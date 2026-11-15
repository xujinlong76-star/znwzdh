'use client'

/**
 * 冬眠偏好的订阅入口（lib/favorites-hibernation 的存储读写 + React 订阅层）。
 *
 * 体例仿 hooks/useTriageSettings：服务端渲染只能看到默认值（localStorage 在
 * server 上不存在），挂载后经订阅更新；变更源有两条——本页其它组件写盘后的
 * `navhub_hibernation_settings_changed`、其它标签页写同一键时浏览器才派发的 `storage`。
 * 本模块顶部 import 了 `useSyncExternalStore`，因此服务端模块一律不许 import 它。
 */

import { useSyncExternalStore } from 'react'

import {
  DEFAULT_HIBERNATION_SETTINGS,
  HIBERNATION_SETTINGS_KEY,
  readHibernationSettings,
  type HibernationSettings,
} from '@/lib/favorites-hibernation'

export { writeHibernationSettings } from '@/lib/favorites-hibernation'
export type { HibernationSettings } from '@/lib/favorites-hibernation'

const SERVER_SNAPSHOT: HibernationSettings = { ...DEFAULT_HIBERNATION_SETTINGS }

let snapshot: HibernationSettings = SERVER_SNAPSHOT
const listeners = new Set<() => void>()
let sourceBound = false

function emit(): void {
  for (const listener of [...listeners]) listener()
}

function setSnapshot(next: HibernationSettings): void {
  if (next === snapshot) return
  snapshot = next
  emit()
}

function bindOnce(): void {
  if (sourceBound || typeof window === 'undefined') return
  sourceBound = true
  snapshot = readHibernationSettings()
  // 两条变更源一律「回读存储」而不是相信事件负载：写盘可能只成功了一半
  // （配额满、隐私模式），以存储为准才不会把半截状态固化进快照。
  window.addEventListener('navhub_hibernation_settings_changed', () => setSnapshot(readHibernationSettings()))
  window.addEventListener('storage', (event) => {
    if (event.key && event.key !== HIBERNATION_SETTINGS_KEY) return
    setSnapshot(readHibernationSettings())
  })
}

function subscribe(listener: () => void): () => void {
  bindOnce()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useHibernationSettings(): HibernationSettings {
  return useSyncExternalStore(subscribe, () => snapshot, () => SERVER_SNAPSHOT)
}

/** 只订阅单个冬眠偏好项：值没变就不重渲染。 */
export function useHibernationSetting<K extends keyof HibernationSettings>(key: K): HibernationSettings[K] {
  return useSyncExternalStore(
    subscribe,
    () => snapshot[key],
    () => DEFAULT_HIBERNATION_SETTINGS[key],
  )
}
