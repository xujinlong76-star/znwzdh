/**
 * 插件语义检索（REST / MCP 共用）。
 *
 * 契约（与增强研究文档 D2 一致）：
 *  - 语义通道可用（embedding 已装配且 ready）时走 plugins_vec KNN，按距离排序；
 *  - 不可用 / 未就绪 / 命中为空时**关键词回退**，响应里用 `degraded` 如实标注
 *    「本次结果来自关键词，不是语义」；搜索必须始终可用。
 *  - 空 q 等价于「浏览列表」，degraded=false（没有语义预期，无所谓降级）。
 *
 * 未就绪时常见的是「刚启动还没人触发过 encode」：本模块会顺手 fire-and-forget
 * 触发一次 warmup（不阻塞当前请求），下一次请求即具备语义能力。
 */

import { summarizePluginManifest } from "@navhub/core";
import {
  pluginSlugFromVectorId,
  type PluginRecord,
} from "@navhub/store";
import { indexItemFromManifest, indexPlugin } from "./index-plugin.ts";
import type { AppContext } from "./context.ts";

export interface PluginSearchOptions {
  q: string;
  kind?: string;
  limit?: number;
}

export type PluginSearchItem = Omit<PluginRecord, "manifest"> & {
  /** site-pack 不下发完整清单，卡片只用 summary；详情走 `/api/plugins/:slug` */
  manifest?: PluginRecord["manifest"];
  summary: ReturnType<typeof summarizePluginManifest>;
  /** 语义模式的余弦相似度（1 - distance，越大越接近）；关键词回退时缺省 */
  score?: number | null;
};

/**
 * 搜索/相似结果是卡片型载荷，与 `GET /api/plugins` 的默认裁剪保持一致：
 * site-pack 的完整清单单包可达数十 KB，按 5~12 条返回就是数百 KB，
 * 而消费方（搜索面板、详情页相似区、MCP）全部只读 summary。
 */
function toSearchItem(p: PluginRecord, score?: number | null): PluginSearchItem {
  const item: PluginSearchItem = { ...p, summary: summarizePluginManifest(p.manifest) };
  if (p.kind === "site-pack") delete item.manifest;
  if (score !== undefined) item.score = score;
  return item;
}

export interface PluginSearchResult {
  items: PluginSearchItem[];
  total: number;
  mode: "semantic" | "keyword";
  degraded: boolean;
}

export interface SimilarPluginsResult {
  items: PluginSearchItem[];
  total: number;
  degraded: boolean;
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 语义未就绪时触发一次预热（不阻塞当前请求）；模型不可用则永久走关键词回退 */
function kickWarmup(ctx: AppContext): void {
  try {
    void Promise.resolve(ctx.embedding?.warmup?.()).catch(() => undefined);
  } catch {
    // ignore
  }
}

/** 把插件向量命中映射回已上架插件；返回 null 表示「语义通道本次不可用/未就绪」 */
async function slugsByVector(
  ctx: AppContext,
  text: string,
  limit: number,
): Promise<{ slugs: string[]; scoreBySlug: Map<string, number> } | null> {
  if (!ctx.embedding) return null;
  if (!ctx.embedding.ready()) {
    kickWarmup(ctx);
    return null;
  }
  const vec = await ctx.embedding.encode(text);
  const matches = await ctx.pluginVectors.search(vec, limit);
  const slugs: string[] = [];
  const scoreBySlug = new Map<string, number>();
  for (const m of matches) {
    const slug = pluginSlugFromVectorId(m.siteId);
    if (!slug || scoreBySlug.has(slug)) continue;
    slugs.push(slug);
    // 余弦距离 -> 相似度分数（越小越近；仅供展示与调试，不参与排序）
    scoreBySlug.set(slug, Number((1 - m.distance).toFixed(4)));
  }
  return { slugs, scoreBySlug };
}

/**
 * 语义优先的插件检索。
 *
 * mode=semantic 当且仅当语义通道实际产出结果；否则 keyword 回退且
 * degraded = q 非空（「有语义预期但没用上」）。
 */
export async function searchPluginsSemantic(
  ctx: AppContext,
  opts: PluginSearchOptions,
): Promise<PluginSearchResult> {
  const limit = Math.min(50, Math.max(1, opts.limit ?? 12));
  const q = opts.q.trim();

  let hits: { slugs: string[]; scoreBySlug: Map<string, number> } | null = null;
  if (q) {
    try {
      hits = await slugsByVector(ctx, q, limit * 3);
    } catch (err) {
      ctx.capabilities.notes.push("插件语义检索失败：" + msg(err));
      hits = null;
    }
  }

  if (hits && hits.slugs.length > 0) {
    const hydrated = (
      await Promise.all(hits.slugs.map((slug) => ctx.repo.getPluginBySlug(slug)))
    ).filter(
      (p): p is PluginRecord =>
        Boolean(p) && p!.status === "published" && (!opts.kind || p!.kind === opts.kind),
    );
    const items = hydrated
      .slice(0, limit)
      .map((p) => toSearchItem(p, hits.scoreBySlug.get(p.slug) ?? null));
    return { items, total: items.length, mode: "semantic", degraded: false };
  }

  const res = await ctx.repo.listPlugins({
    status: "published",
    kind: opts.kind || undefined,
    q: q || undefined,
    sort: "popular",
    limit,
    offset: 0,
  });
  const items = res.items.map((p) => toSearchItem(p));
  return { items, total: res.total, mode: "keyword", degraded: Boolean(q) };
}

/**
 * 「相似插件」：详情页发现回路。
 *
 * 自身向量优先读持久层（plugin_embeddings）；缺失时（老库 / 索引批未跑过）
 * 尝试按需补建。语义不可用或补建失败时返回空列表 + degraded=true，
 * 由前端静默隐藏模块，绝不阻塞详情页主内容。
 */
export async function similarPlugins(
  ctx: AppContext,
  slug: string,
  limit = 6,
): Promise<SimilarPluginsResult> {
  const n = Math.min(20, Math.max(1, limit));
  const self = await ctx.repo.getPluginBySlug(slug);
  if (!self) return { items: [], total: 0, degraded: false };

  let vec = await ctx.repo.getPluginEmbedding(slug);
  if (!vec && ctx.embedding?.ready()) {
    await indexPlugin(ctx, indexItemFromManifest(self.slug, self.manifest));
    vec = await ctx.repo.getPluginEmbedding(slug);
  }
  if (!vec) {
    if (ctx.embedding && !ctx.embedding.ready()) kickWarmup(ctx);
    return { items: [], total: 0, degraded: true };
  }

  try {
    const matches = await ctx.pluginVectors.search(vec, n * 3 + 1);
    const seen = new Set<string>([slug]);
    const slugs: string[] = [];
    for (const m of matches) {
      const s = pluginSlugFromVectorId(m.siteId);
      if (!s || seen.has(s)) continue;
      seen.add(s);
      slugs.push(s);
    }
    const hydrated = (
      await Promise.all(slugs.map((s) => ctx.repo.getPluginBySlug(s)))
    ).filter((p): p is PluginRecord => Boolean(p) && p!.status === "published");
    const items = hydrated.slice(0, n).map((p) => toSearchItem(p));
    return { items, total: items.length, degraded: false };
  } catch (err) {
    ctx.capabilities.notes.push("相似插件检索失败：" + msg(err));
    return { items: [], total: 0, degraded: true };
  }
}
