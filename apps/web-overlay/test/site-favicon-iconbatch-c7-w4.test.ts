import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复 C 类第 7 批补批（2026-11-20，W4 小说组 1）。
 *
 * 2/20 站：起点中文网 / 晋江文学城。C7 原“安全原因暂缓”经 2026-11-20
 * 调查证实只是 W4 一份报告被安全系统移除，无任何一站涉及安全/侵权/
 * 版权/合规（见 icon-c7-defer-reason-2026-11-20.md §5）；两站官网/
 * favicon 本轮实测均可取。其余 15 站由其他 worker 并行实施，本文件
 * 只覆盖 W4 的 2 站，不碰其他站。
 *
 * 本批 CASES 必须传三参数（url, title, customIcon）：navigation.json 的
 * icon 字段（customIcon）在 resolveSiteIcon 里优先级最高，不传就复现不了
 * 真实解析链。2 站的 href / 标题 / customIcon 均按当前 main 的
 * navigation.json 逐个核对，不可猜；2 站 customIcon 均为远端
 * …/favicon.ico，均被 isRemoteRawFavicon 拦截后回落 map。
 *
 * 来源要点（2026-11-20 15:0x CST，curl，浏览器 UA）：
 * - 起点中文网：首页 202（209 B，反爬挑战页，probe.js，不影响取标，
 *   仿 C8 慕课网/可汗学院“首页被验证墙拦截、favicon 直链 200 即落地”
 *   先例）；favicon.ico 直链 200，4,286 B，image/x-icon，单帧 ICO
 *   32×32 32bpp；Pillow 默认解码转 RGBA PNG 原样落盘 qidian.png
 *   （1,547 B，红底白字“起点中文网”标，主红 #f02737/#e50517，
 *   32×32 全幅不透明，目视核对为官网在用标）。
 * - 晋江文学城：首页 200（71,944 B），站内无 icon 声明，根 favicon.ico
 *   是唯一官方源；favicon.ico 直链 200，2,038 B，image/x-icon，ICO 双帧
 *   均为 16×16（24bpp + 32bpp）；Pillow 默认解码转 RGBA PNG 原样落盘
 *   jjwxc.png（485 B，绿底白字“晋江文学城”标，主绿 #275f15，目视核对
 *   为官网在用标）。16×16 原尺寸按规范 §1.1 原样保留、绝不放大。
 *
 * 事实钉死（只记、不加占位、不擅自换图）：
 * - 晋江 16px 原样小图（jjwxc.png）：官网 favicon 只有 16×16 两帧，
 *   无更大官方方形标，按规范 §1.1“<128 原样保留、绝不放大”落盘
 *   （仿 C12 百合网/世纪佳缘 16px 原样先例）；16px 在卡片内会显小，
 *   是已知特性，非质量问题。
 * - 全库 383 站核对：'qidian.com' / 'jjwxc.net' 各只命中一站，
 *   无后缀串站。navigation.json 不动；'github.com' / 'adobe.com'
 *   键未碰；U-22 5 站未碰。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  // 起点中文网 / 晋江文学城的 customIcon 均含 favicon
  { url: 'https://www.qidian.com', title: '起点中文网', customIcon: 'https://www.qidian.com/favicon.ico', expected: '/brand-icons/qidian.png' },
  { url: 'https://www.jjwxc.net', title: '晋江文学城', customIcon: 'https://www.jjwxc.net/favicon.ico', expected: '/brand-icons/jjwxc.png' },
]

const LOCAL_ASSETS: Array<{ name: string; width: number; height: number }> = [
  // PNG：≥128 源缩到 128，<128 源原样不放大
  { name: 'qidian.png', width: 32, height: 32 },
  { name: 'jjwxc.png', width: 16, height: 16 },
]

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG 魔数 8 字节 + IHDR：宽（offset 16，BE u32）、高（offset 20，BE u32）
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（图标修复 C 类第 7 批补批 W4）', () => {
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

  it('尺寸钉死：PNG 2 站按表', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name, width, height } of LOCAL_ASSETS) {
      const buf = readFileSync(`${dir}${name}`)
      const dims = readPngDimensions(buf)
      expect(dims, name).toEqual({ width, height })
    }
  })

  it('光栅单站落盘 ≤ ~15KB', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name } of LOCAL_ASSETS) {
      expect(statSync(`${dir}${name}`).size, name).toBeLessThanOrEqual(15 * 1024)
    }
  })

  it('事实钉死：起点 32×32 原样（1,547 B，红底白字标）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(readPngDimensions(readFileSync(`${dir}qidian.png`))).toEqual({ width: 32, height: 32 })
    expect(statSync(`${dir}qidian.png`).size).toBe(1547)
    expect(resolveSiteIcon('https://www.qidian.com', '起点中文网', 'https://www.qidian.com/favicon.ico')).toBe('/brand-icons/qidian.png')
  })

  it('事实钉死：晋江 16px 原样小图（485 B，无更大官方方标，不放大）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(readPngDimensions(readFileSync(`${dir}jjwxc.png`))).toEqual({ width: 16, height: 16 })
    expect(statSync(`${dir}jjwxc.png`).size).toBe(485)
    // 晋江与起点确为两站各自的标（字节数不同，此处以字节数区分钉死）。
    expect(readFileSync(`${dir}jjwxc.png`).equals(readFileSync(`${dir}qidian.png`))).toBe(false)
    expect(resolveSiteIcon('https://www.jjwxc.net', '晋江文学城', 'https://www.jjwxc.net/favicon.ico')).toBe('/brand-icons/jjwxc.png')
  })
})
