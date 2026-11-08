'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'

export interface ModuleWindowSize {
  /** 12 栅格列宽跨度：4 (1/3 宽) ~ 12 (全宽)，默认 12 */
  colSpan?: number
  /** 模块窗口内容区高度上限（像素）：200 ~ 1200，undefined 表示自适应全展开 */
  heightPx?: number
}

export type ModuleWindowSizeMap = Record<string, ModuleWindowSize>

export const MODULE_SIZES_STORAGE_KEY = 'navhub_module_window_sizes_v1'

const EMPTY_SIZES: ModuleWindowSizeMap = {}

let sharedSizes: ModuleWindowSizeMap = EMPTY_SIZES
let hydrated = false
const listeners = new Set<() => void>()
let diskPersistTimer: ReturnType<typeof setTimeout> | null = null

function emitChange() {
  for (const listener of listeners) {
    listener()
  }
}

export function subscribeModuleSizes(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getModuleSizesSnapshot(): ModuleWindowSizeMap {
  return sharedSizes
}

export function getServerModuleSizesSnapshot(): ModuleWindowSizeMap {
  return EMPTY_SIZES
}

export interface ModuleWindowSizeSnapshot {
  colSpan: number
  heightPx?: number
  isCustomSized: boolean
}

const moduleSnapshotCache = new Map<string, ModuleWindowSizeSnapshot>()
const serverSnapshotCache = new Map<string, ModuleWindowSizeSnapshot>()

function getServerModuleSnapshot(
  defaultCol: number,
  defaultHeight?: number
): ModuleWindowSizeSnapshot {
  const key = `${defaultCol}:${defaultHeight ?? ''}`
  let cached = serverSnapshotCache.get(key)
  if (!cached) {
    cached = { colSpan: defaultCol, heightPx: defaultHeight, isCustomSized: false }
    serverSnapshotCache.set(key, cached)
  }
  return cached
}

export function getModuleSizeSnapshot(
  moduleId: string,
  defaultCol: number,
  defaultHeight?: number
): ModuleWindowSizeSnapshot {
  const entry = sharedSizes[moduleId]
  const colSpan = entry?.colSpan ?? defaultCol
  const heightPx = entry?.heightPx ?? defaultHeight
  const isCustomSized = Boolean(
    (entry?.colSpan !== undefined && entry.colSpan !== defaultCol) ||
      (entry?.heightPx !== undefined && entry.heightPx !== defaultHeight)
  )

  const cached = moduleSnapshotCache.get(moduleId)
  if (
    cached &&
    cached.colSpan === colSpan &&
    cached.heightPx === heightPx &&
    cached.isCustomSized === isCustomSized
  ) {
    return cached
  }

  const nextSnap: ModuleWindowSizeSnapshot = { colSpan, heightPx, isCustomSized }
  moduleSnapshotCache.set(moduleId, nextSnap)
  return nextSnap
}

function clampColSpan(col?: number): number | undefined {
  if (typeof col !== 'number' || !Number.isFinite(col)) return undefined
  return Math.max(3, Math.min(12, Math.round(col)))
}

function clampHeightPx(h?: number): number | undefined {
  if (typeof h !== 'number' || !Number.isFinite(h) || h <= 0) return undefined
  return Math.max(160, Math.min(1400, Math.round(h)))
}

function sanitizeSizeMap(raw: unknown): ModuleWindowSizeMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY_SIZES
  const next: ModuleWindowSizeMap = {}
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || !val || typeof val !== 'object') continue
    const v = val as { colSpan?: unknown; heightPx?: unknown }
    const colSpan = clampColSpan(typeof v.colSpan === 'number' ? v.colSpan : undefined)
    const heightPx = clampHeightPx(typeof v.heightPx === 'number' ? v.heightPx : undefined)
    if (colSpan !== undefined || heightPx !== undefined) {
      next[key] = {
        ...(colSpan !== undefined ? { colSpan } : {}),
        ...(heightPx !== undefined ? { heightPx } : {}),
      }
    }
  }
  return Object.keys(next).length > 0 ? next : EMPTY_SIZES
}

function scheduleDiskPersist(sizes: ModuleWindowSizeMap) {
  if (typeof window === 'undefined' || !window.localStorage) return
  if (diskPersistTimer) {
    clearTimeout(diskPersistTimer)
    diskPersistTimer = null
  }
  diskPersistTimer = setTimeout(() => {
    diskPersistTimer = null
    try {
      if (Object.keys(sizes).length === 0) {
        window.localStorage.removeItem(MODULE_SIZES_STORAGE_KEY)
      } else {
        window.localStorage.setItem(MODULE_SIZES_STORAGE_KEY, JSON.stringify(sizes))
      }
    } catch {
      // 隐私模式或存储配额满时仅保留内存态生效
    }
  }, 80)
}

