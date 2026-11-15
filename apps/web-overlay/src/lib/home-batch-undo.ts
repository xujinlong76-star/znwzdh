/**
 * 首页批量操作的全局撤销条目 builder（11b）。
 *
 * 三个纯 builder：收据进、UndoEntry 出；0 生效返回 null（§2.3 不推规则）。
 * 逆操作闭包只活在内存栈里，不序列化。
 *
 * 逆操作提交一律 `{ pushHistory: false }`（协调人裁决，2026-11-14）：
 * 决策 5（`{ pushHistory: true, forceNewHistoryEntry: true }`）已撤销——
 * D2 探针实测它与设计 §5.3 用例 2 / R5 / §6.4 冲突：闭包压历史后 DIY
 * 栈顶是闭包自己的记录，全局撤销后编排态 Ctrl+Z 弹出它等于把批量操作
 * 重新应用，终态不是 §6.4 要求的“终态不变”。不压历史则先快后长幂等：
 * 全局撤销把 config 恢复到批量前 S0 且不留记录，编排态 Ctrl+Z 弹出
 * 批量提交 H1 仍是 S0（no-op）；redo 并不丢失——H1 仍在 DIY 栈上，
 * 编排态 Ctrl+Shift+Z 可重做批量操作。
 * `forceNewHistoryEntry` 选项本身保留在 home-diy-storage.ts（有效 API，
 * 后续可用），只是本次闭包不用它。
 *
 * 注意（与施工文档 §3.3 的一处出入，实测为准）：
 * `snapshotAndRemoveLocal` 内部并不 `markDirty`——脏标记是 hook 的
 * `remove` / `toggle` 在调用它之后补的（useFavorites.ts），而 `markDirty`
 * 本身是该模块的私有函数，这里调不到。所以 pin 撤销后、若在 pin 与撤销
 * 之间已经发生过一次云端同步，云端 remove op 不会再被派生（脏标记已被那
 * 次同步清掉）；8 秒内没有同步介入时，pin 时的脏标记仍在，同步按
 *「脏 ∩ 本地 = ∅ → remove op」正常派生。彻底修要么导出 `markDirty`、
 * 要么把它收进 `snapshotAndRemoveLocal` 内部——那是 useFavorites.ts 的
 * 改动，不在本 builder 的授权文件内，留给后续跟进。
 */

import { commitHomeDiyConfig, getHomeDiySnapshot } from '@/lib/modular/home-diy-storage'
import type { BatchAddReceipt, BatchRemoveReceipt } from '@/lib/modular/use-home-diy'
import type { BatchPinReceipt } from '@/lib/modular/workbench-bridge'
import { snapshotAndRemoveLocal } from '@/hooks/useFavorites'
import {
  UNDO_SUBLABEL,
  UNDO_WINDOW_MS,
  newUndoBatchId,
  newUndoId,
  type UndoEntry,
} from '@/lib/undo-stack'

/** add / remove 用的自定义副标题：DIY config 没有回收站，默认文案那句是假话 */
export const HOME_BATCH_UNDO_SUBLABEL = '8 秒内可撤销 · Ctrl+Z 也可以'

const STORE_WRITE_FAILED = '本机存储写不进去，撤销未完成'

function baseEntry(
  kind: UndoEntry['kind'],
  label: string,
  count: number,
  undo: UndoEntry['undo'],
  opts: { sublabel?: string; detail?: string } = {},
): UndoEntry {
  const now = Date.now()
  return {
    id: newUndoId(),
    batchId: newUndoBatchId(),
    kind,
    label,
    sublabel: opts.sublabel,
    createdAt: now,
    expiresAt: now + UNDO_WINDOW_MS,
    count,
    detail: opts.detail,
    undo,
  }
}

/**
 * 批量收录的逆操作 = 按 id 从目标分类删掉本次新建的条目（§3.1）。
 * 按 id 删，不按 href / 下标删：8 秒内用户手动又加同 href 的站也不会误删。
 * 幂等：目标分类已被删 / 条目已被用户手动删 → 无命中即 ok，不报错。
 */
export function buildHomeBatchAddUndoEntry(receipt: BatchAddReceipt): UndoEntry | null {
  if (receipt.addedCount === 0 || receipt.added.length === 0) return null
  const addedIds = new Set(receipt.added.map((a) => a.id))
  return baseEntry(
    'home.batch-add',
    `已收录 ${receipt.addedCount} 个站点至「${receipt.categoryTitle}」`,
    receipt.addedCount,
    async () => {
      const result = commitHomeDiyConfig(
        (prev) => ({
          ...prev,
          customCategories: prev.customCategories.map((cat) =>
            cat.id === receipt.categoryId
              ? { ...cat, items: cat.items.filter((i) => !addedIds.has(i.id)) }
              : cat,
          ),
          updatedAt: Date.now(),
        }),
        { pushHistory: false },
      )
      if (!result.ok) return { ok: false, message: STORE_WRITE_FAILED }
      return { ok: true }
    },
    { sublabel: HOME_BATCH_UNDO_SUBLABEL, detail: receipt.categoryTitle },
  )
}

