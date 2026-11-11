import { FEATURE_KEYS, type FeatureKey } from './site-settings'

/**
 * 个人级「首页模块隐藏」的本机落点。
 *
 * 数据流（账号级同步，服务端为事实源）：
 * - 服务端真值在中枢 `/api/me/settings` 的 `hiddenHomeModules` 字段；
 * - 登录后 `UserPrefsSync` 把服务端值写进本机这个 key，首页据此叠加隐藏；
 * - 用户在 /me/settings 改动时先写本机（即时生效）再 PATCH 服务端（跨设备）。
 *
 * 与全站 features 的关系：全站关了（features[key]=false）前端根本不渲染；
 * 个人隐藏只在全站开启的前提下再减一层——个人设置优先级高于全站默认。
 * 与既有 nav_pruned_ids（DIY 移除模块）是两套机制：那边管 hero/展板等
 * 结构模块，这边管可编排板块与挂件，键名不重叠，互不干扰。
 */
export const PERSONAL_HIDDEN_MODULES_KEY = 'navhub_hidden_home_modules'

export function parseHiddenHomeModules(raw: unknown): FeatureKey[] {
  if (!Array.isArray(raw)) return []
  const out: FeatureKey[] = []
  for (const item of raw) {
    if ((FEATURE_KEYS as readonly string[]).includes(item as string) && !out.includes(item as FeatureKey)) {
      out.push(item as FeatureKey)
    }
  }
  return out
}

export function readLocalHiddenHomeModules(): FeatureKey[] {
  if (typeof window === 'undefined') return []
  try {
    return parseHiddenHomeModules(JSON.parse(window.localStorage.getItem(PERSONAL_HIDDEN_MODULES_KEY) ?? 'null'))
  } catch {
    return []
  }
}

export function writeLocalHiddenHomeModules(modules: FeatureKey[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PERSONAL_HIDDEN_MODULES_KEY, JSON.stringify(modules))
  } catch {
    // 隐私模式等写不进本机时静默：服务端真值还在，下次登录会再同步
  }
}
