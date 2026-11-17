/**
 * 插件市场分类浏览的数据口径（P2-2 / P2-12，2026-11-17）。
 *
 * 为什么单独抽一层纯函数：
 * - 分类着陆页、首页精选区、站内分类页三处入口共用同一份「分类 → 市场链接」
 *   映射，写在三处会 drift；这里是唯一事实源。
 * - 零新参数：所有 href 只用市场已有的 `q` / `kind` / `sort` 三个参数
 *   （`parseMarketplaceFilters` / `buildMarketplaceQuery` 的既有契约），
 *   不引入 `category` 参数——那是后续步骤，先不动 API。
 * - 不编数据：专题词与标签只用市场岛（plugin-market-board.tsx）里已实测
 *   有命中的词（`极客` 13 命中；HOT_TAGS 七枚均为种子真实标签）；
 *   `site-pack` 注册表已于 2026-11-15 卸载为空（见 apps/api 种子测试），
 *   这里只给它一个分类位，不承诺它有内容——着陆页按实时总数决定
 *   该 kind 是链接还是「暂无插件」纯文本，不造死入口。
 */
import {
  buildMarketplaceQuery,
  DEFAULT_MARKETPLACE_SORT,
  MARKETPLACE_KINDS,
  type MarketplaceFilterState,
  type MarketplaceKind,
} from './marketplace-filters'

export { MARKETPLACE_KINDS, type MarketplaceKind }

/** 分类着陆页路径：静态路由优先于 /marketplace/[slug]，不会被当成插件 slug。 */
export const MARKETPLACE_CATEGORIES_PATH = '/marketplace/categories'

export const MARKETPLACE_KIND_LABELS: Record<MarketplaceKind, string> = {
  'site-pack': '网站包',
  'workspace-preset': '工作台预设',
  theme: '主题',
  'search-pack': '搜索引擎包',
  bundle: '组合包',
}

/**
 * 每种 kind 的一句话说明（只描述形态，不承诺数量与内容）：
 * 与市场岛页头注释的三种形态定义同源——site-pack 是站点 + 分类 + 标签的
 * 声明式 JSON 包；workspace-preset 是 Bento 看板与模块组合；theme 是强调色
 * 与设计 token；search-pack 与 bundle 沿用岛内专题胶囊的既有叫法。
 */
export const MARKETPLACE_KIND_DESCRIPTIONS: Record<MarketplaceKind, string> = {
  'site-pack': '打包好的网站合集：站点、分类与标签一次装进导航',
  'workspace-preset': 'Bento 看板与模块组合，一键搭出工作台',
  theme: '强调色与设计 token，换一套站内配色',
  'search-pack': '搜索引擎合集，直达站内搜索与外部引擎',
  bundle: '多个插件打成精选组合，一次装齐一个场景',
}

function marketplaceHref(state: MarketplaceFilterState): string {
  return `/marketplace${buildMarketplaceQuery(state)}`
}

/** 某 kind 的浏览链接（复用 kind 参数）。 */
export function marketplaceKindHref(kind: MarketplaceKind): string {
  return marketplaceHref({ kind, q: '', sort: DEFAULT_MARKETPLACE_SORT, starred: false })
}

/**
 * 某 kind 的「分类内榜单」链接：复用既有 sort 参数（popular = 安装量榜），
 * 不是新参数；着陆页每张 kind 卡都挂这一条，P2-2「无分类内榜单」的最小解。
 */
export function marketplaceKindRankingHref(kind: MarketplaceKind): string {
  return marketplaceHref({ kind, q: '', sort: 'popular', starred: false })
}

/** 某搜索词的浏览链接（复用 q 参数）。 */
export function marketplaceSearchHref(q: string): string {
  return marketplaceHref({ kind: '', q, sort: DEFAULT_MARKETPLACE_SORT, starred: false })
}

export interface MarketplaceCategoryGroup {
  id: MarketplaceKind
  kind: MarketplaceKind
  title: string
  description: string
  /** 浏览链接：/marketplace?kind=… */
  href: string
  /** 分类内榜单：/marketplace?kind=…&sort=popular */
  rankingHref: string
}

