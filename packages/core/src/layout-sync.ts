/**
 * 布局多端同步的纯算法层（按插槽 LWW + Lamport 逻辑时钟）
 *
 * 要解决的具体故障：多个标签页同时把首页当作起始页打开时，
 * 每个标签页都在失焦/关闭前把**整份配置 JSON** 覆盖写回本地存储。
 * 旧标签页最后写回的那份，会把新标签页刚调好的布局整个抹掉——
 * 用户看到的是"我刚拖好的顺序，切个标签页就没了"。
 *
 * 为什么不用整表 LWW：整表只有一个时间戳，赢家通吃，
 * 在 A 页改了配色、B 页改了分类顺序的场景下必然丢一半改动。
 *
 * 这里的粒度是**插槽（slot）**：
 *   - 标量字段（viewMode / accentColor …）→ 一个字段一个插槽
 *   - customCategories                    → 每个分类一个插槽（按 id）
 *   - pinnedSiteIdsByCategory             → 每个类目一个插槽（按类目 id）
 * 每个插槽带一个 Lamport 逻辑时钟，合并时逐插槽取时钟大者。
 *
 * 时钟为什么不放在 config 里：validateAndCleanDIYConfig 是白名单清洗，
 * 加进 config 的字段会在每次加载时被静默剔除。所以时钟独立存储。
 *
 * 纯算法、0 DOM 依赖，浏览器与 Node 通用（可在 packages/core/test 直接单测）。
 */

/** 插槽 -> 逻辑时钟 */
export type LayoutSlotClocks = Record<string, number>;

/** 元素级插槽的分隔符（避免与字段名的其它字符冲突） */
export const LAYOUT_SLOT_SEP = '::'

/** 需要按元素（而非整字段）做 LWW 的容器字段 */
const ELEMENT_CONTAINER_FIELDS = new Set(['customCategories', 'pinnedSiteIdsByCategory'])

/** 不参与冲突裁决的字段：updatedAt 每次写入都变，不能当作"改动"依据 */
const NON_MERGEABLE_FIELDS = new Set(['updatedAt'])

export function slotKey(field: string, id?: string): string {
  return id === undefined ? field : `${field}${LAYOUT_SLOT_SEP}${id}`
}

/** 下一个 Lamport 时钟：所有已知插槽的最大值 +1 */
export function nextLamport(clocks: LayoutSlotClocks): number {
  let max = 0
  for (const k of Object.keys(clocks)) {
    const v = clocks[k]
    if (typeof v === 'number' && Number.isFinite(v) && v > max) max = v
  }
  return max + 1
}

/** 给指定插槽打上（单调递增的）时钟 */
export function bumpClocks(clocks: LayoutSlotClocks, slots: string[], lamport?: number): LayoutSlotClocks {
  const next: LayoutSlotClocks = { ...clocks }
  if (slots.length === 0) return next
  const v = lamport ?? nextLamport(clocks)
  for (const s of slots) {
    next[s] = Math.max(next[s] ?? 0, v)
  }
  return next
}

function stableStringify(v: unknown): string {
  // 只用于"值是否变了"的比较，不追求跨端一致，JSON.stringify 足够
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

/**
 * 算出本次改动涉及哪些插槽。
 *
 * 删除也要推进时钟：否则"我在 A 页删了这个分类"这条事实
 * 无法在合并时压过 B 页那个更旧的、仍然存在的分类。
 */
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
  /** 合并是否真的改变了本地状态（用于决定要不要触发 React 重渲染） */
  changed: boolean
}

/**
 * 按插槽 LWW 合并两端。
 *
 * 平局时保留本地：两个标签页的时钟可能同时推进到同一个值，
 * 若平局取远端，两个页面会无限互推（A 推给 B、B 又推回 A），
 * 表现为配置在两个值之间来回跳。取本地可以让这个循环立刻收敛。
 */
export function mergeLayoutSlots<T extends Record<string, any>>(
  local: LayoutMergeSide<T>,
  remote: LayoutMergeSide<T>
): LayoutMergeResult<T> {
  const lc = (local.config ?? {}) as Record<string, any>
  const rc = (remote.config ?? {}) as Record<string, any>
  const out: Record<string, any> = { ...lc }
  const clocks: LayoutSlotClocks = { ...local.clocks }
  let changed = false

  const keys = new Set([...Object.keys(lc), ...Object.keys(rc)])

  for (const k of keys) {
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

  // updatedAt 不参与裁决，取两侧较大值
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

  // --- 数组型（customCategories）：按 id 做元素级 LWW ---
  if (Array.isArray(localVal) || Array.isArray(remoteVal)) {
    const lArr = Array.isArray(localVal) ? localVal : []
    const rArr = Array.isArray(remoteVal) ? remoteVal : []
    const lMap = new Map<string, any>()
    for (const e of lArr) if (idOfElement(e)) lMap.set(idOfElement(e), e)
    const rMap = new Map<string, any>()
    for (const e of rArr) if (idOfElement(e)) rMap.set(idOfElement(e), e)

    // 顺序：本地顺序优先，远端独有的追加在后（与 mergeDIYLayoutConfigs 一致）
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
        if (rMap.has(id)) result.push(rMap.get(id)) // 远端已删除 -> 不落回，即删除生效
      } else {
        clocks[slot] = lv
        if (lMap.has(id)) result.push(lMap.get(id))
      }
    }
    return { value: result, clocks }
  }

  // --- 字典型（pinnedSiteIdsByCategory）：按类目 id 做元素级 LWW ---
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
