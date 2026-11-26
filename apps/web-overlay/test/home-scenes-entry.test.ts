/**
 * U-441：场景包首页主入口守卫。
 *
 * 背景：/scenes 的活挂载此前只有四处（场景页自身、AI 找站面板、搜索 AI Tab），
 * 均不在首页主 chrome 内；首页主 chrome 里唯一的 /scenes 链接在已删的
 * HomeMicroStrip:167（U-437）。本轮在首页主 chrome 补三个一级入口：
 *   1. 页脚导航（footer.tsx）：「场景包」，全宽渲染、两视口都在 DOM 内；
 *   2. 胶囊行桌面端（home-capsule-row.tsx）：工作区胶囊同行幽灵样式链接；
 *   3. 胶囊行移动端快捷入口下拉项：asChild 直出 /scenes 链接。
 *
 * 仓库 vitest 是 node 环境、无 jsdom：用 react-dom/server 的 renderToString
 * 做服务端渲染断言（不挂载，effect 不跑，正好对应首屏输出）。next/link 与
 * next/dynamic 用 vi.mock 隔离——本文件测入口接线，不测 Link 与懒加载本身。
 * 下拉菜单内容只在打开时挂载，SSR 抓不到第 3 项，故它只做源码级断言；
 * 第 1、2 项在 SSR HTML 里直接可见。
 */
import { describe, expect, it, vi, afterAll } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Footer } from '../src/components/footer'
import { HomeCapsuleRow } from '../src/components/home-capsule-row'

// next/link 在 node 测试环境没有 Next 运行时：替成直通 <a>，只保留 href/文案。
vi.mock('next/link', async () => {
  const React = await import('react')
  return {
    default: ({ href, children, ...props }: { href?: string; children?: React.ReactNode }) =>
      React.createElement(
        'a',
        { href: typeof href === 'string' ? href : '#', ...props },
        children,
      ),
  }
})

// next/dynamic 的弹窗在 SSR 输出里不渲染：替成空组件（弹窗本身的覆盖在其余测试里）。
vi.mock('next/dynamic', () => ({
  default: () => () => null,
}))

// mock 卫生兜底：isolate:false 下同 worker 的后续文件会看到本文件留下的
// 跨模块 mock，这里统一清掉。
afterAll(() => {
  vi.resetModules()
})

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(resolve(HERE, '..', rel), 'utf8')

describe('U-441：场景包在首页主 chrome 有一级入口', () => {
  it('页脚导航有「场景包」链接（href="/scenes"，与短剧专区同组）', () => {
    const footer = read('src/components/footer.tsx')
    expect(footer).toContain('href="/scenes"')
    expect(footer).toContain('>场景包</Link>')
  })

  it('胶囊行桌面端有「场景包」链接（与工作区胶囊同行、同款幽灵样式，非 tab）', () => {
    const row = read('src/components/home-capsule-row.tsx')
    expect(row).toContain('href="/scenes"')
    expect(row).toContain('<span>场景包</span>')
    // 不是 tab：两个 /scenes 链接（桌面行 + 移动端下拉项）都不带 role="tab"，
    // 不进 tablist、不参与方向键漫游与单行胶囊预算。
    const links = [...row.matchAll(/<Link[\s\S]*?>/g)].map((m) => m[0])
    expect(links).toHaveLength(2)
    for (const link of links) expect(link).not.toContain('role="tab"')
  })

  it('胶囊行移动端快捷入口下拉项有「场景包」（asChild 直出 /scenes 链接）', () => {
    const row = read('src/components/home-capsule-row.tsx')
    expect(row).toContain('<DropdownMenuItem asChild>')
    const item = row.slice(row.indexOf('<DropdownMenuItem asChild>'))
    expect(item).toContain('href="/scenes"')
    expect(item).toContain('场景包')
  })

  it('SSR：页脚渲染出 /scenes 链接（1366px 与 390px 都在 DOM 内，无宽度门控）', () => {
    const html = renderToString(createElement(Footer, {}))
    expect(html).toContain('href="/scenes"')
    expect(html).toContain('场景包')
  })

  it('SSR：胶囊行渲染出 /scenes 链接（桌面行 CSS 隐藏仍进 HTML，移动端下拉项在源码侧）', () => {
    const html = renderToString(
      createElement(HomeCapsuleRow, {
        pluginItems: null,
        onWorkspaceChange: () => {},
      }),
    )
    expect(html).toContain('href="/scenes"')
    expect(html).toContain('场景包')
  })
})
