import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复 C 类第 7 批（2026-11-20，W11，1 站）：Udemy。
 *
 * 本站 CASE 必须传三参数（url, title, customIcon）：navigation.json 的
 * icon 字段（customIcon）在 resolveSiteIcon 里优先级最高，不传就复现不了
 * 真实解析链。href / 标题 / customIcon 均按当前 main 的 navigation.json
 * 核对，不可猜：href https://www.udemy.com、标题 Udemy、customIcon
 * https://www.udemy.com/favicon.ico（远端裸 favicon，被
 * isRemoteRawFavicon 拦截后回落 map）。
 *
 * 来源（浏览器取材 + W11 独立复核，2026-11-20）：
 * - 首页可正常打开，无 403，中文界面完整。
 * - 站根 /favicon.ico 404（返回 Udemy 自身 404 页）；同源 v7 静态目录
 *   下的 favicon.ico、favicon-32x32.png、favicon-144x144.png 也均 404。
 * - 落盘源：https://frontends.udemycdn.com/frontends-homepage/staticx/udemy/images/v7/apple-touch-icon.png
 *   （200、image/png、180×180、1,527 B，SHA-256
 *   1a2683b802a828f68b2014a624aaf3009969dcf75451e6d35c16eb7db40c82e8；
 *   PNG 魔数与 IHDR 尺寸逐字节验过）。
 * - 交叉核对：同源 logo-udemy.svg（1,891 B，viewBox 0 0 91 34），chevron
 *   路径 fill #A435F0、黑色小写 u 字标；调色板分析：白底不透明
 *   （29,004 px 白、无 tRNS 块）、黑 U（0,0,0，1,972 px）、chevron
 *   #A435F0（164,53,240，878 px），与 SVG 的 #A435F0 一致；ASCII 渲染
 *   确认 ⌃ 形 chevron 在上、黑色粗体大写 U 在下。
 * - 落盘：Pillow LANCZOS 180→128（≥128 源缩到 128，批次惯例），RGB PNG，
 *   2,579 B，md5 65c81a2ce9193371cc5f4106796d7635；缩后 ASCII 渲染确认
 *   chevron + U 完好，四角仍为白（255,255,255）。
 *
 * 事实钉死（只记、不加占位、不擅自换图）：
 * - 来源限定：浏览器视图不暴露 head，rel="icon" 的确切声明链接未能直接
 *   读到；apple-touch-icon.png 是同一官方静态目录（frontends.udemycdn.com
 *   /frontends-homepage/staticx/udemy/images/v7/）实测可加载的文件，
 *   以它为源。不是从 rel="icon" 声明链直接取到的。
 * - 白底不透明：落盘图全图不透明、无透明像素，浅/深主题下均显白底方块、
 *   黑 U 可见，无底块（resolveLogoTile 为 null），不做单站补丁，留待
 *   统一处理轮（仿 Midjourney 白底不透明先例；nmc.png 同款已知特性）。
 * - 'udemy.com' 键无后缀串站：全库 383 站核对，只命中 Udemy 一站，
 *   无子域站、无同标题站。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  // Udemy 的 customIcon 为远端裸 favicon（含 favicon），被拦截后回落 map
  { url: 'https://www.udemy.com', title: 'Udemy', customIcon: 'https://www.udemy.com/favicon.ico', expected: '/brand-icons/udemy.png' },
]

const LOCAL_ASSETS: Array<{ name: string; width: number; height: number }> = [
  // PNG：≥128 源缩到 128（180×180 → 128×128，Pillow LANCZOS）
  { name: 'udemy.png', width: 128, height: 128 },
]

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG 魔数 8 字节 + IHDR：宽（offset 16，BE u32）、高（offset 20，BE u32）
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（图标修复 C 类第 7 批 W11）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, customIcon, expected }) => {
    expect(resolveSiteIcon(url, title, customIcon)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘（1 文件）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(LOCAL_ASSETS).toHaveLength(1)
    for (const { name } of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('尺寸钉死：PNG 1 站按表', () => {
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

  it('事实钉死：落盘为官方源 LANCZOS 缩后图（字节数钉死）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    // 180×180 源（1,527 B，SHA-256 1a2683b8…c82e8）→ 128×128 RGB PNG。
    expect(readPngDimensions(readFileSync(`${dir}udemy.png`))).toEqual({ width: 128, height: 128 })
    expect(statSync(`${dir}udemy.png`).size).toBe(2579)
  })

  it('事实钉死：udemy.com 键不串站（全库只命中 Udemy 一站）', () => {
    // 无子域站、无同标题站；裸域键只解析本站。
    expect(resolveSiteIcon('https://www.udemy.com', 'Udemy', 'https://www.udemy.com/favicon.ico')).toBe('/brand-icons/udemy.png')
    expect(resolveSiteIcon('https://www.udemy.com', 'Udemy', undefined)).toBe('/brand-icons/udemy.png')
  })
})
