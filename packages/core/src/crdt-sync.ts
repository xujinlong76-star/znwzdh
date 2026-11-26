/**
 * 本地优先零冲突原子操作日志型 CRDT 协同漫游引擎 (Local-First Op-Log CRDT Engine)
 * 纯算法实现，0 DOM 依赖，跨 Node.js 和浏览器通用。
 * 基于 Last-Write-Wins (LWW) 与因果收敛模型，支持多设备离线编辑、无损合流与日志压缩。
 */

export type CRDTOpType =
  | 'SET_CATEGORY_PIN'
  | 'REORDER_CATEGORIES'
  | 'PIN_SITE_IN_CATEGORY'
  | 'UNPIN_SITE_IN_CATEGORY'
  | 'UPSERT_CUSTOM_CATEGORY'
  | 'DELETE_CUSTOM_CATEGORY'
  | 'UPSERT_CUSTOM_SITE'
  | 'DELETE_CUSTOM_SITE'
  | 'UPSERT_VIDEO_PROGRESS'
  | 'DELETE_VIDEO_PROGRESS'

/** 视频断点接力（Batch 3 第 9 项，方案 A）：平台只取三值，未知平台归 'other'。 */
export type VideoPlatform = 'bilibili' | 'youtube' | 'other'

export interface VideoProgress {
  videoId: string
  title: string
  author?: string
  cover?: string
  platform: VideoPlatform
  timestampSec: number
  durationSec: number
  progressPercent: number
  /** LWW 键：同视频取 updatedAt 更晚者。 */
  updatedAt: number
  /** 复用 sessionStorage 的 navhub_crdt_client_id，不新建 id。 */
  deviceId: string
  /** 可选：无可靠设备名时不编造，缺了就别写，卡上只写相对时间。 */
  deviceLabel?: string
}

export const VIDEO_PROGRESS_FUTURE_SKEW_MS = 5 * 60 * 1000

const VIDEO_PLATFORMS: ReadonlySet<string> = new Set(['bilibili', 'youtube', 'other'])

export interface CRDTOperation<T = any> {
  id: string
  type: CRDTOpType
  entityId: string // 操作针对的实体主键 (如 categoryId, siteId, 或 'global')
  payload: T
  timestamp: number
  clientId: string
}

export interface CRDTCustomSite {
  id: string
  title: string
  href: string
  description?: string
  icon?: string
}

export interface CRDTCustomCategory {
  id: string
  title: string
  items: CRDTCustomSite[]
}

export interface CRDTReducedState {
  pinnedCategoryIds: string[]
  categoryOrder: string[]
  pinnedSiteIdsByCategory: Record<string, string[]>
  customCategories: CRDTCustomCategory[]
  /** 跨设备接力：每视频只留最新一条断点（LWW 以 payload.updatedAt 为准）。 */
  videoProgress: Record<string, VideoProgress>
}

/**
 * 1. 创建规范的 CRDT 原子操作
 */
export function createCRDTOperation<T = any>(
  type: CRDTOpType,
  entityId: string,
  payload: T,
  clientId: string,
  timestamp: number = Date.now()
): CRDTOperation<T> {
  const rand =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 8);
  const id = `op_${timestamp}_${clientId.slice(0, 8)}_${rand}`
  return {
    id,
    type,
    entityId,
    payload,
    timestamp,
    clientId,
  }
}

/**
 * 2. 确定性合并两端操作日志 (Merge Operation Logs)
 * 具备幂等性 (Idempotence)、交换律 (Commutativity) 与结合律 (Associativity)。
 */
