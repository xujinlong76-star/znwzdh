/**
 * 收藏同步状态机与 Outbox 契约（2026-11-21）。
 *
 * ## 设计前提：Local-First
 *
 * 本机写入即成功，云端同步不阻塞。任何"等云端"的交互都是反模式——
 * 用户点了收藏，IndexedDB 事务提交那一刻就算成功，同步只是后台补齐。
 * 因此这里的状态全部是**派生**的：由 (isOnline, outbox 长度, 冲突数, 错误种类)
 * 算出唯一 badgeState，不额外维护第二份真相。
 *
 * ## 为什么要有 dirtyItemIds / conflictItemIds
 *
 * Header 徽标、状态 Popover、冲突抽屉、每一张收藏卡片订阅的都是同一份
 * SyncEngineSnapshot。卡片用 Set O(1) 判断自己该不该显示微点。
 * 如果各处自己算，就会出现"顶部显示已同步、卡片还挂着冲突红点"的 UI 撕裂。
 */

export type SyncBadgeState =
  | 'local_only'    // 匿名态：仅存本机
  | 'local_saved'   // 已登录但离线，或处于防抖/待上传缓冲
  | 'syncing'       // 正在与云端加密同步
  | 'synced'        // 本地与云端一致
  | 'conflict'      // 存在需人工裁决的字段级冲突
  | 'error';        // 多次重试失败 / 401 / 密钥锁定

export type SyncErrorKind =
  | 'network_timeout'
  | 'server_5xx'
  | 'auth_expired'
  | 'e2ee_locked'
  | 'quota_exceeded';

export type ConflictFieldKey =
  | 'title'
  | 'url'
  | 'folderId'
  | 'note'
  | 'tags'
  | 'deleted';

/** 本地持久化 Outbox 变更记录（写入 IndexedDB 即视为本机已存） */
export interface OutboxMutation {
  mutationId: string;
  itemId: string;
  op: 'upsert' | 'delete';
  /** 修改前已知的云端版本号，用于三方合并与乐观锁校验 */
  baseRevision: number;
  /** 本次变更涉及的字段集合，支持正交字段静默自动合并 */
  changedFields: ConflictFieldKey[];
  payload?: Record<string, unknown>;
  updatedAtMs: number;
  retryCount: number;
}

/** 无法自动合并时生成的冲突裁决项 */
export interface SyncConflictItem {
  conflictId: string;
  itemId: string;
  itemTitle: string;
  conflictType: 'field_divergence' | 'edit_vs_delete';
  divergedFields: ConflictFieldKey[];
  baseSnapshot: Record<string, unknown> | null;
  localSnapshot: Record<string, unknown> | null;
  remoteSnapshot: Record<string, unknown> | null;
  localUpdatedAtMs: number;
  remoteUpdatedAtMs: number;
  remoteRevision: number;
}

export type ConflictResolution = 'keep_local' | 'use_remote' | 'keep_both';

/** 供 Header 徽标、Popover、卡片微点共享的单一真相快照 */
export interface SyncEngineSnapshot {
  badgeState: SyncBadgeState;
  isOnline: boolean;
  pendingCount: number;
  /** 便于收藏卡片 O(1) 判断自身是否显示待同步/冲突微点 */
  dirtyItemIds: Set<string>;
  conflictItemIds: Set<string>;
  conflicts: SyncConflictItem[];
  lastSyncedAtMs: number | null;
  nextRetryAtMs: number | null;
  error?: {
    kind: SyncErrorKind;
    message: string;
    canAutoRetry: boolean;
  };
}

/* ==========================================================================
 * 状态派生：唯一入口
 * ========================================================================== */

/** 徽标状态推导的输入（全部来自实际可观测的事实，不含猜测） */
export interface DeriveBadgeInput {
  /** 是否已登录（匿名态只能是 local_only） */
  isAuthed: boolean;
  isOnline: boolean;
  /** Outbox 中待上传的变更数 */
  pendingCount: number;
  /** 需人工裁决的冲突数 */
  conflictCount: number;
  /** 是否正在同步 */
  isSyncing: boolean;
  /** 最近一次同步错误（未恢复前一直保留） */
  error?: { kind: SyncErrorKind; message: string; canAutoRetry: boolean } | null;
}

