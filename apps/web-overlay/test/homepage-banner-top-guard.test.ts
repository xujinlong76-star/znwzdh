// 首页横幅必须在顶部：根 layout 里 <HomepageBanner /> 的渲染位置
// 在 {children} 之前。
//
// 背景：横幅组件在 2026-11-18 04:22 轮之前是普通流式 div（无
// fixed/sticky），文件头自称「首页顶部『设为首页』引导条」，但它曾挂在
// ThemeProvider 末尾——Providers / children / MobileNav / OfflineBanner /
// Toaster 之后，实际渲染在文档底部、页脚之后，用户基本看不到，等于功能
// 缺失（2026-11-15 第 72 轮核实）。改法：移到 <Providers>{children}
// </Providers> 之前（仍在 ThemeProvider 内，主题上下文不变）。
//
// 2026-11-18 04:22 轮方案 A（CLS 修法）：横幅根节点改为 fixed 悬浮条
// （`fixed inset-x-0 top-0 z-50`），脱离文档流——首帧 SSR 为 null、水合
// 后才出现时，不再把工具栏与首页内容下推整条横幅高度，位移构造上归零；
// 展开态容器加 `max-h-[70vh] overflow-y-auto` 封顶，不盖住大半视口。
// 本文件的 layout 位置守卫不变（渲染点仍一处、仍在 Providers/children
// 之前）；新增的源码级断言（见文末）锁死 fixed 与展开封顶，防止后人
// 改回流式 div 让 CLS 静默回归。
//
// 锁死点：
//  - layout 里 <HomepageBanner /> 有且仅有一处渲染点。
//  - 渲染点在 skip-link 与公告栏之后、<Providers> 与 {children} 之前，
//    即在主内容与页脚之前。
//  - 组件本身不动：仍只在 `/` 且未关闭、未领取时渲染（见
//    growth-lazy-guard.test.ts 的行为断言），非首页行为不变。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** overlay 与 apps/web 两份布局下都指向包根 */
const ROOT = resolve(HERE, '..')
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')

const LAYOUT = 'src/app/layout.tsx'
const BANNER = 'src/components/growth/homepage-banner.tsx'
const BANNER_TAG = '<HomepageBanner />'
const GUIDE_DIALOG = 'src/components/home-windows/appearance-guide-dialog.tsx'
const MICRO_STRIP = 'src/components/home-micro-strip.tsx'

describe('首页「设为首页」引导已收拢进向导小窗（不再 fixed top-0 遮挡正文）', () => {
  it('layout 不再顶部固定渲染遮挡正文的 <HomepageBanner />', () => {
    const src = read(LAYOUT)
    expect(src).not.toContain(BANNER_TAG)
    expect(src).not.toContain("from '@/components/growth/homepage-banner-lazy'")
    expect(src).not.toContain("from '@/components/growth/homepage-banner'")
  })

  it('AppearanceGuideDialog 懒加载小窗承接设为首页引导与 +100 经验奖励，走 growth-lazy 门面', () => {
    const src = read(GUIDE_DIALOG)
    expect(src).toContain('HOMEPAGE_BANNER_DISMISSED_KEY')
    expect(src).toContain('HOMEPAGE_CLAIM_XP')
    expect(src).toContain('claimHomepageAction')
    expect(src).toContain("from '@/lib/growth-lazy'")
    expect(src).not.toContain("from '@/lib/growth'")
  })

  it('HomeMicroStrip 保留轻量非阻断徽章直达向导小窗，且已领取后自动退场', () => {
    const src = read(MICRO_STRIP)
    expect(src).toContain('HOMEPAGE_BANNER_DISMISSED_KEY')
    expect(src).toContain('向导与设首页')
  })

  it('layout 主题与 Providers 结构仍保持完整', () => {
    const src = read(LAYOUT)
    expect(src).toContain('skip-to-content')
    expect(src).toContain('<AnnouncementBar')
    expect(src).toContain('<Providers')
    expect(src).toContain('<ThemeProvider')
  })
})

describe('首页横幅 fixed 悬浮条（CLS 方案 A，2026-11-18 04:22 轮）', () => {
  it('横幅根节点 fixed 脱离文档流：水合插入不下推任何内容', () => {
    const src = read(BANNER)
    // 根 div 必须同时带 fixed + 全宽 + 顶贴 + 盖过 sticky 工具栏（z-30）：
    // 缺任何一项都会回到流式下推或被工具栏盖住。
    expect(src).toContain('fixed inset-x-0 top-0 z-50')
    expect(src).not.toContain('<div className="border-b border-primary/20 bg-primary/5">')
  })

  it('展开态容器封顶可滚：引导卡不盖住大半视口', () => {
    const src = read(BANNER)
    expect(src).toContain('max-h-[70vh] overflow-y-auto')
    // 展开容器仍是 HomepageGuideCard 的直接父级。
    const cap = src.indexOf('max-h-[70vh]')
    expect(cap).toBeGreaterThan(-1)
    expect(src.indexOf('<HomepageGuideCard compact />', cap)).toBeGreaterThan(cap)
  })
})