export function mergeOperationLogs(
  localOps: CRDTOperation[],
  remoteOps: CRDTOperation[]
): CRDTOperation[] {
  const seenIds = new Set<string>()
  const combined: CRDTOperation[] = []

  for (const op of localOps) {
    if (!seenIds.has(op.id)) {
      seenIds.add(op.id)
      combined.push(op)
    }
  }

  for (const op of remoteOps) {
    if (!seenIds.has(op.id)) {
      seenIds.add(op.id)
      combined.push(op)
    }
  }

  // 排序规则：时间戳升序；若时间戳完全相同，按 clientId 字典序破除平局
  return combined.sort((a, b) => {
    if (a.timestamp !== b.timestamp) {
      return a.timestamp - b.timestamp
    }
    if (a.clientId !== b.clientId) {
      return a.clientId.localeCompare(b.clientId)
    }
    return a.id.localeCompare(b.id)
  })
}

/**
 * 3. 将操作日志时序流规约计算为最新状态 (Reduce Operations to State)
 */
export function reduceOperationsToState(
  operations: CRDTOperation[],
  initialState?: Partial<CRDTReducedState>,
  now: number = Date.now()
): CRDTReducedState {
  const state: CRDTReducedState = {
    pinnedCategoryIds: [...(initialState?.pinnedCategoryIds || [])],
    categoryOrder: [...(initialState?.categoryOrder || [])],
    pinnedSiteIdsByCategory: { ...(initialState?.pinnedSiteIdsByCategory || {}) },
    customCategories: (initialState?.customCategories || []).map((c) => ({
      ...c,
      items: [...c.items],
    })),
    videoProgress: Object.fromEntries(
      Object.entries(initialState?.videoProgress || {}).map(([k, v]) => [k, { ...v }])
    ),
  }

  // 记录每个实体的最新写入时间，用于精确 LWW 冲突解决
  const lwwTimestamps = new Map<string, number>()

  const isMoreRecent = (key: string, op: CRDTOperation): boolean => {
    const prev = lwwTimestamps.get(key)
    if (prev === undefined || op.timestamp >= prev) {
      lwwTimestamps.set(key, op.timestamp)
      return true
    }
    return false
  }

  // 视频断点用 payload.updatedAt 做 LWW（与排版类 op 的 op.timestamp 分开记，
  // 否则压缩后 op.timestamp 被抬到 maxTs 会让旧断点误胜）。
  // 初始态已有的断点先 seeding，避免旧 op 覆盖更新的初始态。
  const videoLww = new Map<string, number>()
  for (const [videoId, progress] of Object.entries(state.videoProgress)) {
    if (Number.isFinite(progress.updatedAt)) videoLww.set(videoId, progress.updatedAt)
  }
  // 未来时间戳脏数据（updatedAt > now + 5min）丢弃：沿用 resurface.ts
  // 「晚于 now 的时间戳一律忽略」口径。返回 true 表示该 op 可参与 LWW。
  const videoOpWins = (videoId: string, updatedAt: number): boolean => {
    if (!Number.isFinite(updatedAt) || updatedAt > now + VIDEO_PROGRESS_FUTURE_SKEW_MS) {
      return false
    }
    const prev = videoLww.get(videoId)
    if (prev !== undefined && updatedAt < prev) return false
    videoLww.set(videoId, updatedAt)
    return true
  }
  // payload.updatedAt 缺失/非法时退回 op.timestamp（压缩前的老 op 与手写 op 仍能参与 LWW）。
  const videoUpdatedAtOf = (op: CRDTOperation): number => {
    const raw = (op.payload as { updatedAt?: unknown } | null | undefined)?.updatedAt
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : op.timestamp
  }

  for (const op of operations) {
    switch (op.type) {
      case 'UPSERT_VIDEO_PROGRESS': {
        const videoId = op.entityId
        if (!videoId) break
        const p = (op.payload || {}) as Partial<VideoProgress>
        // 先校验 payload 再占 LWW 水位：无效 op 不得挡住随后有效的 op。
        if (
          typeof p.title !== 'string' ||
          p.title.length === 0 ||
          typeof p.timestampSec !== 'number' ||
          !Number.isFinite(p.timestampSec) ||
          p.timestampSec < 0 ||
          typeof p.durationSec !== 'number' ||
          !Number.isFinite(p.durationSec) ||
          p.durationSec < 0 ||
          typeof p.progressPercent !== 'number' ||
          !Number.isFinite(p.progressPercent)
        ) {
          break
        }
        const updatedAt = videoUpdatedAtOf(op)
        if (!videoOpWins(videoId, updatedAt)) break
        // 注意：看完（progressPercent >= 95%）不发删除、记录照常保留，
        // 只是接力卡上不显示——规约层不过滤，由卡片 UI 决定。
        const progress: VideoProgress = {
          videoId,
          title: p.title,
          platform: VIDEO_PLATFORMS.has(p.platform as string)
            ? (p.platform as VideoPlatform)
            : 'other',
          timestampSec: p.timestampSec,
          durationSec: p.durationSec,
          progressPercent: Math.min(100, Math.max(0, p.progressPercent)),
          updatedAt,
          deviceId:
            typeof p.deviceId === 'string' && p.deviceId.length > 0 ? p.deviceId : op.clientId,
        }
        if (typeof p.author === 'string' && p.author.length > 0) progress.author = p.author
        if (typeof p.cover === 'string' && p.cover.length > 0) progress.cover = p.cover
        if (typeof p.deviceLabel === 'string' && p.deviceLabel.length > 0) {
          progress.deviceLabel = p.deviceLabel
        }
        state.videoProgress[videoId] = progress
        break
      }

      case 'DELETE_VIDEO_PROGRESS': {
        const videoId = op.entityId
        if (!videoId) break
        // 只有比现有断点更新的删除才生效，旧删除不能复活已删的断点，
        // 也不能删掉比它更新的断点。
        if (!videoOpWins(videoId, videoUpdatedAtOf(op))) break
        delete state.videoProgress[videoId]
        break
      }

      case 'SET_CATEGORY_PIN': {
        const key = `cat_pin_${op.entityId}`
        if (isMoreRecent(key, op)) {
          const isPinned = Boolean(op.payload?.isPinned)
          if (isPinned) {
            if (!state.pinnedCategoryIds.includes(op.entityId)) {
              state.pinnedCategoryIds.push(op.entityId)
            }
          } else {
            state.pinnedCategoryIds = state.pinnedCategoryIds.filter((id) => id !== op.entityId)
          }
        }
        break
      }

      case 'REORDER_CATEGORIES': {
        const key = 'global_category_order'
        if (isMoreRecent(key, op)) {
          if (Array.isArray(op.payload?.categoryOrder)) {
            state.categoryOrder = [...op.payload.categoryOrder]
          }
        }
        break
      }

      case 'PIN_SITE_IN_CATEGORY': {
        const { siteId } = op.payload || {}
        if (!siteId) break
        const key = `site_pin_${op.entityId}_${siteId}`
        if (isMoreRecent(key, op)) {
          const current = state.pinnedSiteIdsByCategory[op.entityId] || []
          if (!current.includes(siteId)) {
            state.pinnedSiteIdsByCategory[op.entityId] = [...current, siteId]
          }
        }
        break
      }

      case 'UNPIN_SITE_IN_CATEGORY': {
        const { siteId } = op.payload || {}
        if (!siteId) break
        const key = `site_pin_${op.entityId}_${siteId}`
        if (isMoreRecent(key, op)) {
          const current = state.pinnedSiteIdsByCategory[op.entityId] || []
          state.pinnedSiteIdsByCategory[op.entityId] = current.filter((id) => id !== siteId)
        }
        break
      }

      case 'UPSERT_CUSTOM_CATEGORY': {
        const key = `custom_cat_${op.entityId}`
        if (isMoreRecent(key, op)) {
          const cat = op.payload as CRDTCustomCategory
          if (cat && cat.id) {
            const idx = state.customCategories.findIndex((c) => c.id === cat.id)
            if (idx >= 0) {
              state.customCategories[idx] = {
                ...state.customCategories[idx]!,
                title: cat.title || state.customCategories[idx]!.title,
              }
            } else {
              state.customCategories.push({
                id: cat.id,
                title: cat.title,
                items: cat.items ? [...cat.items] : [],
              })
            }
          }
        }
        break
      }

      case 'DELETE_CUSTOM_CATEGORY': {
        const key = `custom_cat_${op.entityId}`
        if (isMoreRecent(key, op)) {
          state.customCategories = state.customCategories.filter((c) => c.id !== op.entityId)
          delete state.pinnedSiteIdsByCategory[op.entityId]
        }
        break
      }

      case 'UPSERT_CUSTOM_SITE': {
        const { site, categoryId } = op.payload || {}
        const targetCatId = categoryId || op.entityId
        if (!site || !site.id) break
        const key = `custom_site_${site.id}`
        if (isMoreRecent(key, op)) {
          // 跨分类移动：先从所有其他分类移除，再写入目标（避免旧分类残留）
          for (const cat of state.customCategories) {
            if (cat.id !== targetCatId) cat.items = cat.items.filter((i) => i.id !== site.id);
          }
          const targetCat = state.customCategories.find((c) => c.id === targetCatId)
          if (targetCat) {
            const itemIdx = targetCat.items.findIndex((i) => i.id === site.id)
            if (itemIdx >= 0) {
              targetCat.items[itemIdx] = { ...site }
            } else {
              targetCat.items.push({ ...site })
            }
          } else {
            // 目标分类尚未存在时自动初始化，防止站点操作日志在合流时静默丢失
            state.customCategories.push({
              id: targetCatId,
              title: "自定义分类",
              items: [{ ...site }],
            })
          }
        }
        break
      }

      case 'DELETE_CUSTOM_SITE': {
        const { siteId, categoryId } = op.payload || {}
        const targetSiteId = siteId || op.entityId
        if (!targetSiteId) break
        const key = `custom_site_${targetSiteId}`
        if (isMoreRecent(key, op)) {
          for (const cat of state.customCategories) {
            if (!categoryId || cat.id === categoryId) {
              cat.items = cat.items.filter((i) => i.id !== targetSiteId)
            }
          }
        }
        break
      }
    }
  }

  return state
}

