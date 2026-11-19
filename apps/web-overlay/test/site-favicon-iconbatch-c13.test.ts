import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveLogoTile, resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复 C 类第 13 批（2026-11-19，尾巴 1 站）。
 *
 * 1/1 站：Zeabur（后端与云 / IaC 与云厂商）。
 *
 * 本批 CASES 必须传三参数（url, title, customIcon）：navigation.json 的
 * icon 字段（customIcon）在 resolveSiteIcon 里优先级最高，不传就复现不了
 * 真实解析链。Zeabur 的 href / 标题 / customIcon 均按当前 main 的
 * navigation.json 逐个核对，不可猜；其 customIcon 为远端
 * https://zeabur.com/favicon.svg，被 isRemoteRawFavicon 拦截后回落 map。
 *
 * 来源要点（设计证据 ~/workspace/icon-full/staging/c13/EVIDENCE.md）：
 * - Zeabur：官网声明的浅色 favicon /logo.svg 原样（370 B，
 *   viewBox 0 0 32 32，纯图形标无文字，三色 #19181B / #6300FF /
 *   #EE430E；源与落盘 md5 一致 8fb0aeb3bab1c3d7fd2531d91efcb9f1）。
 *   首页声明 4 个图标，/logo.svg 为 rel="icon" type="image/svg+xml"
 *   class="favicon-light"；favicon.ico 404 未用。
 *   /apple-touch-icon.png 与 /favicon-32x32.png 目视为同一 Z 形标，
 *   来源一致。
 *
 * 事实钉死（只记、不加占位、不擅自换图）：
 * - 深色变体未决：Zeabur 另有官网 /logo-dark.svg（368 B，仅黑元素
 *   改为白色），未另行落盘——按统一规范 §9，只落默认浅色标、不做
 *   单站补丁，深色底块问题留待统一处理轮；接线/复审如需定夺深色
 *   变体，请裁决。本轮 resolveLogoTile('https://zeabur.com') 为 null，
 *   不配底块。
 * - 全库 371 站核对：'zeabur.com' map 键只命中 Zeabur 一站，无后缀串站。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  // Zeabur 的 customIcon 为远端 …/favicon.svg，被 isRemoteRawFavicon 拦截
  { url: 'https://zeabur.com', title: 'Zeabur', customIcon: 'https://zeabur.com/favicon.svg', expected: '/brand-icons/zeabur.svg' },
]

const LOCAL_ASSETS: Array<{ name: string }> = [
  { name: 'zeabur.svg' },
]

describe('resolveSiteIcon（图标修复 C 类第 13 批）', () => {
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

  it('SVG 原样钉死：viewBox 0 0 32 32、三色与 370 B', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const svg = readFileSync(`${dir}zeabur.svg`, 'utf8')
    expect(svg.includes('<svg'), 'zeabur.svg').toBe(true)
    expect(svg.includes('viewBox="0 0 32 32"')).toBe(true)
    expect(svg.includes('width="32"')).toBe(true)
    expect(svg.includes('height="32"')).toBe(true)
    expect(svg.includes('#19181B')).toBe(true)
    expect(svg.includes('#6300FF')).toBe(true)
    expect(svg.includes('#EE430E')).toBe(true)
    expect(statSync(`${dir}zeabur.svg`).size).toBe(370)
  })

  it('事实钉死：深色变体 /logo-dark.svg 未落盘、无底块，待裁决', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(existsSync(`${dir}zeabur-dark.svg`), 'zeabur-dark.svg').toBe(false)
    expect(existsSync(`${dir}logo-dark.svg`), 'logo-dark.svg').toBe(false)
    expect(resolveLogoTile('https://zeabur.com')).toBeNull()
    expect(resolveSiteIcon('https://zeabur.com', 'Zeabur', 'https://zeabur.com/favicon.svg')).toBe('/brand-icons/zeabur.svg')
  })

  it('事实钉死：zeabur.com 键不串站（无子域站、无同名站）', () => {
    expect(resolveSiteIcon('https://zeabur.com', 'Zeabur', 'https://zeabur.com/favicon.svg')).toBe('/brand-icons/zeabur.svg')
    // 无 customIcon 时同样走 map，不回落远程 favicon.svg
    expect(resolveSiteIcon('https://zeabur.com', 'Zeabur')).toBe('/brand-icons/zeabur.svg')
  })
})
