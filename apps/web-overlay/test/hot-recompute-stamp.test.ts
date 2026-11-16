import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * /hot 热度榜「真实重算时间」戳（口径 B：读 recompute_rank 事件流）。
 *
 * 锁住四件事：
 * 1. 服务端 page.tsx 把 trending 响应的 recomputedAt 透传给 HotView；
 * 2. HotView 只在热度 tab 显示「热度分 X 分钟前重算」，新品 tab 不显示；
 * 3. recomputedAt 为 null（尚无重算记录）时不显示、不编造时间；
 * 4. 客户端重试刷新走 fetchTrendingMeta，时间戳随之更新。
 *
 * 诚实边界（与 hot-report-click.test.ts 同口径）：本仓库 vitest 是 node
 * 环境，无 jsdom / @testing-library/react，直接 import .tsx 渲染点按
 * 做不到；本文件钉住「接线都在、条件正确」，真实的渲染由 Playwright
 * e2e / 真机复核覆盖。
 */

const HOT_VIEW = join(import.meta.dirname, '..', 'src', 'app', 'hot', 'hot-view.tsx')
const HOT_PAGE = join(import.meta.dirname, '..', 'src', 'app', 'hot', 'page.tsx')
const view = readFileSync(HOT_VIEW, 'utf8')
const page = readFileSync(HOT_PAGE, 'utf8')

describe('/hot 热度重算时间戳接线', () => {
  it('page.tsx：loadHot 取 trending 响应的 recomputedAt 并透传给 HotView', () => {
    expect(page).toContain("hubGet<{ hits: RankHit[]; recomputedAt?: number | null }>('/api/rank/trending?limit=30', 60)")
    expect(page).toContain('recomputedAt: trendingRes?.recomputedAt ?? null')
    expect(page).toContain('<HotView initialTrending={trending} initialFresh={fresh} recomputedAt={recomputedAt} degraded={degraded} />')
  })

  it('HotView 声明 recomputedAt 可选 prop，null = 尚无重算记录', () => {
    expect(view).toContain('recomputedAt: initialRecomputedAt = null')
    expect(view).toContain('/** 上次热度重算时刻（epoch 毫秒）；null = 尚无重算记录，不显示、不编造 */')
    expect(view).toContain('recomputedAt?: number | null')
  })

  it('时间戳只在热度 tab 显示：条件同时要求 tab 与非 null', () => {
    expect(view).toContain("tab === 'trending' && recomputedAt != null")
    expect(view).toContain('热度分{formatRelativeTime(recomputedAt)}重算')
    // 新品 tab 的内容区（TabsContent value="new"）之后不应再出现时间戳文案
    const newTabIdx = view.indexOf('<TabsContent value="new"')
    expect(newTabIdx).toBeGreaterThan(-1)
    expect(view.slice(newTabIdx)).not.toContain('重算')
  })

  it('客户端重试刷新走 fetchTrendingMeta，时间戳随之更新', () => {
    expect(view).toContain('fetchTrendingMeta(30, onDegraded)')
    expect(view).toContain('setRecomputedAt(t.recomputedAt)')
    expect(view).toContain('setTrending(t.sites)')
  })
})
