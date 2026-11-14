/**
 * 共享 hook useMyExams（Wave 0）测试：
 *  - 源码守卫：单点读写（load/save 各一处）、挂载 effect 内初始化并订阅
 *    跨 tab 刷新、useSyncExternalStore 共享快照、存储键只从 lib import、
 *    写操作读共享现态（不读闭包旧 state）；
 *  - 运行时：读坏拒写、交错写不丢更新（竞态回归）、订阅通知、跨 tab 刷新、
 *    脏标记、重置先备份。
 *
 * node 环境：localStorage/window 用替身（与 click-evidence.test.ts 同款）；
 * 模块级共享态按 worker 持久（isolate:false），逐测动态 import 新模块隔离。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXAMS } from '../src/lib/exam-calendar'
import { MY_EXAMS_STORAGE_KEY } from '../src/lib/my-exams'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

const KEY = MY_EXAMS_STORAGE_KEY
const kaoyan = EXAMS.find((e) => e.id === 'kaoyan')!
const kaoyanFirstNode = kaoyan.nodes[0].label

/** 浏览器存储替身：node 环境里既没有 localStorage 也没有 window */
function stubBrowser(seed?: Record<string, string>, opts?: { getItemThrows?: boolean }) {
  const map = new Map<string, string>()
  if (seed) for (const [k, v] of Object.entries(seed)) map.set(k, v)
  const store = {
    get length() {
      return map.size
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => {
      if (opts?.getItemThrows) throw new Error('denied')
      return map.has(k) ? map.get(k)! : null
    },
    setItem: (k: string, v: string) => {
      map.set(k, v)
    },
    removeItem: (k: string) => {
      map.delete(k)
    },
  }
  vi.stubGlobal('localStorage', store)
  vi.stubGlobal('window', {
    localStorage: store,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  })
  return map
}

async function freshHook() {
  vi.resetModules()
  return await import('../src/hooks/useMyExams')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useMyExams 源码守卫', () => {
  const hook = read('src/hooks/useMyExams.ts')

  it('用 useSyncExternalStore 订阅同一份模块级快照，null 是挂载前哨兵', () => {
    expect(hook).toContain('useSyncExternalStore(')
    expect(hook).toContain('subscribeMyExams')
    expect(hook).toContain('getMyExamsSnapshot')
    expect(hook).toContain('applyMyExams')
    expect(hook).toContain('let sharedState: MyExamsState | null = null')
  })

  it('存储键只从 lib import，不在 hook 里写死字面量', () => {
    expect(hook).toContain('MY_EXAMS_STORAGE_KEY')
    expect(hook).toContain("from '@/lib/my-exams'")
    expect(hook).not.toContain("'navhub.my-exams.v1'")
  })

  it('读存储只在 loadMyExamsLocal 一处、写存储只在 saveMyExamsLocal 一处', () => {
    const loadBody = hook.slice(
      hook.indexOf('export function loadMyExamsLocal'),
      hook.indexOf('export function saveMyExamsLocal'),
    )
    expect(loadBody.match(/localStorage\.getItem/g)?.length).toBe(1)
    const saveBody = hook.slice(
      hook.indexOf('export function saveMyExamsLocal'),
      hook.indexOf('/* ---------------------------- 模块级共享状态'),
    )
    expect(saveBody.match(/localStorage\.setItem/g)?.length).toBe(1)
  })

  it('挂载 effect 内初始化并订阅跨 tab 刷新（读发生在挂载后）', () => {
    const effectBody = hook.slice(hook.indexOf('useEffect(() => {'), hook.indexOf('}, [])'))
    expect(effectBody).toContain('loadMyExamsLocal()')
    expect(effectBody).toContain("addEventListener('navhub_workbench_updated'")
    expect(effectBody).toContain("addEventListener('storage'")
  })

  it('写操作读模块级共享现态，不读调用方闭包里的旧 state', () => {
    const followBody = hook.slice(
      hook.indexOf('export function toggleMyExamsFollow'),
      hook.indexOf('export function toggleMyExamsNodeCheck'),
    )
    expect(followBody).toContain('const current = sharedState')
    const checkBody = hook.slice(
      hook.indexOf('export function toggleMyExamsNodeCheck'),
      hook.indexOf('export function replaceMyExamsAll'),
    )
    expect(checkBody).toContain('const current = sharedState')
    expect(hook).toContain('toggleMyExamsFollow(examId), [])')
    expect(hook).toMatch(/toggleMyExamsNodeCheck\(examId, nodeLabel\),\s*\n\s*\[\],/)
  })
})

describe('loadMyExamsLocal（运行时）', () => {
  it('空存储返回空态且不阻塞', async () => {
    stubBrowser()
    const { loadMyExamsLocal } = await freshHook()
    expect(loadMyExamsLocal()).toEqual({ state: { followed: [], checked: {} }, blocked: null })
  })

  it('合法 JSON 收敛：未知考试 id 与非法节点 label 被丢掉', async () => {
    stubBrowser({
      [KEY]: JSON.stringify({
        followed: ['kaoyan', 'no-such-exam'],
        checked: { kaoyan: [kaoyanFirstNode, '不存在的节点'] },
      }),
    })
    const { loadMyExamsLocal } = await freshHook()
    const { state, blocked } = loadMyExamsLocal()
    expect(blocked).toBeNull()
    expect(state.followed).toEqual(['kaoyan'])
    expect(state.checked).toEqual({ kaoyan: [kaoyanFirstNode] })
  })

  it('JSON 损坏返回 blocked（读坏拒写的前置条件）', async () => {
    stubBrowser({ [KEY]: '{"followed": ["kaoyan",' })
    const { loadMyExamsLocal } = await freshHook()
    const { blocked } = loadMyExamsLocal()
    expect(blocked).not.toBeNull()
    expect(blocked).toContain('读不出来')
  })

  it('getItem 抛错（存储被禁）返回 blocked', async () => {
    stubBrowser({}, { getItemThrows: true })
    const { loadMyExamsLocal } = await freshHook()
    expect(loadMyExamsLocal().blocked).not.toBeNull()
  })
})

