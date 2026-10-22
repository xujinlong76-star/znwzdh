import type { HubSite } from '@/lib/navhub-api'

export const SITE_DESCRIPTION_MIN = 20
export const SITE_DESCRIPTION_MAX = 160

/**
 * 站点详情 meta description：原始描述够长就直接用；少于 20 字时用真实字段
 * （站点名 / 分类名 / 标签）兜底，避免把「免费字体」这类碎片当摘要。
 * 不编造评分、排名、安装量，也不使用「最好 / 必备 / 第一」这类词。
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
  return `${site.title}：收录于${category}分类，提供官网入口、同类站点与标签导航。${tagPart}`.slice(
    0,
    SITE_DESCRIPTION_MAX,
  )
}
