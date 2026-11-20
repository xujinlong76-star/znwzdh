import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复 C 类第 7 批补批 W5（2026-11-20，小说组 2）。
 *
 * 2/2 站：纵横中文网 / 飞卢小说网。本批 0 阻塞。
 *
 * 本批 CASES 必须传三参数（url, title, customIcon）：navigation.json 的
 * icon 字段（customIcon）在 resolveSiteIcon 里优先级最高，不传就复现不了
 * 真实解析链。2 站的 href / 标题 / customIcon 均按当前 main 的
 * navigation.json 逐个核对，不可猜；2 站 customIcon 均为远端
 * …/favicon.ico，均被 isRemoteRawFavicon 拦截后回落 map。
 *
 * 来源要点（2026-11-20 curl，浏览器 UA）：
 * - 纵横中文网：首页 200（447,577 B），声明 rel="icon"
 *   href="/favicon.ico"；/favicon.ico 200，742 B，image/x-icon，
 *   内容实为 PNG 16×16（md5 5c2a43cd336a629e5852d2f9e8f21bde），
 *   按内容解码原样落盘 zongheng.png，红底白字纵横标。
 * - 飞卢小说网：首页 200（31,330 B），声明 rel="shortcut icon"
 *   href="//s.faloo.com/novel/favicon.ico"；该声明源与根 /favicon.ico
 *   md5 相同（c4f3df9dec223473188a362ae250ba41），均为 200、9,662 B、
 *   image/x-icon，单帧 48×48 32bpp ICO，Pillow 转 PNG 原样落盘
 *   faloo.png（3,708 B），绿底白字“飞卢”书法标。
 *
 * 事实钉死（只记、不加占位、不擅自换图）：
 * - 纵横 16px 原样小图：官网 favicon 原尺寸，按规范 §1.1 原样保留、
 *   绝不放大（C6 唯品会 / 速卖通 / 携程仅 16px 已接受原样，有先例）。
 *   16px 在卡片内会显小，是已知特性，非质量问题。
 * - 全库 383 站核对：'zongheng.com' / 'faloo.com' 各只命中一站，
 *   无后缀串站、无子域站。navigation.json 不动；
 *   'github.com' / 'adobe.com' 键未碰；U-22 5 站未碰；其余 C7 站未碰。
 * - C7 暂缓“安全原因”经调查只是 W4 报告被安全系统移除，无任何一站
 *   涉及安全/侵权/版权/合规（icon-c7-defer-reason-2026-11-20.md §5）；
 *   本批实施中未再次出现“报告被安全系统移除”类提示。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  // 纵横中文网 / 飞卢小说网的 customIcon 均含 favicon
  { url: 'https://www.zongheng.com', title: '纵横中文网', customIcon: 'https://www.zongheng.com/favicon.ico', expected: '/brand-icons/zongheng.png' },
  { url: 'https://www.faloo.com', title: '飞卢小说网', customIcon: 'https://www.faloo.com/favicon.ico', expected: '/brand-icons/faloo.png' },
]

const LOCAL_ASSETS: Array<{ name: string; width: number; height: number; size: number; md5: string }> = [
  // PNG：<128 源原样不放大
  { name: 'zongheng.png', width: 16, height: 16, size: 742, md5: '5c2a43cd336a629e5852d2f9e8f21bde' },
  { name: 'faloo.png', width: 48, height: 48, size: 3708, md5: '85c2edbff7f22b625ff7246139948824' },
]

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG 魔数 8 字节 + IHDR：宽（offset 16，BE u32）、高（offset 20，BE u32）
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（图标修复 C 类第 7 批补批 W5）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, customIcon, expected }) => {
    expect(resolveSiteIcon(url, title, customIcon)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘（2 文件）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(LOCAL_ASSETS).toHaveLength(2)
    for (const { name } of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('尺寸 / 字节数 / md5 钉死：PNG 2 站按表', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name, width, height, size, md5 } of LOCAL_ASSETS) {
      const buf = readFileSync(`${dir}${name}`)
      expect(readPngDimensions(buf), name).toEqual({ width, height })
      expect(statSync(`${dir}${name}`).size, name).toBe(size)
      expect(createHash('md5').update(buf).digest('hex'), name).toBe(md5)
    }
  })

  it('光栅单站落盘 ≤ ~15KB（2 站均在参考线内）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name } of LOCAL_ASSETS) {
      expect(statSync(`${dir}${name}`).size, name).toBeLessThanOrEqual(15 * 1024)
    }
  })

  it('事实钉死：纵横 16px 原样小图（官网 favicon 原尺寸，绝不放大）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(readPngDimensions(readFileSync(`${dir}zongheng.png`))).toEqual({ width: 16, height: 16 })
    expect(statSync(`${dir}zongheng.png`).size).toBe(742)
    // 纵横与飞卢确为两站各自的标（md5 不同，此处以字节不等钉死）。
    expect(readFileSync(`${dir}zongheng.png`).equals(readFileSync(`${dir}faloo.png`))).toBe(false)
  })

  it('事实钉死：两站 map 键不串站（各只命中本站）', () => {
    // 'zongheng.com' / 'faloo.com' 在全库 383 站中各只命中一站；
    // 去 www 后的 hostname 精确命中 map，无后缀串站。
    expect(resolveSiteIcon('https://www.zongheng.com', '纵横中文网', 'https://www.zongheng.com/favicon.ico')).toBe('/brand-icons/zongheng.png')
    expect(resolveSiteIcon('https://www.faloo.com', '飞卢小说网', 'https://www.faloo.com/favicon.ico')).toBe('/brand-icons/faloo.png')
    expect(resolveSiteIcon('https://www.zongheng.com', '纵横中文网', 'https://www.zongheng.com/favicon.ico')).not.toBe('/brand-icons/faloo.png')
    expect(resolveSiteIcon('https://www.faloo.com', '飞卢小说网', 'https://www.faloo.com/favicon.ico')).not.toBe('/brand-icons/zongheng.png')
  })
})
