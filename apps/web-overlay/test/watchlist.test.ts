import { describe, expect, it } from 'vitest'
import {
  applyWatchDelta,
  cadenceLabel,
  dramaKeyFor,
  isCadenceDay,
  isReminderDue,
  mergeCloudWatchlist,
  normalizeWatchCadence,
  partitionWatchlist,
  sanitizeWatchEntry,
  selectContinueWatching,
  type HubWatchEntry,
  type WatchEntry,
} from '../src/lib/watchlist'
import {
  describeAnonymousWatchlistNote,
  describeWatchlistSyncBanner,
  shouldOfferWatchlistRetry,
} from '../src/lib/watchlist-sync-copy'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 追剧清单的判定与合并口径。
 * 回归重点（都是「诚实」类事故面）：
 *  - 节奏未标注 / 已完结的剧永远不能进待看区（不许假装知道更新了）；
 *  - 今天改进度或手动「今天已看」后不再催；
 *  - 云端合并以云端成员为准，别的设备删掉的剧不能被本地缓存复活。
 */

// 固定一个周三（2026-11-11 是周三，getDay()=3）做判定基准，避免测试随运行日期漂移
const WED = new Date(2026, 10, 11, 10, 0, 0)
const TUE = new Date(2026, 10, 10, 10, 0, 0)
const DAY_MS = 24 * 60 * 60 * 1000

const entry = (over: Partial<WatchEntry> & { title: string }): WatchEntry => ({
  key: dramaKeyFor('nav-hongguo', over.title),
  platformSiteId: 'nav-hongguo',
  platformTitle: '红果短剧',
  playUrl: 'https://www.hongguo.com',
  episode: 3,
  priority: 'normal',
  cadence: { kind: 'unknown' },
  remind: true,
  lastProgressAt: WED.getTime() - 3 * DAY_MS,
  createdAt: WED.getTime() - 10 * DAY_MS,
  updatedAt: WED.getTime() - 3 * DAY_MS,
  ...over,
})

describe('dramaKeyFor / normalizeWatchCadence', () => {
  it('同一部剧在同一平台：空格与大小写差异归一到同一个 key', () => {
    expect(dramaKeyFor('p1', '  Abc  剧 ')).toBe(dramaKeyFor('p1', 'abc 剧'))
    expect(dramaKeyFor('p1', '甲剧')).not.toBe(dramaKeyFor('p2', '甲剧'))
  })

  it('非法节奏形状一律收敛成 unknown（不猜更新日）', () => {
    expect(normalizeWatchCadence(null)).toEqual({ kind: 'unknown' })
    expect(normalizeWatchCadence({ kind: 'weekly', weekdays: [] })).toEqual({ kind: 'unknown' })
    expect(normalizeWatchCadence({ kind: 'weekly', weekdays: [9, -1] })).toEqual({ kind: 'unknown' })
    expect(normalizeWatchCadence({ kind: 'weekly', weekdays: [4, 2, 2] })).toEqual({ kind: 'weekly', weekdays: [2, 4] })
    expect(normalizeWatchCadence({ kind: 'daily' })).toEqual({ kind: 'daily' })
  })

  it('节奏标签：unknown 必须直说未标注', () => {
    expect(cadenceLabel({ kind: 'unknown' })).toContain('未标注')
    expect(cadenceLabel({ kind: 'weekly', weekdays: [3] })).toBe('每周三更新')
    expect(cadenceLabel({ kind: 'daily' })).toBe('每天更新')
    expect(cadenceLabel({ kind: 'finished' })).toBe('已完结')
  })
})