/**
 * 推导徽标状态。**优先级即产品语义**，顺序不能随便调：
 *
 *  1. 匿名 → local_only（不管有没有队列，匿名态就不该出现"同步中/失败"）
 *  2. 有冲突 → conflict（最高优先：需要人介入，其余状态都会掩盖它）
 *  3. 有错误 → error（其次：用户需要知道并处理）
 *  4. 正在同步 → syncing（300ms 防抖由调用方控制，这里只管状态）
 *  5. 有待同步 → local_saved（离线/防抖窗口/队列缓冲都归这里）
 *  6. 其余 → synced
 *
 * 注意 5 与 2/3 的顺序：离线时如果同时有冲突，应该显示 conflict 而不是
 * local_saved——否则用户永远看不到"有冲突"这件事。
 */
export function deriveBadgeState(input: DeriveBadgeInput): SyncBadgeState {
  if (!input.isAuthed) return 'local_only'
  if (input.conflictCount > 0) return 'conflict'
  if (input.error) return 'error'
  if (input.isSyncing) return 'syncing'
  if (input.pendingCount > 0 || !input.isOnline) return 'local_saved'
  return 'synced'
}

/** 徽标文案。计数只在 >0 时出现，避免"待同步 (0)"这种噪音。 */
export function badgeLabel(state: SyncBadgeState, pendingCount = 0, conflictCount = 0): string {
  switch (state) {
    case 'local_only':
      return '仅本机保存'
    case 'local_saved':
      return pendingCount > 0 ? `本地已存 · 待同步 (${pendingCount})` : '本地已存 · 待同步'
    case 'syncing':
      return '同步中...'
    case 'synced':
      return '已同步'
    case 'conflict':
      return `${conflictCount} 项冲突待确认`
    case 'error':
      return '同步失败 · 重试'
  }
}

/**
 * 徽标视觉规范。
 *
 * 原则：**常态克制低饱和，仅异常/冲突态提亮**。
 * synced 是最常见的稳态，必须几乎不占视觉权重；conflict / error 才允许
 * 用饱和色把用户注意力拉过来。
 */
export interface BadgeVisual {
  /** 容器类（胶囊） */
  container: string
  /** 状态微点类（6-8px） */
  dot: string
  /** 这个态是否需要更高的视觉权重 */
  emphatic: boolean
}

const NEUTRAL = 'border-border/60 bg-background/70 text-muted-foreground'

export function badgeVisual(state: SyncBadgeState): BadgeVisual {
  switch (state) {
    case 'local_only':
      return {
        container: `${NEUTRAL} hover:text-foreground`,
        dot: 'bg-zinc-400 dark:bg-zinc-500',
        emphatic: false,
      }
    case 'local_saved':
      return {
        container: 'border-sky-500/25 bg-sky-500/[0.06] text-sky-700 dark:text-sky-400',
        dot: 'bg-sky-500',
        emphatic: false,
      }
    case 'syncing':
      return {
        container: 'border-indigo-500/25 bg-indigo-500/[0.06] text-indigo-700 dark:text-indigo-400',
        dot: 'bg-indigo-500',
        emphatic: false,
      }
    case 'synced':
      // 极简透明/浅绿底：稳态不抢注意力
      return {
        container: 'border-emerald-500/20 bg-emerald-500/[0.04] text-emerald-700 dark:text-emerald-400',
        dot: 'bg-emerald-500',
        emphatic: false,
      }
    case 'conflict':
      // 琥珀底 + 琥珀边框：需要人工裁决，明确提亮
      return {
        container: 'border-amber-500/40 bg-amber-500/[0.09] font-medium text-amber-800 dark:text-amber-300',
        dot: 'bg-amber-500',
        emphatic: true,
      }
    case 'error':
      return {
        container: 'border-rose-500/35 bg-rose-500/[0.07] font-medium text-rose-700 dark:text-rose-400',
        dot: 'bg-rose-500',
        emphatic: true,
      }
  }
}

/* ==========================================================================
 * 同步错误分型：不要统一报"同步失败"
 * ========================================================================== */

/** 错误的技术分类 → 面向用户的分型提示 */
export interface SyncErrorPresentation {
  kind: SyncErrorKind
  /** 一句话说明发生了什么（承认现状） */
  headline: string
  /** 本机数据是否安全（Local-First 承诺的核心安抚） */
  dataSafe: string
  /** 主操作按钮文案 */
  actionLabel: string
  action: 'retry' | 'relogin' | 'unlock_vault' | 'export_snapshot'
  /** 是否应该标红（离线绝不标红） */
  isRed: boolean
  canAutoRetry: boolean
}

/**
 * 把错误映射成用户可理解的处置方案。
 *
 * 关键原则：
 *  - 离线（network_timeout 且 !isOnline）**绝不标红**，回落为冷静的待同步态；
 *  - 每个分支都必须明说"本机数据安全"，这是 Local-First 的信任基础；
 *  - 401 严禁清空 Outbox（本机修改必须保留），只要求重新登录后续传。
 */
