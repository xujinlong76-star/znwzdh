// Node-only upload processing. No storage/auth imports: tests never touch the hub.
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import type { AssetKind } from '../services/siteConfigService'

export const MAX_ASSET_INPUT_PIXELS = 16_000_000
export const MASKABLE_CONTENT_SIZE = 288
const MASKABLE_SIZE = 512
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 }

export const ASSET_MAX_BYTES: Record<AssetKind, number> = {
  logo: 512 * 1024,
  favicon: 128 * 1024,
  ogImage: 1024 * 1024,
  appleTouchIcon: 512 * 1024,
  pwaIcon192: 512 * 1024,
  pwaIcon512: 1024 * 1024,
  pwaMaskable512: 1024 * 1024,
}

const REQUIRED_SIZE: Partial<Record<AssetKind, number>> = {
  appleTouchIcon: 180,
  pwaIcon192: 192,
  pwaIcon512: 512,
  pwaMaskable512: 512,
}
const FORMATS = new Map<string, 'png' | 'jpeg' | 'webp' | 'ico'>([
  ['image/png', 'png'],
  ['image/jpeg', 'jpeg'],
  ['image/webp', 'webp'],
  ['image/x-icon', 'ico'],
  ['image/vnd.microsoft.icon', 'ico'],
])

export class SiteAssetValidationError extends Error {
  constructor(message: string, public readonly status: 400 | 413 | 415 = 400) {
    super(message)
    this.name = 'SiteAssetValidationError'
  }
}

/** Check declared fields before reading the File into another buffer. */
export function validateSiteAssetUpload(kind: string, mime: string, bytes: number): asserts kind is AssetKind {
  if (!Object.prototype.hasOwnProperty.call(ASSET_MAX_BYTES, kind)) {
    throw new SiteAssetValidationError('未知的图片类型，允许：' + Object.keys(ASSET_MAX_BYTES).join('/'))
  }
  const assetKind = kind as AssetKind
  if (!FORMATS.has(mime)) {
    throw new SiteAssetValidationError('只接受 PNG / JPEG / WebP / ICO（不接受 SVG）', 415)
  }
  if (REQUIRED_SIZE[assetKind] && mime !== 'image/png') {
    throw new SiteAssetValidationError(`${kind} 必须上传 PNG 图片`, 415)
  }
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new SiteAssetValidationError('图片文件不能为空')
  }
  if (bytes > ASSET_MAX_BYTES[assetKind]) {
    throw new SiteAssetValidationError(`文件过大（${kind} 上限 ${ASSET_MAX_BYTES[assetKind] / 1024} KB）`, 413)
  }
}

function bitmapFormat(input: Buffer): 'png' | 'jpeg' | 'webp' | undefined {
  if (input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png'
  if (input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) return 'jpeg'
  if (input.length >= 12 && input.toString('ascii', 0, 4) === 'RIFF' && input.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  return undefined
}

/** sharp has no ICO decoder. Preserve existing ICO support with container validation. */
function validateIco(input: Buffer): { width: number; height: number } {
  const invalid = () => new SiteAssetValidationError('ICO 头或图像目录无效/越界')
  if (input.length < 6 || input.readUInt16LE(0) !== 0 || input.readUInt16LE(2) !== 1) throw invalid()
  const count = input.readUInt16LE(4)
  const directoryEnd = 6 + count * 16
  if (!count || directoryEnd > input.length) throw invalid()
  let width = 0
  let height = 0
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16
    const bytes = input.readUInt32LE(entry + 8)
    const offset = input.readUInt32LE(entry + 12)
    if (input[entry + 3] !== 0 || !bytes || offset < directoryEnd || offset + bytes > input.length) throw invalid()
    const w = input[entry] || 256
    const h = input[entry + 1] || 256
    if (w * h > width * height) { width = w; height = h }
  }
  return { width, height }
}

export interface PreparedSiteAsset {
  buffer: Buffer
  kind: AssetKind
  mime: string
  ext: string
  bytes: number
  sha256: string
  width: number
  height: number
}

/** Validate actual pixels (metadata alone is insufficient), then hash the final output. */
export async function prepareSiteAsset(kind: string, mime: string, input: Buffer): Promise<PreparedSiteAsset> {
  validateSiteAssetUpload(kind, mime, input.length)
  const format = FORMATS.get(mime)!
  let buffer: Buffer
  let width: number
  let height: number

  if (format === 'ico') {
    ;({ width, height } = validateIco(input))
    buffer = input
  } else {
    if (bitmapFormat(input) !== format) {
      throw new SiteAssetValidationError('图片实际格式与声明的 MIME 不符', 415)
    }
    try {
      const image = sharp(input, { limitInputPixels: MAX_ASSET_INPUT_PIXELS, failOn: 'warning' })
      const metadata = await image.metadata()
      if (metadata.format !== format || !metadata.width || !metadata.height) {
        throw new SiteAssetValidationError('无法识别图片的实际格式或尺寸')
      }
      if ((metadata.pages ?? 1) !== 1) throw new SiteAssetValidationError('请上传单帧静态图片')
      if (metadata.width * metadata.height > MAX_ASSET_INPUT_PIXELS) {
        throw new SiteAssetValidationError(`图片不能超过 ${MAX_ASSET_INPUT_PIXELS} 像素`)
      }
      const size = REQUIRED_SIZE[kind]
      if (size && (metadata.width !== size || metadata.height !== size)) {
        throw new SiteAssetValidationError(`${kind} 必须是 ${size}×${size} PNG，当前为 ${metadata.width}×${metadata.height}`)
      }

      // Re-encoding forces a full decode and strips untrusted trailing data/metadata.
      if (kind === 'pwaMaskable512') {
        // 正方形角点也必须落在半径 204.8 的安全圆内：144 * sqrt(2) < 204.8。
        const inset = await image.rotate().resize(MASKABLE_CONTENT_SIZE, MASKABLE_CONTENT_SIZE, {
          fit: 'contain', position: 'centre', background: { ...WHITE, alpha: 0 },
        }).png().toBuffer()
        const padding = (MASKABLE_SIZE - MASKABLE_CONTENT_SIZE) / 2
        const output = await sharp({ create: { width: MASKABLE_SIZE, height: MASKABLE_SIZE, channels: 3, background: WHITE } })
          .composite([{ input: inset, left: padding, top: padding }])
          .removeAlpha().png().toBuffer({ resolveWithObject: true })
        buffer = output.data
        width = output.info.width
        height = output.info.height
      } else {
        const output = await image.rotate().toFormat(format).toBuffer({ resolveWithObject: true })
        buffer = output.data
        width = output.info.width
        height = output.info.height
      }
    } catch (error) {
      if (error instanceof SiteAssetValidationError) throw error
      throw new SiteAssetValidationError(`图片无法完整解码，文件可能损坏或超过 ${MAX_ASSET_INPUT_PIXELS} 输入像素上限`)
    }
  }

  if (buffer.length > ASSET_MAX_BYTES[kind]) {
    throw new SiteAssetValidationError(`处理后的图片过大（${kind} 上限 ${ASSET_MAX_BYTES[kind] / 1024} KB）`, 413)
  }
  return {
    buffer, kind, mime, ext: format === 'jpeg' ? 'jpg' : format,
    bytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    width, height,
  }
}
