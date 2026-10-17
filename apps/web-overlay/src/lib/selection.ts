/**
 * 卡片多选（批量操作）的选中状态：纯函数，可单测。
 *
 * 为什么需要它：`components/batch-operation-dock.tsx`（底部批量操作坞）与
 * `lib/batch-operations.ts`（批量导出 / 置顶 / 移动 / 删除）**写好很久了但从未被挂载**
 * —— 全仓没有任何地方渲染这个坞，也没有任何选中状态，于是它是一段死代码，
 * 而用户对「一次处理多个站点」的需求（导出到 OneTab / 复制成 Markdown / 批量置顶）
 * 一直没有入口。
 *
 * 这里只负责「选中的集合怎么变」，与 React / DOM 无关：
 *   - 纯切换语义（相同 id 再点一次即取消，绝不产生重复）
 *   - 全选 / 清空
 *   - **剪枝**：列表因筛选 / 折叠变化后，只保留仍然可见的 id
 *     （否则会导出到用户已经看不到的站点，属于「操作了但看不到」的惊吓）
 */
import type { BatchSiteItem } from '@/lib/batch-operations'

/** 切换一个 id 的选中状态（去重，保持稳定顺序） */
export function toggleSelected(selectedIds: string[], id: string): string[] {
  if (!id) return selectedIds
  if (selectedIds.includes(id)) return selectedIds.filter((x) => x !== id)
  return [...selectedIds, id]
}

/** 是否已选中 */
export function isSelected(selectedIds: string[], id: string): boolean {
  return selectedIds.includes(id)
}

/** 全选：去重、忽略空 id，并保持传入顺序 */
export function selectAllIds(allIds: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of allIds) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/** 清空 */
export function clearSelected(): string[] {
  return []
}

/** 只保留当前仍然可见的 id（筛选 / 分类折叠后调用） */
export function pruneSelected(selectedIds: string[], visibleIds: string[]): string[] {
  const visible = new Set(visibleIds)
  return selectedIds.filter((id) => visible.has(id))
}

/** 「已选 N / 共 M」 —— 让用户始终知道自己选了多大规模 */
export function summarizeSelection(selectedIds: string[], total: number): string {
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0
  const count = selectedIds.filter(Boolean).length
  if (count === 0) return '未选择任何站点'
  if (safeTotal > 0) return `已选 ${count} / 共 ${safeTotal} 个站点`
  return `已选 ${count} 个站点`
}

/** 按选中顺序取出站点数据（顺序 = 用户选择的先后，导出时更符合直觉） */
export function pickSelectedSites(selectedIds: string[], sites: BatchSiteItem[]): BatchSiteItem[] {
  const byId = new Map(sites.map((s) => [s.id, s]))
  const out: BatchSiteItem[] = []
  for (const id of selectedIds) {
    const hit = byId.get(id)
    if (hit) out.push(hit)
  }
  return out
}
