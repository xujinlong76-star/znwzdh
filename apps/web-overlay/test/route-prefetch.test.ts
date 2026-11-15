/**
 * 站内路由预取（Batch 3 第 8 项 P1 / A1）。
 *
 * 纯函数部分直接测 `@/lib/route-prefetch`；Provider 与播放器页的接线
 * 用源码守卫体例（仿 pwa-offline.test.ts / offline-banner.test.ts）：
 * 运行时不挂载组件，只锁「调了该调的函数、没关默认预取、没在别处另起一套」。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  HOVER_PREFETCH_DELAY_MS,
  IDLE_PREFETCH_FALLBACK_MS,
  MAX_SESSION_PREFETCHES,
  NEXT_VIDEO_PROGRESS_HIGH,
  RECENT_PREFETCH_TOP_N,
  buildFavoriteTopCandidates,
  buildNextVideoCandidates,
  buildRecentCandidates,
  buildSceneLandingCandidate,
  createRoutePrefetchSession,
  isPrefetchableHref,
  isRoutePrefetchNetworkAllowed,
  nextVideoPriority,
  normalizeRouteHref,
  pickIdlePrefetchCandidate,
  progressRatio,
  sortPrefetchCandidates,
  toInternalRouteHref,
  tryClaimRoutePrefetch,
  type PrefetchCandidate,
} from '@/lib/route-prefetch'
import {
  DEFAULT_HIBERNATION_SETTINGS,
  type HibernatableFavoriteLike,
  type HibernationSettings,
  type ManualHibernatedItem,
} from '@/lib/favorites-hibernation'
import type { ResurfaceVisitLike } from '@/lib/resurface'
import type { RecentVisit } from '@/lib/offline-recent'

const NOW = Date.UTC(2026, 10, 13, 12, 0, 0)
const DAY_MS = 24 * 60 * 60 * 1000
const ORIGIN = 'https://navhub.example'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 定位并读取 overlay 里的文件；镜像副本（apps/web/test）不会被误当成源 */
function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

describe('isPrefetchableHref：白名单', () => {
  it('精确路由全部通过', () => {
    for (const href of ['/', '/hot', '/tags', '/favorites', '/scenes', '/videos', '/offline']) {
      expect(isPrefetchableHref(href)).toBe(true)
    }
  })

  it('动态路由通过：/tags/[slug]、/site/[id]、/collections/[slug]、/scenes/[id]', () => {
    expect(isPrefetchableHref('/tags/react')).toBe(true)
    expect(isPrefetchableHref('/tags/react/')).toBe(true)
    expect(isPrefetchableHref('/site/abc123')).toBe(true)
    expect(isPrefetchableHref('/collections/my-list')).toBe(true)
    // 场景落地页就是 /scenes/[id]（该页文件头自称「场景落地页」）。
    expect(isPrefetchableHref('/scenes/scene-1')).toBe(true)
  })

  it('/videos/player 必须带 id，只认 id / t 两个参数', () => {
    expect(isPrefetchableHref('/videos/player?id=abc')).toBe(true)
    expect(isPrefetchableHref('/videos/player?id=abc&t=120')).toBe(true)
    expect(isPrefetchableHref('/videos/player')).toBe(false)
    expect(isPrefetchableHref('/videos/player?t=120')).toBe(false)
    expect(isPrefetchableHref('/videos/player?id=abc&foo=1')).toBe(false)
  })

  it('不在白名单上的路由一律不预取', () => {
    for (const href of ['/search', '/search?q=ai', '/videos/v/abc', '/pub/abc', '/me', '/brief', '/algorithms']) {
      expect(isPrefetchableHref(href)).toBe(false)
    }
  })

  it('精确路由不带查询串', () => {
    expect(isPrefetchableHref('/videos?c=tech')).toBe(false)
    expect(isPrefetchableHref('/favorites?folder=1')).toBe(false)
  })
})

