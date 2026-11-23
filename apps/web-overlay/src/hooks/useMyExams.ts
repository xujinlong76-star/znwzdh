'use client'

/**
 * 「我的考试」共享 hook：/exam 十二场卡片与首页条带共用同一份模块级快照。
 *
 * 旧实现每场卡片各持一份 useState 快照、写回时用闭包旧快照整份覆盖——
 * A 卡片关注后，B 卡片再点一次勾选就会把 A 的关注写丢（丢更新竞态）。
 * 本 hook 照抄 useWatchlist 的纪律：模块级共享快照 + useSyncExternalStore，
 * 写操作一律读模块级共享现态再派生，不读渲染闭包里的旧 state。
 *
 * 本地读写的损坏纪律与追剧清单完全一致：读不出来（JSON 损坏、存储被禁）
 * 时拒绝覆盖并把原因交回界面（storageBlocked），绝不把坏数据伪装成空
 * 清单后照写；重置前先备份原值。
 *
 * 云端同步（U-379）：登录后关注与勾选走 POST /api/me/exams/sync（与追剧
 * 同一套批量 ops + 版本游标 + 墓碑协议）。未登录不调同步、不逼登录；
 * 挂载后拉一次云端（同一身份同一会话只拉一次）、关注/勾选后延迟推一次、
 * 登录与合并事件触发再拉一次。同步失败保留脏标记、下次重试，本机仍可用。
 *
 * 脏标记（navhub.my-exams.dirty.v1）：每次本地写操作把 examId 标脏，
 * 同步时按「只推脏考试 + since 增量 + 墓碑」消费它；首次同步须先把全部
 * 已关注 examId 标脏全量推一次，否则全量合并会把本地关注删光（追剧清单
 * 同款一次性迁移陷阱）。每场考试的最后改动时间另记在
 * navhub.my-exams.updated.v1（LWW 的 at 来源；老用户首次同步时缺失，
 * 以同步时刻为准）。
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { type ExamInfo, type ExamNode } from '@/lib/exam-calendar'
import { describeDegrade } from '@/lib/degrade'
import { corruptKeyFor } from '@/lib/favorites-storage'
import { getIdentity } from '@/lib/identity'
import {
  syncMyExamsBatch,
  type HubMyExamsSyncPayload,
  type MyExamSyncOp,
} from '@/lib/navhub-api'
import {
  EMPTY_MY_EXAMS,
  MY_EXAMS_STORAGE_KEY,
  applyMyExamsDelta,
  checkedCount as checkedCountPure,
  isFollowed as isFollowedPure,
  mergeCloudMyExams,
  nearestFollowedExam,
  nextTodoNode,
  parseMyExams,
  toggleFollow as toggleFollowPure,
  toggleNodeCheck as toggleNodeCheckPure,
  type HubExamFollow,
  type MyExamsState,
} from '@/lib/my-exams'

const KEY = MY_EXAMS_STORAGE_KEY
const DIRTY_KEY = 'navhub.my-exams.dirty.v1'
const UPDATED_KEY = 'navhub.my-exams.updated.v1'

export interface MyExamsApi {
  /** null = 还没读过本机存储（挂载前哨兵，与服务端渲染一致的未关注视图） */
  state: MyExamsState | null
  /** 已读过本地（对位 useWatchlist.ready） */
  ready: boolean
  /** 非 null = 本地存储读不出来：所有写入被拒，界面必须把原因显示出来 */
  storageBlocked: string | null
  isFollowed: (examId: string) => boolean
  /** 某场考试已勾选的节点数（对位 lib checkedCount 的 hook 内版本） */
  checkedCount: (exam: ExamInfo) => number
  /** 某场考试的下一步待办（未关注/全部做完返回 undefined） */
  nextTodo: (exam: ExamInfo) => ExamNode | undefined
  /** 首页条带用：已关注、未结束、首日最早的一场 */
  nearestFollowed: () => ExamInfo | undefined
  /** 关注 / 取消关注；未知考试 id 是 no-op，返回是否实际发生变化 */
  toggleFollow: (examId: string) => boolean
  /** 勾选 / 取消勾选一个节点；只对已关注考试生效，其余 no-op 返回 false */
  toggleNodeCheck: (examId: string, nodeLabel: string) => boolean
  /** 同步成功后用合并结果整体替换本地（云端是事实源），并清脏标记 */
  replaceAll: (state: MyExamsState) => boolean
  /** 重置本地：先备份原值再清空；返回 { backedUp } */
  resetLocal: () => { backedUp: boolean }
}

