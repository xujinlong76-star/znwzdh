import type { HubSite } from '@/lib/navhub-api'

export const SITE_DESCRIPTION_MIN = 20
export const SITE_DESCRIPTION_MAX = 160

/**
 * 站点详情 meta description：原始描述够长就直接用；短于 20 字时**保留原句
 * 开头**、只补分类/标签等真实字段扩展到可读长度（与 categoryMetaDescription
 * 同一范式）。旧版整句丢弃换模板，导致 201/298 站（67.4%）的搜索摘要与分享
 * 卡片千篇一律、看不出各站是干什么的；业界共识也是每页摘要必须唯一具体，
 * 重复模板是最常见的失败。不编造评分、排名、安装量，也不使用「最好 / 必备 /
 * 第一」这类词。空描述时仍用站点名 + 真实字段兜底，绝不留白。
 */
export function siteMetaDescription(
  site: Pick<HubSite, 'title' | 'description' | 'tags'>,
  categoryName: string | null,
): string {
  const raw = (site.description ?? '').trim()
  if (raw.length >= SITE_DESCRIPTION_MIN) return raw.slice(0, SITE_DESCRIPTION_MAX)

  const category = categoryName?.trim() || '导航'
  const tags = (site.tags ?? [])
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 3)
  const tagPart = tags.length > 0 ? `相关标签：${tags.join('、')}。` : ''
  const suffix = `收录于${category}分类，提供官网入口、同类站点与标签导航。${tagPart}`
  // 短描述是真实编辑内容（多为 10–19 字的完整短句），保留原句开头再扩展；
  // 原句已带句末标点时不重复加「。」。
  if (raw.length > 0) {
    const sep = /[。？！.!?]$/.test(raw) ? '' : '。'
    return `${raw}${sep}${suffix}`.slice(0, SITE_DESCRIPTION_MAX)
  }
  return `${site.title}：${suffix}`.slice(0, SITE_DESCRIPTION_MAX)
}

/**
 * 分类页 title（2026-11-11，SEO_PLAN §二）。
 *
 * 旧模板「「X」工具与服务」两个问题：影音娱乐、网络小说等非工具分类也被叫
 * 「工具与服务」（与页面内容不符）；且把 title 这个最强的位置让给通用词，
 * 分类名本身的搜索词（「AI工具网站大全」「短剧网站大全」类搜法）没接住。
 * 改为「{分类名}网站大全」：分类名即关键词，「网站大全」是导航类页面的
 * 通用搜法后缀，对工具与非工具分类都成立。
 */
export function categoryMetaTitle(name: string): string {
  const n = (name ?? '').trim()
  if (!n) return '分类网站大全'
  if (/(大全|导航)$/.test(n)) return n
  return `${n}网站大全`
}

/** 分类自带描述达到这个长度视为编辑认真写过，原样用 */
export const CATEGORY_DESCRIPTION_MIN = 30

/**
 * 分类页 meta description：自带描述够长就用；太短（如 11 字的「大模型与
 * AI 产品矩阵」）时保留原句并拼上真实字段（收录数 / 子类名 / 代表站点），
 * 与 siteMetaDescription 同一条红线：不编造评分、排名，也不写「最好/第一」。
 */
export function categoryMetaDescription(input: {
  name: string
  rawDescription?: string | null
  total: number
  childNames?: string[]
  topSiteTitles?: string[]
}): string {
  const raw = (input.rawDescription ?? '').trim()
  if (raw.length >= CATEGORY_DESCRIPTION_MIN) return raw.slice(0, SITE_DESCRIPTION_MAX)

  const name = (input.name ?? '').trim() || '分类'
  const children = (input.childNames ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 4)
  const tops = (input.topSiteTitles ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 3)
  let composed = `「${name}」分类收录 ${input.total} 个网站`
  if (children.length > 0) composed += `，含 ${children.join('、')} 等子类`
  if (tops.length > 0) composed += `；代表站点：${tops.join('、')}`
  composed += '。可按标签筛选，进入详情查看简介与同类推荐。'

  const merged = raw.length >= 8 ? `${raw}。${composed}` : composed
  return merged.slice(0, SITE_DESCRIPTION_MAX)
}
