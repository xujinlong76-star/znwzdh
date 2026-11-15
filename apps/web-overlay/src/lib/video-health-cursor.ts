/**
 * 视频健康巡检的游标分页（全库覆盖 + 断点续扫）。
 *
 * 背景：`sweepVideoHealth` 原来是 `slice(0, maxItems)`（路由默认 30、上限 500），
 * 6007 条的库永远只扫得到前几十条，剩下的死链永不被发现；一轮被掐断就从头再来，
 * 也没有“扫到哪”的记录。
 *
 * 游标是不透明字符串（base64url 编码的 JSON），调用方只负责原样传回，不解析：
 *   { v: 1, runId, lastId, scanned }
 * - `runId`：一轮全库巡检的编号；同一轮的各页共享它，断点续扫回来还是同一轮，
 *   这样“本轮已扫 / 剩余”才能跨中断累加，而不是每次中断都另起一轮。
 * - `lastId`：上一页最后一个已探测条目的 id；续扫时从它之后开始。
 * - `scanned`：本轮累计已扫条数。`lastId` 指向的条目在续扫前被删了（采集轮换删了它）
 *   时用 `scanned` 做位置兜底——库在两页之间几乎不变，偏移量仍指向正确位置；
 *   即使库有增减，最坏也只是下一轮全量再覆盖一次，不会死循环、不会漏报成“已完成”。
 *
 * 顺序是文档顺序（分类 → 子分类 → 条目），与 `sweepVideoHealth` 原来的扁平化顺序
 * 一致；只有带 `videoConfig` 的条目才进巡检分母（没有视频配置的条目无从探测，
 * 不计入 total，否则覆盖率永远到不了 100%）。
 */
import type { NavigationData, NavigationSubItem } from '@/types/navigation'

export interface HealthCursorState {
  v: 1
  /** 本轮巡检编号（`hs_` 前缀 + 时间 + 随机） */
  runId: string
  /** 上一页最后一个已探测条目的 id；第一页为 null */
  lastId: string | null
  /** 本轮累计已扫条数 */
  scanned: number
}

export interface HealthSweepCoverage {
  /** 本轮巡检编号 */
  runId: string
  /** 全库可探测条目总数（带 videoConfig 的条目数） */
  total: number
  /** 本轮累计已扫条数 */
  scanned: number
  /** 尚未探测的条数 */
  remaining: number
  /** 是否已扫完全库 */
  done: boolean
}

/** 以文档顺序扁平化全部可探测条目（带 videoConfig 的才进分母） */
export function flattenVideoItems(data: NavigationData): NavigationSubItem[] {
  const out: NavigationSubItem[] = []
  for (const cat of data.navigationItems ?? []) {
    for (const item of cat.items ?? []) {
      if (item.videoConfig) out.push(item)
    }
    for (const sub of cat.subCategories ?? []) {
      for (const item of sub.items ?? []) {
        if (item.videoConfig) out.push(item)
      }
    }
  }
  return out
}

export function newHealthRunId(): string {
  return `hs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function encodeHealthCursor(state: HealthCursorState): string {
  const json = JSON.stringify({ v: 1, runId: state.runId, lastId: state.lastId, scanned: state.scanned })
  return Buffer.from(json, 'utf8').toString('base64url')
}

/**
 * 解析游标。非法 / 被篡改 / 版本不对 → 返回 null（调用方按“新开一轮”处理，
 * 而不是报错——巡检入口收到脏游标不该 500，尤其不能因此把整轮巡检拦下来）。
 */
export function decodeHealthCursor(raw: string | null | undefined): HealthCursorState | null {
  if (!raw || typeof raw !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (!parsed || typeof parsed !== 'object') return null
    const { v, runId, lastId, scanned } = parsed as Record<string, unknown>
    if (v !== 1 || typeof runId !== 'string' || runId.length === 0) return null
    if (lastId !== null && typeof lastId !== 'string') return null
    if (typeof scanned !== 'number' || !Number.isFinite(scanned) || scanned < 0) return null
    return { v: 1, runId, lastId, scanned: Math.floor(scanned) }
  } catch {
    return null
  }
}

/**
 * 由游标算出本页起点下标。
 *
 * 首选 `lastId` 定位（条目增减不影响它之后的相对位置）；`lastId` 已不存在
 * （续扫前被删）时退到 `scanned` 偏移量，并钳在 `[0, total]` 内。
 * 空库时起点恒为 0。
 */
export function resolveHealthCursorStart(items: NavigationSubItem[], cursor: HealthCursorState | null): number {
  if (!cursor || cursor.lastId === null) {
    return cursor ? Math.min(cursor.scanned, items.length) : 0
  }
  const idx = items.findIndex((item) => item.id === cursor.lastId)
  if (idx >= 0) return idx + 1
  // lastId 已不存在：库在两页之间变了。
  // - scanned > total：库被清空/大幅缩水（6007 → 0 再重采），游标已过期，从头开始；
  // - 否则通常只是游标条目本身被删：它之后那条现在落在 scanned-1（用 scanned 会跳过一条）。
  // 兜底只能保证“不死循环、不把未扫报成已扫”，库中间被大批删改时漏掉的条目由下一轮新开全量覆盖。
  if (cursor.scanned > items.length) return 0
  return Math.max(0, cursor.scanned - 1)
}

export interface HealthPage {
  /** 本页要探测的条目 */
  page: NavigationSubItem[]
  /** 本页起点下标 */
  startIndex: number
  /** 本页结束后的游标；扫完全库时为 null */
  nextCursor: string | null
  coverage: HealthSweepCoverage
}

/**
 * 切出一页。`pageSize` 必须 ≥ 1；空库时返回空页 + `done: true` + `nextCursor: null`
 * （空库是一轮合法的巡检：报告 0 条待查，不报错、不造假）。
 */
export function pageVideoItems(
  items: NavigationSubItem[],
  cursor: HealthCursorState | null,
  pageSize: number,
): HealthPage {
  const size = Math.max(1, Math.floor(pageSize) || 1)
  const runId = cursor?.runId ?? newHealthRunId()
  const startIndex = resolveHealthCursorStart(items, cursor)
  const page = items.slice(startIndex, startIndex + size)
  const endIndex = startIndex + page.length
  const done = endIndex >= items.length
  const scanned = endIndex
  const nextCursor = done
    ? null
    : encodeHealthCursor({ v: 1, runId, lastId: page.length > 0 ? page[page.length - 1].id : cursor?.lastId ?? null, scanned })
  return {
    page,
    startIndex,
    nextCursor,
    coverage: {
      runId,
      total: items.length,
      scanned,
      remaining: Math.max(0, items.length - scanned),
      done,
    },
  }
}
