import type { HubSite } from '@/lib/navhub-api'

/**
 * 榜单冷启动判定与展示策略（2026-11-21）。
 *
 * ## 为什么需要"双态"
 *
 * 实测数据库现状：全站 active 站点总 visit 只有 16（10 个站点有记录），
 * 插件 77 个里仅 10 个有安装、最高 2 次，且没有任何用户评价。
 * 在这种数据量下强行展示"热度榜"会造成两个后果：
 *
 *  1. **信任塌方**：Top 列表里出现"4 次热度""1 次热度"这种极小值，
 *     第 6-30 名干脆没有热度值——用户一眼看出榜单是假的。
 *  2. **名实不符**：标题写"全站技术风向标"，列表里却因为
 *     `ORDER BY trend_score DESC, visit_count DESC, sort ASC` 在
 *     全零数据上退化为 `sort ASC`（数据库插入顺序），
 *     于是 KPL、蓝领招聘、政务通报这类泛生活站在"技术风向标"里排前面。
 *
 * ## 处置原则
 *
 * 不伪造数据、也不假装有榜。未达门槛时诚实降级为"编辑部精选排序"，
 * 用**有证据的元数据**（开源 / 编辑推荐 / 所属领域 / 近期新收录）代替
 * 尴尬的极小热度值；达到门槛后自动切回真实热度。
 */

/** Top 10 站点总有效热度达到此值才算"真实热榜" */
export const HEAT_READY_MIN_TOTAL = 50
/** 或：至少有这么多站点存在有效热度记录 */
export const HEAT_READY_MIN_SITES = 10

export type HeatMode = 'cold' | 'live'

/** 一个站点的有效热度（visit 与 trend 取大者，任一项 > 0 即算有记录） */
export function siteHeat(site: Pick<HubSite, 'visitCount' | 'trendScore'>): number {
  const v = Number(site.visitCount ?? 0)
  const t = Number(site.trendScore ?? 0)
  // trendScore 是小数权重（如 0.594），放大后与 visit 同量级便于比较
  return Math.max(v, Math.round(t * 10))
}

/**
 * 判定当前应展示"冷启动精选态"还是"真实热榜态"。
 *
 * 只看前 10 名的有效热度：更靠后的名次本来就不该决定整体口碑，
 * 而且限 10 与产品口径（Top 10 总热度）一致。
 */
export function resolveHeatMode(sites: readonly Pick<HubSite, 'visitCount' | 'trendScore'>[]): HeatMode {
  const top = sites.slice(0, 10)
  const total = top.reduce((sum, s) => sum + siteHeat(s), 0)
  const withHeat = top.filter((s) => siteHeat(s) > 0).length
  return total >= HEAT_READY_MIN_TOTAL || withHeat >= HEAT_READY_MIN_SITES ? 'live' : 'cold'
}

/**
 * 冷启动态的精选排序权重。
 *
 * 目标：在没有任何真实热度的情况下，给出一张**有质量、可解释**的榜，
 * 而不是数据库插入顺序。权重来源都是站点自身已有的客观属性：
 *
 *   +40  编辑推荐（site.featured / weight 高）
 *   +20  开源（有跨类目属性标签）
 *   +15  近期新收录（30 天内）
 *   +10  有任意真实点击（哪怕只有 1 次，也说明不是死链）
 *   +sort 原序作最后的稳定兜底（避免同分时顺序抖动）
 *
 * 注意：这里**不**把 visit=1 展示成"1 次热度"——它只参与排序，不对外显示。
 */
export function curatedScore(site: HubSite, now = Date.now()): number {
  let score = 0
  const tags = (site.tags ?? []).map((t) => String(t).toLowerCase())
  // 开源：跨类目的客观属性，是最可靠的质量信号
  if (tags.includes('开源') || tags.includes('opensource')) score += 40
  // 有实时指标（GitHub stars / 版本号）说明是活跃维护的项目
  if (site.liveMetrics?.githubStars) score += 25
  // 近期新收录
  const created = site.createdAt ? new Date(site.createdAt).getTime() : 0
  if (created > 0 && now - created < 30 * 24 * 3600 * 1000) score += 20
  // 有任意真实点击（哪怕 1 次也说明不是死链），但不展示这个数字
  if (siteHeat(site) > 0) score += 15
  // 健康状态良好（health 是对象，看 ok 布尔）
  if (site.health?.ok) score += 10
  // 描述完整度（有中文简介说明录入质量高）
  if ((site.description ?? '').length >= 20) score += 5
  return score
}

