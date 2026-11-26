/**
 * 首页 flight 分片：分类取齐注册表（2026-11-26 perf/flight-shard-1126）。
 *
 * 背景：首页初始 flight 只带前 4 个分类，其余分类按需取数。但场景应用
 * （derivePinnedSites）要完整的「站点 id → 所属分类」索引——置顶站点
 * 若在未下发的分类里，会被当成「已删除」剪掉，等于场景功能丢失。
 * 场景切换器 / 管理器在读取 getRegisteredSceneSiteIndex() 之前，
 * 须先 await ensureHomeCategoriesLoaded()，把索引补齐再应用场景。
 *
 * 注册方：NavigationContent 在挂载后注册自己的 loadAllCategories；
 * 调用方：场景应用路径（scene-apply-live / scene-switcher /
 * scene-manager-dialog）。未注册时（非首页上下文）直接 resolve，
 * 不阻塞场景应用。
 */
let loadAll: (() => Promise<void>) | null = null

export function registerHomeCategoryLoader(loader: () => Promise<void>): void {
  loadAll = loader
}

export function unregisterHomeCategoryLoader(loader: () => Promise<void>): void {
  if (loadAll === loader) loadAll = null
}

/** 取齐全部分类（已加载的直接返回，未加载的并行取数）。 */
export async function ensureHomeCategoriesLoaded(): Promise<void> {
  if (!loadAll) return
  await loadAll()
}
