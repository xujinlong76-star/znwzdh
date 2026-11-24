/**
 * 官网卡片的判定与装配（纯函数，可单测）。
 *
 * 约定（品牌认官网第二步 W1，2026-11-24）：
 *  - 查询命中 50 家已核实品牌之一时，核实的官网卡片排在搜索结果第一位；
 *    其余排序一律不动——本模块不改 hits 顺序，只决定「要不要在结果顶部
 *    另起一张卡」，排序逻辑（lib/search-rerank.ts）一个字不碰。
 *  - 命中判定只认 lib/verified-brands.ts 的 findVerifiedBrandByQuery：
 *    含糊、多义、无命中一律返回 null，宁可不显示也不错认。
 *  - 官网链接永远是 `https://` + 规范域名（canonicalDomain），绝不用
 *    站内条目的 site.url 拼——站内 URL 可能带路径/旧域/镜像域。
 *  - 站内条目入口只是附加入口：仅当某条命中的站点 URL 主机与规范域名
 *    一致（`www.` 前缀差异不计）才给，链向站内 `/site/{id}`；找不到
 *    也不影响卡片本身（品牌已核实、站内未收录时卡片照常展示）。
 *  - 卡片不记录用户搜了什么：本模块不写任何搜索记录、不调任何接口，
 *    输入只有当前页已有的查询与结果。
 *  - 排序与拦截位绝不收费：本模块不含任何付费/推广逻辑。
 */

import { findVerifiedBrandByQuery, type VerifiedBrand } from './verified-brands'
import type { HubSearchHit } from './navhub-api'

/** 卡片上的站内条目入口（只取渲染需要的两个字段）。 */
export interface OfficialCardSiteEntry {
  id: string
  title: string
}

export interface OfficialCardData {
  /** 命中的已核实品牌（50 家名单内）。 */
  brand: VerifiedBrand
  /** 官网地址：`https://` + 规范域名，卡片「去官网」按钮唯一去向。 */
  officialUrl: string
  /** 该品牌在站内导航的条目（主机与规范域名一致时才有）；没有也不影响卡片。 */
  siteEntry: OfficialCardSiteEntry | null
}

/** 官网地址只认规范域名：`https://` + canonicalDomain，不拼 site.url。 */
export function officialUrlForBrand(brand: VerifiedBrand): string {
  return `https://${brand.canonicalDomain}`
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, '')
  } catch {
    return null
  }
}

/**
 * 主机是否同一站：只比整串主机名，`www.` 前缀差异不计；子域不算
 * （chat.deepseek.com ≠ deepseek.com）、后缀包含不算
 * （chatgpt.com.evil.com ≠ chatgpt.com），不给仿冒留口子。
 */
function isSameSiteHost(host: string, canonicalDomain: string): boolean {
  const stripWww = (h: string) => h.replace(/^www\./, '')
  return stripWww(host) === stripWww(canonicalDomain.toLowerCase())
}

/**
 * 在命中里找该品牌的站内条目：先查正常结果，再查巡检打不开分区
 * （401/403 反爬的大站也会落在这里，站内详情页本身仍可点）。
 * 只认 URL 主机与规范域名一致的命中；没有返回 null，不编造入口。
 */
export function findOfficialSiteEntry(
  brand: VerifiedBrand,
  hits: HubSearchHit[],
  unavailable: HubSearchHit[] = [],
): OfficialCardSiteEntry | null {
  for (const hit of [...hits, ...unavailable]) {
    const site = hit.site
    if (!site || !site.url) continue
    const host = hostOf(site.url)
    if (!host) continue
    if (isSameSiteHost(host, brand.canonicalDomain)) {
      return { id: site.id, title: site.title }
    }
  }
  return null
}

export interface ResolveOfficialCardInput {
  /** URL 上的原始查询词（已归一化）。 */
  query: string
  /**
   * 中枢纠正后的查询词（result.correction.corrected）：结果本身就是按
   * 纠正后的词查的，卡片跟结果走；没有纠正时传 null/undefined。
   * didYouMean 只是建议、未被采用，不算。
   */
  correctedQuery?: string | null
  /** 当前页码：卡片只在第 1 页展示，翻页不再重复。 */
  page: number
  /** 检索服务本次没有响应时不渲染卡片（结果区本身就是失败态）。 */
  failed: boolean
  /** 本页正常结果。 */
  hits: HubSearchHit[]
  /** 巡检打不开的字面命中（站内条目也可能落在这里）。 */
  unavailable?: HubSearchHit[]
}

/**
 * 判定本次搜索要不要在结果顶部放官网卡片。
 *
 * 返回 null 的情形（一个都不少，全是「不显示」）：
 *  - failed：检索服务没响应；
 *  - page !== 1：翻页不再重复；
 *  - 查询（纠正后为准）未命中 50 家已核实品牌：含糊查询不给官方卡。
 */
export function resolveOfficialCard(input: ResolveOfficialCardInput): OfficialCardData | null {
  if (input.failed) return null
  if (input.page !== 1) return null
  const effectiveQuery = input.correctedQuery ?? input.query
  const brand = findVerifiedBrandByQuery(effectiveQuery)
  if (!brand) return null
  return {
    brand,
    officialUrl: officialUrlForBrand(brand),
    siteEntry: findOfficialSiteEntry(brand, input.hits, input.unavailable ?? []),
  }
}
