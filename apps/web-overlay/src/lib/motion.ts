/**
 * 「减弱动态效果」偏好的读取口。
 *
 * CSS 侧由 styles/reduced-motion.css 覆盖绝大多数动效；但**JS 显式传参的滚动**
 * 是 CSS 管不到的：`el.scrollIntoView({ behavior: 'smooth' })` 里的 behavior
 * 会压过样式表里的 `scroll-behavior`。侧边栏跳分类、键盘导航跟随时都会调用它，
 * 对要求减弱动态效果的用户来说，那是一段无法关掉的滚动动画。
 *
 * 所以这里把判断收成一个纯函数：调用点只写 `behavior: preferredScrollBehavior()`，
 * 偏好与实现只有一个来源，也才能在 node 环境里直接单测（不依赖 jsdom）。
 */

/** 标准媒体查询；写成常量是为了在测试里锁死字符串，避免手滑写错导致偏好永远为假 */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/** 媒体查询匹配器（默认取 window.matchMedia，测试可注入） */
export type MotionQueryMatcher = (query: string) => { matches: boolean } | null | undefined

/** 取真实的 matchMedia；没有 window（SSR / 构建期）或浏览器不支持时返回 null */
function defaultMatcher(query: string): { matches: boolean } | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  try {
    return window.matchMedia(query)
  } catch {
    // 少数环境（老浏览器 / 非浏览器宿主）对未知查询会抛错，按「未要求减弱」处理
    return null
  }
}

/**
 * 用户是否要求减弱动态效果。
 *
 * 读不到（SSR、无 matchMedia）或查询失败时一律返回 false —— 默认保持原有动效，
 * 不能因为读不到偏好就凭空把界面变成"没有反馈"的样子。
 */
export function prefersReducedMotion(match: MotionQueryMatcher = defaultMatcher): boolean {
  try {
    return Boolean(match(REDUCED_MOTION_QUERY)?.matches)
  } catch {
    return false
  }
}

/** 滚动行为：要求减弱动态效果时用 'auto'（直接落位），否则维持 'smooth' */
export function preferredScrollBehavior(match?: MotionQueryMatcher): ScrollBehavior {
  return prefersReducedMotion(match) ? 'auto' : 'smooth'
}
