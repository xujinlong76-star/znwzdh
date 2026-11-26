/**
 * B1 收尾：/drama「继续追」行 + 首页微胶囊的相对时间 meta。
 *
 * 口径（23:22 轮 W7 定稿，实施轮落实）：
 * - 时间只写真实改进度的时间：episode > 0 且 lastProgressAt 合法时写
 *   「上次进度 ×天前」（/drama）/「· ×天前」（首页微胶囊），复用
 *   formatRelativeTime，与 W3 G2 同口径；
 * - 还没开始看（episode = 0）的剧没有进度可写，不写时间；
 * - lastProgressAt 非法（NaN / 0 / 非数字）时整段省略，绝不渲染
 *   formatRelativeTime 的「—」；
 * - 时间只在页面刷新时重算，不承诺实时刷新。
 *
 * 仓库 vitest 是 node 环境、无 jsdom：用 react-dom/server 的 renderToString
 * 做服务端渲染断言（不挂载，effect 不跑，正好对应首屏输出）。next/link、
 * next/navigation 与 useWatchlist 等钩子用 vi.mock 隔离——本文件测两处
 * 时间 meta 的接线，不测 Link 与清单钩子本身。
 */
import { describe, expect, it, vi, afterAll } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DramaContent } from '../src/components/drama-content'
import {
  dramaKeyFor,
  type WatchEntry,
} from '../src/lib/watchlist'

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

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}))

// useWatchlist：可变的清单桩——每个用例先 setWatchlist 再渲染。
const watchlistState = vi.hoisted(() => ({
  ready: true,
  entries: [] as WatchEntry[],
  storageBlocked: null as string | null,
}))

vi.mock('@/hooks/useWatchlist', () => ({
  useWatchlist: () => ({
    ready: watchlistState.ready,
    entries: watchlistState.entries,
    storageBlocked: watchlistState.storageBlocked,
    isWatching: () => false,
    findByPlatformAndTitle: () => undefined,
    add: () => null,
    setEpisode: () => false,
    update: () => false,
    dismissToday: () => false,
    remove: () => undefined,
    replaceAll: () => false,
    resetLocal: () => ({ backedUp: true }),
  }),
}))

// mock 卫生兜底：isolate:false 下同 worker 的后续文件会看到本文件留下的
// 跨模块 mock，这里统一清掉。
afterAll(() => {
  vi.resetModules()
})

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.now()

function entry(over: Partial<WatchEntry> & { title: string }): WatchEntry {
  return {
    key: dramaKeyFor('nav-hongguo', over.title),
    platformSiteId: 'nav-hongguo',
    platformTitle: '红果短剧',
    playUrl: 'https://www.hongguo.com',
    episode: 3,
    priority: 'normal',
    cadence: { kind: 'daily' },
    remind: true,
    lastProgressAt: NOW - 3 * DAY_MS,
    createdAt: NOW - 10 * DAY_MS,
    updatedAt: NOW - 3 * DAY_MS,
    ...over,
  }
}

function setWatchlist(
  entries: WatchEntry[],
  opts?: { ready?: boolean; storageBlocked?: string | null },
): void {
  watchlistState.entries = entries
  watchlistState.ready = opts?.ready ?? true
  watchlistState.storageBlocked = opts?.storageBlocked ?? null
}

const SITES = [{ id: 'nav-hongguo', title: '红果短剧', href: 'https://www.hongguo.com' }]

function renderDrama(): string {
  return renderToString(createElement(DramaContent, { sites: SITES, dramas: [] }))
}

describe('/drama「继续追」行：相对时间 meta', () => {
  it('看到第 3 集、3 天前改进度：写「上次进度 3天前」', () => {
    setWatchlist([entry({ title: '追更剧' })])
    const html = renderDrama()
    expect(html).toContain('继续追')
    expect(html).toContain('看到第 3 集')
    expect(html).toContain('上次进度 3天前')
  })

  it('5 分钟前改进度：写「上次进度 5分钟前」，不写成天数', () => {
    setWatchlist([entry({ title: '刚看过剧', lastProgressAt: NOW - 5 * 60_000 })])
    const html = renderDrama()
    expect(html).toContain('上次进度 5分钟前')
    expect(html).not.toContain('上次进度 3天前')
  })

  it('还没开始看（episode = 0）：不写时间——没有进度可写', () => {
    setWatchlist([entry({ title: '未开看剧', episode: 0 })])
    const html = renderDrama()
    expect(html).toContain('还没开始看')
    expect(html).not.toContain('上次进度')
  })

  it('lastProgressAt 非法（NaN）：整段省略，绝不渲染「—」', () => {
    setWatchlist([entry({ title: '脏数据剧', lastProgressAt: NaN })])
    const html = renderDrama()
    expect(html).toContain('看到第 3 集')
    expect(html).not.toContain('上次进度')
    expect(html).not.toContain('—')
  })

  it('lastProgressAt = 0：整段省略，不写时间', () => {
    setWatchlist([entry({ title: '零时间剧', lastProgressAt: 0 })])
    const html = renderDrama()
    expect(html).toContain('看到第 3 集')
    expect(html).not.toContain('上次进度')
  })
})

/**
 * U-437：首页微胶囊行已删除，其「继续追」时间 meta 随合并行并入
 * HomeCapsuleRow 的移动端快捷入口下拉项（与已删 home-micro-strip 同款口径：
 * episode > 0 且 lastProgressAt 合法才写 `· {formatRelativeTime}`，否则不写、
 * 绝不渲染“—”）。下拉菜单内容只在打开时才挂载，SSR 抓不到它，故这里只做
 * 源码级接线守卫；同一口径的运行时行为仍由上方的 /drama「继续追」行覆盖。
 */
describe('首页胶囊行「继续追」：相对时间 meta 已并入 HomeCapsuleRow（U-437）', () => {
  const row = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'components', 'home-capsule-row.tsx'),
    'utf8',
  )

  it('时间 meta 只写真实改进度：episode > 0 且 lastProgressAt 有限正数才算', () => {
    expect(row).toContain('latestWatch.episode > 0')
    expect(row).toContain("typeof latestWatch.lastProgressAt === 'number'")
    expect(row).toContain('Number.isFinite(latestWatch.lastProgressAt)')
    expect(row).toContain('latestWatch.lastProgressAt > 0')
    expect(row).toContain('formatRelativeTime(latestWatch.lastProgressAt)')
  })

  it('胶囊文案仍是「继续追《剧名》 · ×天前」，无进度时只写剧名、不写“—”', () => {
    expect(row).toContain("继续追《${latestWatch.title}》${latestWatchProgress ? ` · ${latestWatchProgress}` : ''}")
    expect(row).toContain("latestWatch ? `继续追《${latestWatch.title}》")
  })

  it('空清单时退回「今日短剧热榜」，无时间 meta', () => {
    expect(row).toContain("'今日短剧热榜'")
  })
})