describe('共享写操作（运行时，竞态回归）', () => {
  // 写操作走纯函数层的 ended 守卫（默认 Date.now()）：冻结到 2026-11-13，
  // 四场考试都未结束，否则 11-29 后 guokao 关注期望 true 的用例会变红。
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2026, 10, 13, 0, 0, 0))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('挂载读入前写操作拒绝（null 哨兵：还没读过本机存储）', async () => {
    stubBrowser()
    const { toggleMyExamsFollow } = await freshHook()
    expect(toggleMyExamsFollow('guokao')).toBe(false)
  })

  it('交错关注两场：两次写都落地，不互相覆盖（旧 bug：后写会吞掉先写）', async () => {
    const map = stubBrowser()
    const mod = await freshHook()
    mod.refreshMyExamsFromStorage()
    expect(mod.toggleMyExamsFollow('guokao')).toBe(true)
    expect(mod.toggleMyExamsFollow('kaoyan')).toBe(true)
    expect(mod.getMyExamsSnapshot().state?.followed).toEqual(['guokao', 'kaoyan'])
    expect(JSON.parse(map.get(KEY)!).followed).toEqual(['guokao', 'kaoyan'])
  })

  it('外部改动刷新后，写仍基于最新现态（跨实例/跨 tab 不丢更新）', async () => {
    const map = stubBrowser({ [KEY]: JSON.stringify({ followed: ['guokao'], checked: {} }) })
    const mod = await freshHook()
    mod.refreshMyExamsFromStorage()
    // 模拟另一 tab 写了新关注：直接改存储再刷新
    map.set(KEY, JSON.stringify({ followed: ['guokao', 'kaoyan'], checked: {} }))
    mod.refreshMyExamsFromStorage()
    expect(mod.toggleMyExamsNodeCheck('kaoyan', kaoyanFirstNode)).toBe(true)
    const state = mod.getMyExamsSnapshot().state!
    expect(state.followed).toEqual(['guokao', 'kaoyan'])
    expect(state.checked).toEqual({ kaoyan: [kaoyanFirstNode] })
  })

  it('读坏时所有写被拒，原存储串原样保留（不把坏数据伪装成空清单照写）', async () => {
    const raw = '{"followed": ["kaoyan",'
    const map = stubBrowser({ [KEY]: raw })
    const mod = await freshHook()
    mod.refreshMyExamsFromStorage()
    expect(mod.getMyExamsSnapshot().blocked).not.toBeNull()
    expect(mod.toggleMyExamsFollow('guokao')).toBe(false)
    expect(mod.toggleMyExamsNodeCheck('kaoyan', kaoyanFirstNode)).toBe(false)
    expect(mod.replaceMyExamsAll({ followed: [], checked: {} })).toBe(false)
    expect(map.get(KEY)).toBe(raw)
  })

  it('订阅者收到每次写通知，取消订阅后不再收到（多实例同源）', async () => {
    stubBrowser()
    const mod = await freshHook()
    mod.refreshMyExamsFromStorage()
    let calls = 0
    const off = mod.subscribeMyExams(() => {
      calls += 1
    })
    mod.toggleMyExamsFollow('guokao')
    expect(calls).toBe(1)
    off()
    mod.toggleMyExamsFollow('kaoyan')
    expect(calls).toBe(1)
  })

  it('脏标记：写后 examId 进脏集合，replaceAll 后清空', async () => {
    stubBrowser()
    const mod = await freshHook()
    mod.refreshMyExamsFromStorage()
    mod.toggleMyExamsFollow('guokao')
    expect(mod.readMyExamsDirtyKeys()).toEqual(['guokao'])
    expect(mod.replaceMyExamsAll({ followed: ['guokao'], checked: {} })).toBe(true)
    expect(mod.readMyExamsDirtyKeys()).toEqual([])
  })

  it('resetLocal：先备份原值再清空，备份可回读', async () => {
    const raw = JSON.stringify({ followed: ['guokao'], checked: {} })
    const map = stubBrowser({ [KEY]: raw })
    const mod = await freshHook()
    mod.refreshMyExamsFromStorage()
    const { backedUp } = mod.resetMyExamsLocal()
    expect(backedUp).toBe(true)
    expect(JSON.parse(map.get(KEY)!)).toEqual({ followed: [], checked: {} })
    const backupKey = [...map.keys()].find((k) => k.startsWith(`${KEY}.corrupt.`))
    expect(backupKey).toBeDefined()
    expect(map.get(backupKey!)).toBe(raw)
    expect(mod.getMyExamsSnapshot().state).toEqual({ followed: [], checked: {} })
  })
})
