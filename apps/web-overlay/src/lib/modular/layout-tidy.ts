/**
 * 「算法智能自愈整理」的纯决策逻辑（P1-2 组件拆分）。
 *
 * 从 `home-diy-toolbar.tsx` 的 `handleAutoTidyLayout` 抽出：原来这段
 * 「决定隐藏谁、折叠谁、要不要开自适应排序」的算法和 toast / setState
 * 混在一个 30 行的回调里，**一个测试都没有**——而它动的是用户眼前
 * 的整个排版（误隐藏一个分类，用户就「丢了」一个分类）。
 *
 * 抽成纯函数后：决策可单测，组件只负责执行与告知。
 * 规则（与原实现逐条对应）：
 *   - 分类树上一个站点都没有（直接项 + 所有二级项）且未隐藏 → 隐藏；
 *   - 站点数 > 25 且未折叠 → 折叠；
 *   - 自适应排序未开 → 开启（计入改动数）。
 */

export interface TidyCategory {
  id: string
  items?: unknown[]
  subCategories?: Array<{ items?: unknown[] }>
}

export interface TidyPlan {
  /** 应被隐藏的空分类 id */
  toHide: string[]
  /** 应被折叠的超大分类 id */
  toCollapse: string[]
  /** 是否应开启自适应排序 */
  enableAdaptiveRanking: boolean
  /** 本次整理一共有几处改动（用于给用户的反馈文案） */
  changeCount: number
}

/** 超过该站点数的分类会被折叠（避免一屏看不完的长分类） */
export const TIDY_COLLAPSE_THRESHOLD = 25

export function computeLayoutTidyPlan(
  categories: TidyCategory[],
  state: {
    hiddenCategoryIds: string[]
    collapsedCategoryIds: string[]
    isAdaptiveRankingEnabled: boolean
  },
): TidyPlan {
  const toHide: string[] = []
  const toCollapse: string[] = []

  for (const cat of categories) {
    const directCount = (cat.items || []).length
    const subCount = (cat.subCategories || []).reduce(
      (acc, s) => acc + ((s.items || []).length),
      0,
    )
    const total = directCount + subCount
    if (total === 0 && !state.hiddenCategoryIds.includes(cat.id)) {
      toHide.push(cat.id)
    } else if (total > TIDY_COLLAPSE_THRESHOLD && !state.collapsedCategoryIds.includes(cat.id)) {
      toCollapse.push(cat.id)
    }
  }

  const enableAdaptiveRanking = !state.isAdaptiveRankingEnabled
  const changeCount = toHide.length + toCollapse.length + (enableAdaptiveRanking ? 1 : 0)

  return { toHide, toCollapse, enableAdaptiveRanking, changeCount }
}
