/**
 * `/graph` 的 Cluster-First 抽样与图算法（纯函数，可单测）。
 *
 * 背景：旧抽样是 `sampleUniform` 步长均匀抽 24 站——站点在列表里均匀散开，
 * 共享标签的边却要求两站同时被抽中，于是超过一半节点是毫无连线的孤岛，
 * 用户第一眼看到的是一盘散沙，而不是「成团的生态」与「成对的平替」。
 *
 * 本模块把抽样改成「高连通子簇优先」：
 *   1. 先在抽样母体（全局 388 站或某个分类域/场景桶）上构建真实边——
 *      平替边 = 共享标签（与旧实现同一规则，`共享:${tag}`），
 *      生态边 = 同一子分类（与页面底部文案「同分类工具之间的关联」同一口径），
 *      生态边去重（已有平替边的不重复连）且每节点生态度封顶 2，避免团簇爆炸；
 *   2. 在连通分量内按共享标签切出高密度主题子簇（簇名 = 胶水标签 + 「簇」，
 *      如「ai视频簇」「开源簇」，完全由真实数据推导，不写死站点清单）；
 *   3. 优先抽 3–5 个子簇（每簇 3–6 站），再按连接度补齐到 24–36 站，
 *      孤立节点占比硬封顶 15%（超了就换掉，不凑数）。
 *
 * 换一批（round）：按 round 轮转候选子簇的选取顺序，同一 round 输出完全确定，
 * 不同 round 换一批子簇，但约束（簇数、孤立占比）始终成立。
 */

export interface ClusterSiteInput {
  id: string
  title: string
  href: string
  description?: string
  tags?: string[]
  categoryId?: string
}

export interface ClusterEdge {
  source: string
  target: string
  type: 'alternative' | 'ecosystem'
  label: string
}

export interface GraphCluster {
  /** 胶水标签（小写归一化后），如 "ai视频" */
  key: string
  /** 展示用簇名，如 "ai视频簇" */
  label: string
  /** 本次抽样中属于该簇的站点 id（已按连接度排过序） */
  siteIds: string[]
  /** 簇内已抽样成员之间的边数 */
  edgeCount: number
}

export interface ClusterSample {
  /** 本次抽样的站点（簇成员按簇分组在前，其余按连接度在后——圆周布局时同簇相邻） */
  sites: ClusterSiteInput[]
  /** 抽样站点之间的诱导边（两端都在 sites 内） */
  edges: ClusterEdge[]
  /** 本次抽中的子簇（3–5 个；母体太小、簇不够时如实变少） */
  clusters: GraphCluster[]
  /** 抽样站点中在诱导子图里无边的节点数 */
  isolatedCount: number
  /** isolatedCount / sites.length（sites 为空时为 0） */
  isolatedRatio: number
}

export interface SampleClusterFirstOptions {
  /** 目标站数（默认 24） */
  target?: number
  /** 上限站数（默认 36） */
  max?: number
  /** 换一批的轮次（默认 0）；同一 round 输出完全确定 */
  round?: number
  /** 目标子簇数（默认 3–5，取 min(5, max(3, …)) 的区间逻辑见实现） */
  minClusters?: number
  maxClusters?: number
  /** 每簇最多站数（默认 6） */
  maxPerCluster?: number
  /** 孤立占比硬上限（默认 0.15） */
  maxIsolatedRatio?: number
}

const DEFAULT_TARGET = 24
const DEFAULT_MAX = 36
const DEFAULT_MIN_CLUSTERS = 3
const DEFAULT_MAX_CLUSTERS = 5
const DEFAULT_MAX_PER_CLUSTER = 6
const DEFAULT_MAX_ISOLATED_RATIO = 0.15
/** 生态边：同一子分类内，每节点最多连这么多条，避免团簇爆炸 */
const MAX_ECO_DEGREE = 2

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase()
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/**
 * 在给定站点集合上构建真实边（与组件旧实现同一条口径，不编造关系）：
 * 平替边 = 两站共享的第一个标签（按 a 的标签顺序），label `共享:${tag}`；
 * 生态边 = 同一 categoryId（即同一子分类或同一顶级直属组）且尚未有平替边，
 * label `同域生态`，每节点生态度封顶 2。
 * 输入顺序决定一切：同一输入永远同一输出。
 */
