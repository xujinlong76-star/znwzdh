/**
 * 收藏内检索（MCP `search_favorites` 的检索层）。
 *
 * 选型（Batch 3 第 4 项）：方案 (b)——在 packages/mcp 内用 repo + embedding +
 * `@navhub/ai` 的 siteEmbeddingText 薄实现同款算法，不反向依赖 apps/api。
 *
 * 为什么不选 (a)（McpHostContext 加可选方法、由 apps/mcp 注入并委托给
 * retrieveAskCandidates）：stdio.ts 与 http-server.ts 都是把 `createContext`
 * 的 AppContext 原样传进 `createMcpServer`，中间没有任何装配缝；(a) 要在
 * apps/api 补导出 + 两处启动层各加注入，任何一个后来者（测试、新的启动器）
 * 忘掉注入，工具就静默不可用。(b) 让 packages/mcp 自包含，两个传输与所有
 * 测试直通同一份实现。
 *
 * 算法与 apps/api/src/ask-retrieval.ts 的 retrieveAskCandidates 同款，逐项对齐：
 *  - 语料 = 本人全部未删收藏 JOIN 站点行（站点已删的行跳过），问答检索文本 =
 *    siteEmbeddingText + 收藏备注/标签；
 *  - 词法路：字段加权（标题 3 / 备注 2.5 / 标签 2.5 / 描述 1.5 / 网址 0.5）+ 整句命中加分，
 *    中文二字 shingle，top 20；
 *  - 纠错只在词法 0 命中时跑一次，词典只取这批收藏；
 *  - 语义路：余弦相似度，阈值有词法命中时 0.4、纯语义时 0.55，top 20；
 *    编码失败静默降级（semanticAvailable=false），不拖垮调用；
 *  - 合并：词法优先、语义相似度次之、收藏时间新者次之，去重后截断到 limit。
 *
 * 与 /api/ask 的两处有意不同：① 截断到调用方要的 limit（默认 10、上限 50），
 * 不是问答提示词的 12 条上限；② 不出 `closest`（那是问答「不知道」分支的
 * 参考卡片，检索工具不需要）；③ 不做任何 LLM 问答、不新增生成式工具。
 *
 * 漂移风险：两份实现迟早会漂移。约束是测试
 * `packages/mcp/test/favorites-search.test.ts` 里的「与 retrieveAskCandidates
 * 词法同义」用例——同一批夹具上，两边的词法命中集合必须一致；改任一边都要
 * 跑它。
 */
import { siteEmbeddingText } from "@navhub/ai";
import type { McpHostContext } from "../host-context.ts";

/** 一条可引用的收藏（站点行 + 收藏备注/标签/时间），与 AskCandidate 同形。 */
export interface FavoriteCandidate {
  siteId: string;
  title: string;
  url: string;
  description: string | null;
  note: string | null;
  tags: string[];
  folderId: string | null;
  /** 收藏时间（毫秒时间戳） */
  createdAt: number;
  /** 词法得分（命中时才有） */
  lexicalScore?: number;
  /** 语义相似度（命中时才有） */
  similarity?: number;
}

/** 对外返回的一条命中：候选 + 可解释的分数与分路名次。 */
export interface FavoriteSearchHit extends FavoriteCandidate {
  /** 词法分或语义相似度（词法优先），6 位小数 */
  matchScore: number;
  /** 每路召回的名次（1 起），只含实际命中的路 */
  matchedBy: { lexical?: number; semantic?: number };
}

export interface FavoriteSearchResult {
  /** 可引用的收藏条数（站点已删的收藏行不计入；folder/tag 过滤前） */
  totalFavorites: number;
  /** 本次返回的命中（≤ limit，按合并排序） */
  hits: FavoriteSearchHit[];
  lexicalCount: number;
  semanticCount: number;
  /** 收藏子集纠错：仅在词法 0 命中且纠出替代问法时出现 */
  correction: { from: string; to: string } | null;
  /** 语义路是否真正跑起来（模型缺失/编码失败时为 false，只剩词法） */
  semanticAvailable: boolean;
}

const LEXICAL_POOL = 20;
const SEMANTIC_POOL = 20;

function normalizeText(raw: string): string {
  return raw.normalize("NFKC").toLowerCase().trim();
}