describe('isPrefetchableHref：黑名单优先于白名单', () => {
  it('硬编码黑名单：/admin/*、/api/*、/auth/*、/logout、/delete、/destroy', () => {
    for (const href of [
      '/admin',
      '/admin/navigation',
      '/api/search',
      '/api/me/favorites',
      '/auth/signin',
      '/auth/forgot-password',
      '/logout',
      '/delete',
      '/destroy',
    ]) {
      expect(isPrefetchableHref(href)).toBe(false)
    }
  })

  it('写操作语义的路径段一律禁：白名单形、写操作实也拦', () => {
    for (const href of [
      '/site/123/edit',
      '/favorites/delete',
      '/collections/x/remove',
      '/site/x/publish',
      '/tags/react/create',
      '/site/delete',
      '/videos/player?id=x&delete=1',
    ]) {
      expect(isPrefetchableHref(href)).toBe(false)
    }
  })

  it('黑名单大小写不敏感', () => {
    expect(isPrefetchableHref('/Admin/navigation')).toBe(false)
    expect(isPrefetchableHref('/API/search')).toBe(false)
  })

  it('搜索关键词不进候选', () => {
    expect(isPrefetchableHref('/videos/player?id=x&q=ai')).toBe(false)
    expect(isPrefetchableHref('/videos/player?id=x&keyword=ai')).toBe(false)
    expect(isPrefetchableHref('/tags/react?q=ai')).toBe(false)
  })

  it('外部链接与非法输入不预取', () => {
    // '/tags/' 归一化后就是白名单里的 /tags 本身，不算空 slug；空 slug 用 /site/ 测。
    for (const href of ['', 'videos', 'https://example.com/videos', '//evil.example/videos', '/site/', '/tags/a/b']) {
      expect(isPrefetchableHref(href)).toBe(false)
    }
    expect(isPrefetchableHref('/tags/')).toBe(true)
  })
})

describe('normalizeRouteHref / toInternalRouteHref', () => {
  it('去尾斜杠、去 hash', () => {
    expect(normalizeRouteHref('/tags/react/')).toBe('/tags/react')
    expect(normalizeRouteHref('/hot#top')).toBe('/hot')
    expect(normalizeRouteHref('/')).toBe('/')
  })

  it('相对路径原样取；协议相对路径拒绝', () => {
    expect(toInternalRouteHref('/videos', ORIGIN)).toBe('/videos')
    expect(toInternalRouteHref('//evil.example/videos', ORIGIN)).toBeNull()
  })

  it('绝对 URL 只有同源才转站内路由', () => {
    expect(toInternalRouteHref('https://navhub.example/videos?x=1', ORIGIN)).toBe('/videos?x=1')
    expect(toInternalRouteHref('https://other.example/videos', ORIGIN)).toBeNull()
    expect(toInternalRouteHref('ftp://navhub.example/videos', ORIGIN)).toBeNull()
    expect(toInternalRouteHref('https://navhub.example/videos')).toBeNull()
  })
})

describe('isRoutePrefetchNetworkAllowed：网络门控', () => {
  it('无 connection 信息时按网络良好处理', () => {
    expect(isRoutePrefetchNetworkAllowed(undefined)).toBe(true)
    expect(isRoutePrefetchNetworkAllowed(null)).toBe(true)
    expect(isRoutePrefetchNetworkAllowed({})).toBe(true)
    expect(isRoutePrefetchNetworkAllowed({ effectiveType: '4g' })).toBe(true)
  })

  it('saveData / 2G / 3G 时 A1 全停（3g 也不许 RSC 预取）', () => {
    expect(isRoutePrefetchNetworkAllowed({ saveData: true })).toBe(false)
    expect(isRoutePrefetchNetworkAllowed({ effectiveType: 'slow-2g' })).toBe(false)
    expect(isRoutePrefetchNetworkAllowed({ effectiveType: '2g' })).toBe(false)
    expect(isRoutePrefetchNetworkAllowed({ effectiveType: '3g' })).toBe(false)
  })

  it('离线时全停', () => {
    expect(isRoutePrefetchNetworkAllowed({ effectiveType: '4g' }, false)).toBe(false)
    expect(isRoutePrefetchNetworkAllowed(undefined, false)).toBe(false)
  })
})

