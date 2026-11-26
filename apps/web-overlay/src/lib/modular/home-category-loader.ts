/**
 * 首页 flight 分片：分类取齐注册表（2026-11-26 perf/flight-shard-1126）。
 *
 * 背景：首页初始 flight 只带前 4 个分类，其余分类按需取数。但场景应用
 * （derivePinnedSites）要完整的「站点 id → 所属分类」索引——置顶站点
 * 若在未下发的分类里，会被当成「已删除」剪掉，等于场景功能丢失。
 * 场景切换器 / 管理器在读取场景站点索引之前，须先 await
 * ensureHomeCategoriesLoaded()，把索引补齐再应用场景。
 *
 * 注册方：NavigationContent 在挂载后注册自己的 loadAllCategories；
 * 调用方：场景应用路径（scene-apply-live / scene-switcher /
 * scene-manager-dialog）。未注册时（非首页上下文）直接 resolve，
 * 不阻塞场景应用。
 *
 * 取数后的最新列表由加载方返回：调用方用返回值直接建索引，不要读模块级
 * 索引——await 续体执行时 React 尚未重渲染，模块级索引仍是取数前的旧版
 * （与工作区折叠同根的时序竞态，2026-11-26 flight 分片回归）。
 */
import type { NavigationItem } from '@/types/navigation'

let loadAll: (() => Promise<NavigationItem[]>) | null = null

export function registerHomeCategoryLoader(loader: () => Promise<NavigationItem[]>): void {
  loadAll = loader
}

export function unregisterHomeCategoryLoader(loader: () => Promise<NavigationItem[]>): void {
  if (loadAll === loader) loadAll = null
}

/**
 * 取齐全部分类并返回取齐后的完整列表（已加载的直接返回，未加载的并行取数）。
 * 未注册时（非首页上下文）返回 null，调用方回落到模块级索引，不阻塞。
 */
export async function ensureHomeCategoriesLoaded(): Promise<NavigationItem[] | null> {
  if (!loadAll) return null
  return loadAll()
}