export function buildGraphEdges(sites: readonly ClusterSiteInput[]): ClusterEdge[] {
  const tagMap = new Map<string, string[]>()
  for (const s of sites) {
    tagMap.set(s.id, (s.tags || []).map((t) => normalizeTag(String(t))).filter(Boolean))
  }
  const edges: ClusterEdge[] = []
  const altPairs = new Set<string>()
  for (let i = 0; i < sites.length; i++) {
    const a = sites[i]!
    const tagsA = tagMap.get(a.id) || []
    if (tagsA.length === 0) continue
    for (let j = i + 1; j < sites.length; j++) {
      const b = sites[j]!
      const tagsB = tagMap.get(b.id) || []
      const shared = tagsA.find((x) => tagsB.includes(x))
      if (!shared) continue
      edges.push({ source: a.id, target: b.id, type: 'alternative', label: `共享:${shared}` })
      altPairs.add(edgeKey(a.id, b.id))
    }
  }
  const ecoDegree = new Map<string, number>()
  for (let i = 0; i < sites.length; i++) {
    const a = sites[i]!
    if (!a.categoryId) continue
    for (let j = i + 1; j < sites.length; j++) {
      const b = sites[j]!
      if (!b.categoryId || b.categoryId !== a.categoryId) continue
      if (altPairs.has(edgeKey(a.id, b.id))) continue
      if ((ecoDegree.get(a.id) || 0) >= MAX_ECO_DEGREE) continue
      if ((ecoDegree.get(b.id) || 0) >= MAX_ECO_DEGREE) continue
      edges.push({ source: a.id, target: b.id, type: 'ecosystem', label: '同域生态' })
      ecoDegree.set(a.id, (ecoDegree.get(a.id) || 0) + 1)
      ecoDegree.set(b.id, (ecoDegree.get(b.id) || 0) + 1)
    }
  }
  return edges
}

/** 每节点的连接度（无向） */
export function degreeMap(edges: readonly ClusterEdge[]): Map<string, number> {
  const degree = new Map<string, number>()
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) || 0) + 1)
    degree.set(e.target, (degree.get(e.target) || 0) + 1)
  }
  return degree
}

/**
 * 连通分量（并查集）：返回按规模降序、规模相同时按最小 id 升序的 id 数组列表。
 * 孤立节点自成一个 size-1 分量（调用方自行过滤）。
 */
export function connectedComponents(
  ids: readonly string[],
  edges: readonly ClusterEdge[],
): string[][] {
  const parent = new Map<string, string>()
  for (const id of ids) parent.set(id, id)
  const find = (x: string): string => {
    let root = x
    while (parent.get(root) !== root) root = parent.get(root)!
    while (parent.get(x) !== root) {
      const next = parent.get(x)!
      parent.set(x, root)
      x = next
    }
    return root
  }
  for (const e of edges) {
    if (!parent.has(e.source) || !parent.has(e.target)) continue
    const ra = find(e.source)
    const rb = find(e.target)
    if (ra !== rb) parent.set(ra, rb)
  }
  const groups = new Map<string, string[]>()
  for (const id of ids) {
    const root = find(id)
    const list = groups.get(root)
    if (list) list.push(id)
    else groups.set(root, [id])
  }
  return [...groups.values()].sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length
    const aMin = [...a].sort()[0] || ''
    const bMin = [...b].sort()[0] || ''
    return aMin < bMin ? -1 : aMin > bMin ? 1 : 0
  })
}

/** 诱导边：两端都在给定 id 集内的边 */
export function inducedEdges(
  edges: readonly ClusterEdge[],
  idSet: ReadonlySet<string>,
): ClusterEdge[] {
  return edges.filter((e) => idSet.has(e.source) && idSet.has(e.target))
}

function countInducedIsolated(siteIds: readonly string[], edges: readonly ClusterEdge[]): number {
  const connected = new Set<string>()
  for (const e of edges) {
    connected.add(e.source)
    connected.add(e.target)
  }
  return siteIds.filter((id) => !connected.has(id)).length
}

