'use client'

/**
 * 「我的常用」React 接入层（2026-11-20 20:00 战略研究 W9 落地）。
 *
 * - 数据只在浏览器本地（localStorage `znw:personal:v1`），零网络请求；
 * - `useSyncExternalStore` + 同页自定义事件 + 跨标签 `storage` 事件，
 *   卡片、命令面板、专区、数据页四处同读一份快照；
 * - 坏数据（corrupt）时隔离到 `<键>.corrupt.<时间戳>`、不覆盖原数据，
 *   并把 `corrupt` 与 `storageBlocked` 暴露给界面提示用户；
 * - 导入前先把当前数据备份进内存，`undoImport()` 可一键撤销。
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import {
  PERSONAL_STORAGE_KEY,
  addCustomLink,
  addPin,
  buildPresetScenes,
  bumpCounter,
  clearAllPersonalData,
  defaultPersonalData,
  exportPersonalData,
  isRecentRecordingPaused,
  loadPersonalData,
  mergePersonalImport,
  movePin,
  parsePersonalImport,
  personalCorruptBackupKey,
  removeCustomLink,
  removePin,
  savePersonalData,
  setRecentRecordingPaused,
  storageUsageBytes,
  type CatalogCategory,
  type PersonalCounters,
  type PersonalData,
  type PersonalScene,
  type PinnedSite,
} from '@/lib/personal-data'

const CHANGE_EVENT = 'znw:personal-changed'
/** 预置场景只播种一次的标记（用户删光场景后不再自动补回）。 */
const PRESET_SEEDED_KEY = 'znw:personal:seeded:v1'

function browserStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

let cachedData: PersonalData | null = null
let cachedCorrupt = false
let cachedBlocked: string | null = null
/**
 * 服务端快照：必须缓存为同一引用。`defaultPersonalData()` 每次调用都返回
 * 一个全新对象，直接把它当 `getServerSnapshot` 传，React 每次渲染都会拿到
 * 不同引用，报 `getServerSnapshot should be cached` 警告（跟进轮实测 7 次），
 * 且可能引发反复重渲染。与 useHibernationSettings 的 SERVER_SNAPSHOT 同款做法。
 * 共享安全：全部写路径（persist/update）都生成新对象再整体替换快照，
 * 从不原地修改；bumpCounter 与各 lib 函数同样返回新对象，因此这份默认
 * 对象不会被任何一处写脏。
 */
const SERVER_SNAPSHOT: PersonalData = defaultPersonalData()

function getServerSnapshot(): PersonalData {
  return SERVER_SNAPSHOT
}
/** 客户端是否已挂载：挂载前快照一律返回默认空数据，与服务端渲染一致，
 *  避免水合错配（localStorage 只在挂载后读）。与 useFavorites 同款模型。 */
let clientReady = false
const listeners = new Set<() => void>()

function emitChange(): void {
  for (const listener of listeners) listener()
  try {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
  } catch {
    // 非浏览器环境无事件可发
  }
}

function readSnapshot(): PersonalData {
  if (cachedData) return cachedData
  if (!clientReady) {
    // 未挂载：不碰 localStorage，返回缓存的默认空数据（与服务端一致）。
    // 用 SERVER_SNAPSHOT 而不是新调 defaultPersonalData()：首个客户端快照
    // 必须与服务端快照同一引用，否则水合时 React 会丢弃服务端渲染重做。
    cachedData = SERVER_SNAPSHOT
    return cachedData
  }
  const store = browserStorage()
  if (!store) {
    cachedData = SERVER_SNAPSHOT
    return cachedData
  }
  const { data, corrupt } = loadPersonalData(store)
  cachedCorrupt = corrupt
  if (corrupt) {
    // 隔离坏数据：原值挪到带时间戳的键，当前键写回默认空数据；
    // 用户的原数据仍在浏览器里，可从数据页导出隔离副本。
    try {
      const raw = store.getItem(PERSONAL_STORAGE_KEY)
      if (raw) store.setItem(personalCorruptBackupKey(Date.now()), raw)
    } catch {
      // 隔离写失败也不阻断读取
    }
    cachedBlocked = '本地「我的常用」数据读不出来，已先隔离保护，原数据仍在浏览器里，可在数据页查看。'
  }
  cachedData = data
  return cachedData
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === PERSONAL_STORAGE_KEY) {
      cachedData = null
      listener()
    }
  }
  const onCustom = () => {
    cachedData = null
    listener()
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener(CHANGE_EVENT, onCustom)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(CHANGE_EVENT, onCustom)
  }
}

