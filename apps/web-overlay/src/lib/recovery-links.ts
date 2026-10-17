/**
 * 恢复路径（单一来源）。
 *
 * 「找不到页面」是导航站最高频的失败面：外链失效、收藏里存了旧 id、
 * 手输路径打错一个字。此时用户最需要的是**立刻找到正确的东西**，
 * 而不是一句「页面未找到」+ 一个返回首页。
 *
 * 这些出口同时被 404 页使用；集中在这里的好处是可测：
 * 每条 href 都能对着 overlay 的真实路由表校验（见 test/not-found.test.ts），
 * 避免「恢复路径本身是死链」这种最讽刺的回归。
 */

/** 图标键：组件侧用 Record<RecoveryIcon, LucideIcon> 映射，TypeScript 保证不漏 */
export type RecoveryIcon = 'home' | 'trending' | 'tags' | 'collections' | 'graph' | 'favorites'

export interface RecoveryLink {
  /** 站内绝对路径 */
  href: string
  label: string
  /** 一句话说明这条路径能解决什么 */
  description: string
  icon: RecoveryIcon
}

/** 顺序有意义：越靠前越通用，404 页按此顺序展示 */
export const RECOVERY_LINKS: readonly RecoveryLink[] = [
  { href: '/', label: '返回主页', description: '回到导航主干，按分类浏览全部收录', icon: 'home' },
  { href: '/hot', label: '热度榜', description: '看看最近全网在用什么', icon: 'trending' },
  { href: '/tags', label: '标签云', description: '按技术标签下钻，适合描述不了需求的时候', icon: 'tags' },
  { href: '/collections', label: '精选专题', description: '按主题成组浏览（地域 / 路线图 / 技术栈）', icon: 'collections' },
  { href: '/graph', label: '技术生态图谱', description: '看技术之间的关联与替代关系', icon: 'graph' },
  { href: '/favorites', label: '我的收藏', description: '回到你标记过的站点', icon: 'favorites' },
] as const
