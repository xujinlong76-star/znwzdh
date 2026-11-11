'use client'

/**
 * 插件市场主题运行时引擎 (Plugin Theme Runtime Engine)
 *
 * 核心设计目标：
 * 1. 声明式注入：严格消费 @navhub/core 校验通过的 tokens，仅操作白名单 CSS 变量；
 * 2. 响应式与持久化：在 LocalStorage 记录 activeTheme，客户端首屏即时水合；
 * 3. 干净回滚：resetTheme 彻底移除所有注入的 style properties 与 accent 标记，无残留。
 *
 * B12 后半句（深色模式冲突）：种子主题只有一套浅色 tokens（manifest 无深色
 * 字段），内联注入的浅色变量会压过 `.dark` 样式变量，造成「半深半浅」。
 * 产品决策：插件主题只在浅色模式下生效——深色下暂停 tokens（`.dark` 接管），
 * 切回浅色自动恢复。data-accent 不动：它是与 DIY 共用的强调色 hue，
 * `[data-accent]` 规则深浅两用，暂停主题不应误伤它。
 */

import { THEME_COLOR_VARS, type ThemeAccent } from './plugin-manifest'

export const THEME_STORAGE_KEY = 'navhub_active_theme_v1'

/** 深色模式判定：next-themes 以 `class="dark"` 挂在 <html> 上（attribute="class"） */
export function isDarkMode(): boolean {
  if (typeof document === 'undefined') return false
  try {
    return document.documentElement.classList.contains('dark')
  } catch {
    return false
  }
}

/** 移除已注入的主题 tokens 内联变量（暂停时用；不碰 data-accent，见文件头） */
export function suspendThemeTokens(): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  for (const varName of VALID_VARS_SET) {
    root.style.removeProperty(varName)
  }
}

export interface ActiveThemeConfig {
  slug: string
  name: string
  tokens?: Record<string, string>
  accent?: ThemeAccent
  appliedAt: number
}

const VALID_VARS_SET = new Set<string>([...THEME_COLOR_VARS, '--radius'])

/**
 * 将主题 tokens 注入当前 document 根节点。
 *
 * 深色模式下不注入 tokens：内联样式会压过 `.dark` 样式变量，浅色 tokens
 * （如樱花薄雾的粉白底）会让深色页变成「半深半浅」。只留 data-accent
 * （强调色 hue 深浅两用）；tokens 待切回浅色由模式观察者恢复。
 * 调用方无需自行判断深浅：setActiveTheme / 试用 / 水合都走这一处守卫。
 */
