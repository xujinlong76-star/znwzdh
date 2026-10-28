import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { ASSET_MAX_BYTES, MASKABLE_CONTENT_SIZE, MAX_ASSET_INPUT_PIXELS, prepareSiteAsset } from '../src/lib/site-assets'
import { normalizeSettings } from '../src/lib/site-settings'
import type { AssetKind } from '../src/services/siteConfigService'

const mocks = vi.hoisted(() => ({
  verifyAdminSession: vi.fn(), commitFile: vi.fn(), invalidateContentCache: vi.fn(), readSiteSettings: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ verifyAdminSession: mocks.verifyAdminSession }))
vi.mock('@/lib/github', () => ({ commitFile: mocks.commitFile, invalidateContentCache: mocks.invalidateContentCache }))
vi.mock('@/lib/site-config-source', () => ({ readSiteSettings: mocks.readSiteSettings }))

import { POST } from '../src/app/api/site/asset/route'
import manifest from '../src/app/manifest'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.verifyAdminSession.mockResolvedValue({ ok: true, githubToken: 'test-token' })
  mocks.commitFile.mockResolvedValue(undefined)
  mocks.readSiteSettings.mockResolvedValue(normalizeSettings({}))
})
afterAll(() => { vi.resetModules() })

function png(width: number, height = width, alpha = 1) {
  return sharp({ create: { width, height, channels: 4, background: { r: 255, g: 0, b: 0, alpha } } }).png().toBuffer()
}

function ico(payload: Buffer): Buffer {
  const directory = Buffer.alloc(22)
  directory.writeUInt16LE(1, 2)
  directory.writeUInt16LE(1, 4)
  directory[6] = 32
  directory[7] = 32
  directory.writeUInt16LE(1, 10)
  directory.writeUInt16LE(32, 12)
  directory.writeUInt32LE(payload.length, 14)
  directory.writeUInt32LE(22, 18)
  return Buffer.concat([directory, payload])
}

const fixedIcons = [
  ['pwaIcon192', 192], ['pwaIcon512', 512], ['pwaMaskable512', 512], ['appleTouchIcon', 180],
] as const

