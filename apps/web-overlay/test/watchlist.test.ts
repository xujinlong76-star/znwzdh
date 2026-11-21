import { describe, expect, it, afterEach, beforeEach } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import {
  applyWatchDelta,
  asPremiereDate,
  cadenceLabel,
  dramaKeyFor,
  dramaReservedKeyFor,
  isCadenceDay,
  isReminderDue,
  isReservedEntry,
  isReservedPremiereDue,
  mergeCloudWatchlist,
  normalizeWatchCadence,
  partitionWatchlist,
  RESERVED_PLATFORM_TITLE,
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
import { useWatchlist, type WatchlistApi } from '../src/hooks/useWatchlist'
import { WATCHLIST_STORAGE_KEY } from '../src/lib/watchlist'
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

/* ------------------------------ 预约态（U-377） ------------------------------ */

/**
 * 开播日历上的剧没有平台信息（预约榜不给平台），追剧清单键是
 * platformSiteId:归一化剧名，无平台就无键——修法是只按剧名占位
 * （reserved::归一化剧名），不乱指平台入口。
 *  - 预约态不进新集检查：键不在 featured 检查集合里（平台键才在），
 *    partition 也不把它放进 check 区，故「未查到最新集数」无从写起；
 *  - 开播日到了也不静默消失：仍在 reserved 分区，只改文案。
 */
const reservedEntry = (over: Partial<WatchEntry> & { title: string }): WatchEntry => ({
  key: dramaReservedKeyFor(over.title),
  // title 只由 ...over 提供：显式再写 title: over.title 会与 spread 里的必填 title
  // 重复，tsc TS2783。entry() 同款写法（key 在前、title 只走 spread）可过。
  platformSiteId: '',
  platformTitle: RESERVED_PLATFORM_TITLE,
  playUrl: '',
  episode: 0,
  priority: 'normal',
  cadence: { kind: 'unknown' },
  remind: true,
  lastProgressAt: WED.getTime() - 3 * DAY_MS,
  createdAt: WED.getTime() - 10 * DAY_MS,
  updatedAt: WED.getTime() - 3 * DAY_MS,
  premiereDate: '2026-11-30',
  ...over,
})

describe('预约态 U-377：reserved::剧名占位键', () => {
  it('键只按归一化剧名，不指向平台：空格/大小写归一，与一切平台键互斥', () => {
    expect(dramaReservedKeyFor('  Abc  剧 ')).toBe(dramaReservedKeyFor('abc 剧'))
    expect(dramaReservedKeyFor('甲剧')).toBe('reserved::甲剧')
    expect(dramaReservedKeyFor('甲剧')).not.toBe(dramaKeyFor('nav-hongguo', '甲剧'))
    // 平台键的平台段是真实平台站 id（nav-*），与 reserved:: 命名空间互斥
  })

  it('asPremiereDate：只认 YYYY-MM-DD，非法不猜不补', () => {
    expect(asPremiereDate('2026-11-30')).toBe('2026-11-30')
    expect(asPremiereDate('11月30日')).toBeNull()
    expect(asPremiereDate(null)).toBeNull()
    expect(asPremiereDate(20261130)).toBeNull()
  })

  it('sanitize：预约态无平台无播放页是合法形状，平台名固定「平台待确认」；非预约态缺平台/播放页仍丢弃', () => {
    const reserved = sanitizeWatchEntry({
      key: 'reserved::待开播剧',
      title: '待开播剧',
      platformSiteId: '',
      platformTitle: '',
      playUrl: '',
      premiereDate: '2026-11-30',
    })
    expect(reserved).not.toBeNull()
    expect(reserved?.platformTitle).toBe('平台待确认')
    expect(reserved?.playUrl).toBe('')
    expect(reserved?.premiereDate).toBe('2026-11-30')
    expect(sanitizeWatchEntry({ title: '无平台剧', platformSiteId: '', playUrl: '' })).toBeNull()
    expect(sanitizeWatchEntry({ title: '无播放页剧', platformSiteId: 'p1', playUrl: '' })).toBeNull()
    // 坏开播日不拖垮条目：字段直接省略（不写 premiereDate: null）
    expect(
      sanitizeWatchEntry({ key: 'reserved::坏日期剧', title: '坏日期剧', premiereDate: '下月' })?.premiereDate,
    ).toBeUndefined()
  })

  it('分区：预约态只进 reserved，不进 due/check/active/finished；提醒永不到期', () => {
    const reserved = reservedEntry({ title: '待开播剧' })
    expect(isReservedEntry(reserved)).toBe(true)
    expect(isReminderDue(reserved, WED)).toBe(false)
    const parts = partitionWatchlist(
      [reserved, entry({ title: '待查剧' }), entry({ title: '今日待看剧', cadence: { kind: 'daily' } })],
      WED,
    )
    expect(parts.reserved.map((e) => e.title)).toEqual(['待开播剧'])
    expect(parts.check.map((e) => e.title)).toEqual(['待查剧'])
    expect(parts.due.map((e) => e.title)).toEqual(['今日待看剧'])
    expect(parts.active).toEqual([])
    expect(parts.finished).toEqual([])
  })

  it('开播日到了也不静默消失：仍在 reserved 分区，只改到期判定', () => {
    const past = reservedEntry({ title: '已到开播日的剧', premiereDate: '2026-11-10' })
    expect(isReservedPremiereDue(past, WED)).toBe(true)
    expect(isReservedPremiereDue(reservedEntry({ title: '未到开播日的剧' }), WED)).toBe(false)
    expect(isReservedPremiereDue(reservedEntry({ title: '无日期的剧', premiereDate: null }), WED)).toBe(false)
    const parts = partitionWatchlist([past], WED)
    expect(parts.reserved.map((e) => e.title)).toEqual(['已到开播日的剧'])
    expect([...parts.due, ...parts.check, ...parts.active, ...parts.finished]).toEqual([])
  })

  it('「继续追」不取预约态：还没开播的剧不叫继续追', () => {
    const list = [reservedEntry({ title: '待开播剧' }), entry({ title: '在追剧', cadence: { kind: 'weekly', weekdays: [1] } })]
    expect(selectContinueWatching(list, WED).map((e) => e.title)).toEqual(['在追剧'])
    expect(selectContinueWatching([reservedEntry({ title: '只有预约' })], WED)).toEqual([])
  })

  it('云端往返：预约态开播日只存本机，云端没带就用本地缓存补回', () => {
    const local = reservedEntry({ title: '待开播剧', premiereDate: '2026-11-30' })
    const cloudWithoutDate: HubWatchEntry = {
      ...local,
      premiereDate: undefined,
    }
    delete (cloudWithoutDate as unknown as Record<string, unknown>).premiereDate
    const merged = mergeCloudWatchlist([local], [cloudWithoutDate])
    expect(merged).toHaveLength(1)
    expect(merged[0]?.premiereDate).toBe('2026-11-30')
    // 增量同样补回
    const deltaApplied = applyWatchDelta([], [cloudWithoutDate])
    expect(deltaApplied).toHaveLength(1)
    const deltaWithLocal = applyWatchDelta([local], [{ ...cloudWithoutDate, updatedAt: Date.now() }])
    expect(deltaWithLocal.find((e) => e.key === local.key)?.premiereDate).toBe('2026-11-30')
  })
})

/* ------------------------------------------------------------------ *
 * U-377 返工：先预约、后平台加入——平台态 add 必须就地升级预约条目，
 * 不生成第二条（复核实锤：原实现只按平台键去重，reserved:: 键恒不
 * 相等，同一部剧会同时出现在预约区与在追区）。
 *
 * 真渲染 hook（diy-smart-autotune 同款：假浏览器 + renderToString
 * 抓 api）。add/addReserved 读的是模块级 sharedEntries、不依赖水合，
 * 效果器在 SSR 下不跑；用例间用 resetLocal() 清共享态。
 * ------------------------------------------------------------------ */

function installFakeBrowser(): { get: (key: string) => string | null } {
  const store = new Map<string, string>()
  const localStorage = {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      store.set(k, v)
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size
    },
  }
  const windowStub = {
    localStorage,
    sessionStorage: { getItem: () => null, setItem: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    location: { hash: '', pathname: '/', search: '' },
    history: { replaceState: () => {} },
  }
  ;(globalThis as unknown as { window: unknown }).window = windowStub
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = localStorage
  return { get: (key: string) => (store.has(key) ? (store.get(key) as string) : null) }
}

function uninstallFakeBrowser() {
  delete (globalThis as unknown as { window?: unknown }).window
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage
}

/** renderToString 真渲染一次 hook，抓出返回的 api。 */
function renderWatchlistApi(): WatchlistApi {
  const holder: { api: WatchlistApi | null } = { api: null }
  function Probe() {
    holder.api = useWatchlist()
    return null
  }
  renderToString(createElement(Probe))
  if (holder.api === null) throw new Error('useWatchlist 未返回 api')
  return holder.api
}

describe('预约 → 平台加入就地升级（U-377 返工）', () => {
  let storageGet: (key: string) => string | null

  beforeEach(() => {
    storageGet = installFakeBrowser().get
    // 清掉上个用例的模块级共享态（resetLocal 只动清单与脏标记，不动水合标志）
    renderWatchlistApi().resetLocal()
  })

  afterEach(() => {
    uninstallFakeBrowser()
  })

  /** 脏集合读回：键名与 useWatchlist.ts 的 DIRTY_KEY 同值（navhub.watchlist.dirty.v1）。 */
  const readDirtyKeys = (): string[] => {
    const raw = storageGet('navhub.watchlist.dirty.v1')
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  }

  it('先预约、后平台加入不重复：清单仍只有 1 条该剧，平台字段已补、开播日保留', () => {
    const api = renderWatchlistApi()
    const reserved = api.addReserved('待开播剧', '2026-11-30')
    expect(reserved).not.toBeNull()
    expect(reserved?.key).toBe('reserved::待开播剧')
    expect(reserved?.premiereDate).toBe('2026-11-30')

    // 平台加入：标题带首尾空白也应命中归一回查
    const upgraded = api.add(
      { siteId: 'nav-hongguo', title: '红果短剧', href: 'https://www.hongguo.com' },
      { title: ' 待开播剧 ' },
    )
    expect(upgraded).not.toBeNull()
    expect(upgraded?.key).toBe('nav-hongguo::待开播剧')
    expect(upgraded?.platformSiteId).toBe('nav-hongguo')
    expect(upgraded?.platformTitle).toBe('红果短剧')
    expect(upgraded?.playUrl).toBe('https://www.hongguo.com')
    // 已有进度与开播日保留（预约时 episode 为 0）
    expect(upgraded?.episode).toBe(0)
    expect(upgraded?.premiereDate).toBe('2026-11-30')

    // 清单仍只有 1 条该剧：以落盘 JSON 为准（renderToString 下 hook 的 entries
    // 恒取服务端空快照，读不到模块态；落盘 JSON 就是 loadLocal 下次读回的清单）
    const stored = JSON.parse(storageGet(WATCHLIST_STORAGE_KEY) ?? '[]') as WatchEntry[]
    expect(stored.map((e) => e.key)).toEqual(['nav-hongguo::待开播剧'])
    expect(stored).toHaveLength(1)
    expect(stored[0]?.platformSiteId).toBe('nav-hongguo')
    expect(stored[0]?.premiereDate).toBe('2026-11-30')
  })

  it('升级后预约占位不滞留：分区里不再有该剧的 reserved 条目', () => {
    const api = renderWatchlistApi()
    api.addReserved('待开播剧', '2026-11-30')
    api.add(
      { siteId: 'nav-hongguo', title: '红果短剧', href: 'https://www.hongguo.com' },
      { title: '待开播剧' },
    )
    // 以落盘 JSON（下次 loadLocal 读回的清单）为准：不再有 reserved:: 键，
    // 且该剧正常进在追分区（unknown 节奏 → check 区），不是凭空消失
    const stored = JSON.parse(storageGet(WATCHLIST_STORAGE_KEY) ?? '[]') as WatchEntry[]
    expect(stored.every((e) => !isReservedEntry(e))).toBe(true)
    const parts = partitionWatchlist(stored, WED)
    expect(parts.reserved).toEqual([])
    expect([...parts.due, ...parts.check, ...parts.active, ...parts.finished].map((e) => e.title)).toEqual([
      '待开播剧',
    ])
  })

  it('中间同步过再升级：旧 reserved 键仍进脏集合，下次同步能对其生成 remove op', () => {
    const api = renderWatchlistApi()
    const reserved = api.addReserved('待开播剧', '2026-11-30')
    expect(reserved).not.toBeNull()
    if (!reserved) throw new Error('addReserved 应返回预约条目')
    expect(reserved.key).toBe('reserved::待开播剧')
    // 预约后脏集合里有旧键（若此处已为空，后面的断言就是空断言）
    expect(readDirtyKeys()).toEqual(['reserved::待开播剧'])

    // 模拟一次成功同步：页面在 syncWatchlistToCloud 成功后调
    // replaceAll(nextItems)，其本身清脏集合、保留条目——与「预约后打开一次
    // 我的追剧触发自动同步成功」是同一中间态（同步成功后 clearDirty，见
    // useWatchlist.ts:680）。注意：不用 resetLocal() 模拟，它会连清单一起清掉。
    expect(api.replaceAll([reserved])).toBe(true)
    expect(readDirtyKeys()).toEqual([])
    const storedAfterSync = JSON.parse(storageGet(WATCHLIST_STORAGE_KEY) ?? '[]') as WatchEntry[]
    expect(storedAfterSync.map((e) => e.key)).toEqual(['reserved::待开播剧'])

    // 此时再平台加入升级
    const upgraded = api.add(
      { siteId: 'nav-hongguo', title: '红果短剧', href: 'https://www.hongguo.com' },
      { title: '待开播剧' },
    )
    expect(upgraded).not.toBeNull()
    expect(upgraded?.key).toBe('nav-hongguo::待开播剧')

    // 旧 reserved 键必须在脏集合里：它已不在本地清单（下条断言），同步时
    // 按「在脏集合里且本地已无此键」对其生成 remove op（useWatchlist.ts:646-648），
    // 云端占位才会被写墓碑；否则新设备全量拉取时占位复活。
    expect(readDirtyKeys().sort()).toEqual(['nav-hongguo::待开播剧', 'reserved::待开播剧'].sort())
    const stored = JSON.parse(storageGet(WATCHLIST_STORAGE_KEY) ?? '[]') as WatchEntry[]
    expect(stored.map((e) => e.key)).toEqual(['nav-hongguo::待开播剧'])
  })
})