export const MARKETPLACE_CATEGORY_GROUPS: MarketplaceCategoryGroup[] = MARKETPLACE_KINDS.map(
  (kind) => ({
    id: kind,
    kind,
    title: MARKETPLACE_KIND_LABELS[kind],
    description: MARKETPLACE_KIND_DESCRIPTIONS[kind],
    href: marketplaceKindHref(kind),
    rankingHref: marketplaceKindRankingHref(kind),
  }),
)

export interface MarketplaceTopicGroup {
  id: string
  title: string
  description: string
  /** 浏览链接：/marketplace?q=…（专题胶囊的同款参数） */
  href: string
}

/**
 * 按主题 / 标签浏览：全部复用市场岛已有的专题与热门标签。
 * - `极客`：岛内专题胶囊实测 13 命中的 q（B 批复核注释）；
 * - `#…` 七枚：岛内 HOT_TAGS，种子真实标签，点开走标签查询（q=#tag）。
 */
export const MARKETPLACE_TOPIC_GROUPS: MarketplaceTopicGroup[] = [
  {
    id: 'geek',
    title: '极客全栈装备',
    description: '开发、工具与全栈场景的插件合集',
    href: marketplaceSearchHref('极客'),
  },
  ...(['AI', '工作台', '搜索', '生活', '主题', '深色', '组合包'] as const).map((tag) => ({
    id: `tag-${tag}`,
    title: `#${tag}`,
    description: `带「${tag}」标签的插件`,
    href: marketplaceSearchHref(`#${tag}`),
  })),
]

export interface RelatedPluginLink {
  /** 展示给用户的查询词原文（如 `#AI` / `极客` / `工作台预设`），不编数量 */
  queryLabel: string
  /** 市场链接：只用 q / kind 参数 */
  href: string
}

/**
 * 站内分类名 → 插件市场相关入口。
 *
 * 只映射**已验证有命中**的词（专题胶囊与种子标签的交集），其余返回 null、
 * 调用方只给通用入口（按分类浏览 / 进入市场），不把用户送进一个
 * 「相关插件 0 个」的搜索页：
 * - `#AI` / `#学习` / `#生活` / `#创作者` / `#主题`：种子真实标签；
 * - `极客`：岛内专题实测 13 命中的 q；
 * - `search-pack` / `workspace-preset`：kind 本身就是分类，链接即该分类页。
 */
const RELATED_PLUGIN_RULES: Array<{ keywords: string[]; link: RelatedPluginLink }> = [
  {
    keywords: ['AI', '人工智能', '智能体'],
    link: { queryLabel: '#AI', href: marketplaceSearchHref('#AI') },
  },
  {
    keywords: ['极客', '全栈', '开发', '编程', '程序', '工程'],
    link: { queryLabel: '极客', href: marketplaceSearchHref('极客') },
  },
  {
    keywords: ['设计', '美化', '配色', '主题'],
    link: { queryLabel: '#主题', href: marketplaceSearchHref('#主题') },
  },
  {
    keywords: ['搜索', '引擎'],
    link: { queryLabel: '搜索引擎包', href: marketplaceKindHref('search-pack') },
  },
  {
    keywords: ['工作', '效率', '办公', '生产力'],
    link: { queryLabel: '工作台预设', href: marketplaceKindHref('workspace-preset') },
  },
  {
    keywords: ['学习', '教育', '考试', '学生', '课程'],
    link: { queryLabel: '#学习', href: marketplaceSearchHref('#学习') },
  },
  {
    keywords: ['生活', '购物', '美食', '旅行', '健康', '运动'],
    link: { queryLabel: '#生活', href: marketplaceSearchHref('#生活') },
  },
  {
    keywords: ['创作', '自媒体', '内容', '运营', '增长'],
    link: { queryLabel: '#创作者', href: marketplaceSearchHref('#创作者') },
  },
]

export function resolveRelatedPluginLink(categoryName: string): RelatedPluginLink | null {
  const name = (categoryName ?? '').trim()
  if (!name) return null
  for (const rule of RELATED_PLUGIN_RULES) {
    if (rule.keywords.some((keyword) => name.includes(keyword))) return rule.link
  }
  return null
}