/**
 * Cluster-First 抽样：优先抽 3–5 个高密度主题子簇，再按连接度补齐。
 * 保证（母体有足够连通节点时）：
 * - 抽样站数落在 [min(target, 母体数), max]；
 * - 子簇 3–5 个，每簇 3–6 站且簇内成员在诱导子图里互相连通（簇内边数 ≥ 簇成员数 - 1
 *   不保证——保证的是簇成员在原图里同属一个连通分量且共享胶水标签，诱导边数如实上报）；
 * - 诱导孤立占比 ≤ maxIsolatedRatio（超了就用未抽样的连通节点换掉孤立者，一轮修复）。
 * 母体 ≤ max 时一般全量返回（不丢站点），但孤立比超上限时只留封顶数的孤立站
 * （小分类/小场景桶第一眼也不能是一盘散沙）；全是孤立站时如实全量返回。
 */
export function sampleClusterFirst(
  sites: readonly ClusterSiteInput[],
  options: SampleClusterFirstOptions = {},
): ClusterSample {
  const target = Math.max(1, options.target ?? DEFAULT_TARGET)
  const max = Math.max(target, options.max ?? DEFAULT_MAX)
  const round = Math.max(0, Math.floor(options.round ?? 0))
  const minClusters = options.minClusters ?? DEFAULT_MIN_CLUSTERS
  const maxClusters = Math.max(minClusters, options.maxClusters ?? DEFAULT_MAX_CLUSTERS)
  const maxPerCluster = Math.max(3, options.maxPerCluster ?? DEFAULT_MAX_PER_CLUSTER)
  const maxIsolatedRatio = options.maxIsolatedRatio ?? DEFAULT_MAX_ISOLATED_RATIO

  const byId = new Map(sites.map((s) => [s.id, s]))
  const edges = buildGraphEdges(sites)
  const degree = degreeMap(edges)

  // 母体小：一般全量返回（不丢站点），簇照算、孤立比如实上报；
  // 但孤立比超上限时只留封顶数的孤立站、其余丢掉——小分类/小场景桶
  // 第一眼也不能是一盘散沙（与主路径同一封顶公式）；全是孤立站
  // （无连通节点可留）时如实全量返回——空图会让组件退回示例态，更差。
  if (sites.length <= max) {
    const allIds = sites.map((s) => s.id)
    const induced = inducedEdges(edges, new Set(allIds))
    const isolatedCount = countInducedIsolated(allIds, induced)
    const isolatedRatio = allIds.length === 0 ? 0 : isolatedCount / allIds.length
    const clusters = pickClusters(sites, edges, degree, {
      round,
      minClusters,
      maxClusters,
      maxPerCluster,
      limitTotal: sites.length,
    })
    if (isolatedRatio <= maxIsolatedRatio) {
      return {
        sites: [...sites],
        edges: induced,
        clusters,
        isolatedCount,
        isolatedRatio,
      }
    }
    const connectedIds = allIds.filter((id) => (degree.get(id) || 0) > 0)
    if (connectedIds.length === 0) {
      return {
        sites: [...sites],
        edges: induced,
        clusters,
        isolatedCount,
        isolatedRatio,
      }
    }
    const maxIsolates = Math.floor(
      (maxIsolatedRatio * connectedIds.length) / (1 - maxIsolatedRatio),
    )
    const keptSet = new Set([
      ...connectedIds,
      ...allIds.filter((id) => (degree.get(id) || 0) === 0).slice(0, maxIsolates),
    ])
    const finalSites = sites.filter((s) => keptSet.has(s.id))
    const finalEdges = inducedEdges(edges, keptSet)
    const finalClusters = clusters.map((c) => {
      const memberSet = new Set(c.siteIds.filter((id) => keptSet.has(id)))
      return {
        ...c,
        siteIds: c.siteIds.filter((id) => keptSet.has(id)),
        edgeCount: finalEdges.filter((e) => memberSet.has(e.source) && memberSet.has(e.target))
          .length,
      }
    })
    const finalIsolated = countInducedIsolated(
      finalSites.map((s) => s.id),
      finalEdges,
    )
    return {
      sites: finalSites,
      edges: finalEdges,
      clusters: finalClusters,
      isolatedCount: finalIsolated,
      isolatedRatio: finalSites.length === 0 ? 0 : finalIsolated / finalSites.length,
    }
  }

  // 候选子簇：按胶水标签分组（同一标签 ≥3 站），按簇内边数、规模排序，round 轮转。
  const clusters = pickClusters(sites, edges, degree, {
    round,
    minClusters,
    maxClusters,
    maxPerCluster,
    limitTotal: target,
  })

  const picked = new Set<string>()
  const pickedOrder: string[] = []
  for (const cluster of clusters) {
    for (const id of cluster.siteIds) {
      if (picked.has(id)) continue
      picked.add(id)
      pickedOrder.push(id)
    }
  }

  // 补齐：未抽样的连通节点按连接度降序（同度按输入顺序），补到 target。
  const connectedPool = sites
    .filter((s) => !picked.has(s.id) && (degree.get(s.id) || 0) > 0)
    .sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0))
  for (const s of connectedPool) {
    if (pickedOrder.length >= target) break
    picked.add(s.id)
    pickedOrder.push(s.id)
  }

  // 孤立节点：只有连通节点不够 target 时才补，且硬封顶 15%。
  // total = picked + isolates，isolates / total ≤ ratio  ⟹  isolates ≤ ratio * picked / (1 - ratio)。
  const maxIsolates = Math.floor(
    (maxIsolatedRatio * pickedOrder.length) / (1 - maxIsolatedRatio),
  )
  const isolatePool = sites.filter((s) => !picked.has(s.id) && (degree.get(s.id) || 0) === 0)
  let isolatesAdded = 0
  for (const s of isolatePool) {
    if (pickedOrder.length >= target) break
    if (isolatesAdded >= maxIsolates) break
    picked.add(s.id)
    pickedOrder.push(s.id)
    isolatesAdded++
  }

  // 一轮修复：若诱导孤立仍超上限，用未抽样的连通节点换掉多余的孤立者
  // （换入者须与已抽样集合有边，否则换了也白换）。
  const finalIds = [...pickedOrder]
  const repair = () => {
    const idSet = new Set(finalIds)
    const induced = inducedEdges(edges, idSet)
    const isolated = finalIds.filter((id) => {
      for (const e of induced) if (e.source === id || e.target === id) return false
      return true
    })
    const allowed = Math.floor(maxIsolatedRatio * finalIds.length)
    if (isolated.length <= allowed) return false
    const connected = new Set<string>()
    for (const e of induced) {
      connected.add(e.source)
      connected.add(e.target)
    }
    const surplus = isolated.slice(allowed)
    const replacements = sites.filter(
      (s) =>
        !idSet.has(s.id) &&
        (degree.get(s.id) || 0) > 0 &&
        edges.some(
          (e) =>
            (e.source === s.id && idSet.has(e.target)) ||
            (e.target === s.id && idSet.has(e.source)),
        ),
    )
    if (replacements.length === 0) return false
    replacements.sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0))
    let changed = false
    for (let i = 0; i < surplus.length && i < replacements.length; i++) {
      const idx = finalIds.indexOf(surplus[i]!)
      if (idx === -1) continue
      finalIds[idx] = replacements[i]!.id
      changed = true
    }
    return changed
  }
  repair()

  const finalSet = new Set(finalIds)
  const finalEdges = inducedEdges(edges, finalSet)
  const finalSites = finalIds.map((id) => byId.get(id)!).filter(Boolean)
  // 簇内边数按最终诱导边重算（修复换人后如实上报）。
  const finalClusters = clusters.map((c) => {
    const memberSet = new Set(c.siteIds.filter((id) => finalSet.has(id)))
    return {
      ...c,
      siteIds: c.siteIds.filter((id) => finalSet.has(id)),
      edgeCount: finalEdges.filter((e) => memberSet.has(e.source) && memberSet.has(e.target))
        .length,
    }
  })
  const isolatedCount = countInducedIsolated(finalIds, finalEdges)
  return {
    sites: finalSites,
    edges: finalEdges,
    clusters: finalClusters,
    isolatedCount,
    isolatedRatio: finalIds.length === 0 ? 0 : isolatedCount / finalIds.length,
  }
}

