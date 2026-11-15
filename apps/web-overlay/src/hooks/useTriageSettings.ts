'use client'

/**
 * 待读分流偏好的订阅入口（lib/favorites-triage 的存储读写 + React 订阅层）。
 *
 * 体例仿 lib/user-preferences：服务端渲染只能看到默认值（localStorage 在
 * server 上不存在），挂载后经订阅更新；变更源有两条——本页其它组件写盘后的
 * `navhub_triage_settings_changed`、其它标签页写同一键时浏览器才派发的 `storage`。
 * 本模块顶部 import 了 `useSyncExternalStore`，因此服务端模块一律不许 import 它。
 */

import { useSyncExternalStore } from 'react'

import {
  DEFAULT_TRIAGE_SETTINGS,
  TRIAGE_SETTINGS_KEY,
  readTriageSettings,
  type TriageSettings,
} from '@/lib/favorites-triage'

export { writeTriageSettings } from '@/lib/favorites-triage'
export type { TriageSettings } from '@/lib/favorites-triage'

const SERVER_SNAPSHOT: TriageSettings = { ...DEFAULT_TRIAGE_SETTINGS }

let snapshot: TriageSettings = SERVER_SNAPSHOT
const listeners = new Set<() => void>()
let sourceBound = false

function emit(): void {
  for (const listener of [...listeners]) listener()
}

function setSnapshot(next: TriageSettings): void {
  if (next === snapshot) return
  snapshot = next
  emit()
}

function bindOnce(): void {
  if (sourceBound || typeof window === 'undefined') return
  sourceBound = true
  snapshot = readTriageSettings()
  // 两条变更源一律「回读存储」而不是相信事件负载：写盘可能只成功了一半
  // （配额满、隐私模式），以存储为准才不会把半截状态固化进快照。
  window.addEventListener('navhub_triage_settings_changed', () => setSnapshot(readTriageSettings()))
  window.addEventListener('storage', (event) => {
    if (event.key && event.key !== TRIAGE_SETTINGS_KEY) return
    setSnapshot(readTriageSettings())
  })
}

function subscribe(listener: () => void): () => void {
  bindOnce()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useTriageSettings(): TriageSettings {
  return useSyncExternalStore(subscribe, () => snapshot, () => SERVER_SNAPSHOT)
}

/** 只订阅单个分流偏好项：值没变就不重渲染。 */
export function useTriageSetting<K extends keyof TriageSettings>(key: K): TriageSettings[K] {
  return useSyncExternalStore(
    subscribe,
    () => snapshot[key],
    () => DEFAULT_TRIAGE_SETTINGS[key],
  )
}