/* ---------------------------- 本地读写 ---------------------------- */

export function loadMyExamsLocal(): { state: MyExamsState; blocked: string | null } {
  if (typeof window === 'undefined') return { state: EMPTY_MY_EXAMS, blocked: null }
  let raw: string | null
  try {
    raw = window.localStorage.getItem(KEY)
  } catch {
    return {
      state: EMPTY_MY_EXAMS,
      blocked: '浏览器不允许读写本地存储（隐私模式或权限被拒），本次考试关注改动无法保存。',
    }
  }
  if (raw === null) return { state: EMPTY_MY_EXAMS, blocked: null }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {
      state: EMPTY_MY_EXAMS,
      blocked:
        '本地考试关注读不出来（可能写入中断，或被其他程序改写）。为避免覆盖掉原数据，已暂停保存考试关注改动 —— 原数据仍在浏览器里，可以先备份再重置。',
    }
  }
  return { state: parseMyExams(parsed), blocked: null }
}

export function saveMyExamsLocal(state: MyExamsState): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // 存储满 / 隐私模式：内存态仍然有效，刷新丢失
  }
}

/* ---------------------------- 模块级共享状态 ---------------------------- */

export type MyExamsSnapshot = { state: MyExamsState | null; blocked: string | null }

let sharedState: MyExamsState | null = null
let sharedBlocked: string | null = null
let myExamsSnapshot: MyExamsSnapshot = { state: sharedState, blocked: sharedBlocked }
let myExamsInitialized = false
const myExamsListeners = new Set<() => void>()

export function applyMyExams(next: { state: MyExamsState | null; blocked: string | null }): void {
  sharedState = next.state
  sharedBlocked = next.blocked
  myExamsSnapshot = { state: next.state, blocked: next.blocked }
  for (const listener of myExamsListeners) listener()
}

export function subscribeMyExams(listener: () => void): () => void {
  myExamsListeners.add(listener)
  return () => {
    myExamsListeners.delete(listener)
  }
}

export function getMyExamsSnapshot(): MyExamsSnapshot {
  return myExamsSnapshot
}

/** 跨 tab / 跨组件刷新：重新读存储并应用（storage 事件与工作台事件共用） */
export function refreshMyExamsFromStorage(): void {
  applyMyExams(loadMyExamsLocal())
}

/* ------------------------------ 脏标记 ------------------------------ */

/** 脏标记：本地变更过、云端还没确认的 examId 集合（与追剧清单同一条纪律） */
let memoryDirty: Set<string> | null = null

function readDirty(): Set<string> {
  if (memoryDirty) return memoryDirty
  let keys: string[] = []
  try {
    const raw = window.localStorage.getItem(DIRTY_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) keys = parsed.filter((x): x is string => typeof x === 'string')
    }
  } catch {
    keys = []
  }
  memoryDirty = new Set(keys)
  return memoryDirty
}

function writeDirty(keys: Set<string>): void {
  memoryDirty = new Set(keys)
  try {
    window.localStorage.setItem(DIRTY_KEY, JSON.stringify([...memoryDirty]))
  } catch {
    // 配额满 / 隐私模式：内存态仍然生效，刷新后标记丢失——代价是下次多推几条，不会推错
  }
}

function markDirty(examIds: string[]): void {
  if (examIds.length === 0) return
  const next = readDirty()
  for (const examId of examIds) next.add(examId)
  writeDirty(next)
}

function clearDirty(): void {
  writeDirty(new Set<string>())
}

/** 供测试与后续同步波次读取：当前脏 examId（返回副本） */
export function readMyExamsDirtyKeys(): string[] {
  return [...readDirty()]
}

/** 只清已确认推上云端的脏 examId（同步中途又被改过的保留，等下次重推） */
function removeDirty(examIds: string[]): void {
  if (examIds.length === 0) return
  const next = readDirty()
  let changed = false
  for (const examId of examIds) {
    if (next.delete(examId)) changed = true
  }
  if (changed) writeDirty(next)
}

/* ------------------------- 每场最后改动时间 ------------------------- */

/** 每场考试最后改动时间（LWW 的 at 来源；与脏标记同一条纪律） */
let memoryUpdated: Record<string, number> | null = null