describe('品牌图片实际内容校验', () => {
  it.each(fixedIcons)('%s 接受正确尺寸 PNG 并返回最终输出元数据', async (kind, size) => {
    const asset = await prepareSiteAsset(kind, 'image/png', await png(size))
    const meta = await sharp(asset.buffer).metadata()
    expect(asset).toMatchObject({ kind, mime: 'image/png', ext: 'png', width: size, height: size, bytes: asset.buffer.length })
    expect(meta).toMatchObject({ format: 'png', width: size, height: size })
    expect(asset.sha256).toBe(createHash('sha256').update(asset.buffer).digest('hex'))
  })

  it.each(fixedIcons)('%s 拒绝尺寸错误、非方形以及 JPEG', async (kind, size) => {
    await expect(prepareSiteAsset(kind, 'image/png', await png(size - 1))).rejects.toThrow(`${size}×${size}`)
    await expect(prepareSiteAsset(kind, 'image/png', await png(size, size - 1))).rejects.toThrow(`${size}×${size}`)
    const jpeg = await sharp(await png(size)).jpeg().toBuffer()
    await expect(prepareSiteAsset(kind, 'image/jpeg', jpeg)).rejects.toMatchObject({ status: 415 })
    await expect(prepareSiteAsset(kind, 'image/png', jpeg)).rejects.toMatchObject({ status: 415 })
  })

  it.each(['logo', 'ogImage', 'favicon'] as const)('%s 校验普通 PNG/JPEG/WebP，不回归现有格式', async (kind) => {
    for (const format of ['png', 'jpeg', 'webp'] as const) {
      const input = await sharp(await png(32, 24)).toFormat(format).toBuffer()
      const asset = await prepareSiteAsset(kind, `image/${format}`, input)
      expect(asset).toMatchObject({ width: 32, height: 24, mime: `image/${format}`, kind })
      expect((await sharp(asset.buffer).metadata()).format).toBe(format)
    }
  })

  it('拒绝伪 MIME、伪 PNG 头、SVG 和非图像数据', async () => {
    const input = await png(32)
    await expect(prepareSiteAsset('logo', 'image/jpeg', input)).rejects.toMatchObject({ status: 415 })
    for (const fake of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), Buffer.from('not an image')]) {
      await expect(prepareSiteAsset('logo', 'image/png', fake)).rejects.toMatchObject({ status: 415 })
    }
    const fakeHeader = Buffer.concat([input.subarray(0, 8), Buffer.alloc(100)])
    await expect(prepareSiteAsset('logo', 'image/png', fakeHeader)).rejects.toThrow('无法完整解码')
    await expect(prepareSiteAsset('logo', 'image/svg+xml', input)).rejects.toMatchObject({ status: 415 })
  })

  it('metadata 成功仍须完整解码：拒绝截断的 PNG 像素数据', async () => {
    const input = await png(192)
    const truncated = input.subarray(0, input.length - 40)
    expect((await sharp(truncated).metadata()).width).toBe(192)
    await expect(prepareSiteAsset('pwaIcon192', 'image/png', truncated)).rejects.toThrow('无法完整解码')
  })

  it('限制输入像素，阻止体积很小的超大解压图片', async () => {
    const input = await png(4001, 4000)
    expect(input.length).toBeLessThan(ASSET_MAX_BYTES.logo)
    expect(4001 * 4000).toBeGreaterThan(MAX_ASSET_INPUT_PIXELS)
    await expect(prepareSiteAsset('logo', 'image/png', input)).rejects.toThrow(/像素/)
  })

  it('拒绝未知 kind、空文件和超出体积限制的输入', async () => {
    await expect(prepareSiteAsset('unknown', 'image/png', await png(32))).rejects.toThrow('未知')
    await expect(prepareSiteAsset('toString', 'image/png', await png(32))).rejects.toThrow('未知')
    await expect(prepareSiteAsset('logo', 'image/png', Buffer.alloc(0))).rejects.toThrow('不能为空')
    await expect(prepareSiteAsset('logo', 'image/png', Buffer.alloc(ASSET_MAX_BYTES.logo + 1))).rejects.toMatchObject({ status: 413 })
  })

  it.each(['image/x-icon', 'image/vnd.microsoft.icon'])('保留 %s ICO 支持，校验头及每个目录边界', async (mime) => {
    const valid = ico(await png(32))
    const asset = await prepareSiteAsset('favicon', mime, valid)
    expect(asset).toMatchObject({ kind: 'favicon', mime, ext: 'ico', width: 32, height: 32, bytes: valid.length })
    expect(asset.buffer).toEqual(valid)
    expect(asset.sha256).toBe(createHash('sha256').update(valid).digest('hex'))
    const mutations = [
      (b: Buffer) => b.writeUInt16LE(1, 0),
      (b: Buffer) => b.writeUInt16LE(2, 2),
      (b: Buffer) => b.writeUInt16LE(0, 4),
      (b: Buffer) => b.writeUInt16LE(65535, 4),
      (b: Buffer) => b.writeUInt32LE(0, 14),
      (b: Buffer) => b.writeUInt32LE(0xffffffff, 14),
      (b: Buffer) => b.writeUInt32LE(6, 18),
      (b: Buffer) => b.writeUInt32LE(b.length, 18),
    ]
    for (const mutate of mutations) {
      const bad = Buffer.from(valid)
      mutate(bad)
      await expect(prepareSiteAsset('favicon', mime, bad)).rejects.toThrow('ICO')
    }
    await expect(prepareSiteAsset('favicon', mime, valid.subarray(0, 5))).rejects.toThrow('ICO')
    await expect(prepareSiteAsset('favicon', mime, await png(32))).rejects.toThrow('ICO')
  })
})

describe('maskable 自动安全留边', () => {
  it('所有内容缩入安全圆，512 PNG 画布为不透明白色，哈希基于处理结果', async () => {
    const input = await png(512)
    const asset = await prepareSiteAsset('pwaMaskable512', 'image/png', input)
    const { data, info } = await sharp(asset.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(info).toMatchObject({ width: 512, height: 512, channels: 4 })
    const padding = (512 - MASKABLE_CONTENT_SIZE) / 2
    let contentPixels = 0
    let transparentPixels = 0
    let nonwhitePadding = 0
    let maxContentRadius = 0
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 512; x++) {
        const offset = (y * 512 + x) * 4
        const white = data[offset] === 255 && data[offset + 1] === 255 && data[offset + 2] === 255
        if (data[offset + 3] !== 255) transparentPixels++
        if (!white) {
          contentPixels++
          if (x < padding || x >= 512 - padding || y < padding || y >= 512 - padding) nonwhitePadding++
          maxContentRadius = Math.max(maxContentRadius, Math.hypot(x + 0.5 - 256, y + 0.5 - 256))
        }
      }
    }
    expect(transparentPixels).toBe(0)
    expect(nonwhitePadding).toBe(0)
    expect(maxContentRadius).toBeLessThanOrEqual(204.8)
    expect(contentPixels).toBe(MASKABLE_CONTENT_SIZE ** 2)
    expect(asset.sha256).not.toBe(createHash('sha256').update(input).digest('hex'))
    expect(asset.sha256).toBe(createHash('sha256').update(asset.buffer).digest('hex'))
  })

  it('接受透明内容并在白色背景上合成，不产生透明边框', async () => {
    const asset = await prepareSiteAsset('pwaMaskable512', 'image/png', await png(512, 512, 0.5))
    const { data, info } = await sharp(asset.buffer).raw().toBuffer({ resolveWithObject: true })
    expect(info.channels).toBe(3)
    expect(Array.from(data.subarray(0, 3))).toEqual([255, 255, 255])
    const center = (256 * 512 + 256) * 3
    expect(data[center]).toBe(255)
    expect(data[center + 1]).toBeGreaterThanOrEqual(126)
    expect(data[center + 1]).toBeLessThanOrEqual(129)
    expect(data[center + 2]).toBe(data[center + 1])
  })
})