export function applyThemeTokens(
  tokens?: Record<string, string>,
  accent?: ThemeAccent
): void {
  if (typeof document === 'undefined') return

  const root = document.documentElement

  // 1. 注入 CSS 变量（深色模式下跳过，见上）
  if (!isDarkMode() && tokens && typeof tokens === 'object') {
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

  activeTryout = null
  window.dispatchEvent(new CustomEvent('navhub_theme_tryout_changed', { detail: null }))
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
 * 设置并持久化当前主题。
 * 深色模式下只保存不注入 tokens（applyThemeTokens 的守卫），切回浅色由
 * 模式观察者自动恢复；UI 读 isThemeSuspended() 标注暂停状态，不谎称生效。
 * 显式激活压过试用：试用是「看看而已」，用户一点启用就是拍板；不清掉残留
 * 试用，切回浅色时会把试用 tokens 盖回来、取消试用还会倒回试用前的主题。
 */
export function setActiveTheme(config: Omit<ActiveThemeConfig, 'appliedAt'>): void {
  if (typeof window === 'undefined') return

  // 与 resetTheme 同款处理：清试用 + 派发试用变更事件，飘带随之收起
  if (activeTryout) {
    activeTryout = null
    window.dispatchEvent(new CustomEvent('navhub_theme_tryout_changed', { detail: null }))
  }

  // 先清空旧主题残留
  const root = document.documentElement
  for (const varName of VALID_VARS_SET) {
    root.style.removeProperty(varName)
  }
  // 新主题没带 accent 时清掉旧的 data-accent，别让上一个主题的强调色残留；
  // 有 accent 时由 applyThemeTokens 覆盖写。只动显式激活路径，水合不管
  // （水合时 data-accent 尚未建立，DIY 强调色随后自行挂载）。
  if (!config.accent) {
    root.removeAttribute('data-accent')
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
 * 客户端首屏初始化（水合时调用）。
 * 深色模式下 applyThemeTokens 自带守卫（tokens 不注入），只恢复 accent；
 * 同时启动深浅模式观察者，此后模式翻转自动暂停/恢复，无需各调用方操心。
 */
export function initThemeRuntime(): ActiveThemeConfig | null {
  const active = getActiveTheme()
  if (active) {
    applyThemeTokens(active.tokens, active.accent)
  }
  startModeObserver()
  return active
}

/* ------------------------------------------------------------------ *
 * 免安装即时沙箱试用 (Theme Live Tryout Sandbox)
 * ------------------------------------------------------------------ */

export interface ThemeTryoutConfig {
  slug: string
  name: string
  tokens?: Record<string, string>
  accent?: ThemeAccent
}

let activeTryout: (ThemeTryoutConfig & { original: ActiveThemeConfig | null }) | null = null

export function getActiveTryout(): (ThemeTryoutConfig & { original: ActiveThemeConfig | null }) | null {
  return activeTryout
}

export function isThemeInTryout(slug?: string): boolean {
  if (!activeTryout) return false
  if (!slug) return true
  return activeTryout.slug === slug
}

export function startThemeTryout(config: ThemeTryoutConfig): void {
  if (typeof window === 'undefined') return
  const current = getActiveTheme()
  activeTryout = {
    ...config,
    original: current,
  }

  // 先清空当前 document 变量（深色模式下 applyThemeTokens 的守卫会跳过注入，
  // 试用只记录不生效，飘带读 isThemeSuspended() 标注暂停）
  const root = document.documentElement
  for (const varName of VALID_VARS_SET) {
    root.style.removeProperty(varName)
  }
  // 试用主题没带 accent 时清掉旧的 data-accent，别让上一个主题的强调色残留
  if (!config.accent) {
    root.removeAttribute('data-accent')
  }

  // 应用试用主题
  applyThemeTokens(config.tokens, config.accent)
  window.dispatchEvent(new CustomEvent('navhub_theme_tryout_changed', { detail: activeTryout }))
  // 试用开始也可能翻转暂停态（如深色下此前无存量主题）：通知主题监听者刷新
  window.dispatchEvent(new CustomEvent('navhub_theme_changed', { detail: getActiveTheme() }))
}

export function cancelThemeTryout(): void {
  if (typeof window === 'undefined' || !activeTryout) return
  const original = activeTryout.original
  activeTryout = null

  const root = document.documentElement
  for (const varName of VALID_VARS_SET) {
    root.style.removeProperty(varName)
  }
  root.removeAttribute('data-accent')

  if (original) {
    applyThemeTokens(original.tokens, original.accent)
  }

  window.dispatchEvent(new CustomEvent('navhub_theme_tryout_changed', { detail: null }))
  window.dispatchEvent(new CustomEvent('navhub_theme_changed', { detail: original }))
}

export function commitThemeTryout(): void {
  if (typeof window === 'undefined' || !activeTryout) return
  const config = {
    slug: activeTryout.slug,
    name: activeTryout.name,
    tokens: activeTryout.tokens,
    accent: activeTryout.accent,
  }
  activeTryout = null
  setActiveTheme(config)
  window.dispatchEvent(new CustomEvent('navhub_theme_tryout_changed', { detail: null }))
}

/* ------------------------------------------------------------------ *
 * 深浅模式跟随 (B12 后半句)：主题只在浅色模式下生效
 * ------------------------------------------------------------------ */

let modeObserver: MutationObserver | null = null
let lastModeDark: boolean | null = null

/**
 * 当前是否有主题/试用因深色模式被暂停（派生状态，不另存标志，防漂移）。
 * 设置页、管家页、试用飘带读它来如实标注，不谎称生效。
 */
export function isThemeSuspended(): boolean {
  if (typeof document === 'undefined') return false
  if (!isDarkMode()) return false
  return getActiveTheme() !== null || activeTryout !== null
}

/**
 * 跟随深浅翻转：深色暂停 tokens（只清内联变量，`.dark` 接管）、浅色按当前
 * 主题/试用恢复；随后派发主题变更事件，让设置页与管家页刷新暂停文案。
 * 只改内联样式不碰 class，不会触发观察者自身循环；与深浅无关的 class
 * 变动直接跳过，不重复应用、不重复派发事件。
 */
function syncThemeWithMode(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  const dark = isDarkMode()
  if (lastModeDark !== null && lastModeDark === dark) return
  lastModeDark = dark
  const hasThemeState = getActiveTheme() !== null || activeTryout !== null
  if (dark) {
    suspendThemeTokens()
  } else if (activeTryout) {
    applyThemeTokens(activeTryout.tokens, activeTryout.accent)
  } else {
    const active = getActiveTheme()
    if (active) applyThemeTokens(active.tokens, active.accent)
  }
  if (hasThemeState) {
    window.dispatchEvent(
      new CustomEvent('navhub_theme_changed', { detail: getActiveTheme() })
    )
    if (activeTryout) {
      window.dispatchEvent(
        new CustomEvent('navhub_theme_tryout_changed', { detail: activeTryout })
      )
    }
  }
}

/**
 * 监听 <html> class 变化（next-themes 的深色开关、系统跟随变化都走这一处）。
 * 只启动一次；SSR 与无 MutationObserver 环境直接跳过。
 */
function startModeObserver(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  if (modeObserver || typeof MutationObserver === 'undefined') return
  lastModeDark = isDarkMode()
  modeObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        syncThemeWithMode()
        return
      }
    }
  })
  modeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  })
}