/**
 * 查询拆成匹配单元：拉丁/数字词原样；中文连续串切成二字 shingle。
 * 与 ask-retrieval.ts 的 askQueryUnits 同款。
 */
export function favoriteQueryUnits(query: string): string[] {
  const norm = normalizeText(query);
  const units = new Set<string>();
  for (const m of norm.matchAll(/[a-z0-9]+/g)) units.add(m[0]);
  for (const m of norm.matchAll(/[\u4e00-\u9fff]+/g)) {
    const run = m[0];
    if (run.length === 1) {
      units.add(run);
    } else {
      for (let i = 0; i + 2 <= run.length; i += 1) units.add(run.slice(i, i + 2));
    }
  }
  return [...units];
}

/** 收藏检索文本：全站 embedding 文本 + 收藏备注/标签（不改全站口径）。 */
export function favoriteRetrievalText(item: {
  title: string;
  description?: string | null;
  url?: string;
  note?: string | null;
  tags?: string[];
}): string {
  const base = siteEmbeddingText({
    title: item.title,
    description: item.description ?? null,
    url: item.url,
  });
  const extra: string[] = [];
  if (item.note?.trim()) extra.push("收藏备注：" + item.note.trim());
  if (item.tags && item.tags.length > 0) extra.push("收藏标签：" + item.tags.join("、"));
  return extra.length > 0 ? `${base}。${extra.join("。")}` : base;
}

/** 取该身份全部未删收藏，JOIN 站点行拼成候选（站点已删的行跳过、不可引用）。 */
export async function loadFavoritesCorpus(
  ctx: Pick<McpHostContext, "repo">,
  identity: string,
): Promise<FavoriteCandidate[]> {
  const favorites = await ctx.repo.listFavorites(identity);
  if (favorites.length === 0) return [];
  const sites = await ctx.repo.getSitesByIds(favorites.map((f) => f.siteId));
  const out: FavoriteCandidate[] = [];
  for (const fav of favorites) {
    const site = sites.get(fav.siteId);
    if (!site) continue;
    out.push({
      siteId: site.id,
      title: site.title,
      url: site.url,
      description: site.description ?? null,
      note: fav.note ?? null,
      tags: fav.tags ?? [],
      folderId: fav.folderId,
      createdAt: fav.createdAt,
    });
  }
  return out;
}

interface ScoredCandidate extends FavoriteCandidate {
  score: number;
  matchedUnits: number;
}

/** 词法路：字段加权（标题 3 / 备注 2.5 / 标签 2.5 / 描述 1.5 / 网址 0.5）+ 整句命中加分。 */
export function lexicalFavoriteCandidates(
  query: string,
  corpus: readonly FavoriteCandidate[],
): FavoriteCandidate[] {
  const units = favoriteQueryUnits(query);
  const normQuery = normalizeText(query);
  if (units.length === 0) return [];
  const scored: ScoredCandidate[] = [];
  for (const item of corpus) {
    const hay = {
      title: normalizeText(item.title),
      description: normalizeText(item.description ?? ""),
      note: normalizeText(item.note ?? ""),
      tags: normalizeText(item.tags.join(" ")),
      url: normalizeText(item.url),
    };
    let score = 0;
    let matched = 0;
    let matchedStrong = 0;
    for (const unit of units) {
      let w = 0;
      if (hay.title.includes(unit)) w = Math.max(w, 3);
      if (hay.note.includes(unit)) w = Math.max(w, 2.5);
      if (hay.tags.includes(unit)) w = Math.max(w, 2.5);
      if (hay.description.includes(unit)) w = Math.max(w, 1.5);
      if (hay.url.includes(unit)) w = Math.max(w, 0.5);
      if (w > 0) {
        matched += 1;
        // 单字中文单元（「做」「的」）是噪音：命中判定只认长度 ≥2 的强单元，
        // 否则「做 PPT 用什么」这类口语问法里只命中 PPT 的收藏会被「还差一个单元」漏掉。
        if (unit.length >= 2) matchedStrong += 1;
      }
      score += w;
    }
    let phrase = 0;
    if (normQuery.length >= 2) {
      if (hay.title.includes(normQuery)) phrase = 6;
      else if (hay.note.includes(normQuery) || hay.tags.includes(normQuery)) phrase = 4;
      else if (hay.description.includes(normQuery)) phrase = 2;
    }
    score += phrase;
    const hit =
      score >= 1.5 && (units.length === 1 || matchedStrong >= 1 || phrase > 0);
    if (hit) scored.push({ ...item, lexicalScore: score, score, matchedUnits: matched });
  }
  scored.sort((a, b) => b.score - a.score || b.createdAt - a.createdAt);
  return scored.slice(0, LEXICAL_POOL).map(({ score: _s, matchedUnits: _m, ...rest }) => rest);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n]!;
}