describe('会话预算：每会话 ≤5 条、每路由只 1 次、不持久化', () => {
  it('默认上限 5 条，第 6 条拒绝', () => {
    expect(MAX_SESSION_PREFETCHES).toBe(5)
    const session = createRoutePrefetchSession()
    for (const href of ['/hot', '/tags', '/favorites', '/scenes', '/videos']) {
      expect(tryClaimRoutePrefetch(session, href)).toBe(true)
    }
    expect(tryClaimRoutePrefetch(session, '/offline')).toBe(false)
    expect(session.claimed.size).toBe(5)
  })

  it('同一路由只认领 1 次（尾斜杠归一后也算同一条）', () => {
    const session = createRoutePrefetchSession()
    expect(tryClaimRoutePrefetch(session, '/hot')).toBe(true)
    expect(tryClaimRoutePrefetch(session, '/hot')).toBe(false)
    expect(tryClaimRoutePrefetch(session, '/hot/')).toBe(false)
    expect(session.claimed.size).toBe(1)
  })

  it('黑名单认领失败，且不占预算', () => {
    const session = createRoutePrefetchSession()
    expect(tryClaimRoutePrefetch(session, '/api/search')).toBe(false)
    expect(tryClaimRoutePrefetch(session, '/admin')).toBe(false)
    expect(session.claimed.size).toBe(0)
    expect(tryClaimRoutePrefetch(session, '/hot')).toBe(true)
  })

  it('当前页本身不预取', () => {
    const session = createRoutePrefetchSession()
    expect(tryClaimRoutePrefetch(session, '/videos', '/videos')).toBe(false)
    expect(tryClaimRoutePrefetch(session, '/videos/player?id=a', '/videos/player?id=a')).toBe(false)
    expect(tryClaimRoutePrefetch(session, '/videos/player?id=b', '/videos/player?id=a')).toBe(true)
  })

  it('新会话从空集合开始（不持久化）', () => {
    const a = createRoutePrefetchSession()
    expect(tryClaimRoutePrefetch(a, '/hot')).toBe(true)
    const b = createRoutePrefetchSession()
    expect(b.claimed.size).toBe(0)
    expect(tryClaimRoutePrefetch(b, '/hot')).toBe(true)
  })
})

describe('视频下一集候选', () => {
  const videos = [
    { id: 'a', title: 'A' },
    { id: 'b', title: 'B' },
    { id: 'c', title: 'C' },
    { id: 'd', title: 'D' },
  ]

  it('进度比：时长未知时为 NaN（到不了 75% 就不触发）', () => {
    expect(progressRatio(450, 600)).toBe(0.75)
    expect(progressRatio(100, undefined)).toBeNaN()
    expect(progressRatio(100, 0)).toBeNaN()
    expect(progressRatio(-5, 600)).toBeNaN()
  })

  it('下一集优先级：>75% high，正好 75% 还是 normal', () => {
    expect(NEXT_VIDEO_PROGRESS_HIGH).toBe(0.75)
    expect(nextVideoPriority(0.76)).toBe('high')
    expect(nextVideoPriority(0.75)).toBe('normal')
    expect(nextVideoPriority(0.5)).toBe('normal')
    expect(nextVideoPriority(Number.NaN)).toBe('normal')
  })

  it('下一集 high + 再下一集 low、最多 1 条', () => {
    const out = buildNextVideoCandidates(videos, 0, 0.8)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ href: '/videos/player?id=b', priority: 'high', source: 'next-video' })
    expect(out[0]?.meta).toEqual({ id: 'b', title: 'B' })
    expect(out[1]).toMatchObject({ href: '/videos/player?id=c', priority: 'low', source: 'next-video' })
  })

  it('进度 ≤75% 时下一集标 normal（优先级标签），再下一集仍是 low', () => {
    const out = buildNextVideoCandidates(videos, 1, 0.5)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ href: '/videos/player?id=c', priority: 'normal' })
    expect(out[1]).toMatchObject({ href: '/videos/player?id=d', priority: 'low' })
  })

  it('播到最后一集 / 越界时无候选', () => {
    expect(buildNextVideoCandidates(videos, 3, 0.9)).toEqual([])
    expect(buildNextVideoCandidates(videos, -1, 0.9)).toEqual([])
    expect(buildNextVideoCandidates(videos, 4, 0.9)).toEqual([])
  })

  it('候选只含路由与元数据，不含 iframe 与视频流地址', () => {
    const out = buildNextVideoCandidates(videos, 0, 0.9)
    for (const c of out) {
      expect(c.href).not.toContain('iframe')
      expect(c.href).not.toContain('bilibili')
      expect(c.href).not.toContain('youtube')
      expect(c.href).not.toMatch(/\.(mp4|webm|m3u8)/)
    }
  })
})

