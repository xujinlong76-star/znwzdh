import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveLogoTile, resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复：进化轮 2026-11-22-2222（C 线，4 站 AI 办公）：
 * 千问办公 / WPS 灵犀 / WorkBuddy / 百度搭子。
 *
 * 本站 CASE 必须传三参数（url, title, customIcon）：4 站在 navigation.json
 * 里均省略 icon 字段（customIcon 为 undefined），不传就复现不了真实解析链。
 * href / 标题均按当前 main 的 navigation.json 核对，不可猜：
 * 千问办公 https://qwenwork.cn/、WPS 灵犀 https://lingxi.kdocs.cn/、
 * WorkBuddy https://www.workbuddy.cn/、百度搭子 https://dumate.baidu.com/app。
 *
 * 背景（B 线研究，2026-11-22 22:26–22:36）：全库 23 站 icon 字段为空，
 * 逐一核对 site-favicon.tsx 的 map 键后 19 站有本地 map 键兜底，仅此 4 站
 * 既无 icon 字段又无 map 键，卡片只能渲染「渐变底 + 首字母」兜底徽章；
 * 4 站全在最热的 AI 办公类目。
 *
 * 来源（全部 curl 重新验证，200 + image MIME + 魔数 + 尺寸）：
 * - 千问办公：官网 apple-touch-icon 180×180
 *   https://img.alicdn.com/imgextra/i4/O1CN01HdCyPs1MZh3Szwmxo_!!6000000001449-2-tps-180-180.png
 *   （13,406 B，SHA-256
 *   0287e8361985920e2cb0ac7d941c0f11e622b33bbbfe12a3d44aa56f08cf06de；
 *   首页 head 另声明 32×32 / 48×48 同标，站根 /favicon.svg 404 未用）。
 *   黑圆角方块 + 亮绿 #52E890 字标，四角透明；Pillow LANCZOS 180→128。
 * - WPS 灵犀：manifest
 *   https://qn.cache.wpscdn.cn/lingxi-app/web/manifest_v2.json 给出官方
 *   logo 三档，取 192×192
 *   https://qn.cache.wpscdn.cn/copilot-test/copilot-cdn/images/copilot/lingxi_logo_192_v1.png
 *   （19,806 B，SHA-256
 *   5e59eb231012f80de70f2bc7102f64c61337675a2d21fc71974cca0b367929f5；
 *   站根 /favicon.ico 实为 HTML 壳页未用）。青紫渐变圆角徽 + 白底黑字标，
 *   四角透明；Pillow LANCZOS 192→128。
 * - WorkBuddy：官网 logo.svg
 *   https://assets.workbuddy.cn/web/workbuddy/7b25e1f24385a28a7c133de175ff1dc2bc6b455e/assets/logo.svg
 *   （image/svg+xml、4,142 B，SHA-256
 *   10ccbc099e7bc3d5ff12c315c4edd7b21386aa7166c1ec19997b3d55010d5c7d；
 *   40×40 viewBox 渐变圆角方块），SVG 原样。
 * - 百度搭子：站方 favicon.png
 *   https://now.bdstatic.com/store/v2/d33e0f5/qianfan-desktop-h5/4d5dbbe/favicon.png
 *   （image/png、5,521 B，144×144，SHA-256
 *   02e8924440fddc11aff3574eeb6f74aec55a6a21d154b86d6fd81eb21a1dd3a2）。
 *   浅薰衣草圆角方块 + 深色字标，四角透明；Pillow LANCZOS 144→128。
 *
 * 事实钉死（只记、不加占位、不擅自换图）：
 * - 'qwen.svg' 已被通义千问占用，不可复用于千问办公；标题 '千问办公'
 *   不含 'qwen'，不触发上方 qwen3 标题规则。
 * - 'lingxi.kdocs.cn' 必须用完整子域精确键：map 已有 'kdocs.cn=kdocsj'
 *   （金山文档站），后缀匹配会让灵犀错指 kdocs.jpg；精确查找在后缀循环
 *   之前，精确键优先命中（本文件末两条断言钉死）。
 * - 'dumate.baidu.com' 用完整子域键；map 无 'baidu.com' 裸域键，绝不加。
 * - 浅/深主题：四标 ASCII 渲染均为真实品牌标；qwenwork 深色下黑方块与底色
 *   相融但亮绿字标仍醒目，lingxi 渐变徽边框定形、dumate 深色字标可读，
 *   workbuddy 满幅渐变方块双主题均可见；按规范 §9 不做单站底块补丁、
 *   不配 LOGO_TILE_MAP（resolveLogoTile 为 null），留待统一处理轮。
 * - lingxi.png 15,659 B：调色板量化会改 10% 像素（1,647/16,384 像素差 >8，
 *   青紫渐变会断带），故保留 RGBA；15KB 是各批次自设惯例值、非全局守卫
 *   （nmc.png 21,543 B、chinatax.png 98,842 B 已在库），本批光栅上限放宽
 *   到 16KB 并钉死字节数。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  // 4 站均无 icon 字段（customIcon 为 undefined），解析走 map 精确键
  { url: 'https://qwenwork.cn/', title: '千问办公', customIcon: undefined, expected: '/brand-icons/qwenwork.png' },
  { url: 'https://lingxi.kdocs.cn/', title: 'WPS 灵犀', customIcon: undefined, expected: '/brand-icons/lingxi.png' },
  { url: 'https://www.workbuddy.cn/', title: 'WorkBuddy', customIcon: undefined, expected: '/brand-icons/workbuddy.svg' },
  { url: 'https://dumate.baidu.com/app', title: '百度搭子', customIcon: undefined, expected: '/brand-icons/dumate.png' },
]