/**
 * 收藏子集纠错：只在词法 0 命中时跑。
 *
 * 词典就是这批收藏的标题/标签/备注里切出来的词（拉丁词 + 中文连续串），
 * 不碰全站 5000 站词典——收藏外的高频词不会把问题纠偏。
 * 只纠「在收藏里一次都没出现过」的词，且编辑距离要足够小（短词 1，长词 len/4）。
 */
export function correctQueryAgainstFavorites(
  query: string,
  corpus: readonly FavoriteCandidate[],
): string | null {
  if (corpus.length === 0) return null;
  const corpusText = corpus
    .map((c) => [c.title, c.description ?? "", c.note ?? "", c.tags.join(" ")].join(" "))
    .join(" ");
  const normCorpus = normalizeText(corpusText);
  const vocab = new Set<string>();
  for (const m of normCorpus.matchAll(/[a-z0-9]+|[\u4e00-\u9fff]{2,}/g)) vocab.add(m[0]);
  const words = [...normalizeText(query).matchAll(/[a-z0-9]+|[\u4e00-\u9fff]+/g)].map((m) => m[0]);
  if (words.length === 0) return null;
  let corrected = normalizeText(query);
  let changed = false;
  for (const word of words) {
    if (word.length < 2) continue;
    if (normCorpus.includes(word)) continue;
    const sameScript = [...vocab].filter((v) =>
      /[a-z0-9]/.test(word[0]!) === /[a-z0-9]/.test(v[0]!),
    );
    let best: string | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const v of sameScript) {
      if (Math.abs(v.length - word.length) > 2) continue;
      const d = levenshtein(word, v);
      if (d < bestDist) {
        bestDist = d;
        best = v;
      }
    }
    const allowed = Math.max(1, Math.floor(word.length / 4));
    if (best && bestDist <= allowed && best !== word) {
      corrected = corrected.replace(word, best);
      changed = true;
    }
  }
  return changed ? corrected : null;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface FavoriteEmbedder {
  encode(text: string): Promise<Float32Array>;
  encodeBatch(texts: string[]): Promise<Float32Array[]>;
}

/**
 * 语义路：编码问题 + 批量编码收藏问答文本，余弦相似度过阈值即命中。
 *
 * 编码失败（模型未下载/推理抛错）静默降级为空，不拖垮整次检索——
 * 词法路仍在，调用方按 semanticAvailable 如实标注。
 */
export async function semanticFavoriteCandidates(
  embed: FavoriteEmbedder | null | undefined,
  query: string,
  corpus: readonly FavoriteCandidate[],
  threshold: number,
): Promise<{ candidates: FavoriteCandidate[]; available: boolean }> {
  if (!embed || corpus.length === 0 || !query.trim()) return { candidates: [], available: false };
  try {
    const qVec = await embed.encode(query);
    const vecs = await embed.encodeBatch(corpus.map((c) => favoriteRetrievalText(c)));
    const scored: Array<FavoriteCandidate & { similarity: number }> = [];
    for (let i = 0; i < corpus.length; i += 1) {
      const vec = vecs[i];
      if (!vec) continue;
      const sim = cosineSimilarity(qVec, vec);
      if (sim >= threshold) scored.push({ ...corpus[i]!, similarity: sim });
    }
    scored.sort((a, b) => b.similarity - a.similarity || b.createdAt - a.createdAt);
    return { candidates: scored.slice(0, SEMANTIC_POOL), available: true };
  } catch {
    return { candidates: [], available: false };
  }
}