describe('sortPrefetchCandidates：候选排序', () => {
  it('视频下一集 > 用户明确意图 > 最近访问 > 收藏 top > 场景落地页', () => {
    const shuffled: PrefetchCandidate[] = [
      { href: '/scenes/s1', priority: 'low', source: 'scene-landing' },
      { href: '/site/f1', priority: 'normal', source: 'favorite-top' },
      { href: '/hot', priority: 'normal', source: 'recent' },
      { href: '/tags/x', priority: 'high', source: 'user-intent' },
      { href: '/videos/player?id=b', priority: 'high', source: 'next-video' },
    ]
    const sorted = sortPrefetchCandidates(shuffled)
    expect(sorted.map((c) => c.source)).toEqual([
      'next-video',
      'user-intent',
      'recent',
      'favorite-top',
      'scene-landing',
    ])
  })

  it('同源内 high 在 low 前面；全相同保持输入顺序', () => {
    const input: PrefetchCandidate[] = [
      { href: '/videos/player?id=c', priority: 'low', source: 'next-video' },
      { href: '/videos/player?id=b', priority: 'high', source: 'next-video' },
    ]
    const sorted = sortPrefetchCandidates(input)
    expect(sorted[0]?.href).toBe('/videos/player?id=b')
    expect(sorted[1]?.href).toBe('/videos/player?id=c')
  })
})

describe('buildRecentCandidates：最近访问 top 3', () => {
  function visit(id: string, href: string, agoDays: number): RecentVisit {
    return { id, title: id, href, visitedAt: NOW - agoDays * DAY_MS }
  }

  it('只在回到首页 / /offline 时才有候选', () => {
    const visits = [visit('v1', '/videos', 1)]
    expect(buildRecentCandidates(visits, '/')).toHaveLength(1)
    expect(buildRecentCandidates(visits, '/offline')).toHaveLength(1)
    expect(buildRecentCandidates(visits, '/videos')).toEqual([])
    expect(buildRecentCandidates(visits, '/favorites')).toEqual([])
  })

  it('取最近 3 条：外站、搜索页、非白名单一律滤掉', () => {
    const visits = [
      visit('ext', 'https://example.com/some-site', 0),
      visit('search', '/search?q=ai', 0),
      visit('v1', '/tags/react', 1),
      visit('v2', '/videos', 2),
      visit('v3', '/favorites', 3),
      visit('v4', '/hot', 4),
    ]
    const out = buildRecentCandidates(visits, '/')
    expect(out).toHaveLength(RECENT_PREFETCH_TOP_N)
    expect(out.map((c) => c.href)).toEqual(['/tags/react', '/videos', '/favorites'])
    expect(out.every((c) => c.source === 'recent' && c.priority === 'normal')).toBe(true)
  })

  it('同源绝对 URL 可转站内路由；当前页本身不预取；重复去重', () => {
    const visits = [
      visit('home', '/', 0),
      visit('hot1', 'https://navhub.example/hot', 1),
      visit('hot2', '/hot', 2),
    ]
    const out = buildRecentCandidates(visits, '/', 3, ORIGIN)
    expect(out.map((c) => c.href)).toEqual(['/hot'])
  })
})

