/**
 * 智能整理（P1 #6）：按意思把未分组的收藏自动归组，用户确认后才建夹、才移动。
 *
 * 痛点（见 research-2026-11-12.md #6）：手动分夹失败——"Read Later" 攒到
 * 1,400 条就找不到了；收藏夹里的文章"用搜索引擎比用自己的整理系统更
 * 容易找到"。本站已有手动收藏夹（lib/favorites-folders），但分组全靠手。
 *
 * 为什么是「向量 + 标签」两路信号，而不是只取一路：
 *
 * 1. 语义边（主信号）。浏览器里没有模型、也不建第二套 embedding
 *    （P0 #3 的决定仍在）：语义相似只能走中枢通道——对每个未分组收藏，
 *    用它的标题向 `GET /api/search?mode=semantic` 发一次探测查询，
 *    命中里（contributions 有 semantic 键，见 semanticSiteScores）出现
 *    的其它未分组收藏就是它的语义近邻。A 与 B 任一方向是近邻即连边，
 *    互为近邻更强——但命名与分组都不依赖"互为"，单向也算数。
 *    诚实边界：中枢语义索引只覆盖站点元数据（标题/描述），用户私有的
 *    备注/标签不在索引里——备注/标签只参与命名，不参与相似度。
 *    语义通道整个不可用时（neighbors 传 null）不返回任何建议：
 *    宁可诚实地说"暂不可用"，也不用纯关键词拼出假分组。
 *
 * 2. 标签边（补充信号）。用户自己打的标签是强分组证据：两个收藏共用
 *    同一个标签就连边。语义漏掉的（如标题写法差异大、但同属"做饭"）
 *    由标签补回来；理由文案会点名是哪一路证据，不混说。
 *
 * 命名只取真凭实据：组内共享标签 > 组内共享关键词 > 组内出现过的关键词
 * （取自成员真实的标题/描述/备注，绝不凭空编一个分组名）；连一个关键词
 * 都没有的组直接丢弃，不给它起名字。
 *
 * 本模块是纯函数（除底部的 dismissal 持久化小工具外）：不读 localStorage、
 * 不发请求——探测查询与落盘都在调用方（panel）做，便于单测。
 */
import { normalizeFolderName } from './favorites-folders'

/** 一组建议的最少成员数：单条成不了组 */
export const SMART_COLLECTIONS_MIN_GROUP_SIZE = 2
/** 一次最多展示的建议组数：再多用户也看不过来 */
export const SMART_COLLECTIONS_MAX_GROUPS = 5
/** 候选太少时不建议：3 条以下未分组收藏凑不出有意义的分组 */
export const SMART_COLLECTIONS_MIN_CANDIDATES = 3
/** 一次分析最多探测的未分组收藏数：每个候选要发一次语义请求，封顶防刷爆 */
export const SMART_COLLECTIONS_PROBE_LIMIT = 30
/** 已忽略的建议 id 的存储键（与收藏本体、收藏夹键都分开，丢了只影响"不再提示"） */
export const SMART_COLLECTIONS_DISMISSED_KEY = 'navhub.favorites.smart-collections.dismissed.v1'

export interface SmartCollectionItem {
  siteId: string
  title: string
  description?: string
  note?: string
  tags?: string[]
  folderId?: string | null
}

export type SmartCollectionReasonKind = 'semantic' | 'tag' | 'mixed'

export interface SuggestedCollection {
  /** 确定性 id：成员 siteId 排序后哈希——同一批成员在任何一次分析里都是同一个 id，忽略才持久有效 */
  id: string
  name: string
  memberIds: string[]
  reason: string
  reasonKind: SmartCollectionReasonKind
  /** 命名所用的共享标签（有的话）；理由文案与文件夹名都从它来 */
  sharedTag?: string
  /** 命名所用的关键词（无共享标签时）；一定是成员真实文本里的词 */
  sharedKeyword?: string
}

/** 命名用的通用词：出现频率再高也不能当分组名 */
const SMART_KEYWORD_STOPWORDS = new Set([
  '官网', '首页', '网站', '平台', '在线', '免费', '最新', '大全', '官方',
  '入口', '下载', '登录', '注册', '地址', '导航', '搜索',
  'the', 'and', 'www', 'com', 'http', 'https', 'app', 'site', 'online', 'free', 'best', 'top',
])

/**
 * 从一段文本里抽关键词：中文取连续 2 字以上的词串，拉丁取 2 字母以上的词。
 * 不做分词、不猜词义——只取"原样出现过"的词串，命名才有据可查。
 */
export function extractSmartKeywords(text: string): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  const re = /[\u4e00-\u9fff]{2,}|[a-z][a-z0-9_-]{1,}/g
  for (const match of String(text ?? '').toLowerCase().matchAll(re)) {
    const token = match[0]
    if (token.length < 2 || SMART_KEYWORD_STOPWORDS.has(token)) continue
    if (seen.has(token)) continue
    seen.add(token)
    found.push(token)
  }
  return found
}