function uploadRequest(kind: AssetKind, input: Buffer, mime = 'image/png') {
  const form = new FormData()
  form.set('kind', kind)
  form.set('file', new File([new Uint8Array(input)], 'upload.png', { type: mime }))
  return new Request('http://localhost/api/site/asset', { method: 'POST', body: form })
}

describe('上传路由（认证/存储均 mock，不连接数据库）', () => {
  it('文档保存 kind/mime/bytes/sha256/width/height，URL 哈希来自最终 buffer', async () => {
    const response = await POST(uploadRequest('pwaMaskable512', await png(512)))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(mocks.commitFile).toHaveBeenCalledTimes(1)
    const [path, json] = mocks.commitFile.mock.calls[0]
    const document = JSON.parse(json)
    const buffer = Buffer.from(document.data, 'base64')
    const hash = createHash('sha256').update(buffer).digest('hex')
    expect(document).toMatchObject({ encoding: 'base64', kind: 'pwaMaskable512', mime: 'image/png', bytes: buffer.length, sha256: hash, width: 512, height: 512 })
    expect(body).toMatchObject({ url: `/api/site/asset/pwaMaskable512-${hash.slice(0, 10)}.png`, bytes: buffer.length, sha256: hash })
    expect(path).toBe(`src/navsphere/content/assets/pwaMaskable512-${hash.slice(0, 10)}.png.json`)
    expect(mocks.invalidateContentCache).toHaveBeenCalledWith(path)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('尺寸错和伪 MIME 返回字段可读的 4xx，完全不写存储', async () => {
    const wrongSize = await POST(uploadRequest('pwaIcon192', await png(32)))
    expect(wrongSize.status).toBe(400)
    expect((await wrongSize.json()).error).toContain('192×192')
    const fake = await POST(uploadRequest('pwaIcon512', Buffer.from('not PNG')))
    expect(fake.status).toBe(415)
    expect((await fake.json()).error).toContain('MIME')
    expect(mocks.commitFile).not.toHaveBeenCalled()
    expect(mocks.invalidateContentCache).not.toHaveBeenCalled()
  })

  it('拒绝未授权上传', async () => {
    mocks.verifyAdminSession.mockResolvedValue({ ok: false, error: 'Unauthorized', status: 401 })
    expect((await POST(uploadRequest('pwaIcon192', await png(192)))).status).toBe(401)
    expect(mocks.commitFile).not.toHaveBeenCalled()
  })
})

describe('PWA manifest 品牌图标', () => {
  it('使用三种独立配置，清空则逐项回退内置图', async () => {
    const appearance = {
      pwaIcon192: '/api/site/asset/pwaIcon192-0123456789.png',
      pwaIcon512: '/api/site/asset/pwaIcon512-0123456789.png',
      pwaMaskable512: '/api/site/asset/pwaMaskable512-0123456789.png',
    }
    mocks.readSiteSettings.mockResolvedValue(normalizeSettings({ appearance }))
    expect((await manifest()).icons).toEqual([
      { src: appearance.pwaIcon192, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: appearance.pwaIcon512, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: appearance.pwaMaskable512, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ])
    mocks.readSiteSettings.mockResolvedValue(normalizeSettings({ appearance: { ...appearance, pwaIcon192: '' } }))
    expect((await manifest()).icons?.map((icon) => icon.src)).toEqual(['/icons/icon-192.png', appearance.pwaIcon512, appearance.pwaMaskable512])
    mocks.readSiteSettings.mockResolvedValue(normalizeSettings({}))
    expect((await manifest()).icons?.map((icon) => icon.src)).toEqual(['/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png'])
  })
})