function readUpdated(): Record<string, number> {
  if (memoryUpdated) return memoryUpdated
  const map: Record<string, number> = {}
  try {
    const raw = window.localStorage.getItem(UPDATED_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === 'number' && Number.isFinite(v) && v > 0) map[k] = Math.trunc(v)
        }
      }
    }
  } catch {
    // 读不到就按无记录处理：同步时以同步时刻为准，不阻塞关注本身
  }
  memoryUpdated = map
  return memoryUpdated
}

function writeUpdated(map: Record<string, number>): void {
  memoryUpdated = { ...map }
  try {
    window.localStorage.setItem(UPDATED_KEY, JSON.stringify(memoryUpdated))
  } catch {
    // 配额满 / 隐私模式：内存态仍然生效，刷新后时间戳丢失——代价是下次
    // 同步用同步时刻当 at，LWW 仍以服务端 updated_at 为准，不会推错
  }
}

/** 记一笔改动时间并返回它（调用方把它当本次同步 op 的 at） */
function touchUpdated(examId: string, at: number = Date.now()): number {
  const next = readUpdated()
  next[examId] = at
  writeUpdated(next)
  return at
}

/** 供测试读取：当前每场最后改动时间（返回副本） */
export function readMyExamsUpdatedAt(): Record<string, number> {
  return { ...readUpdated() }
}

/* ---------------------------- 共享写操作 ---------------------------- */

function persist(next: MyExamsState): boolean {
  if (sharedBlocked) return false
  applyMyExams({ state: next, blocked: sharedBlocked })
  saveMyExamsLocal(next)
  return true
}

/**
 * 关注 / 取消关注。写前读模块级共享现态（不是调用方闭包里的旧 state），
 * 十二场卡片交错点也不会互相覆盖；读坏时拒写返回 false。
 */
export function toggleMyExamsFollow(examId: string): boolean {
  const current = sharedState
  if (current === null) return false
  const next = toggleFollowPure(current, examId)
  if (next === current) return false
  if (!persist(next)) return false
  touchUpdated(examId)
  markDirty([examId])
  scheduleMyExamsCloudSync()
  return true
}

/** 勾选 / 取消勾选一个节点；只对已关注考试生效，其余 no-op 返回 false。 */
export function toggleMyExamsNodeCheck(examId: string, nodeLabel: string): boolean {
  const current = sharedState
  if (current === null) return false
  const next = toggleNodeCheckPure(current, examId, nodeLabel)
  if (next === current) return false
  if (!persist(next)) return false
  touchUpdated(examId)
  markDirty([examId])
  scheduleMyExamsCloudSync()
  return true
}

/** 同步成功后用合并结果整体替换本地，并清脏标记。 */
export function replaceMyExamsAll(next: MyExamsState): boolean {
  const ok = persist(next)
  if (ok) clearDirty()
  return ok
}

/** 重置本地：先把原值备份到隔离键并校验回读，再清空。 */
export function resetMyExamsLocal(): { backedUp: boolean } {
  let backedUp = false
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw) {
      const backupKey = corruptKeyFor(KEY, Date.now())
      window.localStorage.setItem(backupKey, raw)
      backedUp = window.localStorage.getItem(backupKey) === raw
    } else {
      backedUp = true
    }
  } catch {
    backedUp = false
  }
  applyMyExams({ state: EMPTY_MY_EXAMS, blocked: null })
  saveMyExamsLocal(EMPTY_MY_EXAMS)
  clearDirty()
  return { backedUp }
}

/* --------------------------- 自动同步触发（状态） --------------------------- */

let myExamsSyncInFlight: Promise<MyExamsCloudSyncResult | null> | null = null
let myExamsSyncQueued = false
let myExamsCloudSyncedIdentity: string | null = null
let myExamsSyncTimer: ReturnType<typeof setTimeout> | null = null

