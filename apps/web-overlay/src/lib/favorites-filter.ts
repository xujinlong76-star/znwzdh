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
export interface FilterableFavorite {
  title: string
  href: string
  description?: string
  /** 备注与标题/链接/描述同入检索范围（T16）：用户写的备注恰恰是检索线索 */
  note?: string
  /** 标签（T22）同入检索范围 */
  tags?: string[]
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
  const haystack = [item.title, item.href, item.description ?? '', item.note ?? '', (item.tags ?? []).join(' ')]
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
