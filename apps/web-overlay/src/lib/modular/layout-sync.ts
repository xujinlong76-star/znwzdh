/**
 * 布局多端同步（Web 客户端运行时）
 *
 * 本文件是 packages/core/src/layout-sync.ts 的浏览器镜像 + 传输层，
 * 沿用本仓既有约定：纯算法在 core（可单测），前端保留一份运行时副本
 * （原因：apps/web 不依赖 @navhub/core，无法直接 import）。
 * 两份逻辑必须保持一致，改动请同步。
 *
 * 解决的具体故障：多个标签页同时把首页当起始页打开时，每个标签页都会把
 * 整份 HomeDIYConfig 覆盖写回本地存储。旧标签页最后写回的那份会把新标签页
 * 刚调好的布局整个抹掉。这里改成：
 *   1. 每次改动只推进「被改动插槽」的 Lamport 时钟
 *   2. 通过 BroadcastChannel 广播 { config, clocks }
 *   3. 收到远端后按插槽逐项 LWW 合并，而不是整表覆盖
 */

export type LayoutSlotClocks = Record<string, number>

export const LAYOUT_SLOT_SEP = '::'

const ELEMENT_CONTAINER_FIELDS = new Set(['customCategories', 'pinnedSiteIdsByCategory'])
const NON_MERGEABLE_FIELDS = new Set(['updatedAt'])

export const LAYOUT_SYNC_CHANNEL = 'navhub_home_diy_sync_v1'

export function slotKey(field: string, id?: string): string {
  return id === undefined ? field : `${field}${LAYOUT_SLOT_SEP}${id}`
}

export function nextLamport(clocks: LayoutSlotClocks): number {
  let max = 0
  for (const k of Object.keys(clocks)) {
    const v = clocks[k]
    if (typeof v === 'number' && Number.isFinite(v) && v > max) max = v
  }
  return max + 1
}

export function bumpClocks(clocks: LayoutSlotClocks, slots: string[], lamport?: number): LayoutSlotClocks {
  const next: LayoutSlotClocks = { ...clocks }
  if (slots.length === 0) return next
  const v = lamport ?? nextLamport(clocks)
  for (const s of slots) next[s] = Math.max(next[s] ?? 0, v)
  return next
}

function stableStringify(v: unknown): string {
  return JSON.stringify(v ?? null)
}

function entriesOfRecord(v: unknown): Array<[string, unknown]> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return []
  return Object.entries(v as Record<string, unknown>)
}

function idOfElement(el: unknown): string {
  if (el && typeof el === 'object' && 'id' in (el as Record<string, unknown>)) {
    return String((el as Record<string, unknown>).id ?? '')
  }
  return ''
}

export function diffChangedSlots(prev: any, next: any): string[] {
  const slots: string[] = []
  const a = (prev ?? {}) as Record<string, unknown>
  const b = (next ?? {}) as Record<string, unknown>
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])

  for (const k of keys) {
    if (NON_MERGEABLE_FIELDS.has(k)) continue
    const av = a[k]
    const bv = b[k]
    if (stableStringify(av) === stableStringify(bv)) continue

    slots.push(slotKey(k))

    if (k === 'customCategories') {
      const prevIds = new Set((Array.isArray(av) ? av : []).map(idOfElement))
      const nextIds = new Set((Array.isArray(bv) ? bv : []).map(idOfElement))
      for (const id of new Set([...prevIds, ...nextIds])) {
        if (!id) continue
        const pe = (Array.isArray(av) ? av : []).find((e) => idOfElement(e) === id)
        const ne = (Array.isArray(bv) ? bv : []).find((e) => idOfElement(e) === id)
        if (stableStringify(pe) !== stableStringify(ne)) slots.push(slotKey(k, id))
      }
    }

    if (k === 'pinnedSiteIdsByCategory') {
      const prevMap = new Map(entriesOfRecord(av))
      const nextMap = new Map(entriesOfRecord(bv))
      for (const id of new Set([...prevMap.keys(), ...nextMap.keys()])) {
        if (stableStringify(prevMap.get(id)) !== stableStringify(nextMap.get(id))) {
          slots.push(slotKey(k, id))
        }
      }
    }
  }

  return slots
}