/**
 * 批量移除的逆操作 = 按原位插回（§3.2，与 insertRestoredFavorites 同款语义）。
 * 按 categoryId 分组，组内按原 index 升序 splice(Math.min(index, len), 0, item)；
 * 已在列表里的条目跳过；多分类一次提交处理全部。
 * 顺序容差（决策 3）：撤销前 8 秒内有别的插入落在恢复位置之前时，顺序至多差
 * 一位，只保证集合完全一致，不当 bug 修。
 * 目标分类被删时整批拒绝恢复（不自动重建分类、不做部分恢复），如实报失败。
 */
export function buildHomeBatchRemoveUndoEntry(receipt: BatchRemoveReceipt): UndoEntry | null {
  if (receipt.removedCount === 0 || receipt.removed.length === 0) return null
  // detail 用涉及的分类名（多个时第一个 + “等 M 个分类”，§2.1）。收据里只有
  // categoryId 没有 title，构建当时（移除刚发生）分类一定还在，从当前配置
  // 里现查；查不到的分类不进 detail，全部查不到时 detail 留空。
  const seenIds: string[] = []
  for (const r of receipt.removed) {
    if (!seenIds.includes(r.categoryId)) seenIds.push(r.categoryId)
  }
  const titles = seenIds
    .map(
      (id) =>
        getHomeDiySnapshot().config.customCategories.find((c) => c.id === id)?.title,
    )
    .filter((t): t is string => typeof t === 'string' && t.length > 0)
  const detail =
    titles.length === 0
      ? undefined
      : titles.length === 1
        ? titles[0]
        : `${titles[0]}等 ${titles.length} 个分类`
  return baseEntry(
    'home.batch-remove',
    `已从专属分类移除 ${receipt.removedCount} 个站点`,
    receipt.removedCount,
    async () => {
      // 先判目标分类是否还在：任一目标分类被删 → 整批拒绝恢复。
      const current = getHomeDiySnapshot().config
      const alive = new Set(current.customCategories.map((c) => c.id))
      if (seenIds.some((id) => !alive.has(id))) {
        return { ok: false, message: '分类已被删除，无法恢复这批站点' }
      }
      const byCategory = new Map<string, BatchRemoveReceipt['removed']>()
      for (const r of receipt.removed) {
        const group = byCategory.get(r.categoryId)
        if (group) group.push(r)
        else byCategory.set(r.categoryId, [r])
      }
      const result = commitHomeDiyConfig(
        (prev) => ({
          ...prev,
          customCategories: prev.customCategories.map((cat) => {
            const group = byCategory.get(cat.id)
            if (!group) return cat
            const items = [...cat.items]
            for (const r of [...group].sort((a, b) => a.index - b.index)) {
              if (items.some((i) => i.id === r.item.id)) continue
              items.splice(Math.min(r.index, items.length), 0, r.item)
            }
            return { ...cat, items }
          }),
          updatedAt: Date.now(),
        }),
        { pushHistory: false },
      )
      if (!result.ok) return { ok: false, message: STORE_WRITE_FAILED }
      return { ok: true }
    },
    { sublabel: HOME_BATCH_UNDO_SUBLABEL, detail },
  )
}

/**
 * 批量固定的逆操作 = 按 siteId 删收藏条目（只删本次新建的）+ dock 留下（§3.3、
 * 决策 1）。CAS：createdAt 与收据不一致的条目跳过（不删、不进 trash），
 * 计入 skipped，整体仍 ok 并如实报“其中 M 个已变化，未动”。
 * label / count 按本次新建数（addedSiteIds.length）写死——这才是本条目
 * 撤销时真正会动的那批站；pinnedCount 可能含已固定过的站，那些站不在
 * 本条目的撤销范围内。
 */
export function buildHomeBatchPinUndoEntry(receipt: BatchPinReceipt): UndoEntry | null {
  if (receipt.addedSiteIds.length === 0) return null
  const count = receipt.addedSiteIds.length
  return baseEntry(
    'home.batch-pin',
    `已固定 ${count} 个站点到工作台`,
    count,
    async () => {
      const expected = new Map(receipt.addedItems.map((i) => [i.siteId, i.createdAt]))
      const res = snapshotAndRemoveLocal(receipt.addedSiteIds, 'batch', {
        expectedCreatedAt: expected,
      })
      if (res === null) return { ok: false, message: STORE_WRITE_FAILED }
      const skipped = res.skippedSiteIds.length
      if (skipped > 0) {
        return {
          ok: true,
          message: `已取消固定 ${res.removed.length} 个站点，其中 ${skipped} 个已变化，未动`,
        }
      }
      return { ok: true }
    },
    // pin 撤销经 snapshotAndRemoveLocal 写回收站，默认文案那句是真的。
    { sublabel: UNDO_SUBLABEL },
  )
}