/**
 * 冷启动态排序：精选权重降序，同分保持原序（稳定排序）。
 * 达标的实时态则由服务端 ORDER BY 决定，不经过这里。
 */
export function sortCurated<T extends HubSite>(sites: readonly T[], now = Date.now()): T[] {
  return [...sites].sort((a, b) => curatedScore(b, now) - curatedScore(a, now))
}

/**
 * 冷启动态展示的"元数据文案"——替代尴尬的 "1 次热度"。
 *
 * 只从**站点真实属性**里取，绝不编造：
 *   开源 / 编辑推荐 / 开放 API / 近期新收录 / 所属领域（首个标签）
 */
export function curatedBadge(site: HubSite, now = Date.now()): string {
  const tags = (site.tags ?? []).map((t) => String(t).toLowerCase())
  if (tags.includes('开源') || tags.includes('opensource')) return '开源'
  if (site.liveMetrics?.githubStars) return `★ ${site.liveMetrics.githubStars}`
  if (tags.includes('开放api') || tags.includes('api')) return '开放 API'
  const created = site.createdAt ? new Date(site.createdAt).getTime() : 0
  if (created > 0 && now - created < 30 * 24 * 3600 * 1000) return '近期新收录'
  const first = site.tags?.[0]
  return first ? String(first) : '精选'
}

/* ==========================================================================
 * 领域分榜（解决"文不对题"）
 * ========================================================================== */

export type RankDomain = 'all' | 'ai' | 'dev' | 'design' | 'life'

/**
 * 领域定义。
 *
 * 用**关键词匹配站点自身分类与标签**（不是硬编码站点名单），
 * 这样新增站点自动归位，不需要维护一张会过期的清单。
 */
export const RANK_DOMAINS: ReadonlyArray<{ id: RankDomain; label: string; keywords: readonly string[] }> = [
  { id: 'all', label: '全部精选', keywords: [] },
  {
    id: 'ai',
    label: 'AI 与大模型',
    keywords: ['ai', '大模型', 'llm', 'gpt', '机器学习', '深度学习', 'aigc', '智能体', 'agent', '模型'],
  },
  {
    id: 'dev',
    label: '研发与架构',
    keywords: ['开发', '编程', '框架', '数据库', 'devops', '云原生', '架构', '前端', '后端', '开源', 'api', '代码'],
  },
  {
    id: 'design',
    label: '设计与效率',
    keywords: ['设计', 'ui', 'ux', '素材', '图标', '效率', '协作', '办公', '工具', '排版'],
  },
  {
    id: 'life',
    label: '生活与资讯',
    keywords: ['生活', '资讯', '娱乐', '游戏', '视频', '短剧', '招聘', '政务', '医疗', '教育', '消费'],
  },
]

/** 把 URL 的 ?domain= 值归一成合法领域 id */
export function parseDomain(raw: string | undefined | null): RankDomain {
  const v = String(raw ?? '').toLowerCase()
  return (RANK_DOMAINS.find((d) => d.id === v)?.id ?? 'all') as RankDomain
}

/**
 * 按领域过滤站点。
 *
 * 匹配面 = 一级分类名 + 全部标签，全部转小写后做关键词包含判断。
 * 'all' 直接返回原数组（不复制）。
 */
export function filterByDomain<T extends HubSite>(sites: readonly T[], domain: RankDomain): T[] {
  if (domain === 'all') return sites as T[]
  const def = RANK_DOMAINS.find((d) => d.id === domain)
  if (!def || def.keywords.length === 0) return sites as T[]
  return sites.filter((s) => {
    const hay = (s.tags ?? []).map((t) => String(t)).join(' ').toLowerCase()
    return def.keywords.some((k) => hay.includes(k))
  })
}