export function useMyExams(): MyExamsApi {
  const snap = useSyncExternalStore(subscribeMyExams, getMyExamsSnapshot, getMyExamsSnapshot)
  const { state, blocked: storageBlocked } = snap
  const [ready, setReady] = useState(() => myExamsInitialized)

  useEffect(() => {
    if (!myExamsInitialized) {
      myExamsInitialized = true
      applyMyExams(loadMyExamsLocal())
    }
    setReady(true)
    // 登录后拉一次云端：同一身份同一会话只拉一次（十一张卡片各挂一个 hook
    // 实例，不加守卫会连发十一次）；登录/合并事件会重置守卫再拉一次。
    // 拉取失败不锁守卫（trigger 内失败即清守卫），下次挂载再试。
    const maybeSyncOnMount = () => {
      const identity = getIdentity()
      if (!identity || identity.startsWith('anon-')) return
      if (myExamsCloudSyncedIdentity === identity) return
      void triggerMyExamsCloudSync().then((result) => {
        if (result?.ok) myExamsCloudSyncedIdentity = identity
      })
    }
    maybeSyncOnMount()
    const onIdentity = () => {
      myExamsCloudSyncedIdentity = null
      maybeSyncOnMount()
    }
    const refresh = () => refreshMyExamsFromStorage()
    window.addEventListener('navhub_workbench_updated', refresh)
    window.addEventListener('storage', refresh)
    window.addEventListener('navhub_identity_changed', onIdentity)
    window.addEventListener('navhub_identity_merged', onIdentity)
    return () => {
      window.removeEventListener('navhub_workbench_updated', refresh)
      window.removeEventListener('storage', refresh)
      window.removeEventListener('navhub_identity_changed', onIdentity)
      window.removeEventListener('navhub_identity_merged', onIdentity)
    }
  }, [])

  const isFollowed = useCallback(
    (examId: string) => (state === null ? false : isFollowedPure(state, examId)),
    [state],
  )

  const checkedCount = useCallback(
    (exam: ExamInfo) => (state === null ? 0 : checkedCountPure(state, exam)),
    [state],
  )

  const nextTodo = useCallback(
    (exam: ExamInfo) => (state === null ? undefined : nextTodoNode(state, exam)),
    [state],
  )

  const nearestFollowed = useCallback(
    () => (state === null ? undefined : nearestFollowedExam(state)),
    [state],
  )

  const toggleFollow = useCallback((examId: string) => toggleMyExamsFollow(examId), [])

  const toggleNodeCheck = useCallback(
    (examId: string, nodeLabel: string) => toggleMyExamsNodeCheck(examId, nodeLabel),
    [],
  )

  const replaceAll = useCallback((next: MyExamsState) => replaceMyExamsAll(next), [])

  const resetLocal = useCallback(() => resetMyExamsLocal(), [])

  return {
    state,
    ready,
    storageBlocked,
    isFollowed,
    checkedCount,
    nextTodo,
    nearestFollowed,
    toggleFollow,
    toggleNodeCheck,
    replaceAll,
    resetLocal,
  }
}

/* ------------------------------ 云端同步 ------------------------------ */

const SYNC_CURSOR_PREFIX = 'navhub.my-exams.sync.v1.'
const SYNC_STATUS_KEY = 'navhub.my-exams.sync.last'

export interface MyExamsSyncStatus {
  at: number
  ok: boolean
  pushed: number
  remoteRemoved: number
  error?: string
}

function writeSyncStatus(status: MyExamsSyncStatus): void {
  try {
    window.localStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(status))
  } catch {
    // 写不进状态只是少一行提示，不影响同步本身
  }
}

