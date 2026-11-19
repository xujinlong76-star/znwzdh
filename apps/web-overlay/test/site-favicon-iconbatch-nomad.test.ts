import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { LOCAL_LOGO_MAP, resolveLogoTile, resolveSiteIcon } from '../src/components/site-favicon'

/**
 * U-254 补站 Nomad（2026-11-20 进化轮 06:22，容器与编排叶 7→8 站）。
 *
 * 本批 CASES 必须传两参数（url, title）：navigation.json 的 Nomad
 * 条目省略 icon 字段（customIcon 为空），解析走 LOCAL_LOGO_MAP 的
 * hostname 精确查找。Nomad 的 href / 标题均按当前 main 的
 * navigation.json 逐个核对，不可猜；无 customIcon。
 *
 * 来源要点（研究线 A 实测 2026-11-20 06:35–06:55）：
 * - www.nomadproject.io 200（121,622 B），308 永久跳转至
 *   developer.hashicorp.com/nomad；href 沿用 www.nomadproject.io
 *  （与 GitHub hashicorp/nomad homepage、库内 SEO 工作表一致）。
 * - 站方 favicon.ico 实为跳转目标页 HTML（text/html、121,622 B），
 *   不可用；developer.hashicorp.com 的 favicon 是通用 HashiCorp 标，
 *   非 Nomad 专属，不可用。
 * - 品牌标：Simple Icons CDN https://cdn.simpleicons.org/nomad，
 *   200、277 B，内容 <title>Nomad</title>、fill #00CA8E，落盘 md5
 *   28386b152cf83ccfb1f3463380f238a3 与 CDN 一致。
 *   raw GitHub 版为 262 B（缺 fill 属性），不采用。
 *
 * 事实钉死（只记、不加占位、不擅自换图）：
 * - 品牌绿 #00CA8E 明亮，无需底块（resolveLogoTile 为 null），不做
 *   单站补丁。
 * - 全库 379 站核对：'nomadproject.io' map 键只命中 Nomad 一站，无后缀串站。
 * - 定价 freemium（BUSL 1.1，免费社区版 + 付费 Nomad Enterprise）；
 *   BUSL 不是 OSI 开源许可证，绝不写 open_source（库内 Terraform 的
 *   open_source 是既有不准确先例，不得仿照）。
 */

const CASES: Array<{ url: string; title: string; expected: string }> = [
  // 导航条目省略 icon 字段，两参调用走 map 精确查找
  { url: 'https://www.nomadproject.io', title: 'Nomad', expected: '/brand-icons/nomad.svg' },
  { url: 'https://nomadproject.io', title: 'Nomad', expected: '/brand-icons/nomad.svg' },
]

describe('resolveSiteIcon（U-254 补站 Nomad）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, expected }) => {
    expect(resolveSiteIcon(url, title)).toBe(expected)
  })

  it("LOCAL_LOGO_MAP['nomadproject.io'] === '/brand-icons/nomad.svg'", () => {
    expect(LOCAL_LOGO_MAP['nomadproject.io']).toBe('/brand-icons/nomad.svg')
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘（1 文件）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(existsSync(`${dir}nomad.svg`), 'nomad.svg').toBe(true)
  })

  it('SVG 原样钉死：Simple Icons 277 B、fill #00CA8E、<title>Nomad</title>', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(statSync(`${dir}nomad.svg`).size).toBe(277)
    const svg = readFileSync(`${dir}nomad.svg`, 'utf8')
    expect(svg.includes('<svg')).toBe(true)
    expect(svg.includes('<title>Nomad</title>')).toBe(true)
    expect(svg.includes('#00CA8E')).toBe(true)
  })

  it('事实钉死：无深色变体、无底块', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(existsSync(`${dir}nomad-dark.svg`), 'nomad-dark.svg').toBe(false)
    expect(resolveLogoTile('https://www.nomadproject.io')).toBeNull()
    expect(resolveSiteIcon('https://www.nomadproject.io', 'Nomad')).toBe('/brand-icons/nomad.svg')
  })

  it('事实钉死：nomadproject.io 键不串站（无子域站、无同名站）', () => {
    expect(resolveSiteIcon('https://nomadproject.io', 'Nomad')).toBe('/brand-icons/nomad.svg')
    expect(resolveSiteIcon('https://www.nomadproject.io', 'Nomad')).toBe('/brand-icons/nomad.svg')
  })

  it('防回归：developer.hashicorp.com/nomad 绝不解析到 nomad.svg', () => {
    // 当前行为钉死：'developer.hashicorp.com' 的 map 键已被 Terraform 占用
    // （['developer.hashicorp.com', 'terraform.svg']），resolveSiteIcon 是纯
    // hostname 查找、无路径区分，故该 URL 返回 terraform.svg。若将来有人把
    // Nomad 的 href 改成 developer.hashicorp.com/nomad，必须先加一条 map 前
    // 标题规则（仿 Firefly 先例）再改本断言；本断言先失败即为提醒。
    expect(resolveSiteIcon('https://developer.hashicorp.com/nomad', 'Nomad')).toBe('/brand-icons/terraform.svg')
    expect(resolveSiteIcon('https://developer.hashicorp.com/nomad', 'Nomad')).not.toBe('/brand-icons/nomad.svg')
  })
})
