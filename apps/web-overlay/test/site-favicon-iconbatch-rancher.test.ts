import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { LOCAL_LOGO_MAP, resolveLogoTile, resolveSiteIcon } from '../src/components/site-favicon'

/**
 * U-08 补站 Rancher（2026-11-20 进化轮 05:22，容器与编排叶 5→6 站）。
 *
 * 本批 CASES 必须传三参数（url, title, customIcon）：navigation.json 的
 * icon 字段（customIcon）在 resolveSiteIcon 里优先级最高，不传就复现不了
 * 真实解析链。Rancher 的 href / 标题 / customIcon 均按当前 main 的
 * navigation.json 逐个核对，不可猜；其 customIcon 为站方 head 自声明的
 * https://www.rancher.com/assets/img/favicon.png，被 isRemoteRawFavicon
 * 拦截（pathname 含 favicon）后回落 map。
 *
 * 来源要点（研究线 D 实测 2026-11-20 05:11–05:30）：
 * - 站方 favicon.ico 200 但 0 B，不可用；favicon.png 200、1,329 B 可用但
 *   被拦截，故 navigation.json 的 icon 字段写它、解析走 map。
 * - 品牌标：Simple Icons CDN https://cdn.simpleicons.org/rancher，
 *   200、1,337 B、image/svg+xml，内容 <title>Rancher</title>、fill
 *   #0075A8，落盘 md5 8066b963408abc1596fcc88c7d0ce118 与 CDN 一致。
 *
 * 事实钉死（只记、不加占位、不擅自换图）：
 * - 深色模式下品牌蓝 #0075A8 偏暗，按统一规范 §9 不做单站补丁、不配
 *   底块，留待统一处理轮；本轮 resolveLogoTile('https://rancher.com')
 *   为 null。
 * - 全库 377 站核对：'rancher.com' map 键只命中 Rancher 一站，无后缀串站。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  // Rancher 的 customIcon 为站方声明的 …/favicon.png，被 isRemoteRawFavicon 拦截
  { url: 'https://www.rancher.com', title: 'Rancher', customIcon: 'https://www.rancher.com/assets/img/favicon.png', expected: '/brand-icons/rancher.svg' },
]

describe('resolveSiteIcon（U-08 补站 Rancher）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, customIcon, expected }) => {
    expect(resolveSiteIcon(url, title, customIcon)).toBe(expected)
  })

  it("LOCAL_LOGO_MAP['rancher.com'] === '/brand-icons/rancher.svg'", () => {
    expect(LOCAL_LOGO_MAP['rancher.com']).toBe('/brand-icons/rancher.svg')
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘（1 文件）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(existsSync(`${dir}rancher.svg`), 'rancher.svg').toBe(true)
  })

  it('SVG 原样钉死：Simple Icons 1,337 B、fill #0075A8、<title>Rancher</title>', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(statSync(`${dir}rancher.svg`).size).toBe(1337)
    const svg = readFileSync(`${dir}rancher.svg`, 'utf8')
    expect(svg.includes('<svg')).toBe(true)
    expect(svg.includes('<title>Rancher</title>')).toBe(true)
    expect(svg.includes('#0075A8')).toBe(true)
  })

  it('事实钉死：无深色变体、无底块，待统一处理轮裁决', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(existsSync(`${dir}rancher-dark.svg`), 'rancher-dark.svg').toBe(false)
    expect(resolveLogoTile('https://rancher.com')).toBeNull()
    expect(resolveSiteIcon('https://www.rancher.com', 'Rancher', 'https://www.rancher.com/assets/img/favicon.png')).toBe('/brand-icons/rancher.svg')
  })

  it('事实钉死：rancher.com 键不串站（无子域站、无同名站）', () => {
    expect(resolveSiteIcon('https://rancher.com', 'Rancher', 'https://www.rancher.com/assets/img/favicon.png')).toBe('/brand-icons/rancher.svg')
    expect(resolveSiteIcon('https://rancher.com', 'Rancher')).toBe('/brand-icons/rancher.svg')
  })
})
