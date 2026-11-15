// 首页横幅必须在顶部：根 layout 里 <HomepageBanner /> 的渲染位置
// 在 {children} 之前。
//
// 背景：横幅组件本身是普通流式 div（无 fixed/sticky），文件头自称
// 「首页顶部『设为首页』引导条」，但它曾挂在 ThemeProvider 末尾——
// Providers / children / MobileNav / OfflineBanner / Toaster 之后，
// 实际渲染在文档底部、页脚之后，用户基本看不到，等于功能缺失
// （2026-11-15 第 72 轮核实）。改法：移到 <Providers>{children}
// </Providers> 之前（仍在 ThemeProvider 内，主题上下文不变）。
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
