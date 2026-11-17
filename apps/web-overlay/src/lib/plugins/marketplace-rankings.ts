import type { HubPluginItem } from '@/lib/navhub-api'

export type RankingGroupKey = 'trending' | 'popular' | 'rating' | 'fresh'

/**
 * /hot 插件 tab 复用的四组排行（与市场页同口径、同 limit）：
 * trending = 市场默认排序「7 天飙升榜」（sort=trending），其余三组
 * 与市场首页三榜一致（popular / rating / fresh）。
 */
export type PluginRankGroups = {
  trending: HubPluginItem[]
  popular: HubPluginItem[]
  rating: HubPluginItem[]
  fresh: HubPluginItem[]
}

/**
 * 榜单 metric：只说有证据的话。
 *
 * 0 安装/0 评价时不拿“精选/审计通过”填充——全新库里种子包安装/评价
 * 全为 0，榜单前 5 照样上榜，兜底文案等于凭空发认证（F-1）。
 * 卡片上的“精选”徽章是 gated 的（仅 plugin.featured 时显示），榜单
 * 文案也必须守同一条线：没数据就说没数据。
 */
export function rankingMetric(key: RankingGroupKey, p: HubPluginItem): string {
  // 飙升分本身不对外展示：行内只报真实安装数，与 popular 同口径；
  // 顺序（飙升 vs 安装量）由取数时的 sort 决定，不由这里决定。
  if (key === 'popular' || key === 'trending') {
    if (p.installCount > 0) return `${p.installCount} 次安装`
    return '暂无安装'
  }
  if (key === 'rating') {
    if ((p.reviewCount ?? 0) > 0) {
      return `${(p.ratingAvg ?? 0).toFixed(1)} ★ · ${p.reviewCount} 评`
    }
    return '暂无评价'
  }
  return p.publishedAt ? new Date(p.publishedAt).toLocaleDateString('zh-CN') : '刚刚上架'
}