export function describeSyncError(kind: SyncErrorKind, isOnline: boolean): SyncErrorPresentation {
  switch (kind) {
    case 'network_timeout':
      if (!isOnline) {
        return {
          kind,
          headline: '当前离线，改动已安全存在本机',
          dataSafe: '重新联网后会自动同步，无需任何操作',
          actionLabel: '知道了',
          action: 'retry',
          isRed: false,
          canAutoRetry: true,
        }
      }
      return {
        kind,
        headline: '网络不稳定，正在后台重试',
        dataSafe: '你的改动已安全存在本机',
        actionLabel: '立即重试',
        action: 'retry',
        isRed: false,
        canAutoRetry: true,
      }
    case 'server_5xx':
      return {
        kind,
        headline: '云端服务暂时不可用',
        dataSafe: '你的改动已安全存在本机，不会丢失',
        actionLabel: '立即重试',
        action: 'retry',
        isRed: true,
        canAutoRetry: true,
      }
    case 'auth_expired':
      return {
        kind,
        headline: '登录状态已过期',
        dataSafe: '你的本机修改已安全保留，重新登录后会继续同步',
        actionLabel: '重新登录并继续同步',
        action: 'relogin',
        isRed: true,
        canAutoRetry: false,
      }
    case 'e2ee_locked':
      return {
        kind,
        headline: '本地解密密钥未就绪',
        dataSafe: '为避免写入错误密文，同步已暂停；本机数据完好',
        actionLabel: '解锁金库后继续',
        action: 'unlock_vault',
        isRed: true,
        canAutoRetry: false,
      }
    case 'quota_exceeded':
      return {
        kind,
        headline: '云端存储空间已满',
        dataSafe: '你的改动仍在本地，可先导出快照兜底',
        actionLabel: '导出本机快照',
        action: 'export_snapshot',
        isRed: true,
        canAutoRetry: false,
      }
  }
}

/**
 * 是否允许自动重试。服务端抖动/网络问题可退避重试；
 * 鉴权/密钥/配额必须人工介入，重试只会刷错误。
 */
export function canAutoRetry(kind: SyncErrorKind): boolean {
  return kind === 'network_timeout' || kind === 'server_5xx'
}

/** 指数退避阶梯（毫秒）：2s → 6s → 18s */
export const RETRY_BACKOFF_MS = [2000, 6000, 18000] as const

/** 第 n 次重试（0-based）应等待的毫秒数；超出阶梯返回 null（不再自动重试） */
export function retryDelayMs(retryCount: number): number | null {
  return RETRY_BACKOFF_MS[retryCount] ?? null
}

/** 同步中的视觉防抖：慢于这个时长才切到 syncing，避免极速同步导致徽标闪烁 */
export const SYNCING_VISIBLE_DELAY_MS = 300

/** 编辑后的合并窗口：这段时间内的连续改动合并成一次上传 */
export const EDIT_DEBOUNCE_MS = 1500

/* ==========================================================================
 * 分级冲突消解：三方基线对比（Base vs Local vs Remote）
 * ========================================================================== */

/** 三方快照的通用形：字段名 → 值。null 表示该条目不存在（已删除）。 */
export type TriSnapshot = Record<string, unknown> | null

/** 一次三方对比的结论 */
export type MergeVerdict =
  /** 双方一致（含都删了）或只有一边变化 → 无需人工介入 */
  | { kind: 'clean'; merged: TriSnapshot }
  /** 不同字段各改各的 → 字段级自动合并 */
  | { kind: 'auto_merged'; merged: TriSnapshot; mergedFields: ConflictFieldKey[] }
  /** 同一字段分歧 → 需要人工裁决 */
  | { kind: 'conflict'; divergedFields: ConflictFieldKey[]; conflictType: 'field_divergence' | 'edit_vs_delete' }

/** 参与三方对比的字段（顺序即对比顺序） */
export const MERGE_FIELDS: readonly ConflictFieldKey[] = [
  'title',
  'url',
  'folderId',
  'note',
  'tags',
  'deleted',
]

/** 深比较两个字段值（tags 是数组，不能只比引用） */
function fieldEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    // tags 语义是无序集合，但保持位置比较即可——排序差异本身也是修改
    return a.every((v, i) => v === b[i])
  }
  // null 与 undefined 在快照里都表示"无值"
  if ((a == null) !== (b == null)) return false
  return false
}

