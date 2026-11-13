/**
 * 「我的收藏」按意思找（"按意思搜"模式）。
 *
 * 评审结论（2026-11-12，见 research-2026-11-12.md #3）：
 * 关键词搜不到「意思」——收藏的标题未必包含用户脑子里的词
 * （如搜「做菜」时收藏夹里的「下厨房」）。本站已有的 ONNX 语义向量 +
 * FTS5 只覆盖站点元数据，收藏、历史、备注都不在索引里。
 *
 * 本模块的四个设计决定：
 *
 * 1. 嵌入范围——只做收藏（标题 / 描述 / 备注 / 标签 / 链接）。
 *    历史不进：站内没有存「访问历史内容」，只有 /api/search-history 的
 *    查询词串和服务端的点击计数——查询词不是「存下来的东西」，嵌它对
 *    「按意思找收藏」没有帮助。备注没有独立存储：备注就是
 *    LocalFavorite.note（≤200 字），作为收藏文本的一部分一起索引。
 *
 * 2. 向量存在哪——不新建。真正的 ONNX 向量（bge-small-zh-v1.5）继续
 *    留在服务端（packages/ai + packages/store 的 sqlite-vec / pgvector），
 *    这里复用已有的中枢通道：`GET /api/search?mode=semantic` 的召回与
 *    排序只来自语义近邻（见 packages/store/src/search.ts 的
 *    wantSemanticOnly），本模块只把返回的命中按 siteId 与本地收藏求交。
 *    中枢不知道的本地文本（备注、标签、自定义站点的标题/描述）用已有的
 *    本地全文匹配（favorites-filter.ts 的规则）补召回，并如实标注来源。
 *    浏览器里不下载模型、不建第二套 embedding、不持久化任何向量——
 *    收藏量级（几十到几百条）下每次查询现算即可。
 *
 * 3. 索引触发——惰性、按需。没有后台建索引任务：每次「按意思搜」查询
 *    （250ms 防抖、可取消）发一次语义请求（召回池 50 条，供求交用），
 *    再对内存里的收藏做本地全文匹配；收藏增删改后下一次查询自动用新
 *    列表重排。离线/中枢不可达时语义通道缺席，本地全文兜底仍在，且
 *    界面必须把这一点说出来（见状态机）。
 *
 * 4. UI 落点——收藏页筛选条旁的「关键词 / 按意思搜」切换。只在收藏页做：
 *    这里是用户「存下来的东西」所在的地方，也是痛点发生的地方。
 *    语义命中的排在前面（按中枢分数），本地匹配随后，并按匹配来源标注。
 *    排序在按意思模式下就是语义相关度，不再按时间/标题重排。
 */

import { matchesFavoriteQuery, parseFavoriteQuery, type FilterableFavorite } from './favorites-filter'

/** 收藏页的搜索方式：关键词（现有本地筛选）/ 按意思搜（本模块） */
export type SaveSearchMode = 'keyword' | 'meaning'

/** 一条收藏被「按意思搜」命中的来源——界面按它标注，不把全文匹配说成语义匹配 */
export type SaveMatchReason = 'semantic' | 'note' | 'tag' | 'keyword'

export interface RankedSave<T> {
  item: T
  reason: SaveMatchReason
  /** 仅语义命中时有：中枢返回的语义分数（越大越接近） */
  semanticScore?: number
}

/**
 * 语义通道的状态机。
 *
 * 模型加载路径（packages/ai/src/embedding.ts）是惰性加载：首次 encode
 * 才开始下载模型（约 24MB），`ready()` 在下载完成前一直是 false——
 * 中枢只报「语义不可用」，不区分「正在下载」与「未配置/已失败」。
 * 因此这里用「第几次语义请求」区分：第一次就报不可用，很可能只是模型
 * 还在首次下载，先报「准备中」并给重试；重试仍不可用才报「暂不可用」。
 * 这是端侧能做到的最诚实区分；想拿到真正的「下载中」信号，需要中枢
 * 在 /api/health 上加 loading 位（服务端改动，本轮 overlay-only 范围外）。
 */
export type SemanticSaveStatus = 'idle' | 'loading' | 'ready' | 'preparing' | 'unavailable'

/** 语义召回池：一次取 50 条与本地收藏求交，收藏通常远少于此 */
export const MEANING_SEARCH_POOL_LIMIT = 50

/**
 * 下一个语义状态（纯函数，可单测）。
 *
 * - 语义可用 → ready；
 * - 首次请求即不可用（prev idle/loading）→ preparing（模型可能在首次下载）；
 * - 曾经就绪、或已准备过一次仍不可用 → unavailable（不是首次下载了）。
 */
export function nextSemanticSearchStatus(
  prev: SemanticSaveStatus,
  semanticAvailable: boolean,
): 'ready' | 'preparing' | 'unavailable' {
  if (semanticAvailable) return 'ready'
  if (prev === 'idle' || prev === 'loading') return 'preparing'
  return 'unavailable'
}

/** 中枢命中里「语义通道召回」的最小形状（与 HubSearchHit 对齐的子集） */
export interface SemanticSearchHitLike {
  siteId: string
  score: number
  contributions?: Record<string, { rank: number; value: number }>
}

/**
 * 从中枢命中里抽出「语义召回」的 siteId → 分数。
 *
 * 判定口径与 /search 页的 semanticOnly 一致：contributions 里有 semantic
 * 键才是语义通道召回的证据。mode=semantic 下词法通道照跑、但候选在融合
 * 前被剔除，所以命中集合本身已是语义近邻；这里再卡一次键，是防着
 * contributions 为 {} 的兜底路径把「按标签列出」说成语义命中。
 * 同一 siteId 多条命中只留最高分。
 */