describe('buildFavoriteTopCandidates：收藏 top（冬眠排除）', () => {
  const SETTINGS: HibernationSettings = { ...DEFAULT_HIBERNATION_SETTINGS }
  const NO_MANUAL: ManualHibernatedItem[] = []

  function fav(over: Partial<HibernatableFavoriteLike> & { siteId: string }): HibernatableFavoriteLike {
    return {
      title: over.siteId,
      href: `https://${over.siteId}.example/`,
      createdAt: NOW - 5 * DAY_MS,
      ...over,
    }
  }

  it('只取未冬眠、permanent 的条目，映射到 /site/[id]', () => {
    const favorites = [
      fav({ siteId: 'fresh', lastOpenedAt: NOW - 1 * DAY_MS }),
      fav({ siteId: 'old', lastOpenedAt: NOW - 10 * DAY_MS }),
      fav({ siteId: 'never', createdAt: NOW - 5 * DAY_MS }),
    ]
    const out = buildFavoriteTopCandidates(favorites, [], SETTINGS, NO_MANUAL, NOW)
    expect(out.map((c) => c.href)).toEqual(['/site/fresh', '/site/old', '/site/never'])
    expect(out.every((c) => c.source === 'favorite-top' && c.priority === 'normal')).toBe(true)
  })

  it('自动冬眠的条目（本机记录 200 天没打开）不得进入候选', () => {
    const favorites = [
      fav({ siteId: 'hibernated', createdAt: NOW - 200 * DAY_MS }),
      fav({ siteId: 'awake', lastOpenedAt: NOW - 1 * DAY_MS }),
    ]
    const out = buildFavoriteTopCandidates(favorites, [], SETTINGS, NO_MANUAL, NOW)
    expect(out.map((c) => c.href)).toEqual(['/site/awake'])
  })

  it('手动冬眠的条目不得进入候选', () => {
    const favorites = [fav({ siteId: 'manual', lastOpenedAt: NOW - 1 * DAY_MS })]
    const manual: ManualHibernatedItem[] = [{ siteId: 'manual', hibernatedAt: NOW }]
    expect(buildFavoriteTopCandidates(favorites, [], SETTINGS, manual, NOW)).toEqual([])
  })

  it('待读分流（inbox / read）的条目不进候选；只取 permanent', () => {
    const favorites = [
      fav({ siteId: 'inbox', triageStatus: 'inbox', triageAt: NOW - 1 * 60 * 60 * 1000 }),
      fav({ siteId: 'read', triageStatus: 'read', triageAt: NOW - 1 * DAY_MS }),
      fav({ siteId: 'perm', triageStatus: 'permanent' }),
    ]
    const out = buildFavoriteTopCandidates(favorites, [], SETTINGS, NO_MANUAL, NOW)
    expect(out.map((c) => c.href)).toEqual(['/site/perm'])
  })

  it('打开信号复用 resurface：最近访问里的打开也算打开', () => {
    const favorites = [
      fav({ siteId: 'via-visit', createdAt: NOW - 5 * DAY_MS }),
      fav({ siteId: 'older-open', lastOpenedAt: NOW - 10 * DAY_MS }),
    ]
    const visits: ResurfaceVisitLike[] = [{ id: 'via-visit', visitedAt: NOW - 1 * DAY_MS }]
    const out = buildFavoriteTopCandidates(favorites, visits, SETTINGS, NO_MANUAL, NOW)
    expect(out[0]?.href).toBe('/site/via-visit')
  })

  it('最多取 3 条，同站去重', () => {
    const favorites = [
      fav({ siteId: 'a', lastOpenedAt: NOW - 1 * DAY_MS }),
      fav({ siteId: 'a', lastOpenedAt: NOW - 2 * DAY_MS }),
      fav({ siteId: 'b', lastOpenedAt: NOW - 3 * DAY_MS }),
      fav({ siteId: 'c', lastOpenedAt: NOW - 4 * DAY_MS }),
      fav({ siteId: 'd', lastOpenedAt: NOW - 5 * DAY_MS }),
    ]
    const out = buildFavoriteTopCandidates(favorites, [], SETTINGS, NO_MANUAL, NOW)
    expect(out).toHaveLength(3)
    expect(out.map((c) => c.href)).toEqual(['/site/a', '/site/b', '/site/c'])
  })
})

