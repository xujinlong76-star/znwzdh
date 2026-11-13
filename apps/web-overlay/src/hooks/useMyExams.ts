'use client'

/**
 * 「我的考试」共享 hook：/exam 四场卡片与首页条带共用同一份模块级快照。
 *
 * 旧实现每场卡片各持一份 useState 快照、写回时用闭包旧快照整份覆盖——
 * A 卡片关注后，B 卡片再点一次勾选就会把 A 的关注写丢（丢更新竞态）。
 * 本 hook 照抄 useWatchlist 的纪律：模块级共享快照 + useSyncExternalStore，
 * 写操作一律读模块级共享现态再派生，不读渲染闭包里的旧 state。
 *
 * 本地读写的损坏纪律与追剧清单完全一致：读不出来（JSON 损坏、存储被禁）
 * 时拒绝覆盖并把原因交回界面（storageBlocked），绝不把坏数据伪装成空
 * 清单后照写；重置前先备份原值。只保存在本机，不上传、不跨设备同步。
 *
 * 脏标记（navhub.my-exams.dirty.v1）：每次本地写操作把 examId 标脏，
 * 为后续多设备同步预留——同步波次落地时按「只推脏考试 + since 增量 +
 * 墓碑」消费它；首次同步须先把全部已关注 examId 标脏全量推一次，否则
 * 全量合并会把本地关注删光（追剧清单同款一次性迁移陷阱）。
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { type ExamInfo, type ExamNode } from '@/lib/exam-calendar'
import { corruptKeyFor } from '@/lib/favorites-storage'
import {
  EMPTY_MY_EXAMS,
  MY_EXAMS_STORAGE_KEY,
  checkedCount as checkedCountPure,
  isFollowed as isFollowedPure,
  nearestFollowedExam,
  nextTodoNode,
  parseMyExams,
  toggleFollow as toggleFollowPure,
  toggleNodeCheck as toggleNodeCheckPure,
  type MyExamsState,
} from '@/lib/my-exams'

const KEY = MY_EXAMS_STORAGE_KEY
const DIRTY_KEY = 'navhub.my-exams.dirty.v1'

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

/* ---------------------------- 共享写操作 ---------------------------- */

function persist(next: MyExamsState): boolean {
  if (sharedBlocked) return false
  applyMyExams({ state: next, blocked: sharedBlocked })
  saveMyExamsLocal(next)
  return true
}

/**
 * 关注 / 取消关注。写前读模块级共享现态（不是调用方闭包里的旧 state），
 * 四场卡片交错点也不会互相覆盖；读坏时拒写返回 false。
 */
export function toggleMyExamsFollow(examId: string): boolean {
  const current = sharedState
  if (current === null) return false
  const next = toggleFollowPure(current, examId)
  if (next === current) return false
  if (!persist(next)) return false
  markDirty([examId])
  return true
}

/** 勾选 / 取消勾选一个节点；只对已关注考试生效，其余 no-op 返回 false。 */
export function toggleMyExamsNodeCheck(examId: string, nodeLabel: string): boolean {
  const current = sharedState
  if (current === null) return false
  const next = toggleNodeCheckPure(current, examId, nodeLabel)
  if (next === current) return false
  if (!persist(next)) return false
  markDirty([examId])
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
    const refresh = () => refreshMyExamsFromStorage()
    window.addEventListener('navhub_workbench_updated', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('navhub_workbench_updated', refresh)
      window.removeEventListener('storage', refresh)
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
