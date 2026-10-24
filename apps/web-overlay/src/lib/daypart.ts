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

import { useSyncExternalStore } from 'react'

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

/**
 * 工作区场景 id（与 `WorkspaceFilter` 的 WORKSPACES 同源，写在这里避免
 * 「纯模块反向 import 组件」的循环依赖）。
 */
export type DaypartWorkspaceId = 'all' | 'dev' | 'design' | 'ai' | 'efficiency'

/**
 * 「时段 → 建议场景」的映射。
 *
 * 为什么只给建议、不自动切换：`daypartSceneEnabled` 默认是开的，直接改用户当前
 * 看到的工作区等于未经同意就换掉整屏内容（早上一打开首页就从「AI 实验室」跳到
 * 「效率创作」）。所以这里产出一条可一键采纳的建议，切换由用户点。
 *
 * 三个时段与 `describeDaypart` 的分界逐字一致：
 *  - 早间专注（6-11）→ 效率创作：开工先落到知识库 / 协作 / 在线工具；
 *  - 敏捷高效（12-17）→ 研发全栈：白天主力是开发 / 部署 / API；
 *  - 深度探索（18-次日 5）→ 全部探索：夜间不预设垂类，漫游更合适。
 */
export function recommendDaypartWorkspace(hour: number): DaypartWorkspaceId | null {
  if (typeof hour !== 'number' || !Number.isFinite(hour)) return null
  const normalized = ((Math.trunc(hour) % 24) + 24) % 24
  if (normalized >= 6 && normalized < 12) return 'efficiency'
  if (normalized >= 12 && normalized < 18) return 'dev'
  return 'all'
}

/* ------------------------------------------------------------------ *
 * 客户端小时数（hook）
 * ------------------------------------------------------------------ */

const noopSubscribe = () => () => {}

/**
 * 只在客户端存在的「现在几点」。服务端一律 null。
 *
 * 为什么用 `useSyncExternalStore` 而不是「effect 里 setState」：
 * 后者要在挂载后额外跑一轮渲染，而且 ESLint 的 `set-state-in-effect` 会一路报警；
 * 这里服务端快照恒为 null，首帧两边都渲染占位文案，挂载后 React 自己重读客户端值 ——
 * 既不会水合不匹配，也没有级联渲染。
 */
export function useClientHour(): number | null {
  return useSyncExternalStore(noopSubscribe, () => new Date().getHours(), () => null)
}