function persistSizes(next: ModuleWindowSizeMap, writeToDisk = true) {
  sharedSizes = next
  if (writeToDisk) {
    scheduleDiskPersist(next)
  }
  emitChange()
}

export function hydrateModuleSizes(): void {
  if (hydrated || typeof window === 'undefined') return
  hydrated = true
  try {
    const raw = window.localStorage?.getItem(MODULE_SIZES_STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    const cleaned = sanitizeSizeMap(parsed)
    if (Object.keys(cleaned).length > 0) {
      sharedSizes = cleaned
      emitChange()
    }
  } catch {
    // 解析失败时保持默认尺寸
  }
}

export function setModuleWindowSize(
  moduleId: string,
  patch: Partial<ModuleWindowSize>,
  defaults: { colSpan?: number; heightPx?: number } = { colSpan: 12 },
  persistToDisk = true
): void {
  if (!moduleId) return
  const current = sharedSizes[moduleId] || {}
  const mergedCol =
    'colSpan' in patch ? clampColSpan(patch.colSpan) : current.colSpan
  const mergedHeight =
    'heightPx' in patch ? clampHeightPx(patch.heightPx) : current.heightPx

  const effectiveCol = mergedCol === (defaults.colSpan ?? 12) ? undefined : mergedCol
  const effectiveHeight = mergedHeight === defaults.heightPx ? undefined : mergedHeight

  if (effectiveCol === undefined && effectiveHeight === undefined) {
    if (!(moduleId in sharedSizes)) return
    const next = { ...sharedSizes }
    delete next[moduleId]
    persistSizes(Object.keys(next).length > 0 ? next : EMPTY_SIZES, persistToDisk)
    return
  }

  const nextEntry: ModuleWindowSize = {
    ...(effectiveCol !== undefined ? { colSpan: effectiveCol } : {}),
    ...(effectiveHeight !== undefined ? { heightPx: effectiveHeight } : {}),
  }

  if (
    current.colSpan === nextEntry.colSpan &&
    current.heightPx === nextEntry.heightPx
  ) {
    return
  }

  persistSizes(
    {
      ...sharedSizes,
      [moduleId]: nextEntry,
    },
    persistToDisk
  )
}

export function resetModuleWindowSize(moduleId: string): void {
  if (!moduleId || !(moduleId in sharedSizes)) return
  const next = { ...sharedSizes }
  delete next[moduleId]
  moduleSnapshotCache.delete(moduleId)
  persistSizes(Object.keys(next).length > 0 ? next : EMPTY_SIZES, true)
}

export function resetAllModuleWindowSizes(): void {
  if (Object.keys(sharedSizes).length === 0) return
  moduleSnapshotCache.clear()
  persistSizes(EMPTY_SIZES, true)
}

export function useModuleWindowSize(
  moduleId: string,
  defaults: { colSpan?: number; heightPx?: number } = { colSpan: 12 }
) {
  const defaultCol = defaults.colSpan ?? 12
  const defaultHeight = defaults.heightPx

  const getSnapshot = useCallback(
    () => getModuleSizeSnapshot(moduleId, defaultCol, defaultHeight),
    [moduleId, defaultCol, defaultHeight]
  )

  const getServerSnapshot = useCallback(
    () => getServerModuleSnapshot(defaultCol, defaultHeight),
    [defaultCol, defaultHeight]
  )

  const { colSpan, heightPx, isCustomSized } = useSyncExternalStore(
    subscribeModuleSizes,
    getSnapshot,
    getServerSnapshot
  )

  useEffect(() => {
    hydrateModuleSizes()
  }, [])

  const setSize = useCallback(
    (patch: Partial<ModuleWindowSize>, persistToDisk = true) => {
      setModuleWindowSize(
        moduleId,
        patch,
        {
          colSpan: defaultCol,
          heightPx: defaults.heightPx,
        },
        persistToDisk
      )
    },
    [moduleId, defaultCol, defaults.heightPx]
  )

  const resetSize = useCallback(() => {
    resetModuleWindowSize(moduleId)
  }, [moduleId])

  return {
    colSpan,
    heightPx,
    isCustomSized,
    setSize,
    resetSize,
  }
}

export function useAllModuleWindowSizes() {
  const sizes = useSyncExternalStore(
    subscribeModuleSizes,
    getModuleSizesSnapshot,
    getServerModuleSizesSnapshot
  )

  useEffect(() => {
    hydrateModuleSizes()
  }, [])

  return {
    sizes,
    customSizedCount: Object.keys(sizes).length,
    setModuleWindowSize,
    resetModuleWindowSize,
    resetAllModuleWindowSizes,
  }
}