export interface UsePersonalData {
  data: PersonalData
  ready: boolean
  /** 本地数据损坏被隔离过（界面应提示用户，而非当成「没有数据」）。 */
  corrupt: boolean
  /** 保存被拒绝的原因（配额超限等），无则 null。 */
  storageBlocked: string | null
  isPinned: (siteId: string) => boolean
  togglePin: (site: PinnedSite) => { ok: boolean; error?: string }
  movePinned: (siteId: string, toIndex: number) => void
  addLink: (name: string, url: string) => { ok: boolean; error?: string }
  removeLink: (id: string) => void
  setActiveScene: (sceneId: string | null) => void
  addScene: (name: string, color: string) => { ok: boolean; error?: string; scene?: PersonalScene }
  removeScene: (sceneId: string) => void
  ensurePresetScenes: (catalog: readonly CatalogCategory[]) => void
  recordClick: () => void
  setRecordRecent: (on: boolean) => void
  recordRecent: boolean
  exportJson: () => string
  /** 关闭备份提醒：7 天内不再出现（见 lib/personal-data.ts 的阈值口径）。 */
  dismissBackupReminder: () => void
  importJson: (raw: string, mode: 'replace' | 'merge') => { ok: boolean; error?: string }
  undoImport: () => boolean
  clearAll: () => void
  usageBytes: () => number
}

