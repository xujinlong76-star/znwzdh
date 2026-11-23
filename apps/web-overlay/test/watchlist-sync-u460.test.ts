/**
 * U-460：追剧清单同步以提交数冒充已合并数，LWW 败方静默丢失。
 *
 * 旧行为（复现）：本地旧编辑（at=T0）推上去，服务端 LWW 跳过（applied=0、
 * 云端仍是 episode=3），客户端却按 pushed=1 报「已把本机 1 条追剧更新合并
 * 到云端」，且无条件 clearDirty()、本地被云端态覆盖 —— episode=9 的编辑
 * 永久丢失、无法重试。
 *
 * 修复后契约（照搬 U-371 收藏同步）：
 *   - 成功数按 applied 说，skipped 如实报出，不许再报「已合并」假成功；
 *   - 被跳过的本机改动放回 nextItems（不被云端覆盖），脏标记保留；
 *   - 脏标记只清已 applied 的 op；重试靠用户再改一次（updatedAt 刷新后
 *     op.at 更新，才能赢下 LWW；同 at 重推仍会被跳过）。
 *
 * 服务端不回 skipped 明细（HubWatchSyncPayload 只有 applied）：skipped 的
 * key 由客户端从回传 items 推导——回传行 updatedAt > op.at 即该 op 被跳过
 * （服务端 apply 时把 updated_at 写成 op.at，赢了的行 updatedAt 恒等于
 * op.at；输了的行保持更大的 updatedAt）。推导成立的前提是赢家行在
 * since 切片里：本地旧编辑存在本身就说明赢家编辑晚于上次游标，否则上次
 * 同步的增量早已把它合进本地、本地 updatedAt 不会还停在旧值。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { describeWatchlistSyncBanner } from '../src/lib/watchlist-sync-copy'
import { dramaKeyFor, type WatchEntry } from '../src/lib/watchlist'

const originalFetch = globalThis.fetch
const globals = globalThis as unknown as { window?: unknown; localStorage?: unknown }
let lastStore: Record<string, string> = {}

const WATCH_KEY = 'navhub.watchlist.v1'
const DIRTY_KEY = 'navhub.watchlist.dirty.v1'
const CURSOR_PREFIX = 'navhub.watchlist.sync.v1.'

/** 证据时间：T0 旧编辑 < T1 云端胜方（见 scan-d-evidence-1122/U-460） */
const T0 = 1795348000000
const T1 = 1795349000000

function installStorage(entries: Record<string, string>): void {
  const store: Record<string, string> = { ...entries }
  lastStore = store
  const localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v)
    },
    removeItem: (k: string) => {
      delete store[k]
    },
  }
  globals.localStorage = localStorage
  globals.window = {
    localStorage,
    addEventListener: () => {},
    removeEventListener: () => {},
  }
}

async function mountedModule(): Promise<typeof import('../src/hooks/useWatchlist')> {
  vi.resetModules()
  return import('../src/hooks/useWatchlist')
}

interface FetchCall {
  method: string
  url: string
  body?: string
}

function stubFetch(seq: number[], bodies: Record<number, string> = {}): FetchCall[] {
  const calls: FetchCall[] = []
  let i = 0
  globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string }) => {
    calls.push({ method: (init?.method ?? 'GET').toUpperCase(), url: String(input), body: init?.body })
    const next = seq.length === 0 ? 200 : seq[Math.min(i, seq.length - 1)]
    i++
    return {
      ok: next >= 200 && next < 300,
      status: next,
      text: async () => bodies[next] ?? '',
    } as unknown as Response
  }) as typeof fetch
  return calls
}

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.resetModules()
})

function watchEntry(over: { title: string; episode: number; updatedAt: number }): WatchEntry {
  const key = dramaKeyFor('nav-hongguo', over.title)
  return {
    key,
    title: over.title,
    platformSiteId: 'nav-hongguo',
    platformTitle: '红果短剧',
    playUrl: 'https://www.hongguo.com',
    episode: over.episode,
    priority: 'normal',
    cadence: { kind: 'unknown' },
    remind: true,
    lastProgressAt: over.updatedAt,
    createdAt: over.updatedAt - 1000,
    updatedAt: over.updatedAt,
  }
}

