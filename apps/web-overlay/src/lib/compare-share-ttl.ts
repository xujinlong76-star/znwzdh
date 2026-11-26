/**
 * 对比分享公开页的字段级新鲜度（P13，2026-11-26）。
 *
 * 只做纯函数：给公开页、JSON-LD 与单测共用同一口径，渲染层不得各写一份。
 *
 * TTL 分档（P13 方案，运营约定，须在方法论块里公开）：
 *   - 价格 / 套餐（price / pricing）：30 天；
 *   - 功能清单（platform / form）：90 天；
 *   - 官网域名与上线状态（maintenance）：180 天。
 * 注意：5 个可公开白名单字段里没有「官网域名」维——域名本身不在对照表里，
 * 180 天档目前只覆盖 maintenance（上线状态）；不要把域名 TTL 写成已落地的断言。
 *
 * 三态判定（红线：无 verified_at 或 verified !== true 的格子永远是「未核实」，
 * 绝不能渲染成已核实）：
 *   - verified：verified === true 且 verifiedAt 有效且在 TTL 内；
 *   - expired：verified === true 且 verifiedAt 有效但超出 TTL；
 *   - unverified：值为空，或 verified !== true，或 verifiedAt 缺失/非法。
 *
 * `stale`（price 格的历史标记，90–180 天未核实的旧口径）不参与判定：
 * 它是快照时刻按旧规则算出的派生标记，verifiedAt 才是带日期的证据；
 * 两者矛盾时以 verifiedAt + TTL 为准。
 */

import {
  formatCellValue,
  formatVerifiedDate,
  normalizeCellValue,
  type ComparisonCell,
} from '@/lib/compare'
import type { ShareableCompareField } from '@/lib/compare-share'

/** 字段级 TTL（天）。键与 SHAREABLE_COMPARE_FIELDS 同源，缺键即编程错误。 */
export const COMPARE_SHARE_FIELD_TTL_DAYS: Record<ShareableCompareField, number> = {
  pricing: 30,
  price: 30,
  platform: 90,
  form: 90,
  maintenance: 180,
}

/** 字段新鲜度三态。 */
export type CompareShareFieldState = 'verified' | 'expired' | 'unverified'

const DAY_MS = 24 * 60 * 60 * 1000

/** 某字段的 TTL（毫秒）；未知键返回 null（调用方按 unverified 处理，不编造）。 */
export function fieldTtlMs(key: string): number | null {
  const days = (COMPARE_SHARE_FIELD_TTL_DAYS as Record<string, number | undefined>)[key]
  if (typeof days !== 'number' || !Number.isFinite(days) || days <= 0) return null
  return days * DAY_MS
}

/**
 * 字段新鲜度三态。
 * `nowMs` 默认 Date.now()，单测注入固定时间；边界：now === verifiedAt + TTL
 * 仍算 verified（有效期含当日），超出才 expired。
 */
export function fieldFreshness(
  cell: ComparisonCell | null | undefined,
  key: string,
  nowMs: number = Date.now(),
): CompareShareFieldState {
  if (!cell) return 'unverified'
  if (normalizeCellValue(cell) === null) return 'unverified'
  if (cell.verified !== true) return 'unverified'
  const verifiedAt = cell.verifiedAt
  if (typeof verifiedAt !== 'number' || !Number.isFinite(verifiedAt)) return 'unverified'
  const ttl = fieldTtlMs(key)
  if (ttl === null) return 'unverified'
  return nowMs > verifiedAt + ttl ? 'expired' : 'verified'
}

/** 毫秒戳 → `YYYY-MM-DD`（Asia/Shanghai），非法返回 null（不编造日期）。 */
export function formatIsoDate(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms)) return null
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
}

export interface CompareShareCellDisplay {
  state: CompareShareFieldState
  /** 格子主值（与可见表格逐字一致，也是 JSON-LD 的唯一取值来源）。 */
  valueText: string
  /** 格子副行（来源 · 日期 · 状态，与可见表格逐字一致）。 */
  noteText: string
  /** 核实日期 `YYYY-MM-DD`，未核实/无日期时为 null。 */
  verifiedDateText: string | null
}

/**
 * 一个格子的完整可见文案（表格与 JSON-LD 的唯一来源，两边不得各算一份）。
 *   - verified：`来源：X · 核实于 YYYY/MM/DD`（沿用 CellValue 的副行口径）；
 *   - expired：灰显 + `来源：X · 截至 YYYY-MM-DD 核验，现待复核`；
 *   - unverified：`来源：X · 未验证`（无来源时 `来源未标注 · 未验证`）。
 */
export function compareShareCellDisplay(
  cell: ComparisonCell | null | undefined,
  key: string,
  nowMs: number = Date.now(),
): CompareShareCellDisplay {
  const state = fieldFreshness(cell, key, nowMs)
  const valueText = formatCellValue(cell)
  const sourceText = cell?.source?.trim() ? `来源：${cell.source.trim()}` : '来源未标注'
  const verifiedDateText = formatIsoDate(cell?.verifiedAt ?? null)
  const verifiedDateSlash = formatVerifiedDate(cell?.verifiedAt ?? null)
  let noteText: string
  if (state === 'verified') {
    noteText = verifiedDateSlash ? `${sourceText} · 核实于 ${verifiedDateSlash}` : sourceText
  } else if (state === 'expired') {
    noteText = verifiedDateText
      ? `${sourceText} · 截至 ${verifiedDateText} 核验，现待复核`
      : `${sourceText} · 已过期，现待复核`
  } else {
    noteText = `${sourceText} · 未验证`
  }
  return { state, valueText, noteText, verifiedDateText }
}