export function usePersonalData(): UsePersonalData {
  const data = useSyncExternalStore(subscribe, readSnapshot, getServerSnapshot)
  const readyRef = useRef(false)
  const backupRef = useRef<PersonalData | null>(null)

  useEffect(() => {
    readyRef.current = true
    if (!clientReady) {
      // 挂载后才读本地存储，并通知全部订阅者用真实数据重渲染。
      clientReady = true
      cachedData = null
      emitChange()
    }
  }, [])

  const persist = useCallback((next: PersonalData): boolean => {
    const store = browserStorage()
    if (!store) return false
    const res = savePersonalData(store, next)
    if (!res.ok) {
      cachedBlocked = res.message
    } else {
      cachedBlocked = null
    }
    cachedData = next
    emitChange()
    return res.ok
  }, [])

  const update = useCallback(
    (fn: (current: PersonalData) => PersonalData, counter?: keyof PersonalCounters): boolean => {
      const current = readSnapshot()
      const next = counter ? bumpCounter(fn(current), counter) : fn(current)
      return persist(next)
    },
    [persist],
  )

  const togglePin = useCallback(
    (site: PinnedSite): { ok: boolean; error?: string } => {
      const current = readSnapshot()
      if (current.pinned.some((p) => p.siteId === site.siteId)) {
        update((d) => removePin(d, site.siteId))
        return { ok: true }
      }
      const res = addPin(current, site)
      if ('error' in res) return { ok: false, error: res.error }
      persist(bumpCounter(res.data, 'pin'))
      return { ok: true }
    },
    [persist, update],
  )

  const movePinned = useCallback(
    (siteId: string, toIndex: number) => {
      update((d) => movePin(d, siteId, toIndex))
    },
    [update],
  )

  const addLink = useCallback(
    (name: string, url: string): { ok: boolean; error?: string } => {
      const current = readSnapshot()
      const res = addCustomLink(current, name, url)
      if ('error' in res) return { ok: false, error: res.error }
      persist(res.data)
      return { ok: true }
    },
    [persist],
  )

  const removeLink = useCallback(
    (id: string) => {
      update((d) => removeCustomLink(d, id))
    },
    [update],
  )

  const setActiveScene = useCallback(
    (sceneId: string | null) => {
      update((d) => ({ ...d, activeSceneId: sceneId }))
    },
    [update],
  )

  const addScene = useCallback(
    (name: string, color: string): { ok: boolean; error?: string; scene?: PersonalScene } => {
      const cleanName = name.trim()
      if (cleanName.length === 0) return { ok: false, error: '请给场景起个名字' }
      if (cleanName.length > 24) return { ok: false, error: '场景名最多 24 个字' }
      const current = readSnapshot()
      if (current.scenes.length >= 12) return { ok: false, error: '场景最多 12 个' }
      const scene: PersonalScene = {
        id: `scene-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        name: cleanName,
        color,
        siteIds: [],
        roles: {},
        goal: '',
        builtin: false,
      }
      persist({ ...current, scenes: [...current.scenes, scene] })
      return { ok: true, scene }
    },
    [persist],
  )

  const removeScene = useCallback(
    (sceneId: string) => {
      update((d) => ({
        ...d,
        scenes: d.scenes.filter((s) => s.id !== sceneId),
        activeSceneId: d.activeSceneId === sceneId ? null : d.activeSceneId,
      }))
    },
    [update],
  )

  const ensurePresetScenes = useCallback(
    (catalog: readonly CatalogCategory[]) => {
      const store = browserStorage()
      if (!store) return
      try {
        if (store.getItem(PRESET_SEEDED_KEY) === '1') return
      } catch {
        return
      }
      const current = readSnapshot()
      if (current.scenes.length > 0) {
        try {
          store.setItem(PRESET_SEEDED_KEY, '1')
        } catch {
          // 标记写失败不阻断
        }
        return
      }
      const presets = buildPresetScenes(catalog)
      persist({ ...current, scenes: presets })
      try {
        store.setItem(PRESET_SEEDED_KEY, '1')
      } catch {
        // 标记写失败不阻断
      }
    },
    [persist],
  )

  const recordClick = useCallback(() => {
    update((d) => d, 'personalClick')
  }, [update])

  const setRecordRecent = useCallback(
    (on: boolean) => {
      const store = browserStorage()
      if (store) setRecentRecordingPaused(store, !on)
      update((d) => ({ ...d, prefs: { ...d.prefs, recordRecent: on } }))
    },
    [update],
  )

  const exportJson = useCallback((): string => {
    const json = exportPersonalData(readSnapshot())
    // 导出即记一次备份时间（与 exportCount 同批落盘）：备份提醒的时钟
    // 从这次导出开始算；导出文件本身不含该时间戳（设备本地状态）。
    update((d) => ({ ...d, lastExportAt: Date.now() }), 'exportCount')
    return json
  }, [update])

  const dismissBackupReminder = useCallback(() => {
    update((d) => ({ ...d, backupReminderDismissedAt: Date.now() }))
  }, [update])

  const importJson = useCallback(
    (raw: string, mode: 'replace' | 'merge'): { ok: boolean; error?: string } => {
      const parsed = parsePersonalImport(raw)
      if (!parsed.ok) return { ok: false, error: parsed.error }
      backupRef.current = readSnapshot()
      const merged = mergePersonalImport(readSnapshot(), parsed.data, mode)
      persist(bumpCounter(merged, 'importCount'))
      return { ok: true }
    },
    [persist],
  )

  const undoImport = useCallback((): boolean => {
    if (!backupRef.current) return false
    const backup = backupRef.current
    backupRef.current = null
    return persist(backup)
  }, [persist])

  const clearAll = useCallback(() => {
    const store = browserStorage()
    if (store) clearAllPersonalData(store)
    cachedData = defaultPersonalData()
    cachedCorrupt = false
    cachedBlocked = null
    backupRef.current = null
    emitChange()
  }, [])

  const usageBytes = useCallback((): number => {
    if (!clientReady) return 0
    const store = browserStorage()
    return store ? storageUsageBytes(store) : 0
  }, [])

  return {
    data,
    ready: readyRef.current,
    corrupt: cachedCorrupt,
    storageBlocked: cachedBlocked,
    isPinned: (siteId: string) => data.pinned.some((p) => p.siteId === siteId),
    togglePin,
    movePinned,
    addLink,
    removeLink,
    setActiveScene,
    addScene,
    removeScene,
    ensurePresetScenes,
    recordClick,
    setRecordRecent,
    recordRecent: data.prefs.recordRecent,
    exportJson,
    dismissBackupReminder,
    importJson,
    undoImport,
    clearAll,
    usageBytes,
  }
}

/** 下载一串文本为文件（导出用；纯客户端，不发请求）。 */
export function downloadTextFile(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export { isRecentRecordingPaused }
