/**
 * 「现在几点」→ 一句工作区情境提示。
 *
 * 为什么单独抽成纯模块（真实缺陷）：
 *   WorkspaceFilter 原来在渲染体里直接 `const hour = new Date().getHours()`
 *   算提示文案，而首页是服务端渲染的（app/page.tsx 静态 import NavigationContent）。
 *   服务端多半跑在 UTC（CI 与容器都是），用户却在自己的时区：同一个瞬间两边的
 *   小时数可能差好几个钟头。于是首屏 HTML 里写的是「🌙 深度探索」，客户端首帧
 *   算出来是「☀️ 早间专注」—— React 判定水合不匹配，丢掉这段服务端 HTML 重渲染，
 *   控制台报错，用户还会看到提示文字闪一下。
 *
 *   抽出来之后：边界（5/6/11/12/17/18 点）能逐个钉住；组件里只剩「挂载之后再算」
 *   这一件事，水合安全与否一眼能看出来。
 */

export interface DaypartHint {
  icon: string
  label: string
}

/**
 * 挂载前渲染的占位提示：服务端与客户端首帧都渲染它，因此两边逐字一致。
 * 它不含任何时间信息，所以不会「说错话」。
 */
export const DAYPART_PLACEHOLDER: DaypartHint = { icon: '🕐', label: '识别时段' }

/**
 * hour 取 `Date.getHours()` 的 0-23。
 *  - 非数字 / 非有限值 → 占位提示（不硬凑一个时段）；
 *  - 超出 0-23 的取值按 24 取模（getHours 不会这样，纯属防身）；
 *  - 22:00-05:59 一律「深度探索」，与改动前的取值完全一致。
 */
export function describeDaypart(hour: number): DaypartHint {
  if (typeof hour !== 'number' || !Number.isFinite(hour)) return DAYPART_PLACEHOLDER
  const normalized = ((Math.trunc(hour) % 24) + 24) % 24
  if (normalized >= 6 && normalized < 12) return { icon: '☀️', label: '早间专注' }
  if (normalized >= 12 && normalized < 18) return { icon: '⚡', label: '敏捷高效' }
  return { icon: '🌙', label: '深度探索' }
}

/** 界面上那一行的完整文案。与改动前的字符串逐字一致，避免悄悄换了措辞。 */
export function daypartText(hint: DaypartHint): string {
  return `${hint.icon} ${hint.label}`
}
