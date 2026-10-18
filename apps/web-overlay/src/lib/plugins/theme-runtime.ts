'use client'

/**
 * 插件市场主题运行时引擎 (Plugin Theme Runtime Engine)
 *
 * 核心设计目标：
 * 1. 声明式注入：严格消费 @navhub/core 校验通过的 tokens，仅操作白名单 CSS 变量；
 * 2. 响应式与持久化：在 LocalStorage 记录 activeTheme，客户端首屏即时水合；
 * 3. 干净回滚：resetTheme 彻底移除所有注入的 style properties 与 accent 标记，无残留。
 */

import { THEME_COLOR_VARS, type ThemeAccent } from './plugin-manifest'

export const THEME_STORAGE_KEY = 'navhub_active_theme_v1'

export interface ActiveThemeConfig {
  slug: string
  name: string
  tokens?: Record<string, string>
  accent?: ThemeAccent
  appliedAt: number
}

const VALID_VARS_SET = new Set<string>([...THEME_COLOR_VARS, '--radius'])

/**
 * 将主题 tokens 注入当前 document 根节点
 */
export function applyThemeTokens(
  tokens?: Record<string, string>,
  accent?: ThemeAccent
): void {
  if (typeof document === 'undefined') return

  const root = document.documentElement

  // 1. 注入 CSS 变量
  if (tokens && typeof tokens === 'object') {
    for (const [key, val] of Object.entries(tokens)) {
      if (VALID_VARS_SET.has(key) && typeof val === 'string') {
        root.style.setProperty(key, val.trim())
      }
    }
  }

  // 2. 标记或更新 accent
  //    属性名必须是 data-accent：globals.css 的强调色块（L473+）与 use-home-diy
  //    都消费 `[data-accent=...]`；此前的 data-theme-accent 没有对应 CSS 规则，等于无效。
  if (accent) {
    root.setAttribute('data-accent', accent)
  }
}

/**
 * 恢复默认系统主题（清除所有自定义变量与 accent）
 */
export function resetTheme(): void {
  if (typeof document === 'undefined') return

  const root = document.documentElement
  for (const varName of VALID_VARS_SET) {
    root.style.removeProperty(varName)
  }
  // 移除插件主题的 accent；若用户还配置了 DIY 强调色，会在其下次配置变更/刷新时自行恢复
  root.removeAttribute('data-accent')

  try {
    localStorage.removeItem(THEME_STORAGE_KEY)
  } catch {
    // 忽略 localStorage 受限环境
  }

  // 派发主题变更事件以通知所有监听组件
  window.dispatchEvent(new CustomEvent('navhub_theme_changed', { detail: null }))
}

/**
 * 读取当前活跃主题
 */
export function getActiveTheme(): ActiveThemeConfig | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as ActiveThemeConfig
  } catch {
    return null
  }
}

/**
 * 设置并持久化当前主题
 */
export function setActiveTheme(config: Omit<ActiveThemeConfig, 'appliedAt'>): void {
  if (typeof window === 'undefined') return

  // 先清空旧主题残留
  const root = document.documentElement
  for (const varName of VALID_VARS_SET) {
    root.style.removeProperty(varName)
  }

  // 应用新主题
  applyThemeTokens(config.tokens, config.accent)

  const fullConfig: ActiveThemeConfig = {
    ...config,
    appliedAt: Date.now(),
  }

  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(fullConfig))
  } catch {
    // 忽略 localStorage 受限环境
  }

  window.dispatchEvent(new CustomEvent('navhub_theme_changed', { detail: fullConfig }))
}

/**
 * 客户端首屏初始化（水合时调用）
 */
export function initThemeRuntime(): ActiveThemeConfig | null {
  const active = getActiveTheme()
  if (active) {
    applyThemeTokens(active.tokens, active.accent)
  }
  return active
}