/**
 * 4. 操作日志压缩 (Compaction)
 * 剔除被覆盖的历史中间操作，生成最小收敛等价操作日志，防止长期运行造成数据膨胀。
 */
export function compactOperationLog(
  operations: CRDTOperation[]
): CRDTOperation[] {
  // 先完整计算状态
  const reduced = reduceOperationsToState(operations)
  const compacted: CRDTOperation[] = []

  /**
   * 每个 LWW 键最后一条有效写入。压缩不能只序列化“存在的状态”：
   * 取消 pin / 删除在规约结果里表现为“什么都没有”，但它仍是压制旧 op 的水位。
   * 丢掉这些 tombstone 后，与未压缩的老 peer 日志合并会把旧正值复活。
   */
  type LatestWrite = { op: CRDTOperation; orderTs: number }
  const latestByKey = new Map<string, LatestWrite>()
  const remember = (key: string, op: CRDTOperation, valid = true, orderTs = op.timestamp) => {
    if (!valid) return
    const prev = latestByKey.get(key)
    if (!prev || orderTs >= prev.orderTs) latestByKey.set(key, { op, orderTs })
  }
  const videoOrderTsOf = (op: CRDTOperation): number => {
    const raw = (op.payload as { updatedAt?: unknown } | null | undefined)?.updatedAt
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : op.timestamp
  }
  // 分类删除还会清除该分类的 pin/site。即使分类随后重建，也必须保留最新删除屏障，
  // 否则与老 peer 合流时，删除时间点之前的跨键正值会重新挂到重建分类下。
  const latestCategoryDelete = new Map<string, LatestWrite>()
  const rememberCategoryDelete = (categoryId: string, op: CRDTOperation) => {
    const prev = latestCategoryDelete.get(categoryId)
    if (!prev || op.timestamp >= prev.orderTs) {
      latestCategoryDelete.set(categoryId, { op, orderTs: op.timestamp })
    }
  }
  const now = Date.now()
  for (const op of operations) {
    switch (op.type) {
      case 'SET_CATEGORY_PIN':
        remember(`cat_pin_${op.entityId}`, op)
        break
      case 'REORDER_CATEGORIES':
        remember('global_category_order', op)
        break
      case 'PIN_SITE_IN_CATEGORY':
      case 'UNPIN_SITE_IN_CATEGORY':
        if (op.payload?.siteId) remember(`site_pin_${op.entityId}_${op.payload.siteId}`, op)
        break
      case 'UPSERT_CUSTOM_CATEGORY':
        remember(`custom_cat_${op.entityId}`, op)
        break
      case 'DELETE_CUSTOM_CATEGORY':
        remember(`custom_cat_${op.entityId}`, op)
        rememberCategoryDelete(op.entityId, op)
        break
      case 'UPSERT_CUSTOM_SITE':
        if (op.payload?.site?.id) {
          remember(`custom_site_${op.payload.site.id}`, op)
        }
        break
      case 'DELETE_CUSTOM_SITE': {
        const siteId = op.payload?.siteId || op.entityId
        if (siteId) remember(`custom_site_${siteId}`, op)
        break
      }
      case 'UPSERT_VIDEO_PROGRESS': {
        if (!op.entityId) break
        const p = (op.payload || {}) as Partial<VideoProgress>
        const valid =
          typeof p.title === 'string' && p.title.length > 0 &&
          typeof p.timestampSec === 'number' && Number.isFinite(p.timestampSec) && p.timestampSec >= 0 &&
          typeof p.durationSec === 'number' && Number.isFinite(p.durationSec) && p.durationSec >= 0 &&
          typeof p.progressPercent === 'number' && Number.isFinite(p.progressPercent)
        const orderTs = videoOrderTsOf(op)
        remember(`video_${op.entityId}`, op, valid && orderTs <= now + VIDEO_PROGRESS_FUTURE_SKEW_MS, orderTs)
        break
      }
      case 'DELETE_VIDEO_PROGRESS': {
        if (!op.entityId) break
        const orderTs = videoOrderTsOf(op)
        remember(`video_${op.entityId}`, op, orderTs <= now + VIDEO_PROGRESS_FUTURE_SKEW_MS, orderTs)
        break
      }
    }
  }

  // 正值快照默认使用所属 LWW 键自己的 orderTs，并保留原 clientId/id 作为 tie-break。
  // 视频快照显式传原 op.timestamp：updatedAt 只用于选值，不能改写合并排序字段。
  // 内嵌站点没有同键原 op 时，再从来源分类写派生一个稳定 id。
  const snapshotFromWrite = (
    type: CRDTOpType,
    entityId: string,
    payload: unknown,
    write: LatestWrite,
    timestamp = write.orderTs
  ): CRDTOperation => {
    const sameIdentity = write.op.type === type && write.op.entityId === entityId
    return {
      ...write.op,
      ...(sameIdentity ? {} : { id: `${write.op.id}_${type}_${entityId}` }),
      type,
      entityId,
      payload,
      timestamp,
    }
  }

  // 0. 分类删除是跨 pin/site 键的屏障，先于正值快照输出，保证直接规约压缩结果也等价。
  // 每分类只保留最新一条，历史删除/重建循环不会让快照持续增长。
  for (const { op: barrier } of latestCategoryDelete.values()) {
    compacted.push({ ...barrier, payload: {} })
  }

  // 1. 全局分类排序。空数组也是一个有效终态：老 peer 的旧顺序不能把它填回去。
  const orderWrite = latestByKey.get('global_category_order')
  if (orderWrite) {
    compacted.push(snapshotFromWrite(
      'REORDER_CATEGORIES',
      'global',
      { categoryOrder: reduced.categoryOrder },
      orderWrite
    ))
  }

  // 2. 置顶分类
  for (const catId of reduced.pinnedCategoryIds) {
    const write = latestByKey.get(`cat_pin_${catId}`)
    if (!write) continue
    compacted.push(snapshotFromWrite('SET_CATEGORY_PIN', catId, { isPinned: true }, write))
  }

  // 3. 分类内置顶站点
  for (const [catId, siteIds] of Object.entries(reduced.pinnedSiteIdsByCategory)) {
    for (const siteId of siteIds) {
      const write = latestByKey.get(`site_pin_${catId}_${siteId}`)
      if (!write) continue
      compacted.push(snapshotFromWrite('PIN_SITE_IN_CATEGORY', catId, { siteId }, write))
    }
  }

  // 4. 自定义分类及旗下站点。
  // DELETE 写只能作为 tombstone，不能改头换面变成正值快照：同站点可能因分类内嵌数据
  // 仍存在于另一个分类，而其 custom_site 水位是带 categoryId 的删除；把它合成 UPSERT
  // 会在合流另一端的分类删除时复活站点。自动建类同样不能合成显式分类写，否则默认标题
  // 会覆盖 peer 已命名的标题。两类歧义历史统一保留原日志、放弃压缩，宁可多存也不丢因果。
  const isDeleteWrite = (write: LatestWrite): boolean => write.op.type.startsWith('DELETE_')
  for (const cat of reduced.customCategories) {
    const categoryWrite = latestByKey.get(`custom_cat_${cat.id}`)
    if (!categoryWrite || isDeleteWrite(categoryWrite)) return operations
    for (const site of cat.items) {
      const siteWrite = latestByKey.get(`custom_site_${site.id}`) ?? categoryWrite
      if (isDeleteWrite(siteWrite)) return operations
    }
  }

  for (const cat of reduced.customCategories) {
    const categoryWrite = latestByKey.get(`custom_cat_${cat.id}`)
    if (!categoryWrite) continue
    compacted.push(snapshotFromWrite(
      'UPSERT_CUSTOM_CATEGORY',
      cat.id,
      { id: cat.id, title: cat.title, items: [] },
      categoryWrite
    ))
    for (const site of cat.items) {
      const siteWrite = latestByKey.get(`custom_site_${site.id}`) ?? categoryWrite
      compacted.push(snapshotFromWrite('UPSERT_CUSTOM_SITE', site.id, { categoryId: cat.id, site }, siteWrite))
    }
  }

  // 5. 视频断点：每视频只留最新一条。LWW 选择仍用原始 payload.updatedAt，
  // 快照的 op.timestamp/clientId/id 则必须保持原操作排序字段，不能改成版本号。
  for (const [videoId, progress] of Object.entries(reduced.videoProgress)) {
    const write = latestByKey.get(`video_${videoId}`)
    if (!write) continue
    compacted.push(snapshotFromWrite('UPSERT_VIDEO_PROGRESS', videoId, { ...progress }, write, write.op.timestamp))
  }

  // 6. 负向终态显式落成 tombstone。只输出规约后确实不存在的对象，避免与上面的正值快照互相覆盖。
  // tombstone 必须原样保留 op.timestamp/clientId/id：它既是本键水位，也是同时间戳的 tie-break。
  for (const { op: negative } of latestByKey.values()) {
    if (negative.type === 'SET_CATEGORY_PIN' && !negative.payload?.isPinned) {
      if (reduced.pinnedCategoryIds.includes(negative.entityId)) continue
      compacted.push({ ...negative, payload: { isPinned: false } })
      continue
    }
    if (negative.type === 'UNPIN_SITE_IN_CATEGORY') {
      const siteId = negative.payload?.siteId
      if (!siteId || reduced.pinnedSiteIdsByCategory[negative.entityId]?.includes(siteId)) continue
      compacted.push({ ...negative, payload: { siteId } })
      continue
    }
    if (negative.type === 'DELETE_CUSTOM_SITE') {
      const siteId = negative.payload?.siteId || negative.entityId
      if (!siteId || reduced.customCategories.some((cat) => cat.items.some((site) => site.id === siteId))) continue
      const payload = negative.payload?.categoryId ? { siteId, categoryId: negative.payload.categoryId } : { siteId }
      compacted.push({ ...negative, payload })
      continue
    }
    if (negative.type === 'DELETE_VIDEO_PROGRESS') {
      if (reduced.videoProgress[negative.entityId]) continue
      // 视频删除的 LWW 水位仍是原始 updatedAt；op.timestamp 也保持原值，避免无关 op 抬高它。
      const payload = { ...(negative.payload || {}), updatedAt: videoOrderTsOf(negative) }
      compacted.push({ ...negative, payload })
    }
  }

  return compacted
}

