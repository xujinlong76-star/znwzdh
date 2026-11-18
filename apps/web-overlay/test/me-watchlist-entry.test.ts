/**
 * U-62a EntryGroups「内容」组加第 4 项追剧清单（测试先行，A 方案）。
 *
 * 契约：
 *  - 内容组第 4 项：{ href: '/me/watchlist'（严格，不是 /drama）,
 *    label: '追剧清单', hint: '在追进度 · 更新提醒', icon: Clapperboard,
 *    badgeKey: 'watchlist', defaultBadge: '进度账本' }；
 *  - 徽章按 WATCHLIST_STORAGE_KEY 条数显示「N 部在追」；空清单/损坏存储
 *    显示默认徽章「进度账本」且链接仍在；
 *  - 头部文案「4 组 12 个功能域」→「4 组 13 个功能域」，并同步 V5 注释；
 *  - 走常量、禁裸键名；me-view.tsx、quick-actions.tsx 不动；不要两处
 *    同时加入口（本文件只锁 entry-groups.tsx）。
 *
 * 仓库 vitest 是 node 环境、无 jsdom：条数统计用可导出的纯函数
 * `countWatchlistEntries` / `resolveWatchlistBadge` 锁定（复用
 * favorites-storage 的 parseFavorites + watchlist 的 sanitizeWatchEntry，
 * 与 useWatchlist.loadLocal 同口径：坏一条丢一条，整份读不出来算 0），
 * 首漆与链接用 renderToString 断言；浏览器内 effect 真跑通由 E2E 覆盖。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import {
  EntryGroups,
  countWatchlistEntries,
  resolveWatchlistBadge,
} from '../src/components/user-center/dashboard/entry-groups'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', 'src')
const readSrc = (rel: string) => readFileSync(join(SRC, rel), 'utf8')

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

// EntryGroups 只从 navhub-api 取 fetchPlugins：桩掉，避免拉起整条 hub 客户端。
vi.mock('@/lib/navhub-api', () => ({
  fetchPlugins: vi.fn(async () => ({ items: [], total: 0, limit: 1, offset: 0 })),
}))

// mock 卫生兜底：isolate:false 下同 worker 的后续文件会看到本文件留下的
// 跨模块 mock，这里统一清掉。
afterAll(() => {
  vi.resetModules()
})

/** 最小合法追剧条目：sanitizeWatchEntry 只认 title/platformSiteId/playUrl 三字段。 */
function entry(title: string) {
  return { title, platformSiteId: 'nav-hongguo', playUrl: 'https://www.hongguo.com' }
}

describe('U-62a 追剧清单入口', () => {
  it('内容组含 /me/watchlist 卡片（严格，不是 /drama），文案与图标齐全', () => {
    const html = renderToString(createElement(EntryGroups, {}))
    expect(html).toContain('href="/me/watchlist"')
    expect(html).toContain('追剧清单')
    expect(html).toContain('在追进度')
    // 追剧清单绝不链到 /drama：那是短剧浏览页，不是清单页。
    expect(html).not.toContain('href="/drama"')
  })

  it('徽章按条数显示「N 部在追」', () => {
    expect(countWatchlistEntries(JSON.stringify([entry('剧A'), entry('剧B')]))).toBe(2)
    expect(resolveWatchlistBadge(2)).toBe('2 部在追')
    expect(countWatchlistEntries(JSON.stringify([entry('剧A')]))).toBe(1)
    expect(resolveWatchlistBadge(1)).toBe('1 部在追')
  })

  it('空清单/损坏存储显示默认徽章「进度账本」且链接仍在', () => {
    expect(countWatchlistEntries('[]')).toBe(0)
    expect(countWatchlistEntries(null)).toBe(0)
    expect(countWatchlistEntries('{bad json')).toBe(0)
    expect(countWatchlistEntries('not-an-array')).toBe(0)
    expect(resolveWatchlistBadge(0)).toBe('进度账本')
    const html = renderToString(createElement(EntryGroups, {}))
    expect(html).toContain('href="/me/watchlist"')
    expect(html).toContain('进度账本')
  })

  it('坏一条丢一条，不拖垮整份清单计数', () => {
    const raw = JSON.stringify([entry('好剧'), { title: '缺字段' }, null, entry('另一部')])
    expect(countWatchlistEntries(raw)).toBe(2)
    expect(resolveWatchlistBadge(2)).toBe('2 部在追')
  })

  it('头部计数已同步为 13（4 组 13 个功能域）', () => {
    const html = renderToString(createElement(EntryGroups, {}))
    expect(html).toContain('4 组 13 个功能域')
    expect(html).not.toContain('4 组 12 个功能域')
  })

  it('源码守卫：走 WATCHLIST_STORAGE_KEY 常量、禁裸键名、V5 注释已同步', () => {
    const src = readSrc('components/user-center/dashboard/entry-groups.tsx')
    expect(src).toContain('WATCHLIST_STORAGE_KEY')
    expect(src).not.toContain('navhub.watchlist.v1')
    expect(src).toContain('Clapperboard')
    expect(src).toContain("href: '/me/watchlist'")
    expect(src).toContain('4 组 13 个功能域')
    expect(src).not.toContain('4 组 × 3 项 = 12')
    expect(src).not.toContain('4 组 12 个功能域')
  })
})
