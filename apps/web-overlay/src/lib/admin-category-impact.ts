/**
 * 停用类目的影响预览（纯函数）：把中枢返回的原始计数翻成管理员看得懂的一句话。
 *
 * 数字全部来自 `/api/categories/:id/impact` 的**事实**：
 * 直接子类目数、后代数、直属站点数、子树站点数。这里只负责两件推断：
 *
 *   1. 停用后哪些东西「消失」——导航与分类总览按 `enabled` 逐层过滤，
 *      停一个根，它的整棵子树都不再出现；站点归属与详情页不受影响。
 *   2. 会不会多一个 404——**只有类目自身的分类页**会。后代分类页按自己的
 *      enabled/站点数独立判定，站点详情页从不检查分类状态。
 *
 * 收录门槛必须复用 web 侧同一个常量（`MIN_SITES_FOR_CATEGORY_INDEX`）：
 * 页面侧用它 notFound()，这里用另一份数字就会在确认框里报错数。
 */

import { categoryUrlKey, isHiddenCategory } from './seo/category-url'
import { MIN_SITES_FOR_CATEGORY_INDEX } from './seo/thresholds'

/** 对应中枢 `GET /api/categories/:id/impact` 的响应 */
export interface CategoryImpact {
  category: {
    id: string
    title: string
    slug: string | null
    enabled: boolean
    parentId: string | null
    anchor: string
  }
  childCategories: number
  descendantCategories: number
  directSites: number
  subtreeSites: number
}

export interface DeactivationImpact {
  /** 停用后新增 404 的对外 URL 数（只可能是 0 或 1：类目自身的分类页） */
  publicPagesAtRisk: number
  /** 逐条影响说明，直接进确认框正文 */
  lines: string[]
}

export function describeDeactivationImpact(impact: CategoryImpact): DeactivationImpact {
  const { category } = impact
  const hidden = isHiddenCategory(category)
  const qualifies = impact.subtreeSites >= MIN_SITES_FOR_CATEGORY_INDEX
  const publicPagesAtRisk = category.enabled && !hidden && qualifies ? 1 : 0

  const lines = [
    `· 类目：${impact.childCategories} 个直接子类目、${impact.descendantCategories} 个后代类目` +
      `将从导航与分类总览中消失（树结构与站点归属不变）。`,
    `· 站点：直属 ${impact.directSites} 个、子树合计 ${impact.subtreeSites} 个；` +
      `导航中不再展示，但站点详情页与搜索仍可直达（不会 404）。`,
  ]

  if (publicPagesAtRisk > 0) {
    lines.push(
      `· 对外 URL：/category/${categoryUrlKey(category)} 将返回 404` +
        `（当前 ${impact.subtreeSites} 个站点，已过收录门槛 ${MIN_SITES_FOR_CATEGORY_INDEX}）。`,
    )
  } else if (hidden) {
    lines.push(
      `· 对外 URL：「${category.title}」是兜底类目，本就没有公开分类页，停用不会产生新的 404。`,
    )
  } else if (!qualifies) {
    lines.push(
      `· 对外 URL：当前 ${impact.subtreeSites} 个站点，低于收录门槛 ${MIN_SITES_FOR_CATEGORY_INDEX}，` +
        `没有已发布的分类页，停用不会产生新的 404。`,
    )
  } else {
    lines.push('· 对外 URL：该类目当前已停用，没有已发布的分类页。')
  }

  return { publicPagesAtRisk, lines }
}

/** 停用确认框正文：影响面 + 恢复说明 + 需要手抄类目名 */
export function deactivationPrompt(impact: CategoryImpact): string {
  const { lines } = describeDeactivationImpact(impact)
  return [
    `即将停用类目「${impact.category.title}」：`,
    '',
    ...lines,
    '',
    '停用不会删除任何数据，可随时重新启用。',
    `确认请输入类目名「${impact.category.title}」（取消则不改动）：`,
  ].join('\n')
}

/** 输入必须与类目名一致（忽略首尾空白），防误点 */
export function matchesCategoryName(input: string, impact: CategoryImpact): boolean {
  return input.trim() === impact.category.title.trim()
}
