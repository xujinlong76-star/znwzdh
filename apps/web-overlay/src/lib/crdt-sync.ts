// @core-mirror:parity-ignore-start
// 本文件由 scripts/sync-core-mirrors.mjs 自动生成，请勿手工编辑。
// 事实源：packages/core/src/crdt-sync.ts
// 同步命令：node scripts/sync-core-mirrors.mjs
// 一致性守门：node scripts/sync-core-mirrors.mjs --check（CI 可加）
// @core-mirror:parity-ignore-end
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
  // 保留原最大时间戳，避免压缩后因果序丢失（老 op 变“最新”与未压缩副本合并时 LWW 误胜）
  const maxTs = operations.reduce((m, o) => Math.max(m, o.timestamp), 0) || Date.now();
  const timestamp = maxTs;
  const clientId = 'compact_sys'

  // 1. 全局分类排序
  if (reduced.categoryOrder.length > 0) {
    compacted.push(
      createCRDTOperation(
        'REORDER_CATEGORIES',
        'global',
        { categoryOrder: reduced.categoryOrder },
        clientId,
        timestamp
      )
    )
  }

  // 2. 置顶分类
  for (const catId of reduced.pinnedCategoryIds) {
    compacted.push(
      createCRDTOperation(
        'SET_CATEGORY_PIN',
        catId,
        { isPinned: true },
        clientId,
        timestamp
      )
    )
  }

  // 3. 分类内置顶站点
  for (const [catId, siteIds] of Object.entries(reduced.pinnedSiteIdsByCategory)) {
    for (const siteId of siteIds) {
      compacted.push(
        createCRDTOperation(
          'PIN_SITE_IN_CATEGORY',
          catId,
          { siteId },
          clientId,
          timestamp
        )
      )
    }
  }

  // 4. 自定义分类及旗下站点
  for (const cat of reduced.customCategories) {
    compacted.push(
      createCRDTOperation(
        'UPSERT_CUSTOM_CATEGORY',
        cat.id,
        { id: cat.id, title: cat.title, items: [] },
        clientId,
        timestamp
      )
    )
    for (const site of cat.items) {
      compacted.push(
        createCRDTOperation(
          'UPSERT_CUSTOM_SITE',
          site.id,
          { categoryId: cat.id, site },
          clientId,
          timestamp
        )
      )
    }
  }

  // 5. 视频断点：每视频只留最新一条。
  // 关键：payload.updatedAt 保留原始值、只把 op.timestamp 抬到 maxTs。
  // 若把 updatedAt 也抬到 maxTs，压缩体会误胜另一设备上 updatedAt 介于
  // 原值与 maxTs 之间的真实新断点；若丢掉 maxTs，压缩后的 op 与未压缩
  // 副本合流时旧 op 可能「复活」成最新。两者缺一不可。
  for (const [videoId, progress] of Object.entries(reduced.videoProgress)) {
    compacted.push(
      createCRDTOperation(
        'UPSERT_VIDEO_PROGRESS',
        videoId,
        { ...progress },
        clientId,
        timestamp
      )
    )
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