/**
 * 三方合并。**90% 的情况在这里静默解决，不打扰用户。**
 *
 * 规则（按优先级）：
 *  1. local 与 remote 完全一致 → clean（包括"两边都删了"）
 *  2. local 与 base 一致（本机没改）→ 采用 remote
 *  3. remote 与 base 一致（云端没改）→ 采用 local
 *  4. 两边都改了，但改的是**不同字段** → 字段级 auto_merged
 *  5. 两边都改了**同一字段** → conflict（唯一需要人裁决的情况）
 *
 * 「编辑 vs 删除」单独判定为 conflict 且类型记为 edit_vs_delete——
 * 因为删除是不可逆劳动损失，必须让用户确认（见 resolveConflict 的推荐策略）。
 */
export function mergeThreeWay(
  base: TriSnapshot,
  local: TriSnapshot,
  remote: TriSnapshot,
): MergeVerdict {
  // 1. 完全一致（含双边同删）
  if (local === null && remote === null) return { kind: 'clean', merged: null }
  if (base === null) {
    // 无基线：一边有、一边无 → 视为新增冲突需人工确认；都有则比字段
    if (local === null || remote === null) {
      return { kind: 'conflict', divergedFields: ['deleted'], conflictType: 'edit_vs_delete' }
    }
  }
  if (local === null || remote === null) {
    // 一边删除、一边存在
    const survivor = local ?? remote
    const baseEqualSurvivor =
      base !== null && survivor !== null && MERGE_FIELDS.every((f) => fieldEquals(base[f], survivor[f]))
    // 若留存方与基线一致（即留存方没改过），删除是唯一变更 → 采用删除
    if (baseEqualSurvivor) return { kind: 'clean', merged: null }
    // 否则是「一端编辑、一端删除」：绝不清默丢弃编辑
    return { kind: 'conflict', divergedFields: ['deleted'], conflictType: 'edit_vs_delete' }
  }

  const localUnchanged = base !== null && MERGE_FIELDS.every((f) => fieldEquals(base[f], local[f]))
  const remoteUnchanged = base !== null && MERGE_FIELDS.every((f) => fieldEquals(base[f], remote[f]))

  // 2/3. 只有一边改了
  if (localUnchanged && remoteUnchanged) {
    // 两边都没改但值不同（基线缺失/漂移）→ 保守取 remote（云端是事实源）
    return { kind: 'clean', merged: remote }
  }
  if (localUnchanged) return { kind: 'clean', merged: remote }
  if (remoteUnchanged) return { kind: 'clean', merged: local }

  // 4/5. 两边都改了：逐个字段判定
  const merged: Record<string, unknown> = { ...remote }
  const autoFields: ConflictFieldKey[] = []
  const diverged: ConflictFieldKey[] = []

  for (const f of MERGE_FIELDS) {
    const lv = local[f]
    const rv = remote[f]
    if (fieldEquals(lv, rv)) {
      // 两边改成一样的 → 一致，静默
      merged[f] = rv
      continue
    }
    const bv = base ? base[f] : undefined
    const localChanged = !fieldEquals(bv, lv)
    const remoteChanged = !fieldEquals(bv, rv)

    if (localChanged && remoteChanged) {
      // 同一字段两边都改且不同 → 真冲突
      diverged.push(f)
    } else if (localChanged) {
      // 只有本机改了这个字段 → 采用本机
      merged[f] = lv
      autoFields.push(f)
    } else {
      // 只有云端改了 → 采用云端（已是默认值）
      autoFields.push(f)
    }
  }

  if (diverged.length > 0) {
    return { kind: 'conflict', divergedFields: diverged, conflictType: 'field_divergence' }
  }
  // 关键区分：如果「两边都改了同一个字段、且改成了相同值」，
  // 那最终结果与 local/remote 完全一致 —— 属于"结果一致"，应静默消除
  // 而不是报"自动合并了 N 项"。auto_merged 只在**确实各改各的**时才有意义。
  const fullyIdentical = MERGE_FIELDS.every((f) => fieldEquals(local[f], remote[f]))
  if (fullyIdentical) return { kind: 'clean', merged: remote }
  return { kind: 'auto_merged', merged, mergedFields: autoFields }
}

/**
 * 冲突的推荐裁决动作。
 *
 * 「编辑 vs 删除」**必须**推荐保留编辑（恢复并保留本机修改）——
 * 默认选项高亮"放弃离线劳动"是产品事故。这里把推荐逻辑显式化，
 * 让 UI 不用各自猜。
 */
export function recommendResolution(conflict: Pick<SyncConflictItem, 'conflictType'>): ConflictResolution {
  if (conflict.conflictType === 'edit_vs_delete') return 'keep_both'
  return 'keep_local'
}

