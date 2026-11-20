/**
 * Batch 1 W6b 补丁 2：MRU 加分数据源（04 §3.3/§6）——`mruNormBySiteId`
 * 改用全量快照。
 *
 * 验收：第 9 条及以后的记录也能拿到 MRU 加分（W6 之前只复用空面板
 * 8 条快照，8 条之外的收藏拿不到加分；且面板以预填查询打开时快照
 * 可能为空）。8 条直达区显示不动。
 *
 * 测试策略：`buildMruNormBySiteId` 是纯函数，直接跑；组件接线
 * （独立读 `readOfflineVisits(OFFLINE_RECENT_LIMIT)`、mruNorm 用
 * `mruVisits` 构建、直达区仍读 8 条）用源码守卫锁住。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  OFFLINE_RECENT_LIMIT,
  buildMruNormBySiteId,
  mruScore,
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

describe('buildMruNormBySiteId（MRU 加分数据源）', () => {
  it('第 9 条及以后的记录也能拿到 MRU 加分：12 条快照全进映射', () => {
    expect(OFFLINE_RECENT_LIMIT).toBe(50)
    // 12 条：前 8 条是直达区快照，第 9–12 条在旧逻辑下拿不到加分
    const visits = Array.from({ length: 12 }, (_, i) =>
      visit(`s${i + 1}`, NOW - i * DAY, { count: i + 1 }),
    )
    const map = buildMruNormBySiteId(visits, NOW)
    expect(map.size).toBe(12)
    for (let i = 9; i <= 12; i++) {
      expect(map.has(`s${i}`)).toBe(true)
      expect(map.get(`s${i}`)!).toBeGreaterThan(0)
    }
  })

  it('第 9 条的值与 mruScore/100 一致（建库起点取全表最早一条）', () => {
    const visits = Array.from({ length: 12 }, (_, i) =>
      visit(`s${i + 1}`, NOW - i * DAY, { count: i + 1 }),
    )
    const earliest = NOW - 11 * DAY
    const map = buildMruNormBySiteId(visits, NOW)
    const ninth = visits[8]!
    expect(map.get('s9')).toBeCloseTo(mruScore(ninth, NOW, earliest) / 100, 9)
    // 前 8 条的值也不变：映射覆盖全表，不是只补尾巴
    expect(map.get('s1')).toBeCloseTo(mruScore(visits[0]!, NOW, earliest) / 100, 9)
  })

  it('空快照得空映射；无记录的站不在映射里（调用方按 0 处理）', () => {
    expect(buildMruNormBySiteId([], NOW).size).toBe(0)
    const map = buildMruNormBySiteId([visit('only', NOW, { count: 3 })], NOW)
    expect(map.has('other')).toBe(false)
  })
})

describe('组件接线（源码守卫）', () => {
  it('mruNorm 用全量 mruVisits 构建，直达区仍读 8 条', () => {
    expect(paletteSrc).toContain('readOfflineVisits(OFFLINE_RECENT_LIMIT)')
    expect(paletteSrc).toContain('readOfflineVisits(8)')
    expect(paletteSrc).toContain('buildMruNormBySiteId(mruVisits)')
    expect(paletteSrc).toContain('const [mruVisits, setMruVisits]')
  })
})
