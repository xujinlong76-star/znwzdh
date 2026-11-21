/**
 * 考试关注的云端同步（U-379）：登录后只推脏考试 + since 增量 + 墓碑，
 * 与 syncWatchlistToCloud 同构；匿名不调同步、不逼登录。
 *
 * 契约：
 *   - 匿名：不发任何请求，本机就是事实源；
 *   - 登录首次同步：脏键从未写过且本地非空 → 全量推一次（防一次性迁移陷阱）；
 *   - op.at 取每场最后改动时间（navhub.my-exams.updated.v1），不是同步时刻；
 *   - 成功后合并结果落盘并翻进共享快照，只清已推且中途没再改过的脏标记；
 *   - 失败保留脏标记与游标，下次重试仍推；
 *   - 同步中途本地又改了：那几场以当前本机为准叠加，不被旧快照覆盖。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalFetch = globalThis.fetch
const globals = globalThis as unknown as { window?: unknown; localStorage?: unknown }
let lastStore: Record<string, string> = {}

const KEY = 'navhub.my-exams.v1'
const DIRTY_KEY = 'navhub.my-exams.dirty.v1'
const UPDATED_KEY = 'navhub.my-exams.updated.v1'
const CURSOR_KEY = 'navhub.my-exams.sync.v1.user-1'
const STATUS_KEY = 'navhub.my-exams.sync.last'

/** 伪造 localStorage + window（node 环境没有），让身份与本地关注可用 */
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
    dispatchEvent: () => true,
  }
}

/** 登录态 + 本地关注（state 形如 { followed, checked }） */
function signedIn(state: unknown, extra: Record<string, string> = {}): void {
  installStorage({ 'navhub.userId': 'user-1', [KEY]: JSON.stringify(state), ...extra })
}

/** 匿名态 + 本地关注 */
function anonUser(state: unknown): void {
  installStorage({
    'navhub.anonId': 'anon-11111111-2222-3333-4444-555555555555',
    [KEY]: JSON.stringify(state),
  })
}

interface FetchCall {
  method: string
  url: string
  body?: string
}

async function freshModule(): Promise<typeof import('../src/hooks/useMyExams')> {
  vi.resetModules()
  return import('../src/hooks/useMyExams')
}

/**
 * 按序应答的 fetch 替身：seq 用尽后重复最后一项，便于断言「只发了一次」。
 * 404 不重试（describeDegrade 判不可重试），适合失败用例；5xx/网络失败会重试。
 */
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

function syncBody(payload: Record<string, unknown>): string {
  return JSON.stringify(payload)
}

