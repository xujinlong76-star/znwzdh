/**
 * 搜索建议（search suggestions）—— 首页搜索框输入时的分组建议层（纯函数，可单测）。
 *
 * 背景（research #2「搜索建议 + 零结果救援」）：站内五路召回（精确 / FTS5 /
 * 拼音 / ONNX 语义 / 个人频率 + LinUCB）已经存在，但只在「结果列表」里生效；
 * 用户打字时没有任何建议可点，一次拼写错误就只剩空白的「未找到」。NN/g 的
 * 搜索 UX 要求：5–8 条分组建议、匹配词加粗、150–300ms 防抖、容错、零结果
 * 必须给纠错 + 相关分类 + 下一步。
 *
 * 本层只解决「建议」这一半（零结果页的纠错 / 相关分类 / 推荐在
 * search-results.tsx 里做）：
 *
 * 分组与顺序（建议区总上限 8 条，每组至多 2 条）：
 *   1. 历史搜索 —— 最近的查询优先（fetchSearchHistory 已按最近排序）；
 *   2. 精选专题 —— 已拉取的专题合集，点开即进专题页；
 *   3. 相关搜索 —— 中枢 /api/search 返回的 suggestions（已容错）。
 *
 * 刻意不含的三组：站点 / 插件 / DIY 操作——它们在建议区下方本来就有
 * 完整分组、且已进键盘导航，复制进来只会让面板翻倍、同一条出现两次。
 *
 * 容错（typo tolerance）：
 *   - 站点组复用中枢五路召回（含 fuzzy 放宽 + didYouMean），这里不建
 *     第二个搜索引擎；
 *   - 本地组（历史 / 专题）用 matchSuggestionText：归一化子串命中为主，
 *     Latin token 再加 Levenshtein 容错（长度 ≤4 允许 1 处，≥5 允许 2 处）。
 *     中文只走子串：中文错别字没有「差一个字母」的概念，拼音通道由中枢负责。
 *   - DIY 操作沿用已有的 matchDiyPaletteActions（关键词锚定），不改它的
 *     语义——改动会牵连 diy-palette-actions.test.ts 的既有契约。
 *
 * 防抖：建议直接由搜索框同一份防抖后的查询状态派生（SearchPalette 200ms，
 * 在 NN/g 的 150–300ms 区间内），本层不另起计时器、不发新请求：历史与
 * 专题是面板打开时已取到的数据，相关搜索随当次检索响应一起回来。
 */

export type SuggestionGroupKind = 'history' | 'collection' | 'related'

export interface SuggestionItem {
  /** 导航列表里的稳定 key（`suggestion-${key}`），渲染与键盘导航共用 */
  key: string
  kind: SuggestionGroupKind
  /** 展示文本；历史 / 相关搜索行采纳后即填进搜索框 */
  label: string
  /** 副文本（专题描述） */
  description?: string
  /** 专题行才有：点开直接进专题页，而不是采纳为查询词 */
  href?: string
}

export interface SuggestionGroup {
  kind: SuggestionGroupKind
  title: string
  items: SuggestionItem[]
}

/** 建议区总上限（NN/g：5–8 条） */
export const SUGGESTION_TOTAL_CAP = 8
/** 每组上限：分组均衡，不让一组挤掉其他组 */
export const SUGGESTION_GROUP_CAP = 2

/** 参与建议匹配的专题最小形态（HubCollection 的结构子集） */
export interface SuggestableCollection {
  id: string
  title: string
  slug: string
  description?: string | null
}

export interface BuildSearchSuggestionsInput {
  query: string
  /** 最近搜索（已按最近排序）；与当前查询相同的词不再建议 */
  history: string[]
  /** 已拉取的全部专题（面板聚焦时 fetchCollections 取到） */
  collections: SuggestableCollection[]
  /** 中枢返回的相关搜索词（已容错，见 /api/search 的 suggestions） */
  relatedSearches: string[]
}

/**
 * Levenshtein 编辑距离（输入都很短，朴素 DP 足够）。
 * 长度差已超过阈值时提前返回，避免无意义的整表计算。
 */