const LOCAL_ASSETS: Array<{ name: string; width?: number; height?: number }> = [
  // PNG：≥128 源缩到 128（qwenwork 180→128、lingxi 192→128、dumate 144→128，Pillow LANCZOS）
  { name: 'qwenwork.png', width: 128, height: 128 },
  { name: 'lingxi.png', width: 128, height: 128 },
  { name: 'dumate.png', width: 128, height: 128 },
  // SVG 原样：WorkBuddy 官网 logo.svg（40×40 viewBox）
  { name: 'workbuddy.svg' },
]

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG 魔数 8 字节 + IHDR：宽（offset 16，BE u32）、高（offset 20，BE u32）
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（进化轮 2026-11-22-2222，4 站 AI 办公）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, customIcon, expected }) => {
    expect(resolveSiteIcon(url, title, customIcon)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘（4 文件）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(LOCAL_ASSETS).toHaveLength(4)
    for (const { name } of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('尺寸钉死：PNG 3 站按表 128×128；SVG 为官方原样', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name, width, height } of LOCAL_ASSETS) {
      if (name.endsWith('.png')) {
        const dims = readPngDimensions(readFileSync(`${dir}${name}`))
        expect(dims, name).toEqual({ width, height })
      } else {
        const text = readFileSync(`${dir}${name}`, 'utf8')
        expect(text.startsWith('<svg')).toBe(true)
        expect(text).toContain('viewBox="0 0 40 40"')
      }
    }
  })

  it('光栅单站落盘 ≤ 16KB（lingxi 渐变保留 RGBA，见文件头事实钉死）；SVG ≤ 8KB', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name } of LOCAL_ASSETS) {
      const limit = name.endsWith('.svg') ? 8 * 1024 : 16 * 1024
      expect(statSync(`${dir}${name}`).size, name).toBeLessThanOrEqual(limit)
    }
  })

  it('事实钉死：落盘为官方源 LANCZOS 缩后图 / 官方 SVG 原样（字节数与 md5 钉死）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    // qwenwork：180×180 源（13,406 B）→ 128×128 RGBA PNG。
    expect(statSync(`${dir}qwenwork.png`).size).toBe(10112)
    expect(createHash('md5').update(readFileSync(`${dir}qwenwork.png`)).digest('hex')).toBe(
      'd9ee7cd24b0f1b9eefe7526874ecb83b',
    )
    // lingxi：192×192 源（19,806 B）→ 128×128 RGBA PNG。
    expect(statSync(`${dir}lingxi.png`).size).toBe(15659)
    expect(createHash('md5').update(readFileSync(`${dir}lingxi.png`)).digest('hex')).toBe(
      '2ce27498de252b0dc9e2dd1d2b23f1fb',
    )
    // dumate：144×144 源（5,521 B）→ 128×128 RGBA PNG。
    expect(statSync(`${dir}dumate.png`).size).toBe(11969)
    expect(createHash('md5').update(readFileSync(`${dir}dumate.png`)).digest('hex')).toBe(
      'fd009359737bf1f7a76678bcce1e0722',
    )
    // workbuddy：官网 logo.svg 原样（4,142 B）。
    expect(statSync(`${dir}workbuddy.svg`).size).toBe(4142)
    expect(createHash('md5').update(readFileSync(`${dir}workbuddy.svg`)).digest('hex')).toBe(
      '7a3a3dedb5330b627e3a6039b014ea87',
    )
  })

  it('事实钉死：精确键不串站（同域兄弟站仍走各自的旧键）', () => {
    // lingxi 精确键优先于 kdocs.cn 后缀键：金山文档仍解析为 kdocs.jpg。
    expect(resolveSiteIcon('https://lingxi.kdocs.cn/', 'WPS 灵犀', undefined)).toBe('/brand-icons/lingxi.png')
    expect(resolveSiteIcon('https://www.kdocs.cn', '金山文档', 'https://www.kdocs.cn/favicon.ico')).toBe(
      '/brand-icons/kdocs.jpg',
    )
    // dumate 完整子域键不影响 Baidu Comate（comate.baidu.com 旧键）。
    expect(resolveSiteIcon('https://dumate.baidu.com/app', '百度搭子', undefined)).toBe('/brand-icons/dumate.png')
    expect(resolveSiteIcon('https://comate.baidu.com', 'Baidu Comate', 'https://comate.baidu.com/favicon.ico')).toBe(
      '/brand-icons/comate.png',
    )
    // 千问办公不触发 qwen3 标题规则（标题为中文，不含 'qwen'）。
    expect(resolveSiteIcon('https://qwenwork.cn/', '千问办公', undefined)).toBe('/brand-icons/qwenwork.png')
  })

  it('事实钉死：4 站无底块（resolveLogoTile 为 null，留待统一处理轮）', () => {
    expect(resolveLogoTile('https://qwenwork.cn/')).toBeNull()
    expect(resolveLogoTile('https://lingxi.kdocs.cn/')).toBeNull()
    expect(resolveLogoTile('https://www.workbuddy.cn/')).toBeNull()
    expect(resolveLogoTile('https://dumate.baidu.com/app')).toBeNull()
  })
})
