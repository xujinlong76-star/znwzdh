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

describe('首页「设为首页」引导条在顶部（layout 位置守卫）', () => {
  it('layout 里横幅有且仅有一处渲染点', () => {
    const src = read(LAYOUT)
    // 注意（第 75 轮改写原因）：横幅改走客户端动态边界，layout 的 import
    // 目标从 '@/components/growth/homepage-banner' 换成
    // '@/components/growth/homepage-banner-lazy'；渲染点 <HomepageBanner />
    // 与位置断言不变，锁死点仍是“一处渲染点”。
    expect(src).toContain("import { HomepageBanner } from '@/components/growth/homepage-banner-lazy'")
    expect(src).not.toContain("from '@/components/growth/homepage-banner'")
    const hits = src.split(BANNER_TAG).length - 1
    expect(hits).toBe(1)
  })

  it('横幅渲染在 skip-link 与公告栏之后', () => {
    const src = read(LAYOUT)
    const banner = src.indexOf(BANNER_TAG)
    expect(banner).toBeGreaterThan(src.indexOf('skip-to-content'))
    expect(banner).toBeGreaterThan(src.indexOf('<AnnouncementBar'))
  })

  it('横幅渲染在 <Providers> 与 {children} 之前，即主内容与页脚之前', () => {
    const src = read(LAYOUT)
    const banner = src.indexOf(BANNER_TAG)
    expect(banner).toBeGreaterThan(-1)
    expect(banner).toBeLessThan(src.indexOf('<Providers'))
    // 注意：`{children}` 也出现在函数签名解构处（`RootLayout({ children })`），
    // 须从 <Providers> 之后找 JSX 里的 {children} 才有意义。
    expect(banner).toBeLessThan(src.indexOf('{children}', src.indexOf('<Providers')))
    // 顺带锁住：横幅不在底部导航 / 离线提示 / Toaster 之后。
    expect(banner).toBeLessThan(src.indexOf('<MobileNav />'))
    expect(banner).toBeLessThan(src.indexOf('<OfflineBanner />'))
    expect(banner).toBeLessThan(src.indexOf('<Toaster />'))
  })

  it('横幅仍在 ThemeProvider 内，主题上下文不变', () => {
    const src = read(LAYOUT)
    const banner = src.indexOf(BANNER_TAG)
    expect(banner).toBeGreaterThan(src.indexOf('<ThemeProvider'))
    expect(banner).toBeLessThan(src.indexOf('</ThemeProvider>'))
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