export function readMyExamsSyncStatus(): MyExamsSyncStatus | null {
  try {
    const raw = window.localStorage.getItem(SYNC_STATUS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<MyExamsSyncStatus>
    return {
      at: Number(parsed.at) || 0,
      ok: Boolean(parsed.ok),
      pushed: Number(parsed.pushed) || 0,
      remoteRemoved: Number(parsed.remoteRemoved) || 0,
      error: typeof parsed.error === 'string' ? parsed.error : undefined,
    }
  } catch {
    return null
  }
}

function dirtyKeyEverWritten(): boolean {
  try {
    return window.localStorage.getItem(DIRTY_KEY) !== null
  } catch {
    return true
  }
}

function readSyncCursor(identity: string): number {
  try {
    const n = Number(window.localStorage.getItem(SYNC_CURSOR_PREFIX + identity))
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

function writeSyncCursor(identity: string, version: number): void {
  if (!(version > 0)) return
  try {
    window.localStorage.setItem(SYNC_CURSOR_PREFIX + identity, String(version))
  } catch {
    // 写不进游标不影响本次结果，只是下次仍走全量（全量是幂等的）
  }
}

async function syncBatchWithRetry(
  ops: MyExamSyncOp[],
  since: number,
  onFail: (error: unknown) => void,
): Promise<HubMyExamsSyncPayload | null> {
  let retryable = false
  const mark = (error: unknown) => {
    onFail(error)
    retryable = describeDegrade(error, '云端考试关注').retryable
  }
  const first = await syncMyExamsBatch(ops, since, mark)
  if (first) return first
  for (const delay of [300, 900]) {
    if (!retryable) return null
    await new Promise((resolve) => setTimeout(resolve, delay))
    const retried = await syncMyExamsBatch(ops, since, mark)
    if (retried) return retried
  }
  return null
}

export interface MyExamsCloudSyncResult {
  ok: boolean
  localCount: number
  pushed: number
  /** 已算好的「本地应变成什么」，同步成功时已落盘并翻进共享快照；失败时为 null */
  nextState: MyExamsState | null
  remoteRemoved: number
  error?: string
  retryable: boolean
}

/**
 * 登录后调用一次：只推脏考试，再拉回云端增量/全集，成员集合最终以云端为准
 * （与 syncWatchlistToCloud 同构）。匿名身份直接返回未登录结果——本机就是事实源。
 *
 * 与追剧不同的一点：本函数成功时直接把合并结果落盘并翻进共享快照（调用方
 * 不要再调 replaceAll——它会清掉全部脏标记，含同步中途刚标脏的改动）。
 * 同步中途本地又改了：那几场以当前本机为准叠加上去、不被本次同步的旧快照
 * 覆盖；脏标记只清「已推且中途没再改过」的场，其余留待下次重推。
 */
export async function syncMyExamsToCloud(): Promise<MyExamsCloudSyncResult> {
  const { state: local, blocked } = loadMyExamsLocal()
  const identity = getIdentity()
  if (blocked) {
    return { ok: false, localCount: 0, pushed: 0, nextState: null, remoteRemoved: 0, error: blocked, retryable: false }
  }
  if (!identity || identity.startsWith('anon-')) {
    return {
      ok: false,
      localCount: local.followed.length,
      pushed: 0,
      nextState: null,
      remoteRemoved: 0,
      error: '未登录：考试关注只保存在本机浏览器',
      retryable: false,
    }
  }

  const failure: { message?: string; retryable: boolean } = { retryable: true }
  const onFail = (error: unknown) => {
    const notice = describeDegrade(error, '云端考试关注')
    failure.message = notice.message
    failure.retryable = notice.retryable
    if ((error as { status?: number } | null)?.status === 401) {
      failure.message = '登录已过期，请重新登录后同步考试关注'
      failure.retryable = true
    }
  }

  const since = readSyncCursor(identity)
  // 一次性迁移（与追剧同理）：脏键从未写过且本地非空 → 本次按全量推一次，
  // 否则 since=0 的云端覆盖会把「云端没有的本地关注」从本地删掉且永远推不上去
  if (local.followed.length > 0 && !dirtyKeyEverWritten()) {
    markDirty(local.followed)
  }
  const dirty = readDirty()
  const updated = readUpdated()
  const ops: MyExamSyncOp[] = []
  const pushedAt = new Map<string, number>()
  for (const examId of local.followed) {
    if (!dirty.has(examId)) continue
    const at = updated[examId] ?? Date.now()
    ops.push({
      op: 'follow',
      examId,
      checked: local.checked[examId] ?? [],
      createdAt: at,
      at,
    })
    pushedAt.set(examId, at)
  }
  for (const examId of dirty) {
    if (local.followed.includes(examId)) continue
    const at = updated[examId] ?? Date.now()
    ops.push({ op: 'unfollow', examId, at })
    pushedAt.set(examId, at)
  }

  const OP_BATCH = 500
  const chunks: MyExamSyncOp[][] = []
  for (let i = 0; i < ops.length; i += OP_BATCH) chunks.push(ops.slice(i, i + OP_BATCH))

  let version = since
  let aggregated: HubExamFollow[] = []
  for (const chunk of chunks) {
    const result = await syncBatchWithRetry(chunk, since, onFail)
    if (!result) {
      writeSyncStatus({ at: Date.now(), ok: false, pushed: 0, remoteRemoved: 0, error: failure.message })
      return { ok: false, localCount: local.followed.length, pushed: 0, nextState: null, remoteRemoved: 0, error: failure.message, retryable: failure.retryable }
    }
    version = Math.max(version, result.version)
    aggregated.push(...result.items)
  }
  if (chunks.length === 0) {
    const pulled = await syncBatchWithRetry([], since, onFail)
    if (!pulled) {
      writeSyncStatus({ at: Date.now(), ok: false, pushed: 0, remoteRemoved: 0, error: failure.message })
      return { ok: false, localCount: local.followed.length, pushed: 0, nextState: null, remoteRemoved: 0, error: failure.message, retryable: failure.retryable }
    }
    aggregated = pulled.items
    version = pulled.version
  }

  const alive = aggregated.filter((item) => item.deletedAt == null)
  const remoteRemoved = aggregated.length - alive.length
  let nextState = since === 0 ? mergeCloudMyExams(local, alive) : applyMyExamsDelta(local, aggregated)
  // 同步中途本地又改了：本次没推过、或推完又改过的脏考试，以当前本机为准叠加，
  // 不许被本次同步的旧快照覆盖（否则交错点的一次勾选会在本地凭空消失）
  const currentLocal = loadMyExamsLocal().state
  const currentDirty = readDirty()
  const currentUpdated = readUpdated()
  const overlayIds = [...currentDirty].filter(
    (examId) => !pushedAt.has(examId) || (currentUpdated[examId] ?? 0) > (pushedAt.get(examId) ?? 0),
  )
  if (overlayIds.length > 0) {
    const followed = [...nextState.followed]
    const checked: Record<string, string[]> = { ...nextState.checked }
    for (const examId of overlayIds) {
      if (currentLocal.followed.includes(examId)) {
        if (!followed.includes(examId)) followed.push(examId)
        if ((currentLocal.checked[examId] ?? []).length > 0) checked[examId] = [...currentLocal.checked[examId]!]
        else delete checked[examId]
      } else {
        const idx = followed.indexOf(examId)
        if (idx >= 0) followed.splice(idx, 1)
        delete checked[examId]
      }
    }
    nextState = parseMyExams({ followed, checked })
  }
  if (!persist(nextState)) {
    writeSyncStatus({ at: Date.now(), ok: false, pushed: 0, remoteRemoved: 0, error: '本地存储不可用，同步结果未落盘' })
    return { ok: false, localCount: local.followed.length, pushed: 0, nextState: null, remoteRemoved: 0, error: '本地存储不可用，同步结果未落盘', retryable: false }
  }
  writeSyncCursor(identity, version)
  // 只清「已推且中途没再改过」的脏标记：中途改过的场仍脏，下次重推
  removeDirty(
    [...pushedAt.entries()]
      .filter(([examId, at]) => (currentUpdated[examId] ?? 0) <= at)
      .map(([examId]) => examId),
  )
  writeSyncStatus({ at: Date.now(), ok: true, pushed: ops.length, remoteRemoved })
  return { ok: true, localCount: local.followed.length, pushed: ops.length, nextState, remoteRemoved, retryable: false }
}

/* --------------------------- 自动同步触发 --------------------------- */

/**
 * 立即同步一次（挂载与登录/合并事件用）：在途时只排队一次，结束后重跑，
 * 不让两次同步互相覆盖。失败返回 null，不抛——同步失败不许阻断页面。
 */
export async function triggerMyExamsCloudSync(): Promise<MyExamsCloudSyncResult | null> {
  if (myExamsSyncInFlight) {
    myExamsSyncQueued = true
    return myExamsSyncInFlight
  }
  const run = (async (): Promise<MyExamsCloudSyncResult | null> => {
    try {
      return await syncMyExamsToCloud()
    } catch {
      return null
    } finally {
      myExamsSyncInFlight = null
      if (myExamsSyncQueued) {
        myExamsSyncQueued = false
        void triggerMyExamsCloudSync()
      }
    }
  })()
  myExamsSyncInFlight = run
  return run
}

/** 关注/勾选后延迟推云端：连续点按合并成一次同步；挂载与登录走立即触发。 */
export function scheduleMyExamsCloudSync(): void {
  if (myExamsSyncTimer) clearTimeout(myExamsSyncTimer)
  myExamsSyncTimer = setTimeout(() => {
    myExamsSyncTimer = null
    void triggerMyExamsCloudSync()
  }, 800)
  // 测试/后台进程不被这支延迟定时器拖住：Node 下 detach，浏览器下是 no-op
  ;(myExamsSyncTimer as unknown as { unref?: () => void }).unref?.()
}