export function semanticSiteScores(
  hits: readonly SemanticSearchHitLike[] | null | undefined,
): Map<string, number> {
  const scores = new Map<string, number>()
  for (const hit of hits ?? []) {
    if (!hit || typeof hit.siteId !== 'string' || !Number.isFinite(hit.score)) continue
    if (!hit.contributions || !('semantic' in hit.contributions)) continue
    const prev = scores.get(hit.siteId)
    if (prev === undefined || hit.score > prev) scores.set(hit.siteId, hit.score)
  }
  return scores
}

/**
 * 本地全文命中的来源标注（最「个人」的字段优先）。
 *
 * 包含判定沿用 matchesFavoriteQuery 的 AND 规则（每个词都要命中、词可跨
 * 字段）；这里只决定「功劳算给谁」：任一词落在备注里 → note；否则任一词
 * 落在标签里 → tag；否则 → keyword（标题/描述/链接）。
 */
export function localMatchReason(item: FilterableFavorite, terms: readonly string[]): SaveMatchReason {
  const lowerTerms = terms.map((term) => term.toLowerCase())
  const note = (item.note ?? '').toLowerCase()
  if (lowerTerms.some((term) => term !== '' && note.includes(term))) return 'note'
  const tags = (item.tags ?? []).map((tag) => tag.toLowerCase())
  if (lowerTerms.some((term) => term !== '' && tags.some((tag) => tag.includes(term)))) return 'tag'
  return 'keyword'
}

/**
 * 按意思给收藏排序。
 *
 * 顺序：语义命中在前（按中枢分数降序）→ 本地全文匹配在后（保持原顺序）。
 * 语义命中不需要关键词重合——这正是「按意思找」相对关键词筛选的增量：
 * 搜「做菜」能找回标题里没有这两个字的「下厨房」。
 * 空查询返回原顺序（调用方此时本就不该用按意思模式；这里钉住行为，
 * 避免空串被当成「全量语义召回」）。
 */
export function rankSavesByMeaning<T extends FilterableFavorite & { siteId: string }>(
  items: readonly T[],
  query: string,
  semanticScores: ReadonlyMap<string, number>,
): RankedSave<T>[] {
  const trimmed = String(query ?? '').trim()
  if (!trimmed) return items.map((item) => ({ item, reason: 'keyword' as const }))
  const terms = parseFavoriteQuery(trimmed)
  if (terms.length === 0) return items.map((item) => ({ item, reason: 'keyword' as const }))

  const ranked: RankedSave<T>[] = []
  const used = new Set<string>()
  const semantic = items
    .filter((item) => semanticScores.has(item.siteId))
    .sort((a, b) => (semanticScores.get(b.siteId) ?? 0) - (semanticScores.get(a.siteId) ?? 0))
  for (const item of semantic) {
    used.add(item.siteId)
    ranked.push({ item, reason: 'semantic', semanticScore: semanticScores.get(item.siteId) })
  }
  for (const item of items) {
    if (used.has(item.siteId)) continue
    if (!matchesFavoriteQuery(item, trimmed)) continue
    ranked.push({ item, reason: localMatchReason(item, terms) })
  }
  return ranked
}

/** 按意思模式的结果计数文案：语义几条、本地几条分开说，不混成一个总数 */
export function describeMeaningResults<T>(matches: readonly RankedSave<T>[], total: number): string {
  const semanticCount = matches.filter((match) => match.reason === 'semantic').length
  const localCount = matches.length - semanticCount
  return `按意思找到 ${matches.length} / ${total} 个收藏（语义 ${semanticCount} · 备注 / 标签 / 关键词 ${localCount}）`
}

/**
 * 按意思搜「已就绪」时的状态行文案。
 *
 * 语义通道可用 ≠ 有语义命中：`nextSemanticSearchStatus` 只看
 * `res.semanticAvailable`，中枢返回的命中与本地收藏求交后可能一条都
 * 不剩——此时列表 100% 是本地全文匹配，`describeMeaningResults` 也会
 * 报「语义 0」。再写「已按语义相关度排序」就与计数行自相矛盾，还会
 * 让用户误以为拿到了语义结果；零语义命中时如实说结果是本地匹配。
 */
export function describeMeaningReadyLine(matches: readonly RankedSave<unknown>[] | null): string {
  const semanticCount = (matches ?? []).filter((match) => match.reason === 'semantic').length
  return semanticCount > 0 ? '已按语义相关度排序。' : '本次结果均为本地匹配（备注 / 标签 / 关键词）。'
}

/** 按意思搜的单条匹配来源标签（卡片上按匹配来源标注） */
export function saveMatchReasonLabel(reason: SaveMatchReason): string {
  switch (reason) {
    case 'semantic':
      return '语义匹配'
    case 'note':
      return '备注匹配'
    case 'tag':
      return '标签匹配'
    case 'keyword':
      return '关键词匹配'
  }
}

/** 按意思模式零结果时的标题（与关键词模式的 favoriteFilterEmptyMessage 区分） */
export function favoriteMeaningEmptyMessage(query: string): string {
  const trimmed = String(query ?? '').trim()
  return trimmed ? `按意思没找到匹配「${trimmed}」的收藏` : '按意思没找到匹配的收藏'
}
