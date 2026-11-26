export const INSTALL_VISIT_KEY = 'navhub:install-visits:v1'
export const INSTALL_DISMISS_KEY = 'navhub:install-dismissed:v1'
export const INSTALL_MIN_VISITS = 3
export const INSTALL_DISMISS_DAYS = 14

export function parseVisitCount(raw: string | null): number {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}
export function bumpVisitCount(raw: string | null): number {
  return parseVisitCount(raw) + 1
}

export function installDismissedUntil(now: number): number {
  return now + INSTALL_DISMISS_DAYS * 86_400_000
}
export interface InstallOfferInput {
  visits: number
  dismissedUntil: number
  now: number
  standalone: boolean
  canPrompt: boolean
}
export function shouldOfferInstall(input: InstallOfferInput): boolean {
  if (input.standalone || !input.canPrompt) return false
  if (input.visits < INSTALL_MIN_VISITS) return false
  return input.now >= input.dismissedUntil
}

/**
 * U-366：iOS 判定（纯函数，供组件与单测共用）。
 *
 * iOS Safari 从不触发 beforeinstallprompt，只能走 UA 判定。
 * iPadOS 13+ 的 Safari 默认发桌面版 UA（Macintosh），靠多点触控识别；
 * 无触控的真 Mac 不算 iOS。
 */
export function isIOSUserAgent(userAgent: string, maxTouchPoints = 0): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return true
  return false
}

export interface IosManualInstallInput {
  visits: number
  dismissedUntil: number
  now: number
  standalone: boolean
  isIOS: boolean
}

/**
 * U-366：iOS 手动安装卡展示条件。
 *
 * 与 shouldOfferInstall 同一套门槛（访问 ≥3 次 + 未 standalone +
 * 关闭节流期满），唯一区别是不要求 canPrompt——iOS 上 beforeinstallprompt
 * 永不触发，canPrompt 恒 false，再等它就永远等不到。
 * 展示的是两步手动卡（分享 → 添加到主屏幕），不是原生 prompt。
 */
export function shouldOfferIosManualInstall(input: IosManualInstallInput): boolean {
  if (!input.isIOS || input.standalone) return false
  if (input.visits < INSTALL_MIN_VISITS) return false
  return input.now >= input.dismissedUntil
}
