/**
 * 跨标签页布局合并的通知事件（8a）。
 *
 * 合并本身发生在 lib/modular/home-diy-storage.ts 的 applyRemoteHomeDiyConfig
 *（不归本任务改动），那里只返回写盘结果、不带合并明细。本模块做两件事：
 *   1. 从「合并前 / 合并后 / 远端」三份配置 + 合并前的本地时钟，纯函数算出
 *      哪些插槽是远端赢下来的、其中哪些丢弃了本地改动；
 *   2. 把结果发给订阅者（LayoutSyncAnnouncer 经 subscribeLayoutSyncEvents
 *      订阅后弹 toast + 写 live region）。
 *
 * 接线（协调员在合并处合入，见模块底部注释）：use-home-diy.ts 的
 * applyRemoteConfig 里，调 applyRemoteHomeDiyConfig 前后各取一次快照，
 * 再调一次 notifyLayoutSyncMerge 即可；合并逻辑与撤销栈一概不动。
 */
import {
  describeLayoutSlot,
  diffChangedSlots,
  slotValue,
  type LayoutSlotClocks,
} from './layout-sync'
import type { HomeDIYConfig } from './home-diy-storage'

/**
 * summarizeRemoteMerge / notifyLayoutSyncMerge 接受的配置形态：完整的
 * HomeDIYConfig，或任意字段子集的普通对象（测试与调用方按需传部分字段）。
 * HomeDIYConfig 没有索引签名、不能直接当 Record<string, unknown> 用，
 * 所以内部先统一转成字段记录再读插槽值；转换本身不丢信息（配置值全是
 * JSON 兼容值），与 diffChangedSlots 内部的同款转换一致。
 */
export type LayoutConfigInput = HomeDIYConfig | Record<string, unknown>

function asRecord(config: LayoutConfigInput): Record<string, unknown> {
  return config as Record<string, unknown>
}

export interface LayoutSyncMergeSummary {
  /** 合并后确实变了的插槽（字段级 + 元素级） */
  changedSlots: string[]
  /** 远端赢下来的插槽：合并后的值等于远端的值 */
  remoteWon: string[]
  /**
   * remoteWon 的子集：合并前本地改过这个插槽（本地时钟 > 0），却被远端
   * 更晚的改动覆盖 —— 本地改动被丢弃，必须明确告诉用户。
   */
  discardedLocal: string[]
  receivedAt: number
}

function stableEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/**
 * 从三份配置推导合并摘要。
 *
 * before = 合并前的本地配置，after = 合并后的配置，remote = 远端发来的配置，
 * beforeClocks = 合并前的本地插槽时钟（合并后时钟已被远端覆盖，事后读不到）。
 */
export function summarizeRemoteMerge(
  before: LayoutConfigInput,
  after: LayoutConfigInput,
  remote: LayoutConfigInput,
  beforeClocks: LayoutSlotClocks,
): LayoutSyncMergeSummary {
  const changedSlots = diffChangedSlots(before, after)
  const remoteWon: string[] = []
  const discardedLocal: string[] = []
  const afterRec = asRecord(after)
  const remoteRec = asRecord(remote)

  for (const slot of changedSlots) {
    // 合并后的值等于远端的值、且与合并前不同 → 这次变化是远端带来的
    if (!stableEqual(slotValue(afterRec, slot), slotValue(remoteRec, slot))) continue
    remoteWon.push(slot)
    if ((beforeClocks[slot] ?? 0) > 0) discardedLocal.push(slot)
  }
  // 元素容器字段：diff 会同时给出字段级插槽（customCategories）与元素级
  // 插槽（customCategories::<id>），但字段级的值是合并后的数组，不等于远端
  // 的整个数组，上面一轮筛不出来；有任一元素级插槽是远端赢的，字段级也算上。
  for (const slot of [...remoteWon]) {
    const field = slot.split('::')[0] as string
    if (field !== slot && changedSlots.includes(field) && !remoteWon.includes(field)) {
      remoteWon.push(field)
    }
  }

  return { changedSlots, remoteWon, discardedLocal, receivedAt: Date.now() }
}

