import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { LOCAL_LOGO_MAP, resolveLogoTile, resolveSiteIcon } from '../src/components/site-favicon'

/**
 * U-08 补站 OpenShift（2026-11-20 进化轮 08:22，容器与编排叶 8→9 站）。
 *
 * 本批 CASES 必须传两参数（url, title）：navigation.json 的 OpenShift
 * 条目省略 icon 字段（customIcon 为空），解析走 LOCAL_LOGO_MAP 的
 * hostname 精确查找。OpenShift 的 href / 标题均按当前 main 的
 * navigation.json 逐个核对，不可猜；无 customIcon。
 *
 * 来源要点（实施线实测 2026-11-20 08:52–09:05）：
 * - www.openshift.com 200（916,028 B），重定向至
 *   www.redhat.com/en/technologies/cloud-computing/openshift；href 沿用
 *   www.openshift.com（与库内 SEO 工作表 4573 行一致）。
 * - 站方 favicon.ico 实为 cloud.redhat.com/favicon.ico（15,086 B，
 *   ICO 三帧 48×48，Red Hat 通用站标、非 OpenShift 专属），不可用。
 * - 品牌标：Simple Icons CDN https://cdn.simpleicons.org/redhatopenshift，
 *   200、1,046 B，内容 <title>Red Hat Open Shift</title>、fill #EE0000，
 *   落盘 md5 e81052b72c6991f0f131d53a8492fa3b 与 CDN 一致。
 *   注意：slug openshift 会 404（CDN 与 simpleicons.org/icons 均试过），
 *   正确 slug 是 redhatopenshift。
 *
 * 事实钉死（只记、不加占位、不擅自换图）：
 * - 品牌红 #EE0000 明亮，无需底块（resolveLogoTile 为 null），不做
 *   单站补丁。
 * - 全库 383 站核对：'openshift.com' map 键只命中 OpenShift 一站，无后缀串站。
 * - 定价 freemium（免费 Developer Sandbox + 付费订阅 OpenShift Container
 *   Platform / Kubernetes Engine / ROSA；另有免费 8 小时 ROSA 体验）。
 */

const CASES: Array<{ url: string; title: string; expected: string }> = [
  // 导航条目省略 icon 字段，两参调用走 map 精确查找
  { url: 'https://www.openshift.com', title: 'OpenShift', expected: '/brand-icons/openshift.svg' },
  { url: 'https://openshift.com', title: 'OpenShift', expected: '/brand-icons/openshift.svg' },
]

describe('resolveSiteIcon（U-08 补站 OpenShift）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, expected }) => {
    expect(resolveSiteIcon(url, title)).toBe(expected)
  })

  it("LOCAL_LOGO_MAP['openshift.com'] === '/brand-icons/openshift.svg'", () => {
    expect(LOCAL_LOGO_MAP['openshift.com']).toBe('/brand-icons/openshift.svg')
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘（1 文件）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(existsSync(`${dir}openshift.svg`), 'openshift.svg').toBe(true)
  })

  it('SVG 原样钉死：Simple Icons 1,046 B、fill #EE0000、<title>Red Hat Open Shift</title>', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(statSync(`${dir}openshift.svg`).size).toBe(1046)
    const svg = readFileSync(`${dir}openshift.svg`, 'utf8')
    expect(svg.includes('<svg')).toBe(true)
    expect(svg.includes('<title>Red Hat Open Shift</title>')).toBe(true)
    expect(svg.includes('#EE0000')).toBe(true)
  })

  it('事实钉死：无深色变体、无底块', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(existsSync(`${dir}openshift-dark.svg`), 'openshift-dark.svg').toBe(false)
    expect(resolveLogoTile('https://www.openshift.com')).toBeNull()
    expect(resolveSiteIcon('https://www.openshift.com', 'OpenShift')).toBe('/brand-icons/openshift.svg')
  })

  it('事实钉死：openshift.com 键不串站（无子域站、无同名站）', () => {
    expect(resolveSiteIcon('https://openshift.com', 'OpenShift')).toBe('/brand-icons/openshift.svg')
    expect(resolveSiteIcon('https://www.openshift.com', 'OpenShift')).toBe('/brand-icons/openshift.svg')
  })

  it('防回归：www.redhat.com/en/technologies/cloud-computing/openshift 绝不解析到 openshift.svg', () => {
    // 当前行为钉死：'redhat.com' 的 map 键已被 Ansible Collaborative 占用
    // （['redhat.com', 'ansible-collaborative.png']），resolveSiteIcon 是纯
    // hostname 查找、无路径区分，故该 URL 返回 ansible-collaborative.png。
    // 若将来有人把 OpenShift 的 href 改成 redhat.com 产品页，必须先加一条
    // map 前标题规则（仿 Firefly 先例）再改本断言；本断言先失败即为提醒。
    expect(resolveSiteIcon('https://www.redhat.com/en/technologies/cloud-computing/openshift', 'OpenShift')).toBe('/brand-icons/ansible-collaborative.png')
    expect(resolveSiteIcon('https://www.redhat.com/en/technologies/cloud-computing/openshift', 'OpenShift')).not.toBe('/brand-icons/openshift.svg')
  })
})