/** 归一化标签：去空白 + 小写；空标签不算标签 */
export function normalizeSmartTag(tag: string): string | null {
  const normalized = String(tag ?? '').trim().toLowerCase()
  return normalized.length > 0 ? normalized : null
}

/** 确定性哈希（djb2）：同一批成员 id 永远得到同一个建议 id */
function hashMemberIds(memberIds: readonly string[]): string {
  let hash = 5381
  const joined = [...memberIds].sort().join('|')
  for (let i = 0; i < joined.length; i++) {
    hash = ((hash << 5) + hash + joined.charCodeAt(i)) >>> 0
  }
  return 'smart-' + hash.toString(36)
}

/**
 * 按意思建议分组。
 *
 * - 只看未分组的收藏（已有 folderId 的不参与——它们已经被用户安顿好了，
 *   再建议一次等于教用户推翻自己的决定）；
 * - `semanticNeighbors` 为 null 表示语义通道不可用 → 返回 []（调用方据此
 *   显示"暂不可用"的诚实空态，而不是用关键词拼假分组）；空 Map 表示
 *   通道可用但没有语义近邻，此时标签边仍可成组；
 * - 连通分量 < 最小組 size 的丢弃；组数封顶，大的组优先（成员多 = 证据多），
 *   同等大小按名称排序，保证同样输入永远得到同样输出。
 */
export function suggestSmartCollections(
  items: readonly SmartCollectionItem[],
  semanticNeighbors: ReadonlyMap<string, ReadonlySet<string>> | null,
  options?: { minGroupSize?: number; maxGroups?: number },
): SuggestedCollection[] {
  if (semanticNeighbors === null) return []
  const minGroupSize = options?.minGroupSize ?? SMART_COLLECTIONS_MIN_GROUP_SIZE
  const maxGroups = options?.maxGroups ?? SMART_COLLECTIONS_MAX_GROUPS
  const candidates = items.filter((item) => !item.folderId && item.siteId)
  if (candidates.length < SMART_COLLECTIONS_MIN_CANDIDATES) return []

  const byId = new Map(candidates.map((item) => [item.siteId, item]))
  const ids = candidates.map((item) => item.siteId)

  // 并查集：语义边 + 标签边都连通
  const parent = new Map(ids.map((id) => [id, id]))
  const find = (id: string): string => {
    let root = id
    while (parent.get(root) !== root) root = parent.get(root) as string
    let cur = id
    while (parent.get(cur) !== root) {
      const next = parent.get(cur) as string
      parent.set(cur, root)
      cur = next
    }
    return root
  }
  const union = (a: string, b: string): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  // 每条边的证据：组理由要分清是语义、标签还是两者都有
  const semanticEdgePairs = new Set<string>()
  const tagEdgePairs = new Set<string>()
  const pairKey = (a: string, b: string): string => (a < b ? a + '|' + b : b + '|' + a)

  for (const id of ids) {
    for (const neighbor of semanticNeighbors.get(id) ?? []) {
      if (neighbor === id || !byId.has(neighbor)) continue
      union(id, neighbor)
      semanticEdgePairs.add(pairKey(id, neighbor))
    }
  }
  const tagToIds = new Map<string, string[]>()
  for (const item of candidates) {
    for (const rawTag of item.tags ?? []) {
      const tag = normalizeSmartTag(rawTag)
      if (!tag) continue
      const list = tagToIds.get(tag) ?? []
      list.push(item.siteId)
      tagToIds.set(tag, list)
    }
  }
  for (const list of tagToIds.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        union(list[i] as string, list[j] as string)
        tagEdgePairs.add(pairKey(list[i] as string, list[j] as string))
      }
    }
  }

  const groups = new Map<string, string[]>()
  for (const id of ids) {
    const root = find(id)
    const list = groups.get(root) ?? []
    list.push(id)
    groups.set(root, list)
  }

  const suggestions: SuggestedCollection[] = []
  for (const memberIds of groups.values()) {
    if (memberIds.length < minGroupSize) continue
    const members = memberIds.map((id) => byId.get(id) as SmartCollectionItem)

    // 共享标签：出现次数最多、且至少 2 个成员共用；平局按标签字典序
    const tagCounts = new Map<string, { count: number; display: string }>()
    for (const member of members) {
      const seenInMember = new Set<string>()
      for (const rawTag of member.tags ?? []) {
        const tag = normalizeSmartTag(rawTag)
        if (!tag || seenInMember.has(tag)) continue
        seenInMember.add(tag)
        const prev = tagCounts.get(tag)
        tagCounts.set(tag, { count: (prev?.count ?? 0) + 1, display: rawTag.trim() })
      }
    }
    const sharedTags = [...tagCounts.entries()]
      .filter(([, v]) => v.count >= 2)
      .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0], 'zh-CN'))
    const bestTag = sharedTags[0]

    // 共享关键词：每个成员只计一次（一个长标题不能独占命名权）；平局按词典序
    const keywordCounts = new Map<string, number>()
    for (const member of members) {
      const text = [member.title, member.description ?? '', member.note ?? ''].join(' ')
      for (const keyword of extractSmartKeywords(text)) {
        keywordCounts.set(keyword, (keywordCounts.get(keyword) ?? 0) + 1)
      }
    }
    const sharedKeywords = [...keywordCounts.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    const allKeywords = [...keywordCounts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'),
    )

    // 命名：共享标签（覆盖至少一半成员才够格当组名）> 共享关键词 >
    // 组内出现过的关键词 > 无名可取则丢弃整组（不编名字）
    let name: string | null = null
    let sharedTag: string | undefined
    let sharedKeyword: string | undefined
    if (bestTag && bestTag[1].count * 2 >= members.length) {
      name = bestTag[1].display
      sharedTag = bestTag[1].display
    } else if (sharedKeywords[0]) {
      name = sharedKeywords[0][0]
      sharedKeyword = sharedKeywords[0][0]
      if (bestTag) sharedTag = bestTag[1].display
    } else if (bestTag) {
      name = bestTag[1].display
      sharedTag = bestTag[1].display
    } else if (allKeywords[0]) {
      name = allKeywords[0][0]
      sharedKeyword = allKeywords[0][0]
    }
    const normalizedName = name ? normalizeFolderName(name) : null
    if (!normalizedName) continue

    // 理由：只说真实证据。组内任一对成员有语义边 / 标签边就分别记下，
    // 两者都有就都说；没有哪一路就绝不提哪一路。
    let hasSemantic = false
    let hasTag = false
    for (let i = 0; i < memberIds.length && !(hasSemantic && hasTag); i++) {
      for (let j = i + 1; j < memberIds.length; j++) {
        const key = pairKey(memberIds[i] as string, memberIds[j] as string)
        if (semanticEdgePairs.has(key)) hasSemantic = true
        if (tagEdgePairs.has(key)) hasTag = true
      }
    }
    const reasonParts: string[] = []
    if (sharedTag) reasonParts.push(`共同标签「${sharedTag}」`)
    else if (sharedKeyword && sharedKeywords.length > 0) reasonParts.push(`共同关键词「${sharedKeyword}」`)
    if (hasSemantic) reasonParts.push('内容意思相近')
    const reasonKind: SmartCollectionReasonKind =
      hasSemantic && hasTag ? 'mixed' : hasTag ? 'tag' : 'semantic'

    const sortedMembers = [...memberIds].sort()
    suggestions.push({
      id: hashMemberIds(sortedMembers),
      name: normalizedName,
      memberIds: sortedMembers,
      reason: reasonParts.join(' · ') || '内容意思相近',
      reasonKind,
      ...(sharedTag ? { sharedTag } : {}),
      ...(sharedKeyword ? { sharedKeyword } : {}),
    })
  }

  suggestions.sort((a, b) => b.memberIds.length - a.memberIds.length || a.name.localeCompare(b.name, 'zh-CN'))
  return suggestions.slice(0, maxGroups)
}

