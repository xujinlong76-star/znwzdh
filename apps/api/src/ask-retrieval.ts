/**
 * 问问我的收藏：问答检索（只答收藏）。
 *
 * 为什么是问答侧专用检索、不动通用混合引擎：
 *  - 通用引擎没有「限定在这些站点里」的允许名单；全局检索再求交会被
 *    perChannel=50 截断把收藏目标挤出去（设计缺口 1）；
 *  - 语义向量看不见收藏备注与标签；问答专用检索文本把 note/tags 拼进去，
 *    全站 embedding 文本（siteEmbeddingText）一字不改（设计缺口 2）。
 *
 * 两路并行召回（都在收藏子集内，没有全局检索）：
 *  - 词法路：收藏子集上的内存打分（标题/描述/备注/标签/网址），top 20；
 *    纠错只在收藏子集词典上跑，词法 0 命中时才试一次纠错后查询；
 *  - 语义路：本地 embedding 编码问题与每条收藏的问答文本（encodeBatch 走
 *    服务内 LRU 缓存，重复提问不重复推理），余弦相似度 + 引擎同口径阈值
 *    （有词法命中时 ≥0.4，纯语义时 ≥0.55），top 20。
 * 两路按 siteId 去重，合并排序（词法优先、语义相似度次之、收藏时间新者次之），
 * 截断进提示词最多 12 条。召回为 0 时调用方不调模型，直接走「不知道」分支。
 */

import { siteEmbeddingText } from "@navhub/ai";
import type { AppContext } from "./context.ts";
import type { AskCandidate } from "./ask.ts";
import { ASK_CANDIDATE_LIMIT } from "./ask.ts";

export interface AskEmbedder {
  encode(text: string): Promise<Float32Array>;
  encodeBatch(texts: string[]): Promise<Float32Array[]>;
}

export interface AskRetrieval {
  /** 可引用的收藏条数（站点已删的收藏行不计入） */
  totalFavorites: number;
  /** 进提示词的候选（≤12 条） */
  candidates: AskCandidate[];
  lexicalCount: number;
  semanticCount: number;
  /** 收藏子集纠错：仅在词法 0 命中且纠出替代问法时出现 */
  correction: { from: string; to: string } | null;
  /** 语义路是否真正跑起来（模型缺失/编码失败时为 false，只剩词法） */
  semanticAvailable: boolean;
  /** 「不知道」分支与本地兜底附的参考卡片（≤5 条，标注仅供参考） */
  closest: AskCandidate[];
}

const LEXICAL_POOL = 20;
const SEMANTIC_POOL = 20;
const CLOSEST_LIMIT = 5;

function normalizeText(raw: string): string {
  return raw.normalize("NFKC").toLowerCase().trim();
}

/**
 * 查询拆成匹配单元：拉丁/数字词原样；中文连续串切成二字 shingle。
 *
 * 中文查询常无空格（「免费短剧」），整词子串匹配会漏；二字 shingle 让
 * 「免费短剧」拆成 免费/费短/短剧，标题含其中多数即算命中。
 */
export function askQueryUnits(query: string): string[] {
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

/** 问答专用检索文本：全站 embedding 文本 + 收藏备注/标签（不改全站口径）。 */
export function askRetrievalText(item: {
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

/** 取该身份全部未删收藏，JOIN 站点行拼成问答候选（站点已删的行跳过、不可引用）。 */
export async function loadAskCorpus(
  ctx: Pick<AppContext, "repo">,
  identity: string,
): Promise<AskCandidate[]> {
  const favorites = await ctx.repo.listFavorites(identity);
  if (favorites.length === 0) return [];
  const sites = await ctx.repo.getSitesByIds(favorites.map((f) => f.siteId));
  const out: AskCandidate[] = [];
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

interface ScoredCandidate extends AskCandidate {
  score: number;
  matchedUnits: number;
}

/** 词法路：字段加权（标题 3 / 备注 2.5 / 标签 2.5 / 描述 1.5 / 网址 0.5）+ 整句命中加分。 */
export function lexicalAskCandidates(query: string, corpus: readonly AskCandidate[]): AskCandidate[] {
  const units = askQueryUnits(query);
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
  corpus: readonly AskCandidate[],
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

/**
 * 语义路：编码问题 + 批量编码收藏问答文本，余弦相似度过阈值即命中。
 *
 * 编码失败（模型未下载/推理抛错）静默降级为空，不拖垮整次问答——
 * 词法路仍在，调用方按 semanticAvailable 如实标注。
 */
export async function semanticAskCandidates(
  embed: AskEmbedder | null | undefined,
  query: string,
  corpus: readonly AskCandidate[],
  threshold: number,
): Promise<{ candidates: AskCandidate[]; available: boolean }> {
  if (!embed || corpus.length === 0 || !query.trim()) return { candidates: [], available: false };
  try {
    const qVec = await embed.encode(query);
    const vecs = await embed.encodeBatch(corpus.map((c) => askRetrievalText(c)));
    const scored: Array<AskCandidate & { similarity: number }> = [];
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

/** 两路合并：词法优先、语义相似度次之、收藏时间新者次之；去重后截断到 12 条。 */
export function mergeAskCandidates(
  lexical: readonly AskCandidate[],
  semantic: readonly AskCandidate[],
): AskCandidate[] {
  const merged = new Map<string, AskCandidate>();
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
  return list.slice(0, ASK_CANDIDATE_LIMIT);
}

export async function retrieveAskCandidates(
  ctx: Pick<AppContext, "repo" | "embedding">,
  identity: string,
  query: string,
  opts: { embed?: AskEmbedder | null } = {},
): Promise<AskRetrieval> {
  const corpus = await loadAskCorpus(ctx, identity);
  const totalFavorites = corpus.length;
  if (totalFavorites === 0 || !query.trim()) {
    return {
      totalFavorites,
      candidates: [],
      lexicalCount: 0,
      semanticCount: 0,
      correction: null,
      semanticAvailable: false,
      closest: [],
    };
  }

  let effectiveQuery = query;
  let lexical = lexicalAskCandidates(query, corpus);
  let correction: { from: string; to: string } | null = null;
  if (lexical.length === 0) {
    const corrected = correctQueryAgainstFavorites(query, corpus);
    if (corrected && corrected !== normalizeText(query)) {
      correction = { from: query, to: corrected };
      effectiveQuery = corrected;
      lexical = lexicalAskCandidates(corrected, corpus);
    }
  }

  const hasLexical = lexical.length > 0;
  const threshold = hasLexical ? 0.4 : 0.55;
  const embed = opts.embed !== undefined ? opts.embed : ctx.embedding;
  const semantic = await semanticAskCandidates(embed, effectiveQuery, corpus, threshold);

  const candidates = mergeAskCandidates(lexical, semantic.candidates);
  // 「最接近」卡片的两档来源（不要混成一档）：
  //  - 有候选时取合并排序后的前 5 条：mergeAskCandidates 已按词法分、语义相似度、
  //    收藏时间排过序，所以这里是相关性前 5，不是最近 5；
  //  - 完全无候选时才取 corpus 前 5 条：loadAskCorpus 经 listFavorites 按
  //    created_at DESC 读库，corpus 本身就是最新在前，所以这里是最近 5 条。
  const closest =
    candidates.length > 0
      ? candidates.slice(0, CLOSEST_LIMIT)
      : corpus.slice(0, CLOSEST_LIMIT);
  return {
    totalFavorites,
    candidates,
    lexicalCount: lexical.length,
    semanticCount: semantic.candidates.length,
    correction,
    semanticAvailable: semantic.available,
    closest,
  };
}