export interface LayoutSyncMergeCopy {
  title: string
  description: string
  variant: 'default' | 'destructive'
}

/** 摘要 → toast / live region 文案：去重后的中文插槽名，冲突（丢弃本地改动）单独点名。 */
export function formatLayoutSyncMerge(summary: LayoutSyncMergeSummary): LayoutSyncMergeCopy {
  const labels = (slots: string[]): string[] => {
    const out: string[] = []
    for (const s of slots) {
      const label = describeLayoutSlot(s)
      if (!out.includes(label)) out.push(label)
    }
    return out
  }
  const wonLabels = labels(summary.remoteWon.length > 0 ? summary.remoteWon : summary.changedSlots)

  if (summary.discardedLocal.length > 0) {
    const discardedLabels = labels(summary.discardedLocal)
    return {
      title: '⚠️ 另一标签页的改动覆盖了你的本地改动',
      description: `另一标签页更新了首页排版，其中 ${discardedLabels.join('、')} 是你在这边改过、现在被对方较新版本覆盖的内容。已同步的改动：${wonLabels.join('、')}。`,
      variant: 'destructive',
    }
  }
  return {
    title: '🔄 另一标签页更新了首页排版',
    description: `已同步对方标签页的改动：${wonLabels.join('、')}。`,
    variant: 'default',
  }
}

export type LayoutSyncMergeListener = (summary: LayoutSyncMergeSummary) => void

const listeners = new Set<LayoutSyncMergeListener>()

export function subscribeLayoutSyncEvents(listener: LayoutSyncMergeListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * 合并完成后调一次：无变化返回 null 且不发任何通知；有变化则通知订阅者。
 *
 * 协调员接线（use-home-diy.ts 的 applyRemoteConfig 内，唯一的一处订阅）：
 * ```ts
 * const applyRemoteConfig = useCallback((payload) => {
 *   const before = getHomeDiySnapshot().config
 *   const beforeClocks = getEffectiveSlotClocks()
 *   const result = applyRemoteHomeDiyConfig(payload)
 *   if (result && result.ok) {
 *     notifyLayoutSyncMerge({
 *       before,
 *       after: result.config,
 *       remote: payload.config,
 *       beforeClocks,
 *     })
 *   }
 * }, [])
 * ```
 * 单订阅是刻意的（M1）：共享通道（use-home-diy-grid.ts 的
 * subscribeSharedLayoutSyncChannel）按订阅插入顺序扇出。use-home-diy-grid.ts
 * 绝不能再另订一份裸 applyRemoteHomeDiyConfig——它若先插进处理集、合并先被
 * 它跑掉，applyRemoteConfig 再算 merged.changed 已是 false、返回 null，
 * notifyLayoutSyncMerge 永远调不到，跨标签合并 toast 就死了；合并本身没错，
 * 死的只是通知。useHomeDiyGrid 调 useHomeDIY() 时已经挂上了这唯一订阅，
 * 网格 hook 只管广播（publishSharedLayoutSync），不管接收。
 * 另需在全局挂载一次 <LayoutSyncAnnouncer />（见
 * components/diy/layout-sync-announcer.tsx 顶部注释）。
 */
export function notifyLayoutSyncMerge(input: {
  before: LayoutConfigInput
  after: LayoutConfigInput
  remote: LayoutConfigInput
  beforeClocks: LayoutSlotClocks
}): LayoutSyncMergeSummary | null {
  const summary = summarizeRemoteMerge(input.before, input.after, input.remote, input.beforeClocks)
  if (summary.changedSlots.length === 0) return null
  for (const listener of [...listeners]) {
    try {
      listener(summary)
    } catch {
      // 单个订阅者抛错不影响其它订阅者与主流程
    }
  }
  return summary
}
