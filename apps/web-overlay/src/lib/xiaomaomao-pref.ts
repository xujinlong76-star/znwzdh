/**
 * 桌面小猫猫全局显隐开关（本机设置）。
 *
 * 与半屏下沉栏（lib/half-screen-dock.ts）、字号（lib/font-size.ts）同款纪律：
 * 只存本机 localStorage，不进服务端 UserSettingsModel，避免云端回读覆盖。
 *
 * 默认开：读不到 / 损坏时按开处理；
 * 用户在用户中心关闭后，全站彻底隐藏小猫猫本体与右侧正中 `<` 唤出箭头。
 */

import { getBrowserStorage } from './browser-storage'

export const XIAOMAOMAO_ENABLED_STORAGE_KEY = 'navhub.xiaomaomao.enabled.v1'
export const XIAOMAOMAO_ENABLED_CHANGED_EVENT = 'navhub:xiaomaomao-enabled-changed'

interface XiaomaomaoEnabledRecord {
  on: boolean
}

function parseRecord(raw: string | null): XiaomaomaoEnabledRecord {
  if (!raw) return { on: true }
  if (raw === '0' || raw === 'false') return { on: false }
  if (raw === '1' || raw === 'true') return { on: true }
  try {
    const parsed = JSON.parse(raw) as Partial<XiaomaomaoEnabledRecord> | boolean
    if (typeof parsed === 'boolean') return { on: parsed }
    return { on: parsed?.on !== false }
  } catch {
    return { on: true }
  }
}

export function loadXiaomaomaoEnabled(storage?: Storage | null): boolean {
  const store = storage === undefined ? getBrowserStorage() : storage
  if (!store) return true
  try {
    return parseRecord(store.getItem(XIAOMAOMAO_ENABLED_STORAGE_KEY)).on
  } catch {
    return true
  }
}

export function setXiaomaomaoEnabled(on: boolean, storage?: Storage | null): boolean {
  const store = storage ?? getBrowserStorage()
  if (store) {
    try {
      store.setItem(XIAOMAOMAO_ENABLED_STORAGE_KEY, JSON.stringify({ on }))
    } catch {
      /* 写不进本机存储时本次会话内仍生效 */
    }
  }
  if (typeof window !== 'undefined') {
    try {
      const api = (window as unknown as { XIAOMAOMAO?: { setEnabled?: (enabled: boolean) => boolean } }).XIAOMAOMAO
      api?.setEnabled?.(on)
    } catch {
      /* 挂件脚本尚未挂载时由其初始化阶段读取 localStorage */
    }
    window.dispatchEvent(new CustomEvent(XIAOMAOMAO_ENABLED_CHANGED_EVENT, { detail: { on } }))
  }
  return on
}
