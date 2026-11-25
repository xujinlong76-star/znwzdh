/**
 * Next.js 服务端 SimilarSites 多信号推荐引擎（原生中枢优先 + 零停机无缝降级）。
 *
 * 工作方式：
 *   1. 优先直连中枢（:8787）的 `/api/sites/:id/similar-insights`、`/api/similar/lookup`、
 *      `/api/similar/suggestions`（含 BGE 向量检索 + 用户收藏共现）；
 *   2. 若中枢尚未重启或处于滚动灰度期（上述新端点暂返回 404），自动复用中枢既有的
 *      `/api/sites`、`/api/categories`、`/api/rank/similar/:id`、`/api/sites/:id/relations`
 *      在服务端 60s 内存快照上实时运行同款 5 维多信号打分算法，做到零报错、零等待升级。
 *
 * 注：apps/web 不直接依赖 @navhub/core，因此本模块保持完全自包含。
 */
import { hubGet } from '@/lib/server/hub'
import type {
  HubSimilarQueryParams,
  HubSimilarScopeFilter,
  HubSimilarSiteMatch,
  HubSimilarSitesReport,
  HubSimilarSortBy,
  HubSimilarSuggestion,
  HubSite,
  HubSiteRelation,
} from '@/lib/navhub-api'

interface RawCategory {
  id: string
  parentId?: string | null
  title: string
  relatedCategories?: string[]
}

type EnrichedHubSite = HubSite & {
  weight?: number
  featured?: boolean
  sort?: number
}

interface SnapshotCache {
  loadedAt: number
  sites: EnrichedHubSite[]
  categories: RawCategory[]
}

const SNAPSHOT_TTL_MS = 60_000
let cachedSnapshot: SnapshotCache | null = null
let inflightSnapshot: Promise<SnapshotCache> | null = null

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'your', 'you', 'are', 'all',
  'http', 'https', 'www', 'com', 'org', 'net', 'io', 'app', 'dev', 'cn', 'ai', 'co',
  'site', 'web', 'online', 'official', 'home', 'index', 'html', 'page',
  '网站', '官网', '官方', '平台', '工具', '在线', '免费', '提供', '支持', '用户', '可以',
  '使用', '一个', '以及', '基于', '面向', '专注', '打造', '综合', '常用', '精选', '大全',
])

const OPEN_SOURCE_TAGS = new Set([
  '开源', 'open-source', 'opensource', 'oss', 'foss', 'self-hosted', '自托管', 'mit', 'apache', 'gpl',
])

