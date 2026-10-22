/**
 * 类目站点数的后代聚合（纯函数，页面与 sitemap 共用）。
 *
 * 上游给的计数都按**单个类目自身**统计：中枢 `/api/categories/counts` 是
 * `GROUP BY category_id`，sitemap 侧的 `countCategorySites` 同理。新树里站点只挂
 * 叶子（G2：一级根只做导航不承载站点），所以直接用那份原始计数，18 个一级根会
 * 全部读成 0 站——根页、首页目录带、`/category` 总览会一致地把每个根判成薄分类。
 *
 * 深度按权威树是 2，实现不依赖这个前提：带环保护的记忆化 DFS。存量库里
 * `parent_id` 自指/互指的脏行只会让那一支少算，不会栈溢出。
 * `counts` 为 null（中枢取数失败）时返回 null：调用方要保持降级，
 * 而不是把全树当 0 站。
 */

/** 只用到 id 与 parentId，类目行（HubCategory / CategoryRef）都能直接传进来 */
export interface CountableNode {
  id: string
  parentId?: string | null
}

export function descendantSiteCounts(
  nodes: readonly CountableNode[],
  counts: Map<string, number> | null,
): Map<string, number> | null {
  if (!counts) return null
  const children = new Map<string, string[]>()
  for (const node of nodes) {
    if (!node.parentId) continue
    const siblings = children.get(node.parentId)
    if (siblings) siblings.push(node.id)
    else children.set(node.parentId, [node.id])
  }
  const totals = new Map<string, number>()
  const path = new Set<string>()
  const sum = (id: string): number => {
    const cached = totals.get(id)
    if (cached !== undefined) return cached
    if (path.has(id)) return 0
    path.add(id)
    let total = counts.get(id) ?? 0
    for (const child of children.get(id) ?? []) total += sum(child)
    path.delete(id)
    totals.set(id, total)
    return total
  }
  for (const node of nodes) sum(node.id)
  return totals
}