/** 两路合并：词法优先、语义相似度次之、收藏时间新者次之；去重后截断到 limit。 */
export function mergeFavoriteCandidates(
  lexical: readonly FavoriteCandidate[],
  semantic: readonly FavoriteCandidate[],
  limit: number,
): FavoriteCandidate[] {
  const merged = new Map<string, FavoriteCandidate>();
  for (const item of lexical) merged.set(item.siteId, { ...item });
  for (const item of semantic) {
    const prev = merged.get(item.siteId);
    merged.set(item.siteId, prev ? { ...prev, similarity: item.similarity } : { ...item });
  }
  const list = [...merged.values()];
  list.sort((a, b) => {
    const aLex = a.lexicalScore !== undefined ? 0 : 1;
    const bLex = b.lexicalScore !== undefined ? 0 : 1;
    if (aLex !== bLex) return aLex - bLex;
    if ((b.lexicalScore ?? 0) !== (a.lexicalScore ?? 0)) return (b.lexicalScore ?? 0) - (a.lexicalScore ?? 0);
    if ((b.similarity ?? 0) !== (a.similarity ?? 0)) return (b.similarity ?? 0) - (a.similarity ?? 0);
    return b.createdAt - a.createdAt;
  });
  return list.slice(0, Math.max(1, limit));
}

export async function retrieveFavoriteCandidates(
  ctx: Pick<McpHostContext, "repo" | "embedding">,
  identity: string,
  query: string,
  opts: { folder?: string; tag?: string; limit?: number; embed?: FavoriteEmbedder | null } = {},
): Promise<FavoriteSearchResult> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 10), 1), 50);
  const corpusAll = await loadFavoritesCorpus(ctx, identity);
  const totalFavorites = corpusAll.length;
  // folder/tag 是调用方显式收窄的范围：先过滤语料再跑两路召回（与 /api/ask
  // 的「收藏子集内召回」同一原则——过滤后才进词典与阈值，不存在子集外干扰）。
  let corpus = corpusAll;
  if (opts.folder) corpus = corpus.filter((c) => c.folderId === opts.folder);
  if (opts.tag) {
    const want = normalizeText(opts.tag);
    corpus = corpus.filter((c) => c.tags.some((t) => normalizeText(t) === want));
  }
  if (totalFavorites === 0 || corpus.length === 0 || !query.trim()) {
    return {
      totalFavorites,
      hits: [],
      lexicalCount: 0,
      semanticCount: 0,
      correction: null,
      semanticAvailable: false,
    };
  }

  let effectiveQuery = query;
  let lexical = lexicalFavoriteCandidates(query, corpus);
  let correction: { from: string; to: string } | null = null;
  if (lexical.length === 0) {
    const corrected = correctQueryAgainstFavorites(query, corpus);
    if (corrected && corrected !== normalizeText(query)) {
      correction = { from: query, to: corrected };
      effectiveQuery = corrected;
      lexical = lexicalFavoriteCandidates(corrected, corpus);
    }
  }

  const hasLexical = lexical.length > 0;
  const threshold = hasLexical ? 0.4 : 0.55;
  // AppContext 的 embedding 在模型禁用时为 null；McpHostContext 声明为非空，
  // 运行时仍可能为 null（与 handlers/shared.ts 的 makeIndexSite 同一守卫口径）。
  const embed = opts.embed !== undefined ? opts.embed : (ctx.embedding as FavoriteEmbedder | null | undefined);
  const semantic = await semanticFavoriteCandidates(embed, effectiveQuery, corpus, threshold);

  const merged = mergeFavoriteCandidates(lexical, semantic.candidates, limit);
  const lexicalRank = new Map(lexical.map((c, i) => [c.siteId, i + 1]));
  const semanticRank = new Map(semantic.candidates.map((c, i) => [c.siteId, i + 1]));
  const hits: FavoriteSearchHit[] = merged.map((c) => {
    const { lexicalScore, similarity, ...rest } = c;
    const raw = lexicalScore ?? similarity ?? 0;
    const matchedBy: { lexical?: number; semantic?: number } = {};
    const lr = lexicalRank.get(c.siteId);
    if (lr !== undefined) matchedBy.lexical = lr;
    const sr = semanticRank.get(c.siteId);
    if (sr !== undefined) matchedBy.semantic = sr;
    return {
      ...rest,
      lexicalScore,
      similarity,
      matchScore: Math.round(raw * 1e6) / 1e6,
      matchedBy,
    };
  });
  return {
    totalFavorites,
    hits,
    lexicalCount: lexical.length,
    semanticCount: semantic.candidates.length,
    correction,
    semanticAvailable: semantic.available,
  };
}