describe('buildSceneLandingCandidate：场景落地页只 1 条', () => {
  it('映射到 /scenes/[id]，low 优先级', () => {
    expect(buildSceneLandingCandidate('scene-1')).toMatchObject({
      href: '/scenes/scene-1',
      priority: 'low',
      source: 'scene-landing',
    })
  })

  it('空 sceneId 无候选；绝不展开场景内站点', () => {
    expect(buildSceneLandingCandidate('')).toBeNull()
    expect(buildSceneLandingCandidate('   ')).toBeNull()
  })
})

describe('pickIdlePrefetchCandidate：空闲拾取 1 条', () => {
  it('拾取最高优先候选并认领', () => {
    const session = createRoutePrefetchSession()
    const candidates: PrefetchCandidate[] = [
      { href: '/scenes/s1', priority: 'low', source: 'scene-landing' },
      { href: '/hot', priority: 'normal', source: 'recent' },
      { href: '/videos/player?id=b', priority: 'high', source: 'next-video' },
    ]
    const picked = pickIdlePrefetchCandidate(candidates, session)
    expect(picked?.href).toBe('/videos/player?id=b')
    expect(session.claimed.has('/videos/player?id=b')).toBe(true)
  })

  it('已认领过的跳过，取下一条；预算耗尽返回 null', () => {
    const session = createRoutePrefetchSession(1)
    const candidates: PrefetchCandidate[] = [
      { href: '/videos/player?id=b', priority: 'high', source: 'next-video' },
      { href: '/hot', priority: 'normal', source: 'recent' },
    ]
    expect(pickIdlePrefetchCandidate(candidates, session)?.href).toBe('/videos/player?id=b')
    expect(pickIdlePrefetchCandidate(candidates, session)).toBeNull()
  })

  it('网络门控不过时返回 null，且不认领、不烧预算', () => {
    const session = createRoutePrefetchSession()
    const candidates: PrefetchCandidate[] = [{ href: '/hot', priority: 'normal', source: 'recent' }]
    expect(pickIdlePrefetchCandidate(candidates, session, { networkAllowed: false })).toBeNull()
    expect(session.claimed.size).toBe(0)
  })
})

describe('route-prefetch 模块本身是纯函数（无路由副作用）', () => {
  it('不 import next/navigation，不直接调 router.prefetch', () => {
    const src = overlaySource('src/lib/route-prefetch.ts')
    expect(src).not.toContain('next/navigation')
    expect(src).not.toContain('router.prefetch(')
    expect(src).not.toContain('/api/search')
  })

  it('悬停延迟 150ms、空闲兜底 1500ms', () => {
    expect(HOVER_PREFETCH_DELAY_MS).toBe(150)
    expect(IDLE_PREFETCH_FALLBACK_MS).toBe(1500)
  })
})

