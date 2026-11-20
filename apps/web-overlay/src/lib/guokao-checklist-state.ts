/**
 * 国考准考证打印前清单（U-285）的勾选状态纯规则层（C 步，W3）。
 *
 * 清单项 id 与文案一律复用 `@/lib/guokao-checklist`（W2 内容定稿，
 * Spec §2 的 14 项逐项落稿），本文件不另编清单项、不写新文案。
 * 勾选只保存在本机 localStorage（新键
 * navhub.guokao-admission-checklist.v1），不登录、不上传、不跨设备同步。
 * 旧键 navhub.my-exams.v1 不许改、不复用：清单勾选与「我的考试」关注
 * 解耦，清单页不要求先关注国考；A 组打印开启前就能勾（Spec G3）。
 *
 * 收敛模式照抄 lib/my-exams.ts：形状不对就丢弃对应部分，不猜、不崩；
 * 未知的清单项 id 一律丢掉（清单改了也不留脏数据）。
 */

import {
  GUOKAO_CHECKLIST_GROUPS,
  type GuokaoChecklistGroup,
  type GuokaoChecklistItem,
} from './guokao-checklist'

export type { GuokaoChecklistGroup, GuokaoChecklistItem }

/** 本地存储键。新键；改键 = 老用户的清单勾选凭空消失，不许改。 */
export const GUOKAO_CHECKLIST_STORAGE_KEY = 'navhub.guokao-admission-checklist.v1'

/** 全部清单项（按组顺序展平，共 7 项：A 组 3 + B 组 3 + C 组 1）。 */
export const GUOKAO_CHECKLIST_ITEMS: GuokaoChecklistItem[] =
  GUOKAO_CHECKLIST_GROUPS.flatMap((g) => g.items)

const KNOWN_IDS = new Set(GUOKAO_CHECKLIST_ITEMS.map((i) => i.id))

/**
 * 把一个不可信对象收敛成已勾选 id 数组；形状不对就丢弃对应部分，不猜、不崩。
 * 未知的清单项 id 一律丢掉。
 */
export function parseGuokaoChecklist(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return [
    ...new Set(raw.filter((x): x is string => typeof x === 'string' && KNOWN_IDS.has(x))),
  ]
}

/**
 * 勾选 / 取消勾选一项。未知 id 是 no-op（调用方不需先判，状态层兜底）——
 * 与 U-237 的教训对应：清单项不是 exam-calendar 节点，绝不能复用
 * toggleNodeCheck（它只认 exam.nodes 内的 label，未知 label 静默 no-op，R8）。
 */
export function toggleGuokaoChecklist(checked: string[], id: string): string[] {
  if (!KNOWN_IDS.has(id)) return checked
  return checked.includes(id) ? checked.filter((x) => x !== id) : [...checked, id]
}

/** 某组已勾选的项数（进度「已完成 x / y」的分子）。 */
export function groupCheckedCount(checked: string[], group: GuokaoChecklistGroup): number {
  const done = new Set(checked)
  return group.items.filter((i) => done.has(i.id)).length
}