/** 候选太少时的空态文案（未分组收藏数如实报，不凑数） */
export function describeTooFewForSmartCollections(ungroupedCount: number): string {
  return `未分组的收藏只有 ${ungroupedCount} 个，攒到 ${SMART_COLLECTIONS_MIN_CANDIDATES} 个以上再来智能整理。`
}

/** 语义不可用时的空态文案：不把"没建议"说成"没内容" */
export function describeSmartCollectionsUnavailable(): string {
  return '语义服务暂不可用，无法按意思分组。可以先手动建收藏夹，或稍后再试。'
}

/** 分析完仍无建议时的空态文案：给一个真实的下一步（打标签） */
export function describeNoSmartCollections(): string {
  return '没有找到内容相近、可以成组的收藏。给收藏打上相同的标签，标签相同的收藏更容易被归到一起。'
}

/* ---------------------------- 已忽略的建议 ---------------------------- */

/** 解析已忽略的建议 id：存储损坏 / 结构不符时返回空数组而不是抛错 */
export function parseDismissedIds(raw: string | null): string[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed.filter((id): id is string => typeof id === 'string' && id.length > 0)
}

export function serializeDismissedIds(ids: readonly string[]): string {
  return JSON.stringify([...new Set(ids)])
}

/** 忽略一条建议：已忽略的不重复记 */
export function addDismissedId(ids: readonly string[], id: string): string[] {
  if (!id || ids.includes(id)) return [...ids]
  return [...ids, id]
}

/** 建议列表去掉已忽略的（忽略是持久的：同一批成员不再重复出现） */
export function filterDismissedSuggestions<T extends { id: string }>(
  suggestions: readonly T[],
  dismissedIds: readonly string[],
): T[] {
  if (dismissedIds.length === 0) return [...suggestions]
  const dismissed = new Set(dismissedIds)
  return suggestions.filter((s) => !dismissed.has(s.id))
}
