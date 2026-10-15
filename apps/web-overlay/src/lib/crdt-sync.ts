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
  const rand = Math.random().toString(36).slice(2, 8)
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
  initialState?: Partial<CRDTReducedState>
): CRDTReducedState {
  const state: CRDTReducedState = {
    pinnedCategoryIds: [...(initialState?.pinnedCategoryIds || [])],
    categoryOrder: [...(initialState?.categoryOrder || [])],
    pinnedSiteIdsByCategory: { ...(initialState?.pinnedSiteIdsByCategory || {}) },
    customCategories: (initialState?.customCategories || []).map((c) => ({
      ...c,
      items: [...c.items],
    })),
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

  for (const op of operations) {
    switch (op.type) {
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
          const targetCat = state.customCategories.find((c) => c.id === targetCatId)
          if (targetCat) {
            const itemIdx = targetCat.items.findIndex((i) => i.id === site.id)
            if (itemIdx >= 0) {
              targetCat.items[itemIdx] = { ...site }
            } else {
              targetCat.items.push({ ...site })
            }
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
  const timestamp = Date.now()
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
    this.clock[this.clientId] = (this.clock[this.clientId] ?? 0) + 1
    const op = createCRDTOperation(
      'UPSERT_CUSTOM_SITE',
      id,
      { categoryId: site.categoryId, site: { id, title: site.title, href: site.url } },
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
      return remoteCount === 0 || op.timestamp > 0
    })
  }

  applyRemoteBatch(ops: CRDTOperation[]): number {
    let applied = 0
    for (const op of ops) {
      if (this.operations.some((existing) => existing.id === op.id)) continue
      this.operations.push(op)
      this.clock[op.clientId] = Math.max(this.clock[op.clientId] ?? 0, (this.clock[op.clientId] ?? 0) + 1)
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