describe('isCadenceDay / isReminderDue（有排播标注分支）', () => {
  it('daily：任何一天都是更新日，进度停在昨天之前就到期', () => {
    const e = entry({ title: '日更剧', cadence: { kind: 'daily' } })
    expect(isCadenceDay(e.cadence, WED)).toBe(true)
    expect(isReminderDue(e, WED)).toBe(true)
  })

  it('weekly：今天是标注的周几才到期，不是就不到期', () => {
    const wedShow = entry({ title: '周三剧', cadence: { kind: 'weekly', weekdays: [3] } })
    const tueShow = entry({ title: '周二剧', cadence: { kind: 'weekly', weekdays: [2] } })
    expect(isReminderDue(wedShow, WED)).toBe(true)
    expect(isReminderDue(tueShow, WED)).toBe(false)
    expect(isReminderDue(tueShow, TUE)).toBe(true)
  })

  it('今天已经改进度 = 今天已经看过，不再提醒', () => {
    const e = entry({
      title: '日更剧',
      cadence: { kind: 'daily' },
      lastProgressAt: WED.getTime() - 60_000,
    })
    expect(isReminderDue(e, WED)).toBe(false)
  })

  it('今天手动关过（今天已看）就不再提醒', () => {
    const e = entry({ title: '日更剧', cadence: { kind: 'daily' }, dismissedOn: '2026-11-11' })
    expect(isReminderDue(e, WED)).toBe(false)
  })

  it('逐剧提醒关掉后永不到期', () => {
    const e = entry({ title: '日更剧', cadence: { kind: 'daily' }, remind: false })
    expect(isReminderDue(e, WED)).toBe(false)
  })
})

describe('isReminderDue（无排播标注分支：绝不假装知道更新）', () => {
  it('unknown 节奏永不到期，只进「去看看」区', () => {
    const e = entry({ title: '没标注的剧' })
    expect(isReminderDue(e, WED)).toBe(false)
    const parts = partitionWatchlist([e], WED)
    expect(parts.due).toHaveLength(0)
    expect(parts.check.map((x) => x.title)).toEqual(['没标注的剧'])
  })

  it('finished 永不到期，进完结区', () => {
    const e = entry({ title: '完结剧', cadence: { kind: 'finished' } })
    expect(isReminderDue(e, WED)).toBe(false)
    const parts = partitionWatchlist([e], WED)
    expect(parts.finished.map((x) => x.title)).toEqual(['完结剧'])
    expect(parts.due).toHaveLength(0)
  })

  it('unknown 且提醒已关：既不待看也不催看，进在追区', () => {
    const e = entry({ title: '安静存着的剧', remind: false })
    const parts = partitionWatchlist([e], WED)
    expect(parts.check).toHaveLength(0)
    expect(parts.active.map((x) => x.title)).toEqual(['安静存着的剧'])
  })
})

describe('partitionWatchlist 排序', () => {
  it('待看区：想先看的在前，其次越久没动的越靠前', () => {
    const a = entry({ title: '普通久未看', cadence: { kind: 'daily' }, lastProgressAt: WED.getTime() - 9 * DAY_MS })
    const b = entry({ title: '想先看', cadence: { kind: 'daily' }, priority: 'high', lastProgressAt: WED.getTime() - 1 * DAY_MS })
    const c = entry({ title: '普通刚看过', cadence: { kind: 'daily' }, lastProgressAt: WED.getTime() - 1 * DAY_MS })
    const parts = partitionWatchlist([a, b, c], WED)
    expect(parts.due.map((x) => x.title)).toEqual(['想先看', '普通久未看', '普通刚看过'])
  })
})

describe('sanitizeWatchEntry', () => {
  it('缺剧名/平台/播放页的条目直接丢弃；集数被钳制；坏节奏收敛 unknown', () => {
    expect(sanitizeWatchEntry({ title: '', platformSiteId: 'p', playUrl: 'https://x' })).toBeNull()
    expect(sanitizeWatchEntry({ title: '甲', platformSiteId: 'p' })).toBeNull()
    const ok = sanitizeWatchEntry({
      title: '甲剧',
      platformSiteId: 'p1',
      playUrl: 'https://www.hongguo.com',
      episode: -5,
      cadence: { kind: 'weekly', weekdays: [42] },
      createdAt: 100,
    })
    expect(ok?.episode).toBe(0)
    expect(ok?.cadence).toEqual({ kind: 'unknown' })
    expect(ok?.key).toBe('p1::甲剧')
  })
})

