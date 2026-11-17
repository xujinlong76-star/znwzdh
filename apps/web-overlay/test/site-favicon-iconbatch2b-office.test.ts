import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复第二批 2b 之办公学习类（B 批）回归（2026-11-17，进化轮）。
 *
 * 背景：2b 剩余 + 2c 的 rest-2c 测试先按旧值（capcut/jimeng/zhaopin
 * 的 .ico、极客公园未入 map）落盘；B 批 8 站的资产由 icons/b1
 * （99a848a1：capcut/jimeng/tianyin/youxi）与 icons/b2（8510815e：
 * geekbang/zhaopin/geekpark，icourse163 与基底逐字节相同、无改动）
 * 两批设计提交合批：map 值改 .png、极客公园新入 map、孤儿 .ico 删
 * 除、极客公园加深色底块渲染分支（见 site-favicon.tsx isGeekparkSite）。
 *
 * 这个测试直接执行 resolveSiteIcon：map 键写错一个字符（多一个 www、
 * 少一个字母）都不会报错，只会静默回落渐变——只有跑起来才看得见。
 * 全部 8 站的 href 与标题均按 navigation.json 逐个核对，不可猜。
 * 天音黑字透明底：深色模式下对比度弱是已知局限（与 2a 的 Ollama /
 * SourceHut 黑标同款处理），此处只写进注释钉死、不打补丁，留待
 * 深色底块统一处理轮。
 */

const CASES: Array<{ url: string; title: string; expected: string }> = [
  { url: 'https://www.capcut.cn/', title: '剪映专业版', expected: '/brand-icons/capcut.png' },
  { url: 'https://jimeng.jianying.com', title: '即梦AI', expected: '/brand-icons/jimeng.png' },
  { url: 'https://tianyin.163.com/', title: '网易天音', expected: '/brand-icons/tianyin.png' },
  { url: 'https://youxi.fullpeace.net', title: '有戏AI', expected: '/brand-icons/youxi.png' },
  { url: 'https://www.icourse163.org', title: '中国大学MOOC', expected: '/brand-icons/icourse163.png' },
  { url: 'https://time.geekbang.org/', title: '极客时间', expected: '/brand-icons/geekbang.jpg' },
  { url: 'https://www.zhaopin.com', title: '智联招聘', expected: '/brand-icons/zhaopin.png' },
  { url: 'https://www.geekpark.net', title: '极客公园', expected: '/brand-icons/geekpark.png' },
]

const LOCAL_ASSETS = [
  'capcut.png',
  'jimeng.png',
  'tianyin.png',
  'youxi.png',
  'icourse163.png',
  'geekbang.jpg',
  'zhaopin.png',
  'geekpark.png',
]

/** 读 PNG IHDR（字节 16-23 为宽/高，各 4 字节大端）。 */
function readPngSize(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

/** 读 JPEG SOF0/SOF2 段的宽/高（跳过 SOI 与各 APPn 段）。 */
function readJpegSize(buf: Buffer): { width: number; height: number } {
  let offset = 2
  while (offset < buf.length - 1) {
    if (buf[offset] !== 0xff) throw new Error('invalid JPEG marker')
    const marker = buf[offset + 1]!
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) }
    }
    const len = buf.readUInt16BE(offset + 2)
    offset += 2 + len
  }
  throw new Error('no JPEG SOF segment found')
}

describe('resolveSiteIcon（图标修复第二批 2b 之办公学习类 B 批）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, expected }) => {
    expect(resolveSiteIcon(url, title)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('本地资产尺寸钉死：128 / 64 / 48 方标与极客公园 100x100 方标', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    // 128 方标：天音 / 有戏（PNG 读 IHDR）、极客时间（JPEG 读 SOF）。
    for (const name of ['tianyin.png', 'youxi.png']) {
      const { width, height } = readPngSize(readFileSync(`${dir}${name}`))
      expect([width, height], name).toEqual([128, 128])
    }
    expect(readJpegSize(readFileSync(`${dir}geekbang.jpg`)), 'geekbang.jpg').toEqual({
      width: 128,
      height: 128,
    })
    // 64 方标：剪映 / 即梦 / 中国大学 MOOC（ICO 64x64 取帧 / 原样不放大）。
    for (const name of ['capcut.png', 'jimeng.png', 'icourse163.png']) {
      const { width, height } = readPngSize(readFileSync(`${dir}${name}`))
      expect([width, height], name).toEqual([64, 64])
    }
    // 48 方标：智联（ICO 48x48 解码转 PNG）。
    expect(readPngSize(readFileSync(`${dir}zhaopin.png`)), 'zhaopin.png').toEqual({
      width: 48,
      height: 48,
    })
    // 方标：极客公园 100x100 远端方形标，宽高比 1。
    const geekpark = readPngSize(readFileSync(`${dir}geekpark.png`))
    expect(geekpark, 'geekpark.png').toEqual({ width: 100, height: 100 })
    expect(geekpark.width / geekpark.height).toBeCloseTo(1, 5)
  })

  it('本地资产魔数与体积钉死：PNG/JPEG 魔数、有戏 ≤ ~15KB', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    for (const name of ['capcut.png', 'jimeng.png', 'tianyin.png', 'youxi.png', 'icourse163.png', 'zhaopin.png', 'geekpark.png']) {
      const buf = readFileSync(`${dir}${name}`)
      expect(buf.subarray(0, 8).equals(pngMagic), name).toBe(true)
    }
    const jpegMagic = Buffer.from([0xff, 0xd8, 0xff])
    expect(readFileSync(`${dir}geekbang.jpg`).subarray(0, 3).equals(jpegMagic), 'geekbang.jpg').toBe(true)
    // 有戏 AI 原图 600x600/422095B 已压到 128px 调色板 PNG 7081B。
    expect(readFileSync(`${dir}youxi.png`).length).toBeLessThanOrEqual(15 * 1024)
  })
})