/** 「两份都留」时给本机副本的标题后缀 */
export const LOCAL_COPY_SUFFIX = '（本机副本）'

/** 生成本机副本条目标题，避免与云端原条目重名 */
export function localCopyTitle(title: string): string {
  const t = String(title || '').trim() || '未命名收藏'
  return t.endsWith(LOCAL_COPY_SUFFIX) ? t : t + LOCAL_COPY_SUFFIX
}

/* ==========================================================================
 * Outbox：本机写入即成功
 * ========================================================================== */

/** Outbox 的 IndexedDB 存储键（与现有 local-first 存储同库不同表） */
export const OUTBOX_STORE = 'favorites_sync_outbox'
export const OUTBOX_MAX_ITEMS = 5000

/**
 * 判断一个 Outbox 变更是否可被**静默丢弃**（已有更新的同条目变更覆盖）。
 *
 * 场景：用户连续编辑同一条收藏 3 次，Outbox 里会有 3 条 upsert。
 * 只需要保留最后一条——前面的已无意义（本地状态已经是最终值）。
 * 但 delete 不能被后续 upsert 之外的操作吞掉，且 baseRevision 必须保留最早的
 * （乐观锁要基于"我改之前云端是什么版本"）。
 */
export function compactOutbox(mutations: readonly OutboxMutation[]): OutboxMutation[] {
  const byItem = new Map<string, OutboxMutation>()
  for (const m of mutations) {
    const prev = byItem.get(m.itemId)
    if (!prev) {
      byItem.set(m.itemId, m)
      continue
    }
    // 合并：保留最新 payload/op，但 baseRevision 用更早的那个（首次修改前的云端版本）
    byItem.set(m.itemId, {
      ...m,
      baseRevision: Math.min(prev.baseRevision, m.baseRevision),
      changedFields: [...new Set([...prev.changedFields, ...m.changedFields])],
      // 重试次数取较大者，避免"合并后重试计数归零"导致无限重试
      retryCount: Math.max(prev.retryCount, m.retryCount),
    })
  }
  return [...byItem.values()]
}

/** 待同步项去重后的 count（徽标上显示的数字应该是"有多少条收藏待同步"，不是变更条数） */
export function pendingItemCount(mutations: readonly OutboxMutation[]): number {
  return new Set(mutations.map((m) => m.itemId)).size
}

/* ==========================================================================
 * 卡片级微点：O(1) 判定
 * ========================================================================== */

export type CardSyncDot = 'none' | 'pending' | 'conflict'

/**
 * 单张收藏卡片该显示什么微点。
 *
 * 优先级：冲突 > 待同步 > 无。
 * 卡片只从 snapshot 的两个 Set 里查，不自己算——保证与 Header 徽标同源，
 * 不会出现"顶部已同步、卡片还挂红点"的撕裂。
 */
export function cardSyncDot(snapshot: Pick<SyncEngineSnapshot, 'dirtyItemIds' | 'conflictItemIds'>, itemId: string): CardSyncDot {
  if (snapshot.conflictItemIds.has(itemId)) return 'conflict'
  if (snapshot.dirtyItemIds.has(itemId)) return 'pending'
  return 'none'
}

/** 微点样式：6px 圆点；待同步蓝灰、冲突琥珀 */
export function cardDotClass(dot: CardSyncDot): string {
  if (dot === 'conflict') return 'bg-amber-500'
  if (dot === 'pending') return 'bg-sky-500'
  return ''
}

/** 冲突卡片是否加浅琥珀细边框（让问题条目在列表里可扫到） */
export function cardConflictRing(dot: CardSyncDot): string {
  return dot === 'conflict' ? 'ring-1 ring-amber-500/40' : ''
}

/* ==========================================================================
 * 离开拦截：Local-First 下几乎不该拦
 * ========================================================================== */

/**
 * 是否需要 beforeunload 离开提醒。
 *
 * **反模式警告**：很多 Web 应用在 syncing 时弹"你确定要离开吗，更改可能丢失"。
 * 这在 Local-First 架构下是错的——只要 IndexedDB 事务已提交，关掉标签页
 * 数据 100% 安全，下次打开自动续传 Outbox。
 *
 * 唯一需要提醒的场景：用户打开了冲突裁决抽屉、勾了部分选项但还没确认——
 * 这是**未提交的 UI 决策**，不是未落盘的数据。
 */
export function shouldWarnOnUnload(hasUnconfirmedConflictSelection: boolean): boolean {
  return hasUnconfirmedConflictSelection
}