function normalizeHost(raw: string): string {
  const trimmed = (raw || '').trim()
  if (!trimmed) return ''
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    return new URL(withProto).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return (
      trimmed
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .split(/[/?#]/)[0] ?? ''
    )
  }
}

function registrableDomain(host: string): string {
  const clean = normalizeHost(host)
  if (!clean) return ''
  const parts = clean.split('.').filter(Boolean)
  if (parts.length <= 2) return clean
  const lastTwo = parts.slice(-2).join('.')
  if (/^(com|org|net|gov|edu|ac)\.(cn|uk|jp|au|hk|tw)$/i.test(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join('.')
  }
  return lastTwo
}

function extractTokens(text: string): Set<string> {
  const tokens = new Set<string>()
  const normalized = (text || '').toLowerCase()
  if (!normalized) return tokens
  const ascii = normalized.match(/[a-z0-9][a-z0-9+.#-]{1,24}/g)
  if (ascii) {
    for (const raw of ascii) {
      const tok = raw.replace(/^[.-]+|[.-]+$/g, '')
      if (tok.length >= 2 && !STOPWORDS.has(tok)) tokens.add(tok)
    }
  }
  const cjk = normalized.match(/[\u4e00-\u9fa5]{2,}/g)
  if (cjk) {
    for (const seg of cjk) {
      if (seg.length <= 4 && !STOPWORDS.has(seg)) tokens.add(seg)
      for (let i = 0; i < seg.length - 1; i++) {
        const bg = seg.slice(i, i + 2)
        if (!STOPWORDS.has(bg)) tokens.add(bg)
      }
    }
  }
  return tokens
}

function diceSim(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let common = 0
  const [small, big] = a.size <= b.size ? [a, b] : [b, a]
  for (const tok of small) if (big.has(tok)) common++
  return (2 * common) / (a.size + b.size)
}

function siteBlob(site: HubSite): string {
  const stem = normalizeHost(site.url).replace(/\.(com|org|net|io|cn|dev|app|ai|co)$/i, '')
  return [site.title, site.titleEn ?? '', site.description ?? '', stem, ...(site.tags ?? [])].join(' ')
}

function isOpenSourceSite(site: HubSite): boolean {
  if (site.liveMetrics?.openSource) return true
  const pricing = site.facets?.pricing ?? []
  if (pricing.some((v) => /开源|open.?source|foss/i.test(v))) return true
  if ((site.tags ?? []).some((t) => OPEN_SOURCE_TAGS.has(t.trim().toLowerCase()))) return true
  const h = normalizeHost(site.url)
  return h === 'github.com' || h === 'gitlab.com' || h === 'codeberg.org'
}

function isHealthySite(site: HubSite): boolean {
  if (site.status && site.status !== 'active') return false
  if (site.health && site.health.ok === false) return false
  return true
}

function isSameBrand(target: HubSite, candidate: HubSite): boolean {
  const targetDom = registrableDomain(target.url)
  const candDom = registrableDomain(candidate.url)
  if (targetDom && candDom && targetDom === candDom) {
    const shared = new Set(['github.com', 'gitlab.com', 'gitee.com', 'github.io', 'vercel.app', 'netlify.app', 'pages.dev', 'notion.site', 'huggingface.co'])
    if (!shared.has(targetDom)) return true
    if (normalizeHost(target.url) !== normalizeHost(candidate.url)) return true
  }
  const targetBrand = (target.title || '').split(/[·\-—|｜(\uff08\s]/)[0]?.trim().toLowerCase() ?? ''
  const candTitle = (candidate.title || '').trim().toLowerCase()
  if (targetBrand.length >= 2 && candTitle !== targetBrand && candTitle.startsWith(targetBrand)) {
    const isAscii = /^[a-z0-9]+$/.test(targetBrand)
    if (!isAscii || targetBrand.length >= 4) {
      const nextChar = candTitle[targetBrand.length] ?? ''
      if (!isAscii || !/[a-z0-9]/.test(nextChar)) return true
    }
  }
  return false
}

function popularityScore(site: EnrichedHubSite): number {
  const visits = Math.max(0, Number(site.visitCount ?? 0))
  const trend = Math.max(0, Number(site.trendScore ?? 0))
  const weight = Math.max(0, Number(site.weight ?? 0))
  const stars = Math.max(0, Number(site.liveMetrics?.githubStars ?? 0))
  const featured = site.featured ? 30 : 0
  const sortBonus = (site.sort ?? 0) > 0 && (site.sort ?? 0) <= 50 ? (51 - (site.sort ?? 0)) * 0.4 : 0
  return Math.log1p(visits) * 18 + trend * 12 + Math.log1p(weight) * 8 + Math.log1p(stars) * 3.5 + featured + sortBonus
}

function buildRankings(sites: readonly EnrichedHubSite[]) {
  const scored = sites
    .map((s) => ({
      id: s.id,
      categoryId: s.categoryId ?? '',
      score: popularityScore(s),
      sort: s.sort ?? 9999,
      createdAt: s.createdAt ?? 0,
    }))
    .sort((a, b) => b.score - a.score || a.sort - b.sort || b.createdAt - a.createdAt)

  const siteRankById = new Map<string, number>()
  const categoryRankById = new Map<string, number>()
  const categoryTotalById = new Map<string, number>()

  for (let i = 0; i < scored.length; i++) {
    const row = scored[i]!
    siteRankById.set(row.id, i + 1)
    const next = (categoryTotalById.get(row.categoryId) ?? 0) + 1
    categoryTotalById.set(row.categoryId, next)
    categoryRankById.set(row.id, next)
  }
  return { siteRankById, categoryRankById, categoryTotalById, totalActiveSites: sites.length }
}

function calibratePercent(rawScore: number, hasStrongSignal: boolean): number {
  if (rawScore <= 0) return 0
  const boosted = hasStrongSignal ? 0.42 + rawScore * 0.58 : Math.pow(Math.min(1, rawScore), 0.78) * 0.94
  return Math.max(15, Math.min(99, Math.round(boosted * 100)))
}

async function loadCatalogSnapshot(): Promise<SnapshotCache> {
  const now = Date.now()
  if (cachedSnapshot && now - cachedSnapshot.loadedAt < SNAPSHOT_TTL_MS) {
    return cachedSnapshot
  }
  if (inflightSnapshot) return inflightSnapshot
  inflightSnapshot = (async () => {
    const pageOffsets = [0, 1000, 2000, 3000, 4000, 5000]
    const [categories, ...pages] = await Promise.all([
      hubGet<RawCategory[]>('/api/categories', 60),
      ...pageOffsets.map((offset) =>
        hubGet<HubSite[]>(`/api/sites?status=active&limit=1000&offset=${offset}`, 60),
      ),
    ])
    const seen = new Set<string>()
    const sites: HubSite[] = []
    for (const page of pages) {
      if (!Array.isArray(page)) continue
      for (const s of page) {
        if (!s || !s.id || seen.has(s.id) || s.status !== 'active') continue
        seen.add(s.id)
        sites.push(s)
      }
    }
    const snap: SnapshotCache = {
      loadedAt: Date.now(),
      sites,
      categories: Array.isArray(categories) ? categories : [],
    }
    cachedSnapshot = snap
    return snap
  })()
  try {
    return await inflightSnapshot
  } finally {
    inflightSnapshot = null
  }
}

async function loadVectorKnnFromHub(siteId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const res = await hubGet<{ hits?: Array<{ site?: { id?: string } | null; distance?: number; similarity?: number }> }>(
    `/api/rank/similar/${encodeURIComponent(siteId)}?limit=20`,
    60,
  )
  for (const h of res?.hits ?? []) {
    const id = h.site?.id
    if (!id || id === siteId) continue
    if (typeof h.similarity === 'number' && Number.isFinite(h.similarity)) {
      out.set(id, Math.max(0, Math.min(1, h.similarity)))
    } else if (typeof h.distance === 'number' && Number.isFinite(h.distance)) {
      // L2 / cosine distance 保守换算为 0..1 相似度
      const approx = h.distance <= 2 ? Math.max(0, 1 - (h.distance * h.distance) / 2) : 1 / (1 + h.distance)
      out.set(id, Math.max(0, Math.min(1, approx)))
    }
  }
  return out
}

function buildQueryString(params?: HubSimilarQueryParams): string {
  const sp = new URLSearchParams()
  if (params?.limit) sp.set('limit', String(params.limit))
  if (params?.scope && params.scope !== 'all') sp.set('scope', params.scope)
  if (params?.categoryId) sp.set('categoryId', params.categoryId)
  if (params?.openSource) sp.set('openSource', '1')
  if (params?.healthyOnly) sp.set('healthyOnly', '1')
  if (params?.excludeSameBrand) sp.set('excludeSameBrand', '1')
  if (params?.tag) sp.set('tag', params.tag)
  if (params?.sort && params.sort !== 'similarity') sp.set('sort', params.sort)
  return sp.toString()
}

function computeLocalTargetReport(
  target: HubSite,
  sites: readonly HubSite[],
  categories: readonly RawCategory[],
  relations: readonly HubSiteRelation[],
  vectorSimById: ReadonlyMap<string, number>,
  params: HubSimilarQueryParams,
  matchType: 'exact-site' | 'matched-site' = 'exact-site',
  rawQuery?: string,
): HubSimilarSitesReport {
  const limit = Math.max(1, Math.min(48, Math.trunc(params.limit ?? 24)))
  const scope: HubSimilarScopeFilter = params.scope ?? 'all'
  const sort: HubSimilarSortBy = params.sort ?? 'similarity'
  const catFilter = params.categoryId?.trim() || ''
  const tagFilter = params.tag?.trim().toLowerCase() || ''

  const catById = new Map<string, RawCategory>()
  for (const c of categories) catById.set(c.id, c)
  const resolveCat = (cid?: string | null) => {
    const cat = cid ? catById.get(cid) ?? null : null
    const parent = cat?.parentId ? catById.get(cat.parentId) ?? null : null
    return {
      categoryName: cat?.title ?? null,
      parentCategoryName: parent?.title ?? null,
      parentId: cat?.parentId ?? null,
      relatedIds: new Set(cat?.relatedCategories ?? []),
    }
  }

  const rankings = buildRankings(sites)
  const df = new Map<string, number>()
  for (const s of sites) {
    const seen = new Set<string>()
    for (const raw of s.tags ?? []) {
      const n = raw.trim().toLowerCase()
      if (!n || seen.has(n)) continue
      seen.add(n)
      df.set(n, (df.get(n) ?? 0) + 1)
    }
  }
  const tagIdf = new Map<string, number>()
  for (const [k, v] of df.entries()) {
    const rawIdf = Math.log(1 + sites.length / (1 + v))
    const isGenericTag = sites.length >= 50 && v / sites.length > 0.04
    tagIdf.set(k, isGenericTag ? rawIdf * 0.35 : rawIdf)
  }

  const targetCat = resolveCat(target.categoryId)
  const targetTagMap = new Map<string, string>()
  for (const raw of target.tags ?? []) {
    const t = raw.trim()
    if (t) targetTagMap.set(t.toLowerCase(), t)
  }
  const targetTokens = extractTokens(siteBlob(target))
  const targetOpenSource = isOpenSourceSite(target)
  const targetDomain = registrableDomain(target.url)

  const relById = new Map<string, HubSiteRelation>()
  const relByHost = new Map<string, HubSiteRelation>()
  for (const r of relations) {
    if (r.targetSiteId && !relById.has(r.targetSiteId)) relById.set(r.targetSiteId, r)
    const h = normalizeHost(r.targetUrl)
    if (h && !relByHost.has(h)) relByHost.set(h, r)
  }

  const hasAnyVector = vectorSimById.size > 0
  const scored: HubSimilarSiteMatch[] = []

  for (const cand of sites) {
    if (cand.id === target.id) continue
    const candCat = resolveCat(cand.categoryId)
    const sameCategory = Boolean(target.categoryId && cand.categoryId === target.categoryId)
    const sameParentCategory =
      !sameCategory &&
      Boolean(
        (targetCat.parentId && targetCat.parentId === candCat.parentId) ||
        targetCat.parentId === cand.categoryId ||
        candCat.parentId === target.categoryId,
      )
    const skosRelated =
      !sameCategory &&
      Boolean(
        (cand.categoryId && targetCat.relatedIds.has(cand.categoryId)) ||
        (target.categoryId && candCat.relatedIds.has(target.categoryId)),
      )

    const candTagNorms = new Set((cand.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))
    const sharedPairs: Array<{ label: string; idf: number }> = []
    let interW = 0
    let unionW = 0
    for (const [norm, label] of targetTagMap.entries()) {
      const w = tagIdf.get(norm) ?? 1
      unionW += w
      if (candTagNorms.has(norm)) {
        interW += w
        sharedPairs.push({ label, idf: w })
      }
    }
    for (const norm of candTagNorms) {
      if (!targetTagMap.has(norm)) unionW += tagIdf.get(norm) ?? 1
    }
    sharedPairs.sort((a, b) => b.idf - a.idf)
    const sharedTags = sharedPairs.map((p) => p.label)
    const specificityScale = Math.min(1, interW / (sites.length >= 50 ? 5.2 : 1.4))
    const tagScore =
      unionW > 0 && sharedTags.length > 0
        ? Math.min(1, (interW / unionW) * specificityScale * 1.35 + Math.min(0.22, sharedTags.length * 0.05))
        : 0

    const lexicalSim = diceSim(targetTokens, extractTokens(siteBlob(cand)))
    const vecSim = vectorSimById.get(cand.id) ?? null
    const semanticScore =
      vecSim !== null ? Math.min(1, vecSim * 0.72 + lexicalSim * 0.28) : Math.min(1, lexicalSim * 1.85)

    const categoryScore = sameCategory ? 1.0 : sameParentCategory ? 0.58 : skosRelated ? 0.48 : 0

    const candOpenSource = isOpenSourceSite(cand)
    const sharedFacets: string[] = []
    let fMatch = 0
    let fTotal = 0
    if (target.facets && cand.facets) {
      for (const [fk, tVals] of Object.entries(target.facets)) {
        const cVals = cand.facets[fk]
        if (!Array.isArray(tVals) || !Array.isArray(cVals) || !tVals.length || !cVals.length) continue
        fTotal++
        const cSet = new Set(cVals)
        let hit = false
        for (const v of tVals) {
          if (cSet.has(v)) {
            hit = true
            sharedFacets.push(v)
          }
        }
        if (hit) fMatch++
      }
    }
    if (targetOpenSource && candOpenSource) {
      sharedFacets.push('开源项目')
      fMatch += 0.6
      fTotal += 0.6
    }
    const facetScore = fTotal > 0 ? Math.min(1, fMatch / fTotal) : 0

    const candHost = normalizeHost(cand.url)
    const rel = relById.get(cand.id) ?? (candHost ? relByHost.get(candHost) : undefined) ?? null
    const relScore = rel
      ? rel.relationType === 'alternative'
        ? 1.0
        : rel.relationType === 'complementary' || rel.relationType === 'ecosystem'
          ? 0.72
          : 0.55
      : 0
    const sameBrand = isSameBrand(target, cand)
    const graphScore = Math.min(1, relScore)

    if (categoryScore === 0 && graphScore === 0 && tagScore < 0.25 && semanticScore < 0.32) continue

    const rawScore = categoryScore * 0.28 + semanticScore * 0.27 + tagScore * 0.23 + graphScore * 0.14 + facetScore * 0.08
    const hasStrong =
      rel?.relationType === 'alternative' ||
      (sameCategory && (sharedTags.length >= 1 || semanticScore >= 0.35)) ||
      (vecSim !== null && vecSim >= 0.72)
    const basePercent = calibratePercent(rawScore, hasStrong)
    const similarityPercent = sameBrand ? Math.max(20, basePercent - 10) : basePercent
    if (similarityPercent < 20) continue

    const uniqueTags = (cand.tags ?? [])
      .map((t) => t.trim())
      .filter((t) => t && !targetTagMap.has(t.toLowerCase()))
      .slice(0, 5)

    const reasons: string[] = []
    if (sameBrand) reasons.push('同品牌生态子站/关联服务')
    if (rel?.relationType === 'alternative') {
      reasons.push(rel.note ? `认证平替：${rel.note}` : '知识图谱认证对标平替')
    } else if (rel?.relationType === 'complementary' || rel?.relationType === 'ecosystem') {
      reasons.push(rel.note ? `生态关联：${rel.note}` : '同技术/内容生态搭配')
    }
    if (sharedTags.length > 0) {
      reasons.push(`共享 ${sharedTags.length} 个主题标签：${sharedTags.slice(0, 3).map((t) => `#${t}`).join(' ')}`)
    }
    if (sameCategory && candCat.categoryName) {
      reasons.push(`同属「${candCat.categoryName}」细分领域`)
    } else if (sameParentCategory && candCat.parentCategoryName) {
      reasons.push(`同属「${candCat.parentCategoryName}」大类跨子分类推荐`)
    }
    if (semanticScore >= 0.45 && reasons.length < 3) {
      reasons.push(vecSim !== null ? `语义向量高度相近 (${Math.round(semanticScore * 100)}%)` : `功能简介高度吻合 (${Math.round(semanticScore * 100)}%)`)
    }

    scored.push({
      site: cand,
      categoryName: candCat.categoryName,
      parentCategoryName: candCat.parentCategoryName,
      similarityPercent,
      siteRank: rankings.siteRankById.get(cand.id) ?? rankings.totalActiveSites,
      categoryRank: rankings.categoryRankById.get(cand.id) ?? 1,
      sameCategory,
      sameParentCategory,
      relationType: rel?.relationType ?? null,
      relationNote: rel?.note ?? null,
      isOpenSource: candOpenSource,
      isHealthy: isHealthySite(cand),
      isSameBrand: sameBrand,
      sharedTags,
      uniqueTags,
      sharedFacets: [...new Set(sharedFacets)].slice(0, 4),
      reasons: reasons.slice(0, 3),
      breakdown: {
        tags: Math.round(tagScore * 100),
        semantic: Math.round(semanticScore * 100),
        category: Math.round(categoryScore * 100),
        facets: Math.round(facetScore * 100),
        graph: Math.round(graphScore * 100),
      },
    })
  }

  scored.sort(
    (a, b) =>
      b.similarityPercent - a.similarityPercent ||
      b.sharedTags.length - a.sharedTags.length ||
      a.siteRank - b.siteRank,
  )
  const pool = scored.slice(0, Math.max(limit * 2, 60))

  const tagCounts = new Map<string, number>()
  const catCounts = new Map<string, { id: string; name: string; count: number }>()
  let sameCategoryCount = 0
  let crossCategoryCount = 0
  let openSourceCount = 0
  let healthyCount = 0
  let sameBrandCount = 0
  for (const item of pool) {
    if (item.sameCategory) sameCategoryCount++
    else crossCategoryCount++
    if (item.isOpenSource) openSourceCount++
    if (item.isHealthy) healthyCount++
    if (item.isSameBrand) sameBrandCount++
    for (const t of item.sharedTags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)
    const cid = item.site.categoryId ?? 'other'
    const prev = catCounts.get(cid)
    if (prev) prev.count++
    else catCounts.set(cid, { id: cid, name: item.categoryName ?? '其他分类', count: 1 })
  }

  const filtered = pool.filter((item) => {
    if (scope === 'same-category' && !item.sameCategory) return false
    if (scope === 'cross-category' && item.sameCategory) return false
    if (catFilter && item.site.categoryId !== catFilter) return false
    if (params.openSource && !item.isOpenSource) return false
    if (params.healthyOnly && !item.isHealthy) return false
    if (params.excludeSameBrand && item.isSameBrand) return false
    if (tagFilter && !item.sharedTags.some((t) => t.toLowerCase() === tagFilter)) return false
    return true
  })

  filtered.sort((a, b) => {
    switch (sort) {
      case 'popularity':
        return a.siteRank - b.siteRank || b.similarityPercent - a.similarityPercent
      case 'tags':
        return b.sharedTags.length - a.sharedTags.length || b.similarityPercent - a.similarityPercent
      case 'latency': {
        const la = a.site.health?.ok && typeof a.site.health.latencyMs === 'number' ? a.site.health.latencyMs : 999_999
        const lb = b.site.health?.ok && typeof b.site.health.latencyMs === 'number' ? b.site.health.latencyMs : 999_999
        return la - lb || b.similarityPercent - a.similarityPercent
      }
      case 'similarity':
      default:
        return b.similarityPercent - a.similarityPercent || a.siteRank - b.siteRank
    }
  })

  return {
    matchType,
    query: rawQuery ?? target.url,
    target: {
      site: target,
      categoryName: targetCat.categoryName,
      parentCategoryName: targetCat.parentCategoryName,
      siteRank: rankings.siteRankById.get(target.id) ?? rankings.totalActiveSites,
      totalActiveSites: rankings.totalActiveSites,
      categoryRank: rankings.categoryRankById.get(target.id) ?? 1,
      categoryTotal: rankings.categoryTotalById.get(target.categoryId ?? '') ?? 1,
      isOpenSource: targetOpenSource,
    },
    summary: {
      totalFound: pool.length,
      sameCategoryCount,
      crossCategoryCount,
      openSourceCount,
      healthyCount,
      sameBrandCount,
      topSharedTags: [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag, count]) => ({ tag, count })),
      categories: [...catCounts.values()].sort((a, b) => b.count - a.count).slice(0, 10),
      signalMode: hasAnyVector ? 'hybrid-vector' : 'hybrid-lexical',
    },
    items: filtered.slice(0, limit),
  }
}

function resolveQuerySite(rawQuery: string, sites: readonly HubSite[]) {
  const q = rawQuery.trim()
  if (!q) return null
  const lower = q.toLowerCase()
  const qHost = normalizeHost(q)
  const qDom = registrableDomain(qHost)
  const looksLikeUrl = /^[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(lower.replace(/^https?:\/\//, ''))

  const byId = sites.find((s) => s.id === q)
  if (byId) return { site: byId, matchType: 'exact-site' as const }

  if (looksLikeUrl && qHost) {
    const exactHost = sites.filter((s) => normalizeHost(s.url) === qHost)
    if (exactHost.length > 0) {
      exactHost.sort((a, b) => popularityScore(b) - popularityScore(a))
      return { site: exactHost[0]!, matchType: 'exact-site' as const }
    }
    if (qDom) {
      const domHits = sites.filter((s) => registrableDomain(s.url) === qDom)
      if (domHits.length > 0) {
        domHits.sort((a, b) => popularityScore(b) - popularityScore(a))
        return { site: domHits[0]!, matchType: 'matched-site' as const }
      }
    }
  }

  const exactTitle = sites.find(
    (s) => s.title.trim().toLowerCase() === lower || (s.titleEn ?? '').trim().toLowerCase() === lower,
  )
  if (exactTitle) return { site: exactTitle, matchType: 'exact-site' as const }

  const hits = sites.filter((s) => {
    const t = s.title.toLowerCase()
    const te = (s.titleEn ?? '').toLowerCase()
    const h = normalizeHost(s.url)
    return t.includes(lower) || te.includes(lower) || (lower.length >= 3 && h.startsWith(lower))
  })
  if (hits.length > 0) {
    hits.sort((a, b) => {
      const as = a.title.toLowerCase().startsWith(lower) || (a.titleEn ?? '').toLowerCase().startsWith(lower) ? 1 : 0
      const bs = b.title.toLowerCase().startsWith(lower) || (b.titleEn ?? '').toLowerCase().startsWith(lower) ? 1 : 0
      return bs - as || popularityScore(b) - popularityScore(a)
    })
    return { site: hits[0]!, matchType: 'matched-site' as const }
  }
  return null
}

function computeLocalTopicReport(
  rawQuery: string,
  sites: readonly HubSite[],
  categories: readonly RawCategory[],
  params: HubSimilarQueryParams,
): HubSimilarSitesReport {
  const limit = Math.max(1, Math.min(48, Math.trunc(params.limit ?? 24)))
  const q = rawQuery.trim()
  const lower = q.toLowerCase()
  const qTokens = extractTokens(q.replace(/^https?:\/\//i, '').replace(/^www\./i, ''))
  const catById = new Map<string, RawCategory>()
  for (const c of categories) catById.set(c.id, c)
  const rankings = buildRankings(sites)

  const items: HubSimilarSiteMatch[] = []
  for (const cand of sites) {
    const lexical = diceSim(qTokens, extractTokens(siteBlob(cand)))
    const matchedTags = (cand.tags ?? []).filter((t) => {
      const tl = t.toLowerCase()
      return lower.includes(tl) || tl.includes(lower) || qTokens.has(tl)
    })
    const tagScore = matchedTags.length > 0 ? Math.min(1, matchedTags.length * 0.35) : 0
    const semanticScore = Math.min(1, lexical * 2.1)
    const cat = cand.categoryId ? catById.get(cand.categoryId) ?? null : null
    const parent = cat?.parentId ? catById.get(cat.parentId) ?? null : null
    const catHit = cat && (cat.title.toLowerCase().includes(lower) || qTokens.has(cat.title.toLowerCase())) ? 0.65 : 0

    const rawScore = tagScore * 0.35 + semanticScore * 0.5 + catHit * 0.15
    if (rawScore < 0.08) continue

    const similarityPercent = calibratePercent(rawScore, matchedTags.length > 0)
    const reasons: string[] = []
    if (matchedTags.length > 0) reasons.push(`命中主题标签：${matchedTags.slice(0, 3).map((t) => `#${t}`).join(' ')}`)
    if (semanticScore >= 0.25) reasons.push(`内容关键词相关 (${Math.round(semanticScore * 100)}%)`)
    if (cat) reasons.push(`归属「${cat.title}」分类`)

    items.push({
      site: cand,
      categoryName: cat?.title ?? null,
      parentCategoryName: parent?.title ?? null,
      similarityPercent,
      siteRank: rankings.siteRankById.get(cand.id) ?? rankings.totalActiveSites,
      categoryRank: rankings.categoryRankById.get(cand.id) ?? 1,
      sameCategory: false,
      sameParentCategory: false,
      relationType: null,
      relationNote: null,
      isOpenSource: isOpenSourceSite(cand),
      isHealthy: isHealthySite(cand),
      isSameBrand: false,
      sharedTags: matchedTags,
      uniqueTags: (cand.tags ?? []).filter((t) => !matchedTags.includes(t)).slice(0, 5),
      sharedFacets: [],
      reasons: reasons.slice(0, 3),
      breakdown: {
        tags: Math.round(tagScore * 100),
        semantic: Math.round(semanticScore * 100),
        category: Math.round(catHit * 100),
        facets: 0,
        graph: 0,
      },
    })
  }

  items.sort((a, b) => b.similarityPercent - a.similarityPercent || a.siteRank - b.siteRank)
  const pool = items.slice(0, Math.max(limit * 2, 60))

  const tagCounts = new Map<string, number>()
  const catCounts = new Map<string, { id: string; name: string; count: number }>()
  let openSourceCount = 0
  let healthyCount = 0
  for (const item of pool) {
    if (item.isOpenSource) openSourceCount++
    if (item.isHealthy) healthyCount++
    for (const t of item.sharedTags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)
    const cid = item.site.categoryId ?? 'other'
    const prev = catCounts.get(cid)
    if (prev) prev.count++
    else catCounts.set(cid, { id: cid, name: item.categoryName ?? '其他分类', count: 1 })
  }

  return {
    matchType: 'topic-discovery',
    query: q,
    target: null,
    summary: {
      totalFound: pool.length,
      sameCategoryCount: 0,
      crossCategoryCount: pool.length,
      openSourceCount,
      healthyCount,
      sameBrandCount: 0,
      topSharedTags: [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag, count]) => ({ tag, count })),
      categories: [...catCounts.values()].sort((a, b) => b.count - a.count).slice(0, 10),
      signalMode: 'hybrid-lexical',
    },
    items: pool.slice(0, limit),
  }
}

export async function getSiteSimilarInsightsServer(
  siteId: string,
  params: HubSimilarQueryParams = {},
): Promise<HubSimilarSitesReport | null> {
  const qs = buildQueryString(params)
  const direct = await hubGet<HubSimilarSitesReport>(
    `/api/sites/${encodeURIComponent(siteId)}/similar-insights${qs ? `?${qs}` : ''}`,
    30,
  )
  if (direct && Array.isArray(direct.items)) return direct

  const [snapshot, targetSite, relRes, vectorSim] = await Promise.all([
    loadCatalogSnapshot(),
    hubGet<HubSite>(`/api/sites/${encodeURIComponent(siteId)}`, 60),
    hubGet<{ all?: HubSiteRelation[] }>(`/api/sites/${encodeURIComponent(siteId)}/relations`, 60),
    loadVectorKnnFromHub(siteId),
  ])
  const target = targetSite ?? snapshot.sites.find((s) => s.id === siteId) ?? null
  if (!target) return null
  return computeLocalTargetReport(
    target,
    snapshot.sites,
    snapshot.categories,
    relRes?.all ?? [],
    vectorSim,
    params,
  )
}

export async function lookupSimilarSitesServer(
  query: string,
  params: HubSimilarQueryParams = {},
): Promise<HubSimilarSitesReport | null> {
  const q = query.trim().slice(0, 200)
  if (!q) return null
  const sp = new URLSearchParams(buildQueryString(params))
  sp.set('q', q)
  const direct = await hubGet<HubSimilarSitesReport>(`/api/similar/lookup?${sp.toString()}`, 30)
  if (direct && Array.isArray(direct.items)) return direct

  const snapshot = await loadCatalogSnapshot()
  const resolved = resolveQuerySite(q, snapshot.sites)
  if (resolved) {
    const [relRes, vectorSim] = await Promise.all([
      hubGet<{ all?: HubSiteRelation[] }>(`/api/sites/${encodeURIComponent(resolved.site.id)}/relations`, 60),
      loadVectorKnnFromHub(resolved.site.id),
    ])
    return computeLocalTargetReport(
      resolved.site,
      snapshot.sites,
      snapshot.categories,
      relRes?.all ?? [],
      vectorSim,
      params,
      resolved.matchType,
      q,
    )
  }
  return computeLocalTopicReport(q, snapshot.sites, snapshot.categories, params)
}

export async function getSimilarSuggestionsServer(
  limit = 12,
): Promise<{ totalActiveSites: number; items: HubSimilarSuggestion[] }> {
  const direct = await hubGet<{ totalActiveSites: number; items: HubSimilarSuggestion[] }>(
    `/api/similar/suggestions?limit=${limit}`,
    120,
  )
  if (direct && Array.isArray(direct.items)) return direct

  const snapshot = await loadCatalogSnapshot()
  const catById = new Map<string, RawCategory>()
  for (const c of snapshot.categories) catById.set(c.id, c)
  const ranked = [...snapshot.sites].sort((a, b) => popularityScore(b) - popularityScore(a))
  const perParent = new Map<string, number>()
  const items: HubSimilarSuggestion[] = []
  for (const s of ranked) {
    const cat = s.categoryId ? catById.get(s.categoryId) : undefined
    const bucket = cat?.parentId ?? s.categoryId ?? 'other'
    const used = perParent.get(bucket) ?? 0
    if (used >= 2) continue
    perParent.set(bucket, used + 1)
    items.push({
      id: s.id,
      title: s.title,
      url: s.url,
      iconKey: s.iconKey ?? null,
      description: s.description ?? null,
      categoryName: cat?.title ?? null,
      tags: (s.tags ?? []).slice(0, 3),
    })
    if (items.length >= limit) break
  }
  return { totalActiveSites: snapshot.sites.length, items }
}
