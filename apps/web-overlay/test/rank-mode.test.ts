import { describe, expect, it } from 'vitest'
import type { HubSite } from '@/lib/navhub-api'
import {
  HEAT_READY_MIN_SITES,
  HEAT_READY_MIN_TOTAL,
  curatedScore,
  filterByDomain,
  parseDomain,
  resolveHeatMode,
  siteHeat,
  sortCurated,
} from '../src/lib/rank-mode'

/**
 * 站点榜「冷启动 vs 实时热度」双态回归（2026-11-21）。
 *
 * 实测数据库：全站 active 站点总 visit 只有 16（10 个站点有记录），
 * trend_score 多为 0。此时 `ORDER BY trend_score DESC, visit_count DESC, sort ASC`
 * 会退化成 `sort ASC`（数据库插入顺序），于是 KPL / 蓝领招聘 / 政务通报
 * 这类泛生活站混进"技术风向标"。resolveHeatMode 用来识别这个状态。
 */

const mk = (o: Partial<{ visitCount: number; trendScore: number; tags: string[]; createdAt: number; description: string; health: { ok: boolean } }> = {}) => ({
  id: 'x', url: 'https://x.com', title: 'X', tags: o.tags ?? [], categoryId: 'c',
  status: 'active', visitCount: o.visitCount, trendScore: o.trendScore,
  createdAt: o.createdAt, description: o.description, health: o.health,
} as unknown as HubSite)

describe('siteHeat', () => {
  it('visit 与 trend 取较大者（trend 按 ×10 折算）', () => {
    expect(siteHeat(mk({ visitCount: 5 }))).toBe(5)
    expect(siteHeat(mk({ trendScore: 0.594 }))).toBe(6)
    expect(siteHeat(mk({ visitCount: 5, trendScore: 9.5 }))).toBe(95)
  })
  it('全空时是 0', () => {
    expect(siteHeat(mk())).toBe(0)
  })
})

describe('resolveHeatMode（冷启动门槛）', () => {
  it('门槛常量符合产品口径', () => {
    expect(HEAT_READY_MIN_TOTAL).toBe(50)
    expect(HEAT_READY_MIN_SITES).toBe(10)
  })

  it('全部为 0 → cold（冷启动态）', () => {
    const sites = Array.from({ length: 30 }, () => mk({ visitCount: 0 }))
    expect(resolveHeatMode(sites)).toBe('cold')
  })

  it('实测现状（总 visit=16、10 站点有记录）→ 按站点数达标判 live', () => {
    // 有 10 个站点存在记录即达 SITES 门槛
    const sites = Array.from({ length: 30 }, (_, i) => mk({ visitCount: i < 10 ? 1 : 0 }))
    expect(resolveHeatMode(sites)).toBe('live')
  })

  it('总热度达标 → live（即使站点数少）', () => {
    const sites = [mk({ visitCount: 30 }), mk({ visitCount: 25 }), ...Array.from({ length: 8 }, () => mk())]
    expect(resolveHeatMode(sites)).toBe('live')
  })

  it('总热度 49 且站点数 9 → 仍是 cold（两个门槛都不达）', () => {
    const sites = Array.from({ length: 10 }, (_, i) => mk({ visitCount: i < 9 ? 5 : 0 }))
    // 9 站点 × 5 = 45 < 50，站点数 9 < 10
    expect(resolveHeatMode(sites)).toBe('cold')
  })

  it('只看前 10 名，更靠后的名次不左右整体判断', () => {
    const hot = Array.from({ length: 10 }, () => mk({ visitCount: 6 })) // 60 ≥ 50
    const cold = Array.from({ length: 20 }, () => mk({ visitCount: 0 }))
    expect(resolveHeatMode([...hot, ...cold])).toBe('live')
  })

  it('空榜 → cold', () => {
    expect(resolveHeatMode([])).toBe('cold')
  })
})

describe('curatedScore / sortCurated（冷启动精选排序）', () => {
  const now = Date.parse('2026-11-21T00:00:00Z')
  const day = 24 * 3600 * 1000

  it('开源的分数高于普通站', () => {
    expect(curatedScore(mk({ tags: ['开源'] }), now)).toBeGreaterThan(curatedScore(mk(), now))
  })
  it('近期新收录加分', () => {
    const fresh = mk({ createdAt: new Date(now - day).toISOString() as never })
    const old = mk({ createdAt: new Date(now - 100 * day).toISOString() as never })
    expect(curatedScore(fresh, now)).toBeGreaterThan(curatedScore(old, now))
  })
  it('排序结果稳定：同分保持原序', () => {
    const a = mk({ tags: [] }), b = mk({ tags: [] })
    const sorted = sortCurated([a, b], now)
    expect(sorted.map((s) => s.id)).toEqual([a.id, b.id])
  })
  it('精选排序把高信号站排到前面（而非数据库顺序）', () => {
    const plain = mk({ tags: [] })
    const openSrc = mk({ tags: ['开源'] })
    // 输入顺序是 plain 在前，排序后开源应在前
    expect(sortCurated([plain, openSrc], now)[0].tags).toContain('开源')
  })
})

describe('领域分榜', () => {
  it('parseDomain 归一非法值到 all', () => {
    expect(parseDomain('ai')).toBe('ai')
    expect(parseDomain('AI')).toBe('ai')
    expect(parseDomain('nonsense')).toBe('all')
    expect(parseDomain(undefined)).toBe('all')
    expect(parseDomain('')).toBe('all')
  })
  it('all 不改变输入', () => {
    const sites = [mk({ tags: ['AI'] }), mk({ tags: ['游戏'] })]
    expect(filterByDomain(sites, 'all')).toHaveLength(2)
  })
  it('ai 领域能隔离掉泛生活站', () => {
    const aiSite = mk({ tags: ['AI', '大模型'] })
    const lifeSite = mk({ tags: ['游戏', '电竞'] })
    const out = filterByDomain([aiSite, lifeSite], 'ai')
    expect(out).toHaveLength(1)
    expect(out[0].tags).toContain('AI')
  })
  it('dev 领域收录框架/数据库类站', () => {
    const dev = mk({ tags: ['数据库', '开源'] })
    const life = mk({ tags: ['短剧'] })
    expect(filterByDomain([dev, life], 'dev')).toHaveLength(1)
  })
  it('life 领域收录泛生活站，隔离技术站', () => {
    const life = mk({ tags: ['招聘', '政务'] })
    const tech = mk({ tags: ['Kubernetes', '云原生'] })
    expect(filterByDomain([life, tech], 'life')).toHaveLength(1)
  })
})