export function levenshtein(a: string, b: string, maxDistance?: number): number {
  if (a === b) return 0
  const la = a.length
  const lb = b.length
  if (la === 0) return lb
  if (lb === 0) return la
  if (maxDistance !== undefined && Math.abs(la - lb) > maxDistance) return maxDistance + 1
  // 只保留两行：短词查建议时每行最多几十个候选，没必要整表
  let prev = Array.from({ length: lb + 1 }, (_, j) => j)
  let cur = new Array<number>(lb + 1)
  for (let i = 1; i <= la; i++) {
    cur[0] = i
    const ca = a.charCodeAt(i - 1)
    for (let j = 1; j <= lb; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    const tmp = prev
    prev = cur
    cur = tmp
  }
  return prev[lb]
}

const LATIN_TOKEN = /^[a-z0-9]+$/

/** 单个 token 的容错匹配：子串命中，或 Latin token 的编辑距离在阈值内 */
function matchToken(token: string, haystack: string): boolean {
  if (haystack.includes(token)) return true
  // 太短的词不容错：否则 "go" 会匹配 "to"、"do" 等一切两字母词
  if (token.length < 3 || !LATIN_TOKEN.test(token)) return false
  const threshold = token.length <= 4 ? 1 : 2
  const candidates = haystack.split(/\s+/).filter(Boolean)
  // 去空白全文也比一次："reacthooks" 应该配上 "react hooks"
  const squashed = haystack.replace(/\s+/g, '')
  if (squashed.length > 0 && squashed.length <= 40) candidates.push(squashed)
  return candidates.some(
    (candidate) =>
      LATIN_TOKEN.test(candidate) && levenshtein(token, candidate, threshold) <= threshold,
  )
}

/**
 * 容错匹配：查询词与候选文本是否「算命中」。
 *
 * 多词查询按空白切分，每词都要命中（与检索的多词语义一致）：
 * 每词先走归一化子串（大小写不敏感，中文主路径），Latin 单词再走
 * 编辑距离容错。中文错别字与拼音输入不在本函数管辖：前者没有
 * 「差一个字母」的概念，后者由中枢 pinyin 通道负责。
 */
export function matchSuggestionText(query: string, text: string): boolean {
  const q = query.trim().toLowerCase()
  const t = text.trim().toLowerCase()
  if (!q || !t) return false
  return q
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => matchToken(token, t))
}

/**
 * 按「历史 → 专题 → 相关搜索」分组产出建议。
 *
 * - 空查询返回 []（空查询面板另有「最近搜索 / 常用站点 / 功能速览」，不走这里）；
 * - 与当前查询完全相同的词不建议（建议自己刚打的字是噪音）；
 * - 跨组按归一化文本去重（先出现的组优先，如历史里的 "react" 不会
 *   又在相关搜索里出现一次）；
 * - 每组至多 SUGGESTION_GROUP_CAP 条，总数至多 SUGGESTION_TOTAL_CAP 条。
 */
export function buildSearchSuggestions(input: BuildSearchSuggestionsInput): SuggestionGroup[] {
  const q = input.query.trim()
  if (!q) return []
  const normalizedQuery = q.toLowerCase()
  // 跨组按归一化文本去重（历史里的 "react" 不应又在相关搜索里出现一次）；
  // 专题按 id 去重（标题可能与某个历史词撞名，但它是一个可进的页面）。
  const seenLabels = new Set<string>()
  const seenCollectionIds = new Set<string>()
  const groups: SuggestionGroup[] = []
  let total = 0

  const pushGroup = (group: SuggestionGroup) => {
    if (group.items.length === 0 || total >= SUGGESTION_TOTAL_CAP) return
    const items = group.items.slice(0, Math.min(SUGGESTION_GROUP_CAP, SUGGESTION_TOTAL_CAP - total))
    groups.push({ ...group, items })
    total += items.length
  }

  // 1. 历史搜索：最近优先，容错匹配
  const historyItems: SuggestionItem[] = []
  for (const item of input.history) {
    const label = item.trim()
    if (!label || label.toLowerCase() === normalizedQuery) continue
    if (seenLabels.has(label.toLowerCase())) continue
    if (!matchSuggestionText(q, label)) continue
    seenLabels.add(label.toLowerCase())
    historyItems.push({ key: `history:${label.toLowerCase()}`, kind: 'history', label })
  }
  pushGroup({ kind: 'history', title: '历史搜索', items: historyItems })

  // 2. 精选专题：标题 / 描述 / slug 任一命中即入选
  const collectionItems: SuggestionItem[] = []
  for (const col of input.collections) {
    const haystack = `${col.title} ${col.description ?? ''} ${col.slug}`
    if (!matchSuggestionText(q, haystack)) continue
    if (seenCollectionIds.has(col.id)) continue
    seenCollectionIds.add(col.id)
    collectionItems.push({
      key: `collection:${col.id}`,
      kind: 'collection',
      label: col.title,
      description: col.description ?? undefined,
      href: `/collections/${encodeURIComponent(col.slug)}`,
    })
  }
  pushGroup({ kind: 'collection', title: '精选专题', items: collectionItems })

  // 3. 相关搜索：中枢已容错，这里只做去重与截断
  const relatedItems: SuggestionItem[] = []
  for (const item of input.relatedSearches) {
    const label = item.trim()
    if (!label || label.toLowerCase() === normalizedQuery) continue
    if (seenLabels.has(label.toLowerCase())) continue
    seenLabels.add(label.toLowerCase())
    relatedItems.push({ key: `related:${label.toLowerCase()}`, kind: 'related', label })
  }
  pushGroup({ kind: 'related', title: '相关搜索', items: relatedItems })

  return groups
}
