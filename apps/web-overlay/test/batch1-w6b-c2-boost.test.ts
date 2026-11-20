/**
 * Batch 1 W6b 补丁 1：C2 前半（04 §3.2/§3.3/§9 C2）——空查询「最近访问」
 * 分区的 boosted/rest 两段拆分。
 *
 * 验收：count<3 的项不参与置顶（只按时间排在后段），count≥3 的项按
 * `mruScore` 降序置顶；门槛只决定是否置顶，不删除、不隐藏任何记录。
 *
 * 测试策略：`splitRecentVisitsForBoost` 是纯函数，直接跑；组件接线
 * （空面板渲染 `orderedRecentVisits` 而非原 `recentVisits`）用源码
 * 守卫锁住——SearchPalette 整组件在 node 环境挂不起来（见 W6 报告）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  MRU_MIN_USES_FOR_BOOST,
  splitRecentVisitsForBoost,
  type RecentVisit,
} from '../src/lib/offline-recent'

const DAY = 86400000
const NOW = Date.parse('2026-11-20T12:00:00Z')

const visit = (id: string, visitedAt: number, extra: Partial<RecentVisit> = {}): RecentVisit => ({
  id,
  title: `站点 ${id}`,
  href: `https://example.com/${id}`,
  visitedAt,
  ...extra,
})

const HERE = dirname(fileURLToPath(import.meta.url))

/** 定位 overlay 根目录（镜像副本 apps/web/test 不会被误当成源） */
function overlayRoot(): string {
  const candidates = [resolve(HERE, '..'), resolve(HERE, '..', '..', 'web-overlay')]
  const isOverlayDir = (p: string) => {
    const s = p.replace(/\\/g, '/')
    return s.includes('/web-overlay/') || s.endsWith('/web-overlay')
  }
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p))
  if (!hit) throw new Error('无法定位 web-overlay 根目录（候选：' + candidates.join(' | ') + '）')
  return hit
}

const paletteSrc = readFileSync(
  join(overlayRoot(), 'src/components/search-palette.tsx'),
  'utf8',
)

describe('splitRecentVisitsForBoost（C2 前半）', () => {
  it('count=1 的误点站不进置顶区：哪怕它是最新一条，也只排在 rest 段', () => {
    expect(MRU_MIN_USES_FOR_BOOST).toBe(3)
    const list = [
      visit('misclick', NOW, { count: 1 }), // 今天刚误点一次，最新
      visit('regular', NOW - 3 * DAY, { count: 5 }), // 3 天前 5 次
    ]
    const { boosted, rest } = splitRecentVisitsForBoost(list, NOW)
    expect(boosted.map((v) => v.id)).toEqual(['regular'])
    expect(rest.map((v) => v.id)).toEqual(['misclick'])
  })

  it('count≥3 的站按 mruScore 降序置顶：3 天前 3 次压过 90 天前 20 次', () => {
    // 建库 90 天：mid 50.8125 > old-heavy 47.1582（与 C2 后半同一组数）
    const list = [
      visit('old-heavy', NOW - 90 * DAY, { count: 20 }),
      visit('fresh-once', NOW - 1 * DAY, { count: 1 }),
      visit('mid', NOW - 3 * DAY, { count: 3 }),
    ]
    const { boosted, rest } = splitRecentVisitsForBoost(list, NOW)
    expect(boosted.map((v) => v.id)).toEqual(['mid', 'old-heavy'])
    expect(rest.map((v) => v.id)).toEqual(['fresh-once'])
  })

  it('rest 段按 visitedAt 倒序；count 缺失按 1 计，进 rest 不进 boosted', () => {
    const list = [
      visit('old-once', NOW - 5 * DAY, { count: 2 }),
      visit('new-once', NOW - 1 * DAY), // count 缺失
      visit('mid-once', NOW - 3 * DAY, { count: 1 }),
    ]
    const { boosted, rest } = splitRecentVisitsForBoost(list, NOW)
    expect(boosted).toEqual([])
    expect(rest.map((v) => v.id)).toEqual(['new-once', 'mid-once', 'old-once'])
  })

  it('不删除、不隐藏：boosted + rest 并起来就是原列表（无重复、无丢失）', () => {
    const list = [
      visit('a', NOW, { count: 1 }),
      visit('b', NOW - 1 * DAY, { count: 4 }),
      visit('c', NOW - 2 * DAY, { count: 2 }),
      visit('d', NOW - 3 * DAY, { count: 9 }),
    ]
    const { boosted, rest } = splitRecentVisitsForBoost(list, NOW)
    expect([...boosted, ...rest].map((v) => v.id).sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(new Set([...boosted, ...rest].map((v) => v.id)).size).toBe(4)
    expect(splitRecentVisitsForBoost([], NOW)).toEqual({ boosted: [], rest: [] })
  })
})

describe('空面板接线（源码守卫）', () => {
  it('search-palette 导入 splitRecentVisitsForBoost，渲染 orderedRecentVisits 而非原 recentVisits', () => {
    expect(paletteSrc).toContain('splitRecentVisitsForBoost')
    expect(paletteSrc).toContain('orderedRecentVisits')
    expect(paletteSrc).toContain('{orderedRecentVisits.map((visit) => (')
    expect(paletteSrc).not.toContain('{recentVisits.map((visit) => (')
  })
})