export interface LayoutMergeSide<T> {
  config: T
  clocks: LayoutSlotClocks
}

export interface LayoutMergeResult<T> {
  config: T
  clocks: LayoutSlotClocks
  changed: boolean
}

export function mergeLayoutSlots<T extends Record<string, any>>(
  local: LayoutMergeSide<T>,
  remote: LayoutMergeSide<T>
): LayoutMergeResult<T> {
  const lc = (local.config ?? {}) as Record<string, any>
  const rc = (remote.config ?? {}) as Record<string, any>
  const out: Record<string, any> = { ...lc }
  const clocks: LayoutSlotClocks = { ...local.clocks }
  let changed = false

  for (const k of new Set([...Object.keys(lc), ...Object.keys(rc)])) {
    if (NON_MERGEABLE_FIELDS.has(k)) continue

    if (ELEMENT_CONTAINER_FIELDS.has(k)) {
      const merged = mergeElementContainer(k, lc[k], rc[k], local.clocks, remote.clocks)
      out[k] = merged.value
      for (const [slot, v] of Object.entries(merged.clocks)) clocks[slot] = v
      if (stableStringify(merged.value) !== stableStringify(lc[k])) changed = true
      continue
    }

    const lv = local.clocks[k] ?? 0
    const rv = remote.clocks[k] ?? 0
    if (rv > lv) {
      out[k] = rc[k]
      clocks[k] = rv
      if (stableStringify(out[k]) !== stableStringify(lc[k])) changed = true
    } else {
      out[k] = lc[k]
      clocks[k] = lv
    }
  }

  const lu = typeof lc.updatedAt === 'number' ? lc.updatedAt : 0
  const ru = typeof rc.updatedAt === 'number' ? rc.updatedAt : 0
  out.updatedAt = Math.max(lu, ru) || Date.now()

  return { config: out as T, clocks, changed }
}

function mergeElementContainer(
  field: string,
  localVal: unknown,
  remoteVal: unknown,
  localClocks: LayoutSlotClocks,
  remoteClocks: LayoutSlotClocks
): { value: any; clocks: LayoutSlotClocks } {
  const clocks: LayoutSlotClocks = {}

  if (Array.isArray(localVal) || Array.isArray(remoteVal)) {
    const lArr = Array.isArray(localVal) ? localVal : []
    const rArr = Array.isArray(remoteVal) ? remoteVal : []
    const lMap = new Map<string, any>()
    for (const e of lArr) if (idOfElement(e)) lMap.set(idOfElement(e), e)
    const rMap = new Map<string, any>()
    for (const e of rArr) if (idOfElement(e)) rMap.set(idOfElement(e), e)

    const orderedIds: string[] = []
    for (const id of lMap.keys()) if (!orderedIds.includes(id)) orderedIds.push(id)
    for (const id of rMap.keys()) if (!orderedIds.includes(id)) orderedIds.push(id)

    const result: any[] = []
    for (const id of orderedIds) {
      const slot = slotKey(field, id)
      const lv = localClocks[slot] ?? 0
      const rv = remoteClocks[slot] ?? 0
      if (rv > lv) {
        clocks[slot] = rv
        if (rMap.has(id)) result.push(rMap.get(id))
      } else {
        clocks[slot] = lv
        if (lMap.has(id)) result.push(lMap.get(id))
      }
    }
    return { value: result, clocks }
  }

  const lMap = new Map(entriesOfRecord(localVal))
  const rMap = new Map(entriesOfRecord(remoteVal))
  const result: Record<string, unknown> = {}
  for (const id of new Set([...lMap.keys(), ...rMap.keys()])) {
    const slot = slotKey(field, id)
    const lv = localClocks[slot] ?? 0
    const rv = remoteClocks[slot] ?? 0
    if (rv > lv) {
      clocks[slot] = rv
      if (rMap.has(id)) result[id] = rMap.get(id)
    } else {
      clocks[slot] = lv
      if (lMap.has(id)) result[id] = lMap.get(id)
    }
  }
  return { value: result, clocks }
}