describe('PredictivePrefetchProvider 接线：A0 预连接', () => {
  it('真正调用 determinePrefetchStrategy，saveData/2G 全停、3G 只 dns-prefetch', () => {
    const src = overlaySource('src/components/predictive-prefetch-provider.tsx')
    expect(src).toContain('determinePrefetchStrategy')
    expect(src).toContain('determinePrefetchStrategy(getConnection())')
    expect(src).toContain("strategy === 'none'")
    expect(src).toContain("strategy === 'dns-prefetch'")
  })

  it('上限常量不动：8 origin / 60ms 节流 / 16 节点', () => {
    const src = overlaySource('src/components/predictive-prefetch-provider.tsx')
    expect(src).toContain('const MAX_PRECONNECTS = 8')
    expect(src).toContain('const THROTTLE_MS = 60')
    expect(src).toContain('const MAX_INJECTED_LINKS = MAX_PRECONNECTS * 2')
  })

  it('触屏 / 键盘补位：touchstart 与 focusin 也触发同一次判定', () => {
    const src = overlaySource('src/components/predictive-prefetch-provider.tsx')
    expect(src).toContain("addEventListener('touchstart'")
    expect(src).toContain("addEventListener('focusin'")
    expect(src).toContain('handlePressTarget')
  })
})

describe('PredictivePrefetchProvider 接线：A1 站内预取', () => {
  it('同一 Provider 内加站内预取，不新增 Provider', () => {
    const src = overlaySource('src/components/predictive-prefetch-provider.tsx')
    expect(src).toContain('tryClaimRoutePrefetch')
    expect(src).toContain('getSharedRoutePrefetchSession')
    expect(src).toContain('router.prefetch(href)')
    expect(src).toContain('isRoutePrefetchNetworkAllowed')
  })

  it('悬停 ≥150ms 才预取；空闲用 requestIdleCallback，无则 setTimeout 1500ms 兜底', () => {
    const src = overlaySource('src/components/predictive-prefetch-provider.tsx')
    expect(src).toContain('HOVER_PREFETCH_DELAY_MS')
    expect(src).toContain('requestIdleCallback')
    expect(src).toContain('IDLE_PREFETCH_FALLBACK_MS')
    expect(src).toContain('buildRecentCandidates')
    expect(src).toContain('pickIdlePrefetchCandidate')
  })

  it('不关 <Link> 默认预取：源码里没有 prefetch={false}', () => {
    const src = overlaySource('src/components/predictive-prefetch-provider.tsx')
    expect(src).not.toContain('prefetch={false}')
  })

  it('不预取 /api/search，空闲只在首页 / /offline 跑', () => {
    const src = overlaySource('src/components/predictive-prefetch-provider.tsx')
    expect(src).not.toContain('/api/search')
    expect(src).toContain("pathname !== '/' && pathname !== '/offline'")
  })
})

describe('video-player-page 接线：视频下一集（唯一允许发下一集预取的地方）', () => {
  it('用共享会话 + 进度门控发下一集预取', () => {
    const src = overlaySource('src/components/video-player-page.tsx')
    expect(src).toContain('buildNextVideoCandidates')
    expect(src).toContain('getSharedRoutePrefetchSession')
    expect(src).toContain('NEXT_VIDEO_PROGRESS_HIGH')
    expect(src).toContain('router.prefetch(candidate.href)')
  })

  it('进度 >75% 才发：effect 的执行代码里有进度门控，且不碰 iframe / 视频流', () => {
    const src = overlaySource('src/components/video-player-page.tsx')
    const codeIdx = src.indexOf('const ratio = progressRatio(currentTimeSec')
    expect(codeIdx).toBeGreaterThan(-1)
    const block = src.slice(codeIdx, codeIdx + 1200)
    expect(block).toContain('ratio > NEXT_VIDEO_PROGRESS_HIGH')
    expect(block).toContain('router.prefetch(candidate.href)')
    expect(block).not.toContain('iframe')
    expect(block).not.toContain('.mp4')
  })

  it('video-card.tsx 里没有另起一套下一集预取', () => {
    const src = overlaySource('src/components/video-card.tsx')
    expect(src).not.toContain('router.prefetch')
    expect(src).not.toContain('buildNextVideoCandidates')
  })
})
