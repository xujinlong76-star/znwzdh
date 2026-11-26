/**
 * 首页 flight 分片：分类轻量索引（2026-11-26 perf/flight-shard-1126）。
 *
 * 背景：首页初始 RSC flight 下发全部 4,824 个站点的全量数据（约 2.3MB），
 * 首屏只渲染前 4 个分类。本模块把「分类元数据」与「站点记录」拆开：
 * - 服务端（page.tsx）只把前 N 个分类的全量数据放进 flight，其余分类只
 *   下发一条轻量索引（id / 标题 / 站点数 / 子分类结构，不含任何站点记录）；
 * - 客户端用索引渲染占位块与侧栏，未下发的分类在滚动到视口时
 *   （LazyMountSection）或被功能需要时（工作区筛选、场景应用）再按需取数。
 *
 * 索引条目不含站点记录：13 个分类 + 约 50 个子分类的元数据合计只有几 KB，
 * 相对 2MB 的全量数据可忽略。站点数用 NavigationItem.totalCount 承载
 * （该字段此前未被数据管线使用，见 types/navigation.ts），
 * countCategorySites / estimateTruncatedSectionHeight 在条目无 items 时
 * 优先读 totalCount，保证占位块的数字与高度与真实分类一致。
 */
import type { NavigationCategory, NavigationItem } from '@/types/navigation'
import { countCategorySites } from './category-counts'

/** 首页分类轻量索引：一个分类一条，不含站点记录。 */
export interface HomeCategoryIndexEntry {
  id: string
  title: string
  enabled: boolean
  icon?: string
  /** 该分类下全部站点数（直接条目 + 各子分类条目之和）。 */
  totalCount: number
  subCategories: Array<{ id: string; title: string; totalCount: number }>
}

export type HomeCategoryIndex = HomeCategoryIndexEntry[]

/**
 * 从已处理的全量导航树派生轻量索引（服务端 page.tsx 用）。
 * 只取渲染占位/侧栏/取数所需的元数据，绝不带站点记录。
 */
export function buildHomeCategoryIndex(navigationItems: NavigationItem[]): HomeCategoryIndex {
  return navigationItems.map((cat) => ({
    id: cat.id,
    title: cat.title,
    enabled: cat.enabled !== false,
    icon: cat.icon,
    totalCount: countCategorySites(cat),
    subCategories: (cat.subCategories ?? []).map((sub) => ({
      id: sub.id,
      title: sub.title,
      totalCount: (sub.items ?? []).length,
    })),
  }))
}

/**
 * 把索引条目展开成 NavigationItem 占位（无站点记录，仅 totalCount + 结构）。
 *
 * 占位要点：
 * - 顶级 items 置 []（明确「直接条目尚未加载」）；
 * - 子分类 items 置 undefined（不是 []）：侧栏用 `!sub.items || sub.items.length > 0`
 *   过滤子分类，[] 会把子分类整个滤掉，undefined 才能保留子分类行；
 * - totalCount 同时写在顶级与子分类上，供 countCategorySites /
 *   estimateTruncatedSectionHeight 在无 items 时读数。
 */
export function categoryIndexToStub(entry: HomeCategoryIndexEntry): NavigationItem {
  const subCategories: NavigationCategory[] = entry.subCategories.map((sub) => ({
    id: sub.id,
    title: sub.title,
    parentId: entry.id,
    enabled: true,
    items: undefined,
    totalCount: sub.totalCount,
  }))
  return {
    id: entry.id,
    title: entry.title,
    icon: entry.icon,
    enabled: entry.enabled,
    totalCount: entry.totalCount,
    items: [],
    subCategories,
  }
}

/**
 * 判断一个分类对象是不是索引占位（无站点记录、只有 totalCount）。
 * 接受最小结构（NavigationItem 与 combineAndSortCategories 的
 * CategoryNode 均满足），不依赖具体分类类型。
 */
export function isCategoryIndexStub(
  category:
    | {
        totalCount?: unknown
        items?: unknown[] | null
        subCategories?: Array<{ items?: unknown[] | null }> | null
      }
    | undefined
    | null,
): boolean {
  if (!category) return false
  if (typeof category.totalCount !== 'number') return false
  const direct = category.items?.length ?? 0
  if (direct > 0) return false
  for (const sub of category.subCategories ?? []) {
    if ((sub.items?.length ?? 0) > 0) return false
  }
  return true
}
