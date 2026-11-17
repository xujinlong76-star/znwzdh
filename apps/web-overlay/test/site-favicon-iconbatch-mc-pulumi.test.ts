import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标换官方多色版：Pulumi（2026-11-17，用户 17:24 拍板）。
 *
 * 旧图为 Simple Icons 单色版 pulumi.svg（1,955 B，圆点全紫 #8A3391）。
 * 官网现用圆点为紫/黄/粉多色，来源为官网 favicon
 * https://www.pulumi.com/images/favicon.ico（实测 HTTP 200、
 * image/vnd.microsoft.icon、15,086 B、md5 0f6e8de5d9260dacddf0b69c2c0c59bb，
 * 与质量审计记录 15,086 B 一致；ICO 含 48×48 / 32×32 / 16×16 三帧）。
 * 按规范 §1.1/§1.2：ICO 取最大帧（48×48）转 PNG，原样落盘
 * pulumi.png（48×48，绝不放大到 128；源 <128 原样保留）。
 * map 键 pulumi.com 不变，值由 /brand-icons/pulumi.svg 改为
 * /brand-icons/pulumi.png；旧 pulumi.svg 已 git rm。
 *
 * href 与标题按 navigation.json 核对：Pulumi，https://www.pulumi.com/。
 */

const CASES: Array<{ url: string; title: string; expected: string }> = [
  { url: 'https://www.pulumi.com/', title: 'Pulumi', expected: '/brand-icons/pulumi.png' },
]

const LOCAL_ASSETS = ['pulumi.png']

function pngSize(buf: Buffer): { width: number; height: number } {
  // PNG IHDR：8 字节签名 + 4 字节长度 + 'IHDR'，其后大端宽高各 4 字节。
  expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

function decodePngRgba(buf: Buffer): { width: number; height: number; px: Buffer } {
  // 最小 PNG 解码器（仅 node 内置 zlib）：本文件落盘为 8-bit RGBA PNG，
  // 逐行解滤波，还原像素，供多色断言计数。Pillow 实测对照：
  // 不透明像素 847，其中紫 283 / 黄 282 / 粉 282。
  let off = 8
  const idat: Buffer[] = []
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    }
    if (type === 'IDAT') idat.push(Buffer.from(data))
    off += 12 + len
  }
  expect(bitDepth).toBe(8)
  expect(colorType).toBe(6) // RGBA
  const raw = inflateSync(Buffer.concat(idat))
  const bpp = 4
  const stride = width * bpp
  const px = Buffer.alloc(height * stride)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const out = px.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp] : 0
      const b = prev[x]
      const c = x >= bpp ? prev[x - bpp] : 0
      let v = line[x]
      if (filter === 1) v = (v + a) & 0xff
      else if (filter === 2) v = (v + b) & 0xff
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff
      }
      out[x] = v
    }
    prev = Buffer.from(out)
  }
  return { width, height, px }
}

describe('resolveSiteIcon（图标换官方多色版：Pulumi）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, expected }) => {
    expect(resolveSiteIcon(url, title)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('尺寸钉死：48×48 PNG（ICO 最大帧原样，绝不放大到 128）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const buf = readFileSync(`${dir}pulumi.png`)
    expect(pngSize(buf)).toEqual({ width: 48, height: 48 })
  })

  it('多色钉死：圆点含紫/黄/粉三色，非 Simple Icons 全紫单色版', () => {
    // 旧图全紫 #8A3391；官网现用为紫/黄/粉三色圆点簇（Pillow 与本解码器
    // 双重计数一致：不透明 847 像素中紫 283 / 黄 282 / 粉 282）。
    // 阈值留足余量（各 ≥100），钉死“三色俱全”而非逐像素 brittle 断言。
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const { px } = decodePngRgba(readFileSync(`${dir}pulumi.png`))
    let purple = 0
    let yellow = 0
    let pink = 0
    let opaque = 0
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i]
      const g = px[i + 1]
      const b = px[i + 2]
      const a = px[i + 3]
      if (a <= 128) continue
      opaque++
      if (r > 80 && r < 200 && g < 110 && b > 110) purple++
      if (r > 180 && g > 150 && b < 130) yellow++
      if (r > 180 && g < 150 && b > 110) pink++
    }
    expect(opaque).toBeGreaterThan(500)
    expect(purple).toBeGreaterThanOrEqual(100)
    expect(yellow).toBeGreaterThanOrEqual(100)
    expect(pink).toBeGreaterThanOrEqual(100)
  })
})
