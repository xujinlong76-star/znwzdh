/**
 * 搜索建议列表的客户端重排（纯函数，可单测）。
 *
 * 背景（专家诊断 P0，2026-11-20 实测）：
 *  - 中枢 /api/search 的 RRF 融合会给无意义词也返回一串弱语义命中
 *    （如 "zzzz不存在的站" 返回 12 条，全是 semantic 通道、分数 0.016~0.04），
 *    前端原样渲染等于拿弱相关冒充"找到 N 条"；
 *  - 精确名称命中没有被置顶（如 "Gemini" 首位曾是 Google AI for Developers
 *    而非 Google Gemini 本体）。
 *
 * 本模块只做前端重排，不改后端接口：
 *  1. 失效站点（status === 'broken'）永不进入建议列表。注意：health.ok === false
 *     不能当作失效——WAF 拦截站与从未巡检站的 ok 都是 false（Google Gemini
 *     本体就是 healthOk=false 的活站），真死链以 status=broken 为准
 *     （与 spotlight-modal 的「可能死链」口径一致）。
 *  2. 精确名称匹配置顶：标题本身就是查询词，或标题按词包含查询词
 *     （"Gemini" 命中 "Google Gemini"；中文按子串，如 "考研" 命中 "考研帮"）。
 *  3. 强匹配才算"有结果"：exact / pinyin / personal 通道直接算；fts 必须标题
 *     真含查询词（≥2 字 token），单字弱匹配（如 "在" 命中 "在行"）不算；
 *     纯语义（semantic-only）不算强匹配。没有强匹配时 ordered 为空，
 *     调用方据此渲染真空态，而不是把语义联想当成结果。
 *  4. 其余命中按 RRF 原序保留，语义联想单独进 related 组，调用方标注"相关推荐"。
 */

import type { HubSearchHit } from './navhub-api'

/** 失效站点：无 site 负载或 status=broken（批量巡检连续失败后置）。 */
export function isBrokenSearchHit(hit: HubSearchHit): boolean {
  const site = hit.site
  if (!site) return true
  return site.status === 'broken'
}

export function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * 查询词切 token：拉丁/数字连续串与中文连续串；长度 <2 的单字不算有效 token
 * （单字命中是弱匹配的主要来源，如 "在" 命中 "在行"）。
 */
export function searchQueryTokens(query: string): string[] {
  const norm = normalizeSearchText(query)
  const tokens = norm.match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) ?? []
  return tokens.filter((t) => t.length >= 2)
}

/**
 * 精确名称匹配：标题本身就是查询词，或标题按词包含查询词。
 * 拉丁词按整词命中（"Gemini" 命中 "Google Gemini"，不命中 "GeminiX"）；
 * 中文按子串命中（"考研" 命中 "考研帮"）。
 */
export function isExactNameMatch(hit: HubSearchHit, query: string): boolean {
  const site = hit.site
  if (!site || !site.title) return false
  const title = normalizeSearchText(site.title)
  const q = normalizeSearchText(query)
  if (!q) return false
  if (title === q) return true
  const words = title.split(/[^a-z0-9\u4e00-\u9fff]+/g).filter(Boolean)
  if (words.includes(q)) return true
  if (/[\u4e00-\u9fff]/.test(q) && title.includes(q)) return true
  return false
}

/**
 * 强匹配：值得当作"有结果"的命中。
 * exact / pinyin / personal 通道直接算；fts 必须标题真含查询词（≥2 字 token）；
 * 纯语义（semantic-only）不算。
 */
export function isStrongSearchHit(hit: HubSearchHit, query: string): boolean {
  const site = hit.site
  if (!site) return false
  const channels = hit.contributions ? Object.keys(hit.contributions) : []
  if (channels.includes('exact') || channels.includes('pinyin') || channels.includes('personal')) {
    return true
  }
  if (channels.includes('fts')) {
    const title = normalizeSearchText(site.title ?? '')
    const q = normalizeSearchText(query)
    if (title && q && title === q) return true
    const tokens = searchQueryTokens(query)
    if (tokens.some((t) => title.includes(t))) return true
  }
  return false
}

export interface RankedSearchHits {
  /** 精确名称匹配，置顶 */
  exact: HubSearchHit[]
  /** 强关键词匹配（exact/pinyin/personal 通道，或 fts 标题命中），RRF 原序 */
  keyword: HubSearchHit[]
  /** 其余命中（主要是语义联想），RRF 原序，调用方单独分组标注"相关推荐" */
  related: HubSearchHit[]
  /**
   * 可展示的全部命中（已剔除失效站点），按 exact → keyword → related 排好。
   * 没有强匹配时为空——调用方据此渲染真空态，而不是把弱相关当成结果。
   */
  ordered: HubSearchHit[]
  /** 是否存在强匹配（exact 或 keyword 非空） */
  hasStrongMatch: boolean
  /** 剔除失效站点后的命中数（含 related） */
  visibleCount: number
}

export function rankSearchHits(hits: HubSearchHit[], query: string): RankedSearchHits {
  const visible = hits.filter((h) => !isBrokenSearchHit(h))
  const exact: HubSearchHit[] = []
  const keyword: HubSearchHit[] = []
  const related: HubSearchHit[] = []
  for (const hit of visible) {
    if (isExactNameMatch(hit, query)) exact.push(hit)
    else if (isStrongSearchHit(hit, query)) keyword.push(hit)
    else related.push(hit)
  }
  const hasStrongMatch = exact.length + keyword.length > 0
  const ordered = hasStrongMatch ? [...exact, ...keyword, ...related] : []
  return { exact, keyword, related, ordered, hasStrongMatch, visibleCount: visible.length }
}
