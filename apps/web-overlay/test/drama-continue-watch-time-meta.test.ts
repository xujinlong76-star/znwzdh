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
import { DramaContent } from '../src/components/drama-content'
import { HomeMicroStrip } from '../src/components/home-micro-strip'
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

function renderStrip(): string {
  // 2026-11-22：短剧默认移出全局首屏，需显式进入短剧上下文才能渲染胶囊。
  // 本文件测的是「继续追」时间文案，与曝光策略无关，故传 short-drama 上下文。
  return renderToString(
    createElement(HomeMicroStrip, { pluginItems: null, activeWorkspace: 'short-drama' }),
  )
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

describe('首页微胶囊「继续追」：相对时间 meta', () => {
  it('在追且 3 天前改进度：胶囊写「继续追《剧名》 · 3天前」', () => {
    setWatchlist([entry({ title: '追更剧' })])
    const html = renderStrip()
    expect(html).toContain('继续追《追更剧》')
    expect(html).toContain('3天前')
  })

  it('还没开始看（episode = 0）：只写剧名，不写时间', () => {
    setWatchlist([entry({ title: '未开看剧', episode: 0 })])
    const html = renderStrip()
    expect(html).toContain('继续追《未开看剧》')
    expect(html).not.toContain('天前')
    expect(html).not.toContain('分钟前')
  })

  it('lastProgressAt 非法（NaN）：不写时间、不渲染「—」', () => {
    setWatchlist([entry({ title: '脏数据剧', lastProgressAt: NaN })])
    const html = renderStrip()
    expect(html).toContain('继续追《脏数据剧》')
    expect(html).not.toContain('天前')
    expect(html).not.toContain('—')
  })

  it('空清单：胶囊退回「今日短剧热榜」，无时间 meta', () => {
    setWatchlist([])
    const html = renderStrip()
    expect(html).toContain('今日短剧热榜')
    expect(html).not.toContain('继续追《')
    expect(html).not.toContain('天前')
  })
})
