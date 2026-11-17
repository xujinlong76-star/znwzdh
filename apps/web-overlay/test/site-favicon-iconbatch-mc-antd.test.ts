import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标换官方多色版：Ant Design（2026-11-17，用户 17:24 拍板）。
 *
 * 旧图问题（质量审计 §2-2）：本地 antdesign.svg 977 B 为 Simple Icons
 * 单色版，全蓝；官网现用为圆点与折角带红色的版本。
 * 来源 URL：https://gw.alipayobjects.com/zos/rmsportal/rlpTLlbMzTNYuZGGCVYM.png
 * 本轮重下载核实：HTTP 200、image/png、200×200 PNG、20,228 B，
 * md5 c924155285cdba2f57cbd751674c1bb0，与审计记录字节完全一致。
 * 按规范 §1.2 Pillow LANCZOS 等比缩到 128×128 落盘 antdesign.png（12,445 B），
 * 旧 antdesign.svg 已删；map 原地替换，不另起新块。
 *
 * 站内事实按 navigation.json 核对：标题 Ant Design，href https://ant.design。
 */

const CASES: Array<{ url: string; title: string; expected: string }> = [
  { url: 'https://ant.design', title: 'Ant Design', expected: '/brand-icons/antdesign.png' },
]

const LOCAL_ASSETS = ['antdesign.png']

function pngSize(buf: Buffer): { width: number; height: number } {
  // PNG IHDR：8 字节签名 + 4 字节长度 + 'IHDR'，其后大端宽高各 4 字节。
  expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

function pngPixels(buf: Buffer): { width: number; height: number; rgba: Buffer } {
  // 最小 PNG 解码：只支持 8-bit RGBA（Pillow 落盘即此格式），
  // 拼 IDAT → zlib 解压 → 逐行反滤波，还原 RGBA 像素。
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat: Buffer[] = []
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    const data = buf.subarray(offset + 8, offset + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data))
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + len
  }
  expect(bitDepth).toBe(8)
  expect(colorType).toBe(6)
  const raw = inflateSync(Buffer.concat(idat))
  const channels = 4
  const stride = width * channels
  const rgba = Buffer.alloc(width * height * channels)
  let pos = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++]
    const row = raw.subarray(pos, pos + stride)
    pos += stride
    const prev = y === 0 ? null : rgba.subarray((y - 1) * stride, y * stride)
    const out = rgba.subarray(y * stride, (y + 1) * stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[i - channels] : 0
      const b = prev ? prev[i] : 0
      const c = prev && i >= channels ? prev[i - channels] : 0
      let v = row[i]
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
      out[i] = v
    }
  }
  return { width, height, rgba }
}

describe('resolveSiteIcon（图标换官方多色版 Ant Design）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, expected }) => {
    expect(resolveSiteIcon(url, title)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('光栅尺寸钉死：Ant Design 128×128 PNG', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(pngSize(readFileSync(`${dir}antdesign.png`))).toEqual({ width: 128, height: 128 })
  })

  it('品牌色钉死：官网多色版含红色圆点/折角与蓝色菱形 A，非全蓝单色版', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const { width, height, rgba } = pngPixels(readFileSync(`${dir}antdesign.png`))
    expect({ width, height }).toEqual({ width: 128, height: 128 })
    let red = 0
    let blue = 0
    for (let i = 0; i < rgba.length; i += 4) {
      const r = rgba[i]
      const g = rgba[i + 1]
      const b = rgba[i + 2]
      const a = rgba[i + 3]
      if (a > 200 && r > 180 && g < 110 && b < 110) red++
      if (a > 200 && b > 150 && r < 110) blue++
    }
    // 实测落盘文件：红色像素 1,458、蓝色像素 3,178；阈值留足余量，
    // 只为钉死“红点/红折角存在”，防止回退到全蓝单色版。
    expect(red).toBeGreaterThan(100)
    expect(blue).toBeGreaterThan(1000)
  })
})