describe('云端合并（与收藏同一套成员口径）', () => {
  const cloud = (over: Partial<HubWatchEntry> & { title: string }): HubWatchEntry => ({
    ...entry(over),
    ...over,
  })

  it('全量合并以云端成员为准：本地独有（未推上去）的条目不存活，云端字段为准', () => {
    const local = [entry({ title: '本地独有' }), entry({ title: '两边都有', episode: 1 })]
    const remote = [cloud({ title: '两边都有', episode: 9 })]
    const merged = mergeCloudWatchlist(local, remote)
    expect(merged.map((e) => e.title)).toEqual(['两边都有'])
    expect(merged[0]?.episode).toBe(9)
  })

  it('全量合并跳过墓碑', () => {
    const remote = [cloud({ title: '已删的剧', deletedAt: 123 })]
    expect(mergeCloudWatchlist([], remote)).toHaveLength(0)
  })

  it('增量应用：upsert 新值、墓碑删本地、未提及的本地条目原样保留', () => {
    const local = [entry({ title: '甲剧', episode: 1 }), entry({ title: '乙剧' }), entry({ title: '丙剧' })]
    const delta: HubWatchEntry[] = [
      cloud({ title: '甲剧', episode: 12 }),
      cloud({ title: '乙剧', deletedAt: 999 }),
      cloud({ title: '丁剧' }),
    ]
    const next = applyWatchDelta(local, delta)
    const byTitle = new Map(next.map((e) => [e.title, e]))
    expect(byTitle.get('甲剧')?.episode).toBe(12)
    expect(byTitle.has('乙剧')).toBe(false)
    expect(byTitle.has('丙剧')).toBe(true)
    expect(byTitle.has('丁剧')).toBe(true)
  })
})

describe('同步文案（watchlist-sync-copy）', () => {
  it('失败必须带原因；墓碑删除必须告知；匿名提示说清只存本机', () => {
    expect(describeWatchlistSyncBanner({ ok: false, error: '网络断开', retryable: true }).text).toContain('网络断开')
    expect(describeWatchlistSyncBanner({ ok: true, remoteRemoved: 2 }).text).toContain('2')
    expect(describeWatchlistSyncBanner(null).tone).toBe('hidden')
    expect(shouldOfferWatchlistRetry({ ok: false, retryable: true })).toBe(true)
    expect(shouldOfferWatchlistRetry({ ok: false, retryable: false })).toBe(false)
    expect(describeAnonymousWatchlistNote()).toContain('只保存在这台设备的浏览器里')
  })
})

describe('未登录本机存取（与 useWatchlist 落盘/读回同一条路径）', () => {
  it('落盘 JSON 读回后逐条 sanitize 往返一致（key/节奏/进度不丢）', async () => {
    const { parseFavorites } = await import('../src/lib/favorites-storage')
    const original = [
      entry({ title: '甲剧', cadence: { kind: 'weekly', weekdays: [2, 4] }, episode: 7 }),
      entry({ title: '乙剧', cadence: { kind: 'daily' }, priority: 'high', dismissedOn: '2026-11-10' }),
    ]
    const raw = JSON.stringify(original)
    const { items, corrupt } = parseFavorites<unknown>(raw)
    expect(corrupt).toBe(false)
    const back = items.map((x) => sanitizeWatchEntry(x))
    expect(back).toEqual(original)
  })

  it('存储损坏时解析层报 corrupt（不是空清单）——hook 据此拒绝覆盖', async () => {
    const { parseFavorites } = await import('../src/lib/favorites-storage')
    expect(parseFavorites<unknown>('{"key": 半截').corrupt).toBe(true)
    expect(parseFavorites<unknown>('').corrupt).toBe(false)
    expect(parseFavorites<unknown>(null).items).toEqual([])
  })
})

