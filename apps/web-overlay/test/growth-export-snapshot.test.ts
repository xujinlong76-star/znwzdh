/**
 * U-372 诚实化小步：本机成长快照（导出用）。
 *
 * 快照只能来自本机 localStorage：scope 恒为 'local-only'，摘要字段与档案
 * 原文一致；服务端没有这份档案，导出时由浏览器在下载前填进 growthSnapshot。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GROWTH_SNAPSHOT_NOTE,
  buildGrowthExportSnapshot,
  emptyProfile,
  levelProgress,
  type GrowthProfile,
} from '../src/lib/growth'

function stubStorage(seed: Record<string, string>): void {
  const map = new Map(Object.entries(seed))
  const store = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v)
    },
    removeItem: (k: string) => {
      map.delete(k)
    },
  }
  vi.stubGlobal('localStorage', store)
  vi.stubGlobal('window', { localStorage: store, dispatchEvent: () => {} })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildGrowthExportSnapshot', () => {
  it('快照注明本机口径，摘要与档案原文一致', () => {
    const now = new Date(2026, 10, 21, 12, 0)
    const profile: GrowthProfile = {
      ...emptyProfile(now),
      totalXp: 422,
      freezeCards: 2,
      longestStreak: 5,
    }
    stubStorage({ 'navhub.growth.v1': JSON.stringify(profile) })

    const snap = buildGrowthExportSnapshot(now)
    expect(snap.scope).toBe('local-only')
    expect(snap.source).toBe('browser-localStorage')
    expect(snap.note).toBe(GROWTH_SNAPSHOT_NOTE)
    expect(snap.note).toContain('只保存在这台设备')
    expect(snap.exportedAt).toBe(now.getTime())
    expect(snap.totalXp).toBe(422)
    expect(snap.level).toBe(levelProgress(422).level)
    expect(snap.title).toBe(levelProgress(422).title)
    expect(snap.freezeCards).toBe(2)
    expect(snap.longestStreak).toBe(5)
    // 档案原文原样打包，可验证内容
    expect(snap.profile.totalXp).toBe(422)
    expect(snap.profile.v).toBe(2)
  })

  it('本机无档案时快照仍是本机口径、等级为初始值，不伪造数据', () => {
    const now = new Date(2026, 10, 21, 12, 0)
    stubStorage({})
    const snap = buildGrowthExportSnapshot(now)
    expect(snap.scope).toBe('local-only')
    expect(snap.totalXp).toBe(0)
    expect(snap.level).toBe(levelProgress(0).level)
    expect(snap.profile.totalXp).toBe(0)
  })
})
