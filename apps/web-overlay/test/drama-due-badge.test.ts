/**
 * 「今日待看」入口徽标：移动端底栏「短剧」Tab 角标 + /drama 页顶「我的追剧」药丸文案。
 *
 * 口径零创新：两处都复用 `partitionWatchlist(...).due.length`，与分类横幅、
 * 简报、首页影院同源。角标照抄底栏「我的」Tab 的未读徽章样式与 `9+` 封顶
 *（`lib/notification-badge.ts` 的 `unreadBadgeText`）；药丸文案与分类横幅
 * `drama-category-banner.tsx:95` 逐字一致。
 *
 * 诚实边界：角标只断言「按你标注的节奏，今天是更新日」，永不写「已更新」
 *（`lib/watchlist.ts` 的 `isReminderDue` 口径）；提醒关掉、今日已看过
 *（`dismissedOn` / 当天改进度）的剧不计入 due。
 *
 * 仓库 vitest 是 node 环境、无 jsdom：用 react-dom/server 的 renderToString
 * 做服务端渲染断言（不挂载，effect 不跑，正好对应首屏输出）。next/link、
 * next/navigation 与 useWatchlist 等钩子用 vi.mock 隔离——本文件测两处入口的
 * 待看信号接线，不测 Link 与清单钩子本身（它们的覆盖在其余测试里）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import MobileNav from '../src/components/mobile-nav'
import { DramaContent } from '../src/components/drama-content'
import {
  dramaKeyFor,
  localDateKey,
  type WatchEntry,
} from '../src/lib/watchlist'

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

// 底栏「我的」Tab 的未读徽章固定 0 条——本文件只测短剧角标，不让它干扰断言。
vi.mock('@/hooks/useIdentityReady', () => ({
  useIdentityReady: () => ({ identity: 'anon-test', ready: true, isAnonymous: true }),
}))

vi.mock('@/hooks/useUnreadNotifications', () => ({
  useUnreadNotifications: () => 0,
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

function dueEntries(n: number): WatchEntry[] {
  return Array.from({ length: n }, (_, i) => entry({ title: `待看剧${i + 1}` }))
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

function renderNav(): string {
  return renderToString(createElement(MobileNav))
}

function renderDrama(): string {
  return renderToString(createElement(DramaContent, { sites: SITES, dramas: [] }))
}

describe('底栏「短剧」Tab：待看角标', () => {
  it('due=0（空清单）：无角标、无占位，aria-label 只是「短剧」', () => {
    setWatchlist([])
    const html = renderNav()
    expect(html).toContain('aria-label="短剧"')
    expect(html).not.toContain('今日待看')
    expect(html).not.toContain('-right-2 -top-1.5')
  })

  it('due=0（在追但无待看：节奏未标注 / 今天不是更新日）：同样无角标', () => {
    const today = new Date(NOW).getDay()
    setWatchlist([
      entry({ title: '未标注节奏剧', cadence: { kind: 'unknown' } }),
      entry({ title: '非今日剧', cadence: { kind: 'weekly', weekdays: [(today + 1) % 7] } }),
      entry({ title: '已完结剧', cadence: { kind: 'finished' } }),
    ])
    const html = renderNav()
    expect(html).toContain('aria-label="短剧"')
    expect(html).not.toContain('今日待看')
    expect(html).not.toContain('-right-2 -top-1.5')
  })

  it('due=3：角标显示「3」，aria-label「短剧，今日待看 3 部」', () => {
    setWatchlist(dueEntries(3))
    const html = renderNav()
    expect(html).toContain('>3</span>')
    expect(html).toContain('aria-label="短剧，今日待看 3 部"')
  })

  it('due=12：角标 9+ 封顶，aria-label 仍报真实数「短剧，今日待看 12 部」', () => {
    setWatchlist(dueEntries(12))
    const html = renderNav()
    expect(html).toContain('>9+</span>')
    expect(html).toContain('aria-label="短剧，今日待看 12 部"')
  })

  it('ready=false：清单未就绪时不渲染角标（未就绪不等于没有待看）', () => {
    setWatchlist(dueEntries(3), { ready: false })
    const html = renderNav()
    expect(html).toContain('aria-label="短剧"')
    expect(html).not.toContain('今日待看')
    expect(html).not.toContain('-right-2 -top-1.5')
  })

  it('storageBlocked：本地存储被禁时不渲染角标', () => {
    setWatchlist(dueEntries(3), {
      storageBlocked: '浏览器不允许读写本地存储，本次追剧改动无法保存。',
    })
    const html = renderNav()
    expect(html).toContain('aria-label="短剧"')
    expect(html).not.toContain('今日待看')
    expect(html).not.toContain('-right-2 -top-1.5')
  })

  it('已关提醒 / 今日已看 / 今日已改进度不计入 due：只剩 1 部待看', () => {
    const today = new Date(NOW).getDay()
    setWatchlist([
      entry({ title: '待看剧' }),
      entry({ title: '关提醒剧', remind: false }),
      entry({ title: '今天已看剧', dismissedOn: localDateKey(NOW) }),
      entry({ title: '刚看过剧', lastProgressAt: NOW }),
      entry({ title: '非今日剧', cadence: { kind: 'weekly', weekdays: [(today + 1) % 7] } }),
    ])
    const html = renderNav()
    expect(html).toContain('>1</span>')
    expect(html).toContain('aria-label="短剧，今日待看 1 部"')
  })
})

describe('/drama 页顶「我的追剧」药丸：待看文案', () => {
  it('due=0：文案与样式全不动，仍是「我的追剧」', () => {
    setWatchlist([])
    const html = renderDrama()
    expect(html).toContain('>我的追剧</a>')
    expect(html).not.toContain('今日待看')
  })

  it('due=3：显示「今日待看 3 部 · 去追剧清单」', () => {
    setWatchlist(dueEntries(3))
    const html = renderDrama()
    expect(html).toContain('今日待看 3 部 · 去追剧清单')
    expect(html).not.toContain('>我的追剧</a>')
  })

  it('due=12：药丸写真实数 12 部（不做 9+ 封顶，封顶只在底栏角标）', () => {
    setWatchlist(dueEntries(12))
    const html = renderDrama()
    expect(html).toContain('今日待看 12 部 · 去追剧清单')
  })

  it('ready=false / storageBlocked：药丸退回「我的追剧」，不渲染假信号', () => {
    setWatchlist(dueEntries(3), { ready: false })
    expect(renderDrama()).toContain('>我的追剧</a>')
    setWatchlist(dueEntries(3), { storageBlocked: '浏览器不允许读写本地存储。' })
    const html = renderDrama()
    expect(html).toContain('>我的追剧</a>')
    expect(html).not.toContain('今日待看')
  })

  it('已关提醒 / 今日已看 / 今日已改进度不计入 due：只报 1 部', () => {
    setWatchlist([
      entry({ title: '待看剧' }),
      entry({ title: '关提醒剧', remind: false }),
      entry({ title: '今天已看剧', dismissedOn: localDateKey(NOW) }),
      entry({ title: '刚看过剧', lastProgressAt: NOW }),
    ])
    expect(renderDrama()).toContain('今日待看 1 部 · 去追剧清单')
  })
})

describe('接线守卫：口径与文案只复用、不创新', () => {
  it('底栏角标用 unreadBadgeText 做 9+ 封顶（与「我的」未读徽章同款）', () => {
    const src = readSrc('components/mobile-nav.tsx')
    expect(src).toContain('unreadBadgeText(dueCount)')
    expect(src).toContain('partitionWatchlist(watchlist.entries, new Date())')
  })

  it('药丸文案与分类横幅逐字一致（同一句「今日待看 N 部 · 去追剧清单」）', () => {
    const banner = readSrc('components/drama-category-banner.tsx')
    expect(banner).toContain('今日待看 {dueCount} 部 · 去追剧清单')
    const content = readSrc('components/drama-content.tsx')
    expect(content).toContain('今日待看 ${dueCount} 部 · 去追剧清单')
    expect(content).toContain('partitionWatchlist(entries, new Date())')
  })

  it('诚实边界：两处新文案都不写「已更新」', () => {
    expect(readSrc('components/mobile-nav.tsx')).not.toContain('已更新')
    expect(readSrc('components/drama-content.tsx')).not.toContain('已更新')
  })
})