describe('useWatchlist 守卫（源码级，与 favorites-shared-state 同款）', () => {
  const HERE = dirname(fileURLToPath(import.meta.url))
  const candidates = [resolve(HERE, '..'), resolve(HERE, '..', '..', 'web-overlay')]
  const root = candidates.find((p) => existsSync(join(p, 'src', 'hooks', 'useWatchlist.ts'))) ?? candidates[0]
  const src = readFileSync(join(root, 'src', 'hooks', 'useWatchlist.ts'), 'utf8')

  it('模块级共享状态 + 读不出来拒绝写入', () => {
    expect(src).toContain('useSyncExternalStore(')
    expect(src).toContain('subscribeWatchlist')
    expect(src).toContain('if (storageBlocked) return false')
  })

  it('匿名身份不同步：syncWatchlistToCloud 对 anon-* 直接返回「只保存在本机」', () => {
    expect(src).toContain("identity.startsWith('anon-')")
    expect(src).toContain('未登录：追剧清单只保存在本机浏览器')
  })

  it('成长经验只在集数增大时记（往回改是纠错，不记也不扣）', () => {
    expect(src).toContain("if (nextEpisode > target.episode) recordGrowthEvent('watchlist_progress')")
  })
})

describe('页面诚实文案守卫（源码级）', () => {
  // 与 me-pages.test.ts 同款定位法：测试既可能在 overlay 里跑，也可能在 vendored 的 apps/web 里跑
  const HERE = dirname(fileURLToPath(import.meta.url))
  const candidates = [resolve(HERE, '..'), resolve(HERE, '..', '..', 'web-overlay')]
  const root = candidates.find((p) => existsSync(join(p, 'src', 'app', 'me', 'watchlist', 'page.tsx'))) ?? candidates[0]
  const page = readFileSync(join(root, 'src', 'app', 'me', 'watchlist', 'page.tsx'), 'utf8')

  it('待看区必须把提醒归因于「你标注的节奏」；「已更新」只许出现在否定语境里', () => {
    expect(page).toContain('按你标注的更新节奏')
    const badLines = page
      .split('\n')
      .filter((line) => line.includes('已更新') && !/不|没|冒充/.test(line))
    expect(badLines).toEqual([])
  })

  it('播放链接必须过 safeHref，不许裸 href={entry.playUrl}', () => {
    expect(page).not.toContain('href={entry.playUrl}')
    expect(page).toContain('href={safeHref(entry.playUrl)}')
  })
})

describe('selectContinueWatching（首页「继续追」取行口径）', () => {
  it('due 优先、check 其次、active 补位，finished 永不进', () => {
    const list = [
      entry({ title: '已完结剧', cadence: { kind: 'finished' } }),
      entry({ title: '在追剧', cadence: { kind: 'weekly', weekdays: [1] } }),
      entry({ title: '待查剧' }),
      entry({ title: '今日待看剧', cadence: { kind: 'daily' } }),
    ]
    expect(selectContinueWatching(list, WED).map((e) => e.title)).toEqual([
      '今日待看剧',
      '待查剧',
      '在追剧',
    ])
  })

  it('默认最多 4 部，limit 可改；空清单返回空数组', () => {
    const six = Array.from({ length: 6 }, (_, i) =>
      entry({ title: `在追剧${i}`, cadence: { kind: 'weekly', weekdays: [1] } }),
    )
    expect(selectContinueWatching(six, WED)).toHaveLength(4)
    expect(selectContinueWatching(six, WED, 2)).toHaveLength(2)
    expect(selectContinueWatching([], WED)).toEqual([])
  })

  it('提醒关掉的 unknown 剧不进 check、仍可经 active 补位', () => {
    const only = [entry({ title: '提醒关掉的剧', remind: false })]
    expect(partitionWatchlist(only, WED).check).toEqual([])
    expect(selectContinueWatching(only, WED).map((e) => e.title)).toEqual(['提醒关掉的剧'])
  })
})