interface PickClustersOptions {
  round: number
  minClusters: number
  maxClusters: number
  maxPerCluster: number
  /** 本轮抽样总预算（簇成员总和不超过它） */
  limitTotal: number
}

/**
 * 选 3–5 个互不相交的高密度主题子簇：
 * 候选 = 共享同一胶水标签的节点组（组内 ≥3 站），按簇内边数、规模排序；
 * round 轮转候选顺序实现「换一批」；贪心取互不相交的前 N 组，每组取连接度
 * 最高的至多 maxPerCluster 站；簇不够 minClusters 时退回最大连通分量补位
 * （分量内 ≥3 站的，簇名取分量内最常见的标签）。
 */
function pickClusters(
  sites: readonly ClusterSiteInput[],
  edges: readonly ClusterEdge[],
  degree: ReadonlyMap<string, number>,
  options: PickClustersOptions,
): GraphCluster[] {
  const { round, minClusters, maxClusters, maxPerCluster, limitTotal } = options
  const byId = new Map(sites.map((s) => [s.id, s]))
  const siteOrder = new Map(sites.map((s, i) => [s.id, i]))

  // 标签 → 节点组（组内 ≥3 站才成簇）。
  const tagGroups = new Map<string, string[]>()
  for (const s of sites) {
    const seen = new Set<string>()
    for (const raw of s.tags || []) {
      const tag = normalizeTag(String(raw))
      if (!tag || seen.has(tag)) continue
      seen.add(tag)
      const list = tagGroups.get(tag)
      if (list) list.push(s.id)
      else tagGroups.set(tag, [s.id])
    }
  }
  interface Candidate {
    key: string
    ids: string[]
    edgeCount: number
  }
  const candidates: Candidate[] = []
  for (const [tag, ids] of tagGroups) {
    if (ids.length < 3) continue
    const idSet = new Set(ids)
    const edgeCount = edges.filter((e) => idSet.has(e.source) && idSet.has(e.target)).length
    if (edgeCount === 0) continue
    candidates.push({ key: tag, ids, edgeCount })
  }
  candidates.sort((a, b) => {
    if (b.edgeCount !== a.edgeCount) return b.edgeCount - a.edgeCount
    if (b.ids.length !== a.ids.length) return b.ids.length - a.ids.length
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  })
  // round 轮转：换一批时从不同的候选开始取，同一 round 输出完全确定。
  if (candidates.length > 1 && round > 0) {
    const shift = round % candidates.length
    const rotated = [...candidates.slice(shift), ...candidates.slice(0, shift)]
    candidates.splice(0, candidates.length, ...rotated)
  }

  const picked = new Set<string>()
  const clusters: GraphCluster[] = []
  let budget = limitTotal
  for (const cand of candidates) {
    if (clusters.length >= maxClusters) break
    if (budget < 3) break
    const remaining = cand.ids.filter((id) => !picked.has(id))
    if (remaining.length < 3) continue
    remaining.sort((a, b) => {
      const d = (degree.get(b) || 0) - (degree.get(a) || 0)
      if (d !== 0) return d
      return (siteOrder.get(a) || 0) - (siteOrder.get(b) || 0)
    })
    const take = remaining.slice(0, Math.min(maxPerCluster, budget))
    if (take.length < 3) continue
    for (const id of take) picked.add(id)
    budget -= take.length
    const takeSet = new Set(take)
    clusters.push({
      key: cand.key,
      label: `${cand.key}簇`,
      siteIds: take,
      edgeCount: edges.filter((e) => takeSet.has(e.source) && takeSet.has(e.target)).length,
    })
  }

  // 簇不够：用最大连通分量补位（分量内 ≥3 站，簇名取分量内最常见标签）。
  if (clusters.length < minClusters) {
    const components = connectedComponents(
      sites.map((s) => s.id),
      edges,
    )
    for (const comp of components) {
      if (clusters.length >= minClusters) break
      const remaining = comp.filter((id) => !picked.has(id))
      if (remaining.length < 3) continue
      const tagFreq = new Map<string, number>()
      for (const id of remaining) {
        const s = byId.get(id)
        if (!s) continue
        for (const raw of s.tags || []) {
          const tag = normalizeTag(String(raw))
          if (!tag) continue
          tagFreq.set(tag, (tagFreq.get(tag) || 0) + 1)
        }
      }
      const topTag =
        [...tagFreq.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ||
        '同域'
      remaining.sort((a, b) => {
        const d = (degree.get(b) || 0) - (degree.get(a) || 0)
        if (d !== 0) return d
        return (siteOrder.get(a) || 0) - (siteOrder.get(b) || 0)
      })
      const take = remaining.slice(0, Math.min(maxPerCluster, budget))
      if (take.length < 3 || budget < 3) continue
      for (const id of take) picked.add(id)
      budget -= take.length
      const takeSet = new Set(take)
      clusters.push({
        key: topTag,
        label: `${topTag}簇`,
        siteIds: take,
        edgeCount: edges.filter((e) => takeSet.has(e.source) && takeSet.has(e.target)).length,
      })
    }
  }

  return clusters
}

/**
 * 全站检索：标题开头 > 标题包含 > 标签包含 > 描述包含；同级按标题短者优先、
 * 再按输入顺序。返回前 limit 个站点（limit <= 0 返回全部匹配）。
 * 注意：检索池是调用方给的全部站点（图谱取到的 navigation.json 388 站），
 * 不是当前抽样的 24 站——搜不到抽样外的站点是旧实现的假搜索。
 */
export function searchGraphSites<T extends ClusterSiteInput>(
  sites: readonly T[],
  query: string,
  limit = 8,
): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  interface Scored {
    site: T
    rank: number
    titleLen: number
    order: number
  }
  const scored: Scored[] = []
  sites.forEach((site, order) => {
    const title = site.title.toLowerCase()
    const tags = (site.tags || []).map((t) => normalizeTag(String(t)))
    const desc = (site.description || '').toLowerCase()
    let rank = -1
    if (title.startsWith(q)) rank = 0
    else if (title.includes(q)) rank = 1
    else if (tags.some((t) => t.includes(q))) rank = 2
    else if (desc.includes(q)) rank = 3
    if (rank === -1) return
    scored.push({ site, rank, titleLen: site.title.length, order })
  })
  scored.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank
    if (a.titleLen !== b.titleLen) return a.titleLen - b.titleLen
    return a.order - b.order
  })
  const out = scored.map((s) => s.site)
  return limit > 0 ? out.slice(0, limit) : out
}

