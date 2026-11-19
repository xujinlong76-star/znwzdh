import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { LOCAL_LOGO_MAP, resolveLogoTile, resolveSiteIcon } from '../src/components/site-favicon'

/**
 * U-253 补站 Portainer（2026-11-20 进化轮 05:22，容器与编排叶 6→7 站）。
 *
 * 本批 CASES 必须传两参数（url, title）：navigation.json 的 Portainer
 * 条目省略 icon 字段（customIcon 为空），解析走 LOCAL_LOGO_MAP 的
 * hostname 精确查找。Portainer 的 href / 标题均按当前 main 的
 * navigation.json 逐个核对，不可猜；无 customIcon。
 *
 * 来源要点（研究线 A 实测 2026-11-20 05:58–06:10）：
 * - 站方 favicon.ico / favicon.svg / apple-touch-icon.png 均为 404；
 *   head 唯一 icon 声明是内联 data URI，不可用作导航 icon URL。
 * - 品牌标：Simple Icons CDN https://cdn.simpleicons.org/portainer，
 *   200、1,043 B、image/svg+xml，内容 <title>Portainer</title>、fill
 *   #13BEF9，落盘 md5 515dc2e9aa91111bcedc1b0defc95628 与 CDN 一致。
 *   raw GitHub 版为 1,028 B（缺 fill 属性），不采用。
 *
 * 事实钉死（只记、不加占位、不擅自换图）：
 * - 品牌色 #13BEF9 明亮，无需底块（resolveLogoTile 为 null），不做
 *   单站补丁。
 * - 全库 378 站核对：'portainer.io' map 键只命中 Portainer 一站，无后缀串站。
 */

const CASES: Array<{ url: string; title: string; expected: string }> = [
  // 导航条目省略 icon 字段，两参调用走 map 精确查找
  { url: 'https://www.portainer.io', title: 'Portainer', expected: '/brand-icons/portainer.svg' },
  { url: 'https://portainer.io', title: 'Portainer', expected: '/brand-icons/portainer.svg' },
]

describe('resolveSiteIcon（U-253 补站 Portainer）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, expected }) => {
    expect(resolveSiteIcon(url, title)).toBe(expected)
  })

  it("LOCAL_LOGO_MAP['portainer.io'] === '/brand-icons/portainer.svg'", () => {
    expect(LOCAL_LOGO_MAP['portainer.io']).toBe('/brand-icons/portainer.svg')
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘（1 文件）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(existsSync(`${dir}portainer.svg`), 'portainer.svg').toBe(true)
  })

  it('SVG 原样钉死：Simple Icons 1,043 B、fill #13BEF9、<title>Portainer</title>', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(statSync(`${dir}portainer.svg`).size).toBe(1043)
    const svg = readFileSync(`${dir}portainer.svg`, 'utf8')
    expect(svg.includes('<svg')).toBe(true)
    expect(svg.includes('<title>Portainer</title>')).toBe(true)
    expect(svg.includes('#13BEF9')).toBe(true)
  })

  it('事实钉死：无深色变体、无底块', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(existsSync(`${dir}portainer-dark.svg`), 'portainer-dark.svg').toBe(false)
    expect(resolveLogoTile('https://portainer.io')).toBeNull()
    expect(resolveSiteIcon('https://www.portainer.io', 'Portainer')).toBe('/brand-icons/portainer.svg')
  })

  it('事实钉死：portainer.io 键不串站（无子域站、无同名站）', () => {
    expect(resolveSiteIcon('https://portainer.io', 'Portainer')).toBe('/brand-icons/portainer.svg')
    expect(resolveSiteIcon('https://www.portainer.io', 'Portainer')).toBe('/brand-icons/portainer.svg')
  })
})