export const compactOperationLogs = compactOperationLog;

export type CrdtOperation<T = any> = CRDTOperation<T>

export type VectorClock = Record<string, number>

export function compareVectorClocks(
  a: VectorClock,
  b: VectorClock
): 'EQUAL' | 'GREATER' | 'LESS' | 'CONCURRENT' {
  let hasGreater = false
  let hasLess = false
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)])

  for (const k of allKeys) {
    const valA = a[k] ?? 0
    const valB = b[k] ?? 0
    if (valA > valB) hasGreater = true
    if (valA < valB) hasLess = true
  }

  if (hasGreater && hasLess) return 'CONCURRENT'
  if (hasGreater) return 'GREATER'
  if (hasLess) return 'LESS'
  return 'EQUAL'
}

export class CrdtStore {
  readonly clientId: string
  private clock: VectorClock = {}
  private operations: CRDTOperation[] = []
  private sites = new Map<
    string,
    { id: string; url: string; title: string; categoryId: string; deleted?: boolean; updatedAt: number }
  >()

  constructor(clientId: string) {
    this.clientId = clientId
    this.clock[clientId] = 0
  }

  getVectorClock(): VectorClock {
    return { ...this.clock }
  }

  getOperations(): CRDTOperation[] {
    return [...this.operations]
  }