/** 服务端回执：applied 显式可控；items 为云端行（含 updatedAt，供推导 skipped 用） */
function syncBody(opts: { applied?: number; items: WatchEntry[]; version?: number }): string {
  return JSON.stringify({
    ok: true,
    ...(typeof opts.applied === 'number' ? { applied: opts.applied } : {}),
    version: opts.version ?? T1,
    items: opts.items.map((e) => ({ ...e, deletedAt: null })),
    truncatedTitles: 0,
  })
}

function signedIn(entries: WatchEntry[], dirtyKeys: string[], cursor: number): void {
  installStorage({
    'navhub.userId': 'user-1',
    [WATCH_KEY]: JSON.stringify(entries),
    [DIRTY_KEY]: JSON.stringify(dirtyKeys),
    [CURSOR_PREFIX + 'user-1']: String(cursor),
  })
}

describe('U-460：追剧清单同步不再以 pushed 冒充 applied', () => {
  it('① 复现：旧编辑被 LWW 跳过——applied=0、skipped=1，本机 episode=9 不被云端 3 覆盖', async () => {
    // 同一部剧（同 key）：本机旧编辑只改了集数，云端是另一台设备的新版
    const local = watchEntry({ title: '扫描测试剧', episode: 9, updatedAt: T0 })
    const cloud = watchEntry({ title: '扫描测试剧', episode: 3, updatedAt: T1 })
    signedIn([local], [local.key], T0 - 100_000)
    const { syncWatchlistToCloud: sync } = await mountedModule()
    const calls = stubFetch([200], { 200: syncBody({ applied: 0, items: [cloud] }) })
    const r = await sync()
    const payload = JSON.parse(calls[0]!.body ?? '{}') as { ops: Array<{ at: number }> }
    expect(payload.ops[0]!.at).toBe(T0)
    expect(r.ok).toBe(true)
    expect(r.pushed).toBe(1)
    expect(r.applied).toBe(0)
    expect(r.skipped).toBe(1)
    expect(r.skippedKeys).toEqual([local.key])
    // 被跳过的 op 不清脏：下次同步仍会重推（可重试）
    expect(lastStore[DIRTY_KEY]).toBe(JSON.stringify([local.key]))
    // 被跳过的本机改动不被云端增量覆盖：用户还能看到自己的 episode=9
    const kept = r.nextItems?.find((e) => e.key === local.key)
    expect(kept?.episode).toBe(9)
    expect(kept?.updatedAt).toBe(T0)
  })

  it('② 横幅不再报「已合并」假成功：applied=0、skipped=1 时明说未合并、被覆盖', () => {
    const banner = describeWatchlistSyncBanner({ ok: true, pushed: 1, applied: 0, skipped: 1 })
    expect(banner.tone).toBe('success')
    expect(banner.text).not.toContain('已把本机')
    expect(banner.text).toContain('未合并到云端')
    expect(banner.text).toContain('被另一台设备的更新版本覆盖')
    expect(banner.text).toContain('本机改动已保留')
    expect(banner.text).toContain('再改一次即可重试同步')
  })

  it('③ 全部应用：applied=1、skipped=0，横幅按 applied 报合并、脏标记清空', async () => {
    const local = watchEntry({ title: '扫描测试剧', episode: 9, updatedAt: T0 })
    signedIn([local], [local.key], T0 - 100_000)
    const { syncWatchlistToCloud: sync } = await mountedModule()
    stubFetch([200], { 200: syncBody({ applied: 1, items: [local] }) })
    const r = await sync()
    expect(r.ok).toBe(true)
    expect(r.pushed).toBe(1)
    expect(r.applied).toBe(1)
    expect(r.skipped).toBe(0)
    expect(r.skippedKeys).toEqual([])
    expect(lastStore[DIRTY_KEY]).toBe('[]')
    expect(r.nextItems?.find((e) => e.key === local.key)?.episode).toBe(9)
    expect(
      describeWatchlistSyncBanner({ ok: true, pushed: 1, applied: 1, skipped: 0 }).text,
    ).toBe('已把本机 1 条追剧更新合并到云端')
  })

  it('④ 部分跳过：只清已确认应用的 op，被跳过的保留脏标记与本机值', async () => {
    const a = watchEntry({ title: '甲剧', episode: 5, updatedAt: T0 })
    const b = watchEntry({ title: '乙剧', episode: 9, updatedAt: T0 })
    const bCloud = watchEntry({ title: '乙剧', episode: 3, updatedAt: T1 })
    signedIn([a, b], [a.key, b.key], T0 - 100_000)
    const { syncWatchlistToCloud: sync } = await mountedModule()
    stubFetch([200], { 200: syncBody({ applied: 1, items: [a, bCloud] }) })
    const r = await sync()
    expect(r.pushed).toBe(2)
    expect(r.applied).toBe(1)
    expect(r.skipped).toBe(1)
    expect(r.skippedKeys).toEqual([b.key])
    expect(lastStore[DIRTY_KEY]).toBe(JSON.stringify([b.key]))
    // a 已确认：取云端值；b 被跳过：保留本机值
    expect(r.nextItems?.find((e) => e.key === a.key)?.episode).toBe(5)
    expect(r.nextItems?.find((e) => e.key === b.key)?.episode).toBe(9)
    const banner = describeWatchlistSyncBanner({ ok: true, pushed: 2, applied: 1, skipped: 1 })
    expect(banner.text).toContain('已把本机 1 条追剧更新合并到云端')
    expect(banner.text).toContain('另有 1 条被另一台设备的更新版本覆盖')
  })

  it('⑤ 再改一次后重试能赢：updatedAt 刷新 → op.at 更新 → applied=1、清脏', async () => {
    const local = watchEntry({ title: '扫描测试剧', episode: 9, updatedAt: T0 })
    const cloud = watchEntry({ title: '扫描测试剧', episode: 3, updatedAt: T1 })
    signedIn([local], [local.key], T0 - 100_000)
    const { syncWatchlistToCloud: sync } = await mountedModule()
    stubFetch([200], { 200: syncBody({ applied: 0, items: [cloud] }) })
    const first = await sync()
    expect(first.skipped).toBe(1)
    expect(lastStore[DIRTY_KEY]).toBe(JSON.stringify([local.key]))

    // 用户看到跳过提示后又改了一次进度：updatedAt 刷新到 T1 之后
    const retriedLocal = watchEntry({ title: '扫描测试剧', episode: 10, updatedAt: T1 + 1000 })
    lastStore[WATCH_KEY] = JSON.stringify([retriedLocal])
    const calls = stubFetch([200], {
      200: syncBody({ applied: 1, items: [retriedLocal], version: T1 + 1000 }),
    })
    const retried = await sync()
    const payload = JSON.parse(calls[0]!.body ?? '{}') as { ops: Array<{ at: number; episode: number }> }
    expect(payload.ops[0]!.at).toBe(T1 + 1000)
    expect(payload.ops[0]!.episode).toBe(10)
    expect(retried.applied).toBe(1)
    expect(retried.skipped).toBe(0)
    expect(lastStore[DIRTY_KEY]).toBe('[]')
  })

  it('⑥ 旧协议回执无 applied 时回退 pushed（老调用方文案不变）', async () => {
    const local = watchEntry({ title: '扫描测试剧', episode: 9, updatedAt: T0 })
    signedIn([local], [local.key], T0 - 100_000)
    const { syncWatchlistToCloud: sync } = await mountedModule()
    stubFetch([200], { 200: syncBody({ items: [local] }) })
    const r = await sync()
    expect(r.applied).toBe(1)
    expect(r.skipped).toBe(0)
  })

  it('⑦ 老调用方没传 applied 时横幅仍按 pushed 说（与收藏同款回退）', () => {
    expect(describeWatchlistSyncBanner({ ok: true, pushed: 2 }).text).toBe(
      '已把本机 2 条追剧更新合并到云端',
    )
    expect(describeWatchlistSyncBanner({ ok: true }).text).toBe('云端同步正常')
  })
})
