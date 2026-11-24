/**
 * 网址展示模式 Cookie 读写契约（前后端同构，零 React / next/headers 依赖）。
 *
 * 作用：在首页保持 ISR 静态缓存的前提下，持久化用户的卡片展示模式。
 * - 写侧：每次经 `home-diy-storage` 提交或水合配置时同步写入 `nav_view_mode` Cookie；
 * - 读侧：客户端 `useHomeDIY` 的同构 layout effect 在首次绘制前读取 Cookie/localStorage，
 *   与 SSR 的 standard 默认快照先匹配完成 hydration，再同步应用用户偏好，避免普通 effect 的可见闪烁。
 * - Server Component 不读取 Cookie，避免 `cookies()` 将首页从 ISR 变成动态渲染。
 */
import {
  normalizeCardDisplayMode,
  VALID_CARD_DISPLAY_MODES,
  type CanonicalCardDisplayMode,
  type CardDisplayMode,
} from './card-display-modes'

export const NAV_VIEW_MODE_COOKIE = 'nav_view_mode'
export const NAV_VIEW_MODE_COOKIE_MAX_AGE_S = 31536000 // 1 year

const VALID_MODE_SET: ReadonlySet<string> = new Set(VALID_CARD_DISPLAY_MODES)

/** 安全解析 Cookie 字符串中的展示模式值；缺失或非法值返回 null（绝不抛错） */
export function parseViewModeCookie(raw: string | null | undefined): CanonicalCardDisplayMode | null {
  if (!raw || typeof raw !== 'string') return null
  let decoded = raw.trim()
  try {
    decoded = decodeURIComponent(decoded).trim()
  } catch {
    // 非法百分号编码直接按无效值处理
    return null
  }
  if (!decoded || !VALID_MODE_SET.has(decoded)) return null
  return normalizeCardDisplayMode(decoded)
}

/** 构造标准化的 Set-Cookie / document.cookie 赋值串 */
export function serializeViewModeCookie(mode: CardDisplayMode): string {
  const canonical = normalizeCardDisplayMode(mode)
  return `${NAV_VIEW_MODE_COOKIE}=${encodeURIComponent(canonical)}; Path=/; Max-Age=${NAV_VIEW_MODE_COOKIE_MAX_AGE_S}; SameSite=Lax`
}

/** 浏览器端写入 `nav_view_mode` Cookie（SSR 或受限环境安全静默跳过） */
export function writeViewModeCookie(mode: CardDisplayMode): void {
  if (typeof document === 'undefined') return
  try {
    document.cookie = serializeViewModeCookie(mode)
  } catch {
    // 隐私模式或受限沙箱允许降级，不阻断主状态写入
  }
}

/** 从 `document.cookie` 读取当前 `nav_view_mode`（解析失败返回 null） */
export function readClientViewModeCookie(): CanonicalCardDisplayMode | null {
  if (typeof document === 'undefined' || typeof document.cookie !== 'string') return null
  const prefix = `${NAV_VIEW_MODE_COOKIE}=`
  const parts = document.cookie.split(';')
  for (const part of parts) {
    const trimmed = part.trim()
    if (trimmed.startsWith(prefix)) {
      return parseViewModeCookie(trimmed.slice(prefix.length))
    }
  }
  return null
}
