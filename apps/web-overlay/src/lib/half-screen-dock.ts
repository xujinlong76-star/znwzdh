/**
 * 半屏下沉栏开关（Batch 3 第 12 项，本机设置）。
 *
 * 纪律与长辈模式（lib/elder-mode.ts）同款：只存本机 localStorage，
 * 不进 UserSettingsModel、不碰 me.ts zod、不走 Save-then-Verify——
 * 开关是这台设备的显示偏好，不是账号同步偏好。
 *
 * 默认开：读不到 / 损坏 / 不是对象时一律按开处理，用户只能主动关。
 * 关闭后首页刷新仍关闭，在设置页（密度设置同区）重新打开。
 */

/** 存储键：全仓此前零命中，可自由采用 */
export const HALF_SCREEN_DOCK_STORAGE_KEY = 'navhub.halfScreenDock.v1'

export const HALF_SCREEN_DOCK_CHANGED_EVENT = 'navhub:half-screen-dock-changed'

interface HalfScreenDockRecord {
  on: boolean
}

function parseRecord(raw: string | null): HalfScreenDockRecord {
  // 默认开：读不到 / 损坏一律按开处理
  if (!raw) return { on: true }
  try {
    const parsed = JSON.parse(raw) as Partial<HalfScreenDockRecord> | boolean
    if (typeof parsed === 'boolean') return { on: parsed }
    return { on: parsed.on !== false }
  } catch {
    return { on: true }
  }
}

export function loadHalfScreenDockOn(storage: Storage | null): boolean {
  if (!storage) return true
  try {
    return parseRecord(storage.getItem(HALF_SCREEN_DOCK_STORAGE_KEY)).on
  } catch {
    return true
  }
}

export function setHalfScreenDockOn(on: boolean, storage: Storage | null = null): boolean {
  const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : null)
  if (!store) return on
  try {
    store.setItem(HALF_SCREEN_DOCK_STORAGE_KEY, JSON.stringify({ on }))
  } catch {
    /* 写不进本机存储时本次会话内仍生效 */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(HALF_SCREEN_DOCK_CHANGED_EVENT, { detail: { on } }))
  }
  return on
}