export interface EgoSubgraph {
  /** 中心站点 id */
  centerId: string
  /** 中心 + 一跳邻居（中心在首位，其余按连接度降序） */
  sites: ClusterSiteInput[]
  /** 中心与邻居之间的诱导边 */
  edges: ClusterEdge[]
  /** 邻居里平替边的条数（用于抽屉文案） */
  alternativeCount: number
  /** 邻居里生态边的条数 */
  ecosystemCount: number
}

/**
 * 平替雷达：一跳子图。中心 + 全图里与它直接相连的邻居（平替边优先、再按
 * 连接度），邻居之间也保留诱导边。中心在全图里无邻居时只返回中心本身
 * （调用方据此显示「暂无共享标签关联」的诚实提示，不假装有关系）。
 */
export function egoSubgraph(
  sites: readonly ClusterSiteInput[],
  centerId: string,
  maxNodes = 24,
): EgoSubgraph | null {
  const center = sites.find((s) => s.id === centerId)
  if (!center) return null
  const edges = buildGraphEdges(sites)
  const degree = degreeMap(edges)
  const neighborIds = new Set<string>()
  const neighborEdgeType = new Map<string, 'alternative' | 'ecosystem'>()
  for (const e of edges) {
    if (e.source === centerId) {
      neighborIds.add(e.target)
      if (e.type === 'alternative') neighborEdgeType.set(e.target, 'alternative')
      else if (!neighborEdgeType.has(e.target)) neighborEdgeType.set(e.target, 'ecosystem')
    } else if (e.target === centerId) {
      neighborIds.add(e.source)
      if (e.type === 'alternative') neighborEdgeType.set(e.source, 'alternative')
      else if (!neighborEdgeType.has(e.source)) neighborEdgeType.set(e.source, 'ecosystem')
    }
  }
  const byId = new Map(sites.map((s) => [s.id, s]))
  const neighbors = [...neighborIds]
    .map((id) => byId.get(id)!)
    .filter(Boolean)
    .sort((a, b) => {
      const ta = neighborEdgeType.get(a.id) === 'alternative' ? 0 : 1
      const tb = neighborEdgeType.get(b.id) === 'alternative' ? 0 : 1
      if (ta !== tb) return ta - tb
      return (degree.get(b.id) || 0) - (degree.get(a.id) || 0)
    })
    .slice(0, Math.max(0, maxNodes - 1))
  const outSites = [center, ...neighbors]
  const outSet = new Set(outSites.map((s) => s.id))
  const outEdges = inducedEdges(edges, outSet)
  return {
    centerId,
    sites: outSites,
    edges: outEdges,
    alternativeCount: outEdges.filter((e) => e.type === 'alternative').length,
    ecosystemCount: outEdges.filter((e) => e.type === 'ecosystem').length,
  }
}