/* ------------------------------------------------------------------ *
 * 本地时钟持久化
 * ------------------------------------------------------------------ */

export function readSlotClocks(storageKey: string): LayoutSlotClocks {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: LayoutSlotClocks = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

export function writeSlotClocks(storageKey: string, clocks: LayoutSlotClocks): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(clocks))
  } catch {
    // 配额满 / 隐私模式：同步降级为"本标签页内有效"，不影响主流程
  }
}

/* ------------------------------------------------------------------ *
 * 跨标签页传输
 * ------------------------------------------------------------------ */

export interface LayoutSyncEnvelope<T> {
  clientId: string
  config: T
  clocks: LayoutSlotClocks
}

export interface LayoutSyncChannel<T> {
  publish(payload: LayoutSyncEnvelope<T>): void
  close(): void
}

/** 生成本标签页的稳定 id（刷新后变化，但足以区分同时打开的两个标签页） */
let CLIENT_ID: string | null = null
export function getLayoutClientId(): string {
  if (CLIENT_ID) return CLIENT_ID
  if (typeof window === 'undefined') return 'ssr'
  try {
    const existing = window.sessionStorage.getItem('navhub_layout_client_id')
    if (existing) {
      CLIENT_ID = existing
      return existing
    }
  } catch {
    // sessionStorage 不可用时继续走随机 id
  }
  const id = `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  CLIENT_ID = id
  try {
    window.sessionStorage.setItem('navhub_layout_client_id', id)
  } catch {
    // 忽略
  }
  return id
}

/**
 * 建立跨标签页通道。
 *
 * 优先 BroadcastChannel（同源、毫秒级、不落盘）；
 * 老 Safari 没有它，退回 storage 事件总线：把消息写进一个"总线键"，
 * 其它标签页靠 storage 事件拿到（storage 事件只在**其它**标签页触发，
 * 正好天然过滤掉自己的回声）。
 */
export function createLayoutSyncChannel<T>(
  onRemote: (payload: LayoutSyncEnvelope<T>) => void
): LayoutSyncChannel<T> {
  const clientId = getLayoutClientId()

  if (typeof window === 'undefined') {
    return { publish: () => {}, close: () => {} }
  }

  const busKey = `${LAYOUT_SYNC_CHANNEL}_bus`

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const ch = new BroadcastChannel(LAYOUT_SYNC_CHANNEL)
      ch.onmessage = (ev: MessageEvent) => {
        const data = ev.data as LayoutSyncEnvelope<T> | null
        // 忽略自己发出的回声
        if (!data || data.clientId === clientId) return
        onRemote(data)
      }
      return {
        publish(payload) {
          try {
            ch.postMessage({ ...payload, clientId })
          } catch {
            // 结构化克隆失败（config 里混入了函数等）：跳过本次广播
          }
        },
        close() {
          try {
            ch.close()
          } catch {
            // 忽略
          }
        },
      }
    } catch {
      // BroadcastChannel 构造失败 -> 落回 storage 事件总线
    }
  }

  const handler = (e: StorageEvent) => {
    if (e.key !== busKey || !e.newValue) return
    try {
      const data = JSON.parse(e.newValue) as LayoutSyncEnvelope<T>
      if (!data || data.clientId === clientId) return
      onRemote(data)
    } catch {
      // 总线上的脏数据，忽略
    }
  }
  window.addEventListener('storage', handler)

  return {
    publish(payload) {
      try {
        // 附加 nonce：即使两次消息内容相同，storage 事件也一定会触发
        window.localStorage.setItem(
          busKey,
          JSON.stringify({ ...payload, clientId, _n: Math.random().toString(36).slice(2) }),
        )
      } catch {
        // 忽略
      }
    },
    close() {
      window.removeEventListener('storage', handler)
    },
  }
}
