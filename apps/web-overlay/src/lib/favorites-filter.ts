/**
 * 「我的收藏」页面的本地筛选。
 *
 * 真实痛点：收藏页把 localStorage 里的收藏**一次性全部铺开**，没有任何筛选或搜索。
 * 收藏十几个还看得过来，攒到几十上百个（导航站的收藏增长很快）之后，
 * 想找某一个只能靠眼睛在网格里扫 —— 而这一页恰恰是"只想快速点开某个站"的场景。
 *
 * 为什么不做成全局搜索：全局检索走中枢（可能降级、要联网）；而收藏就在本地，
 * 已经全部在内存里了。这里的语义是**在本页已加载的收藏中过滤**，
 * 不联网、不改变结果集来源，因此也不需要「降级」提示。
 *
 * 匹配规则（刻意保持可预测）：
 *   - 关键词按空白拆成多个词，**每个词**都要命中（AND），词之间可跨字段；
 *   - 命中范围：标题 / 链接 / 描述 / 备注 / 标签，均不区分大小写（中文直接子串匹配）；
 *   - 空关键词 = 不过滤，并且**原样返回入参数组**（引用不变，避免无谓重渲染）。
 */
import { resolveTriageStatus, type TriageStatus, type TriageStatusLike } from './favorites-triage'
import type { FavoritesSort } from './favorites-url'
export interface FilterableFavorite {
  title: string
  href: string
  description?: string
  /** 备注与标题/链接/描述同入检索范围（T16）：用户写的备注恰恰是检索线索 */
  note?: string
  /** 标签（T22）同入检索范围 */
  tags?: string[]
  /** 快捷链接前缀：同入检索范围，搜 `gh` / `!gh` 能找回挂了模板的收藏 */
  quickPrefix?: string
}

/** 把用户输入拆成检索词：去空白、转小写、去重、丢掉空串 */
export function parseFavoriteQuery(query: string): string[] {
  const terms: string[] = []
  for (const raw of String(query ?? '').toLowerCase().split(/\s+/)) {
    if (raw && !terms.includes(raw)) terms.push(raw)
  }
  return terms
}

/** 单个收藏是否命中关键词（空关键词视为命中） */
export function matchesFavoriteQuery(item: FilterableFavorite, query: string): boolean {
  const terms = parseFavoriteQuery(query)
  if (terms.length === 0) return true
  const haystack = [item.title, item.href, item.description ?? '', item.note ?? '', (item.tags ?? []).join(' '), item.quickPrefix ? `!${item.quickPrefix}` : '']
    .join(' ')
    .toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

/**
 * 过滤收藏列表。
 *
 * 空关键词时返回**同一个数组引用**：调用方通常直接放进 `useMemo`，
 * 引用不变才不会让下游（网格、依赖数组）白重渲染一次。
 */
export function filterFavorites<T extends FilterableFavorite>(items: T[], query: string): T[] {
  const terms = parseFavoriteQuery(query)
  if (terms.length === 0) return items
  const filtered = items.filter((item) => matchesFavoriteQuery(item, query))
  return filtered.length === items.length ? items : filtered
}

/**
 * 给筛选结果配一句状态文案；没有关键词时返回 null（不该显示任何计数）。
 * 用户输入「找不到了」时最需要知道的是「是我的筛选把它藏起来了，还是它真的不在了」。
 */
export function describeFavoritesFilter(shown: number, total: number, query: string): string | null {
  if (parseFavoriteQuery(query).length === 0) return null
  return `匹配 ${shown} / ${total} 个收藏`
}

/** 筛选无结果时的提示（明确区别于「还没有收藏任何站点」） */
export function favoriteFilterEmptyMessage(query: string): string {
  const trimmed = String(query ?? '').trim()
  return trimmed ? `没有收藏匹配「${trimmed}」` : '没有收藏匹配当前条件'
}

/**
 * 按待读状态过滤（与 folderId / tags 正交，可与关键词筛选叠加）。
 * 'all' 原样返回入参数组（引用不变）；其余按 resolveTriageStatus 判定——
 * 缺字段的老收藏算 permanent，绝不会被扫进待读箱。
 * 已移出区的条目根本不在入参里（它们住在另一个键），所以搜不到。
 */
export function filterByTriage<T extends TriageStatusLike>(
  items: T[],
  status: TriageStatus | 'all',
  now: number = Date.now(),
): T[] {
  if (status === 'all') return items
  const filtered = items.filter((item) => resolveTriageStatus(item, now) === status)
  return filtered.length === items.length ? items : filtered
}

/**
 * 收藏排序（纯函数，返回新数组，不改入参）。
 *
 * 排序口径与页面旧的内联比较器逐字一致，只是把「最近打开」补进来：
 *  - 'created'：最近收藏在前（createdAt 倒序）。必须显式按时间戳排：
 *    数组现状依赖「toggle unshift + 云端 DESC」的隐式约定，明文导入 /
 *    金库恢复后顺序不再可信；
 *  - 'title'：按标题中文排序；
 *  - 'recent'：最近打开在前（lastOpenedAt 倒序）。没打开过的（缺字段 / 0）
 *    一律沉底，之间按 createdAt 倒序——老收藏没有打开记录是数据现实，
 *    不能把它们排在刚打开过的上面，也不能用 createdAt 冒充打开时间。
 * 未知排序值回退 'created'（与 URL 解析的非法回退同口径）。
 *
 * 为什么 lastOpenedAt 现在才够用：此前只有 ⌘K / 重温 / 久未打开入口点开
 * 才记 lastOpenedAt，主列表点卡不记（见 resurface.ts 的数据现实注释），
 * 「最近打开」排出来是残缺的。页面现已在主列表卡片点击时同步记一次，
 * 排序与记录同一轮次落地，缺口才算补上。
 */
export interface SortableFavorite {
  title: string
  createdAt: number
  /** 本机上次打开时间戳（毫秒）；缺字段 = 从未记录到打开 */
  lastOpenedAt?: number
}

/** 排序口径复用 URL 层的 FavoritesSort，不另起一套并集（否则两处易漂移）。 */
export function sortFavorites<T extends SortableFavorite>(items: T[], sort: FavoritesSort): T[] {
  const sorted = [...items]
  if (sort === 'title') {
    sorted.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
  } else if (sort === 'recent') {
    sorted.sort(
      (a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0) || (b.createdAt || 0) - (a.createdAt || 0),
    )
  } else {
    // 'created' 与未知值：最近收藏在前
    sorted.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  }
  return sorted
}