  addSite(site: { url: string; title: string; categoryId: string; id?: string }): string {
    const id = site.id || `site_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const nextSeq = (this.clock[this.clientId] ?? 0) + 1
    this.clock[this.clientId] = nextSeq
    const op = createCRDTOperation(
      'UPSERT_CUSTOM_SITE',
      id,
      { categoryId: site.categoryId, site: { id, title: site.title, href: site.url }, seq: nextSeq },
      this.clientId,
      Date.now()
    )
    this.operations.push(op)
    this.sites.set(site.url, {
      id,
      url: site.url,
      title: site.title,
      categoryId: site.categoryId,
      updatedAt: op.timestamp,
    })
    return id
  }

  getSiteByUrl(url: string) {
    const s = this.sites.get(url)
    if (!s || s.deleted) return undefined
    return s
  }

  getActiveSites() {
    return Array.from(this.sites.values()).filter((s) => !s.deleted)
  }

  getDeltaSince(remoteClock: VectorClock): CRDTOperation[] {
    return this.operations.filter((op) => {
      const remoteCount = remoteClock[op.clientId] ?? 0
      const opSeq = (op.payload as any)?.seq
      if (typeof opSeq === 'number') {
        return opSeq > remoteCount
      }
      const myCount = this.clock[op.clientId] ?? 0
      return myCount > remoteCount
    })
  }

  applyRemoteBatch(ops: CRDTOperation[]): number {
    let applied = 0
    for (const op of ops) {
      if (this.operations.some((existing) => existing.id === op.id)) continue
      this.operations.push(op)
      const opSeq = (op.payload as any)?.seq ?? ((this.clock[op.clientId] ?? 0) + 1)
      this.clock[op.clientId] = Math.max(this.clock[op.clientId] ?? 0, opSeq)
      if (op.type === 'UPSERT_CUSTOM_SITE' && op.payload?.site) {
        const s = op.payload.site
        this.sites.set(s.href, {
          id: s.id,
          url: s.href,
          title: s.title,
          categoryId: op.payload.categoryId || 'default',
          updatedAt: op.timestamp,
        })
      }
      applied++
    }
    return applied
  }
}