function readState(): unknown {
  return JSON.parse(lastStore[KEY] ?? 'null')
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  globalThis.fetch = originalFetch
  delete globals.window
  delete globals.localStorage
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('syncMyExamsToCloud', () => {
  it('匿名不调同步：零请求，本机就是事实源', async () => {
    anonUser({ followed: ['guokao'], checked: { guokao: ['准考证打印'] } })
    const calls = stubFetch([200])
    const mod = await freshModule()
    const r = await mod.syncMyExamsToCloud()
    expect(r.ok).toBe(false)
    expect(r.error).toContain('未登录')
    expect(calls).toHaveLength(0)
  })

  it('登录首次同步：脏键未写过 → 全量推一次；成功后落盘、清脏、推进游标', async () => {
    signedIn(
      { followed: ['guokao', 'kaoyan'], checked: { guokao: ['准考证打印'] } },
      { [UPDATED_KEY]: JSON.stringify({ guokao: 1000, kaoyan: 2000 }) },
    )
    const calls = stubFetch(
      [200],
      {
        200: syncBody({
          ok: true,
          applied: 2,
          version: 5000,
          items: [
            { examId: 'guokao', checked: ['准考证打印'], createdAt: 1000, updatedAt: 1000, deletedAt: null },
            { examId: 'kaoyan', checked: [], createdAt: 2000, updatedAt: 2000, deletedAt: null },
          ],
        }),
      },
    )
    const mod = await freshModule()
    const r = await mod.syncMyExamsToCloud()
    expect(r.ok).toBe(true)
    expect(r.pushed).toBe(2)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('/api/me/exams/sync')
    const sent = JSON.parse(calls[0]?.body ?? '{}') as {
      ops: Array<{ op: string; examId: string; at: number }>
      since: number
    }
    expect(sent.since).toBe(0)
    expect(sent.ops.map((o) => o.examId).sort()).toEqual(['guokao', 'kaoyan'])
    // op.at 取每场最后改动时间，不是同步时刻
    expect(sent.ops.find((o) => o.examId === 'guokao')?.at).toBe(1000)
    expect(sent.ops.find((o) => o.examId === 'kaoyan')?.at).toBe(2000)
    // 合并结果已落盘：云端成员集合为准
    expect(readState()).toEqual({ followed: ['guokao', 'kaoyan'], checked: { guokao: ['准考证打印'] } })
    expect(lastStore[DIRTY_KEY]).toBe('[]')
    expect(lastStore[CURSOR_KEY]).toBe('5000')
    expect(JSON.parse(lastStore[STATUS_KEY] ?? '{}').ok).toBe(true)
  })

  it('增量拉取不删本地未推送的关注（另一台设备的新关注合并进来）', async () => {
    signedIn(
      { followed: ['kaoyan'], checked: { kaoyan: ['初试'] } },
      {
        [DIRTY_KEY]: JSON.stringify(['kaoyan']),
        [UPDATED_KEY]: JSON.stringify({ kaoyan: 3000 }),
        [CURSOR_KEY]: '100',
      },
    )
    const calls = stubFetch(
      [200],
      {
        200: syncBody({
          ok: true,
          applied: 1,
          version: 4000,
          items: [
            { examId: 'guokao', checked: ['准考证打印'], createdAt: 1500, updatedAt: 1500, deletedAt: null },
          ],
        }),
      },
    )
    const mod = await freshModule()
    const r = await mod.syncMyExamsToCloud()
    expect(r.ok).toBe(true)
    expect(r.pushed).toBe(1)
    expect(calls).toHaveLength(1)
    const sent = JSON.parse(calls[0]?.body ?? '{}') as { since: number }
    expect(sent.since).toBe(100)
    // 增量 upsert：云端新关注进来，本地未推送的 kaoyan 还在
    expect(readState()).toEqual({
      followed: ['kaoyan', 'guokao'],
      checked: { kaoyan: ['初试'], guokao: ['准考证打印'] },
    })
    expect(lastStore[DIRTY_KEY]).toBe('[]')
    expect(lastStore[CURSOR_KEY]).toBe('4000')
  })

  it('取消关注只推墓碑 op；云端墓碑拉回后本地同步取消', async () => {
    signedIn(
      { followed: [], checked: {} },
      {
        [DIRTY_KEY]: JSON.stringify(['guokao']),
        [UPDATED_KEY]: JSON.stringify({ guokao: 3000 }),
        [CURSOR_KEY]: '100',
      },
    )
    const calls = stubFetch(
      [200],
      {
        200: syncBody({
          ok: true,
          applied: 1,
          version: 4000,
          items: [{ examId: 'guokao', checked: [], createdAt: 1000, updatedAt: 3000, deletedAt: 3000 }],
        }),
      },
    )
    const mod = await freshModule()
    const r = await mod.syncMyExamsToCloud()
    expect(r.ok).toBe(true)
    expect(r.remoteRemoved).toBe(1)
    const sent = JSON.parse(calls[0]?.body ?? '{}') as {
      ops: Array<{ op: string; examId: string }>
    }
    expect(sent.ops).toEqual([{ op: 'unfollow', examId: 'guokao', at: 3000 }])
    expect(readState()).toEqual({ followed: [], checked: {} })
  })

  it('同步失败保留脏标记与游标，下次重试仍推', async () => {
    signedIn(
      { followed: ['guokao'], checked: { guokao: ['准考证打印'] } },
      {
        [DIRTY_KEY]: JSON.stringify(['guokao']),
        [UPDATED_KEY]: JSON.stringify({ guokao: 1000 }),
        [CURSOR_KEY]: '100',
      },
    )
    const calls = stubFetch([404], { 404: syncBody({ error: 'not found' }) })
    const mod = await freshModule()
    const r = await mod.syncMyExamsToCloud()
    expect(r.ok).toBe(false)
    expect(calls).toHaveLength(1)
    expect(lastStore[DIRTY_KEY]).toBe(JSON.stringify(['guokao']))
    expect(lastStore[CURSOR_KEY]).toBe('100')
    expect(JSON.parse(lastStore[STATUS_KEY] ?? '{}').ok).toBe(false)
  })

  it('同步中途本地又改了：旧快照不覆盖新改动，延迟触发把新改动推上去', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-13T00:00:00Z'))
    signedIn(
      { followed: ['guokao'], checked: { guokao: ['准考证打印'] } },
      {
        [DIRTY_KEY]: JSON.stringify(['guokao']),
        [UPDATED_KEY]: JSON.stringify({ guokao: 1000 }),
        [CURSOR_KEY]: '100',
      },
    )
    const calls: FetchCall[] = []
    let resolveFirst: ((res: Response) => void) | null = null
    globalThis.fetch = ((input: unknown, init?: { method?: string; body?: string }) => {
      calls.push({ method: (init?.method ?? 'GET').toUpperCase(), url: String(input), body: init?.body })
      if (calls.length === 1) {
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () =>
          syncBody({
            ok: true,
            applied: 1,
            version: 6000,
            items: [
              { examId: 'guokao', checked: ['准考证打印'], createdAt: 1000, updatedAt: 1000, deletedAt: null },
              { examId: 'kaoyan', checked: ['准考证下载'], createdAt: 2000, updatedAt: 2000, deletedAt: null },
            ],
          }),
      } as unknown as Response)
    }) as typeof fetch

    const mod = await freshModule()
    // 先把共享快照初始化成本地态（否则 toggle 读到 null 直接返回 false）
    mod.applyMyExams({ state: { followed: ['guokao'], checked: { guokao: ['准考证打印'] } }, blocked: null })
    const pending = mod.syncMyExamsToCloud()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(1)
    // 同步在途时另一张卡片关注了考研
    expect(mod.toggleMyExamsFollow('kaoyan')).toBe(true)
    resolveFirst!({
      ok: true,
      status: 200,
      text: async () =>
        syncBody({
          ok: true,
          applied: 1,
          version: 5000,
          items: [
            { examId: 'guokao', checked: ['准考证打印'], createdAt: 1000, updatedAt: 1000, deletedAt: null },
          ],
        }),
    } as unknown as Response)
    const r = await pending
    expect(r.ok).toBe(true)
    // 考研关注没被本次同步的旧快照覆盖
    expect(readState()).toEqual({
      followed: ['guokao', 'kaoyan'],
      checked: { guokao: ['准考证打印'] },
    })
    // 考研仍脏（本次没推过），国考已清脏
    expect(JSON.parse(lastStore[DIRTY_KEY] ?? '[]')).toEqual(['kaoyan'])
    // 延迟触发（800ms）把考研推上去
    await vi.advanceTimersByTimeAsync(800)
    expect(calls.length).toBeGreaterThanOrEqual(2)
    const second = JSON.parse(calls[1]?.body ?? '{}') as {
      ops: Array<{ op: string; examId: string }>
    }
    expect(second.ops.map((o) => o.examId)).toContain('kaoyan')
  })
})
