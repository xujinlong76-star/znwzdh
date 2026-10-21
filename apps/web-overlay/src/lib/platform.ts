/**
 * 跨平台环境、操作系统与输入场景感知工具
 * (Cross-Platform Environment, OS & Input Perception)
 *
 * 覆盖场景：
 * 1. 操作系统：Apple 生态 (macOS / iOS / iPadOS) vs Windows / Linux / Android
 * 2. 修饰键与快捷键符号：'⌘' (Command) vs 'Ctrl'
 * 3. 输入模式感知：触控屏 (Touch / Coarse Pointer) vs 鼠标精准光标 (Fine Pointer)
 * 4. PWA 容器：独立应用窗口 (Standalone / Fullscreen) vs 浏览器标签页
 */

export function isClient(): boolean {
  return typeof window !== 'undefined'
}

/**
 * 判断是否为 Apple 平台设备（macOS / iOS / iPadOS）
 * 支持规范的 NavigatorUAData (Client Hints)、navigator.platform 与 iPadOS 桌面伪装特性
 */
export function isAppleDevice(): boolean {
  if (!isClient()) return false
  const nav = (window.navigator || {}) as Navigator & {
    userAgentData?: { platform?: string }
  }

  // 1. 现代 User-Agent Client Hints
  if (nav.userAgentData?.platform) {
    return /mac|ios/i.test(nav.userAgentData.platform)
  }

  const platform = nav.platform || ''
  const userAgent = nav.userAgent || ''

  // 2. 传统 macOS / iOS / iPod
  if (/Mac|iPhone|iPod/i.test(platform) || /Macintosh|iPhone|iPod/i.test(userAgent)) {
    return true
  }

  // 3. iPadOS 13+ 桌面版 Safari 伪装为 MacIntel，但具备多点触控
  if (platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1) {
    return true
  }

  return false
}

/**
 * 获取当前操作系统对应的主键盘修饰键符号
 * - macOS / iOS: '⌘'
 * - Windows / Linux / 其他: 'Ctrl'
 */
export function getModifierKey(): '⌘' | 'Ctrl' {
  return isAppleDevice() ? '⌘' : 'Ctrl'
}

/**
 * 判断当前是否具备触摸输入设备（移动端手机、平板、触控屏笔记本）
 */
export function isTouchDevice(): boolean {
  if (!isClient()) return false
  const nav = (window.navigator || {}) as any
  return (
    'ontouchstart' in window ||
    (nav.maxTouchPoints || 0) > 0 ||
    window.matchMedia?.('(pointer: coarse)').matches === true
  )
}

/**
 * 判断是否处于 PWA 独立安装窗口或全屏模式 (Standalone Mode)
 */
export function isStandalonePwa(): boolean {
  if (!isClient()) return false
  const nav = (window.navigator || {}) as Navigator & { standalone?: boolean }
  return (
    nav.standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    window.matchMedia?.('(display-mode: fullscreen)').matches === true
  )
}
