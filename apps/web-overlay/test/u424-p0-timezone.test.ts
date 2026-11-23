/**
 * U-424 P0：16 处用户高频可见日期渲染固定 Asia/Shanghai（与 U-285 / U-419 口径一致）。
 *
 * 临界值：2026-11-21 16:30 UTC = 2026-11-22 00:30 CST。未修复时渲染跟进程
 * 本地时区：UTC 部署上日期差一天、时间差 8 小时、农历差一天，北京时间部署
 * 上正确。修复后无论进程 TZ 是什么，一律按北京时间出结果。
 * 跑法（仿 U-419）：TZ=UTC 与 TZ=America/New_York 双跑，断言不变。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatLunarDate, lunarPartsFromIntl } from '@/lib/lunar-date'
import {
  buildSafetyChecks,
  type DataSafety,
} from '../../../packages/store/src/repository/safety'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 临界值：2026-11-21 16:30 UTC = 2026-11-22 00:30 CST。 */
const CRITICAL = Date.UTC(2026, 10, 21, 16, 30, 0)

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

function repoSource(rel: string): string {
  const p = resolve(HERE, '..', '..', '..', rel)
  if (!existsSync(p)) throw new Error('无法定位 ' + rel)
  return readFileSync(p, 'utf8')
}

/** P0 清单 16 处：overlay 13 文件 + packages/store 1 文件（history 与 favorites 各 2 处）。 */
const P0_OVERLAY: Array<[string, number]> = [
  ['src/components/modular/modules/clock-widget.tsx', 1],
  ['src/lib/lunar-date.ts', 1],
  ['src/app/me/history/page.tsx', 2],
  ['src/app/me/annotations/page.tsx', 1],
  ['src/app/me/notifications/page.tsx', 1],
  ['src/app/me/vault/page.tsx', 1],
  ['src/app/me/watchlist/page.tsx', 1],
  ['src/app/favorites/page.tsx', 2],
  ['src/app/favorites/shelved/page.tsx', 1],
  ['src/app/favorites/stale/page.tsx', 1],
  ['src/app/favorites/trash/page.tsx', 1],
  ['src/app/marketplace/[slug]/detail-modals.tsx', 1],
  ['src/components/crdt/crdt-sync-status-pill.tsx', 1],
]

describe('U-424 P0：源码锁死 timeZone（与 U-285 / U-419 口径一致）', () => {
  it.each(P0_OVERLAY)('%s 含 %d 处 timeZone: Asia/Shanghai', (rel, count) => {
    const src = overlaySource(rel)
    expect(src.split("timeZone: 'Asia/Shanghai'").length - 1).toBe(count)
  })

  it('safety.ts 上次导出文案含 timeZone: "Asia/Shanghai"', () => {
    expect(repoSource('packages/store/src/repository/safety.ts')).toContain(
      'timeZone: "Asia/Shanghai"',
    )
  })

  it('16 处总数对得上清单（overlay 15 + store 1）', () => {
    const overlayTotal = P0_OVERLAY.reduce((sum, [, count]) => sum + count, 0)
    expect(overlayTotal).toBe(15)
  })

  it('me/history 与 me/notifications、me/vault 不再有无时区的 hour12 渲染', () => {
    for (const rel of [
      'src/app/me/history/page.tsx',
      'src/app/me/notifications/page.tsx',
      'src/app/me/vault/page.tsx',
    ]) {
      expect(overlaySource(rel)).not.toContain("toLocaleString('zh-CN', { hour12: false })")
    }
  })
})

describe('U-424 P0 #2：农历按北京时间出日期（lunar-date）', () => {
  it('临界值 2026-11-21 16:30 UTC（00:30 CST）为农历十月十四', () => {
    expect(lunarPartsFromIntl(new Date(CRITICAL))).toEqual({ month: 10, day: 14, leap: false })
    expect(formatLunarDate(new Date(CRITICAL))).toBe('农历十月十四')
  })

  it('临界值另一侧：2026-11-21 15:30 UTC（23:30 CST）仍为农历十月十三', () => {
    const before = Date.UTC(2026, 10, 21, 15, 30, 0)
    expect(lunarPartsFromIntl(new Date(before))).toEqual({ month: 10, day: 13, leap: false })
    expect(formatLunarDate(new Date(before))).toBe('农历十月十三')
  })
})

describe('U-424 P0 #16：/me/data 上次导出文案按北京时间出时间（safety.ts）', () => {
  function safetyFixture(): DataSafety {
    const checkedAt = CRITICAL + 60_000
    return {
      checkedAt,
      overall: 'ok',
      lastExport: {
        at: CRITICAL,
        format: 'json',
        counts: { favorites: 1, folders: 0, searches: 0 },
        truncated: false,
        sizeBytes: null,
      },
      lastImport: null,
      sync: {
        favorites: { lastSuccessAt: checkedAt - 60 * 60_000, lastFailureAt: null, lastErrorCode: null },
        watchlist: { lastSuccessAt: checkedAt - 2 * 60 * 60_000, lastFailureAt: null, lastErrorCode: null },
        exams: { lastSuccessAt: checkedAt - 2 * 60 * 60_000, lastFailureAt: null, lastErrorCode: null },
        vault: { exists: true, version: 3, updatedAt: checkedAt - 86_400_000 },
        crdt: { exists: true, updatedAt: checkedAt - 86_400_000 },
        unreadSyncFailures: 0,
      },
      localCounts: { favorites: 1, folders: 0, searches: 0, recentEvents: 0 },
      serverBackup: { status: 'unknown', reason: 'not-instrumented' },
      checks: [],
    }
  }

  it('临界值导出时间渲染为 2026/11/22 00:30:00（不是 UTC 的 2026/11/21 16:30）', () => {
    const checks = buildSafetyChecks(safetyFixture())
    const exportCheck = checks.find((c) => c.id === 'export_freshness')
    expect(exportCheck).toBeDefined()
    expect(exportCheck!.detail).toContain('上次导出在 2026/11/22 00:30:00')
    expect(exportCheck!.detail).not.toContain('2026/11/21 16:30')
  })
})
