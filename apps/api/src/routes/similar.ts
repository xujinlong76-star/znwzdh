/**
 * SimilarSites 级多信号相似站点发现与竞品洞察 API。
 *
 * 提供 3 个公开端点：
 *   1. GET /api/sites/:id/similar-insights —— 指定站点的全维度相似推荐分析报告
 *      （综合相似度百分比 + 5 维拆解 + 站内/类目排名 + 可解释理由 + 多维筛选/排序）
 *   2. GET /api/similar/lookup?q=...       —— SimilarSites 风格「输入任意网址/域名/站点名/主题」
 *      即时解析并输出相似站点报告（未收录外站自动走语义/词元主题发现兜底，绝不返回空死胡同）
 *   3. GET /api/similar/suggestions        —— 精选热门种子站点列表（供 /similar 发现页一键体验）
 */
import type { FastifyPluginAsync } from "fastify";
import {
  computeSimilarSitesForTarget,
  computeTopicSimilarSites,
  resolveSiteByLookupQuery,
  sitePopularityScore,
  type Category,
  type SimilarScopeFilter,
  type SimilarSortBy,
  type Site,
} from "@navhub/core";
import type { AppContext } from "../context.ts";
import { sendError } from "../error-envelope.ts";
import { isPubliclyVisibleSite } from "../storage.ts";

interface CatalogSnapshot {
  loadedAt: number;
  dataVersion: number | null;
  sites: Site[];
  categories: Category[];
}

const SNAPSHOT_TTL_MS = 30_000;

function parseScope(raw: unknown): SimilarScopeFilter {
  if (raw === "same-category" || raw === "cross-category") return raw;
  return "all";
}

function parseSort(raw: unknown): SimilarSortBy {
  if (raw === "popularity" || raw === "latency" || raw === "tags") return raw;
  return "similarity";
}

function parseBoolFlag(raw: unknown): boolean {
  return raw === "1" || raw === "true";
}

export const similarRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;
  let snapshotCache: CatalogSnapshot | null = null;
  let inflightSnapshot: Promise<CatalogSnapshot> | null = null;

  /**
   * 30s + dataVersion 双闸门内存快照：
   * 避免每次请求反复全表读 4,800+ 站点，同时站点/分类变更后立即失效。
   */
  async function loadCatalogSnapshot(): Promise<CatalogSnapshot> {
    const now = Date.now();
    const version = await ctx.repo.readNavDataVersion().catch(() => {
      // 候选库不可用时召回降级到词元路径即可，失败无需上报（loadVectorSimilaritiesForText 本身有兜底）。
      return null;
    });
    if (
      snapshotCache &&
      now - snapshotCache.loadedAt < SNAPSHOT_TTL_MS &&
      (version === null || snapshotCache.dataVersion === version)
    ) {
      return snapshotCache;
    }
    if (inflightSnapshot) return inflightSnapshot;
    inflightSnapshot = (async () => {
      const [sites, categories] = await Promise.all([
        ctx.repo.listAllSites(undefined, { facets: true }),
        ctx.repo.listCategories(),
      ]);
      const next: CatalogSnapshot = {
        loadedAt: Date.now(),
        dataVersion: version,
        sites: sites.filter((s) => isPubliclyVisibleSite(s)),
        categories,
      };
      snapshotCache = next;
      return next;
    })();
    try {
      return await inflightSnapshot;
    } finally {
      inflightSnapshot = null;
    }
  }

  /** 读取真实向量余弦相似度（不可用时返回空 Map，由纯文本/标签/分类信号平滑接管） */
  async function loadVectorSimilaritiesForSite(siteId: string): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!ctx.embedding || !ctx.vectors) return out;
    try {
      const vec = await ctx.repo.getEmbedding(siteId);
      if (!vec) return out;
      const matches = await ctx.vectors.search(vec, 64);
      for (const m of matches) {
        if (m.siteId === siteId) continue;
        if (typeof m.similarity === "number" && Number.isFinite(m.similarity) && m.similarity > 0) {
          out.set(m.siteId, Math.min(1, m.similarity));
        }
      }
    } catch {
      // 向量索引降级不影响主流程
    }
    return out;
  }

  /** 对未收录的外站/主题查询做在线向量召回 */
  async function loadVectorSimilaritiesForText(queryText: string): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!ctx.embedding || !ctx.vectors) return out;
    try {
      // EmbeddingService 的真实接口是 encode/encodeBatch（见 index-site.ts）；
      // 采集子系统批次里的 embed() 调用是未落地 API 的笔误，2026-11-24 订正。
      const vec = await ctx.embedding.encode(queryText);
      if (!vec) return out;
      const matches = await ctx.vectors.search(vec, 64);
      for (const m of matches) {
        if (typeof m.similarity === "number" && Number.isFinite(m.similarity) && m.similarity > 0) {
          out.set(m.siteId, Math.min(1, m.similarity));
        }
      }
    } catch {
      // 语义嵌入降级不影响词元召回
    }
    return out;
  }

  /**
   * 真实受众共现信号（同收藏夹共现）：
   * 统计收藏了目标站点的用户同时收藏了哪些其它站点，换算为 0..1 的受众重合度。
   */
  async function loadAudienceOverlapForSite(siteId: string): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    try {
      const totalRows = await ctx.repo.raw(
        `SELECT COUNT(DISTINCT user_id) AS cnt FROM favorites WHERE site_id = ? AND deleted_at IS NULL`,
        [siteId],
      );
      const baseUsers = Number(totalRows?.[0]?.cnt ?? 0);
      if (baseUsers < 1) return out;

      const coRows = await ctx.repo.raw(
        `SELECT f2.site_id AS site_id, COUNT(DISTINCT f2.user_id) AS co_users
           FROM favorites f1
           JOIN favorites f2
             ON f2.user_id = f1.user_id
            AND f2.site_id <> f1.site_id
            AND f2.deleted_at IS NULL
          WHERE f1.site_id = ?
            AND f1.deleted_at IS NULL
          GROUP BY f2.site_id
          ORDER BY co_users DESC
          LIMIT 40`,
        [siteId],
      );
      for (const row of coRows ?? []) {
        const sid = String(row.site_id ?? "");
        const co = Number(row.co_users ?? 0);
        if (sid && co > 0) {
          // 至少 2 名共现用户才给高权重，单用户按柔和系数折算
          const ratio = co / Math.max(baseUsers, 2);
          out.set(sid, Math.min(1, ratio));
        }
      }
    } catch {
      // 表未初始化或方言异常时静默降级
    }
    return out;
  }

  /**
   * 1. 指定站点的多信号相似站点分析报告
   */
  app.get(
    "/api/sites/:id/similar-insights",
    { config: { scope: "public", cache: { maxAge: 60, etag: true } } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const q = (req.query ?? {}) as Record<string, unknown>;
      const limit = Math.min(Math.max(Number(q.limit) || 24, 1), 48);

      const site = await ctx.repo.getSite(id);
      if (!site || !isPubliclyVisibleSite(site)) {
        return sendError(reply, 404, "NOT_FOUND", "站点不存在");
      }

      const [snapshot, relationsRes, vectorSim, audienceSim] = await Promise.all([
        loadCatalogSnapshot(),
        ctx.repo.getDetailedSiteRelations(site.id).catch(() => ({ outgoing: [], incoming: [], all: [] })),
        loadVectorSimilaritiesForSite(site.id),
        loadAudienceOverlapForSite(site.id),
      ]);

      return computeSimilarSitesForTarget(site, snapshot.sites, snapshot.categories, {
        limit,
        scope: parseScope(q.scope),
        categoryId: typeof q.categoryId === "string" ? q.categoryId : undefined,
        openSourceOnly: parseBoolFlag(q.openSource),
        healthyOnly: parseBoolFlag(q.healthyOnly),
        excludeSameBrand: parseBoolFlag(q.excludeSameBrand),
        tag: typeof q.tag === "string" ? q.tag : undefined,
        sort: parseSort(q.sort),
        vectorSimilarityById: vectorSim,
        audienceOverlapById: audienceSim,
        targetRelations: relationsRes.all,
      });
    },
  );

  /**
   * 2. SimilarSites.com 风格任意网址/域名/站点名/关键词查找相似站
   */
  app.get(
    "/api/similar/lookup",
    { config: { scope: "public", cache: { maxAge: 30, etag: true } } },
    async (req, reply) => {
      const q = (req.query ?? {}) as Record<string, unknown>;
      const rawQuery = typeof q.q === "string" ? q.q.trim().slice(0, 200) : "";
      if (!rawQuery) {
        return sendError(reply, 400, "BAD_REQUEST", "请输入要查询的网址、域名或站点名称");
      }
      const limit = Math.min(Math.max(Number(q.limit) || 24, 1), 48);
      const snapshot = await loadCatalogSnapshot();

      const resolved = resolveSiteByLookupQuery(rawQuery, snapshot.sites);
      if (resolved) {
        const [relationsRes, vectorSim, audienceSim] = await Promise.all([
          ctx.repo.getDetailedSiteRelations(resolved.site.id).catch(() => ({ outgoing: [], incoming: [], all: [] })),
          loadVectorSimilaritiesForSite(resolved.site.id),
          loadAudienceOverlapForSite(resolved.site.id),
        ]);
        const report = computeSimilarSitesForTarget(resolved.site, snapshot.sites, snapshot.categories, {
          limit,
          scope: parseScope(q.scope),
          categoryId: typeof q.categoryId === "string" ? q.categoryId : undefined,
          openSourceOnly: parseBoolFlag(q.openSource),
          healthyOnly: parseBoolFlag(q.healthyOnly),
          excludeSameBrand: parseBoolFlag(q.excludeSameBrand),
          tag: typeof q.tag === "string" ? q.tag : undefined,
          sort: parseSort(q.sort),
          vectorSimilarityById: vectorSim,
          audienceOverlapById: audienceSim,
          targetRelations: relationsRes.all,
        });
        return {
          ...report,
          matchType: resolved.matchType,
          query: rawQuery,
        };
      }

      // 未收录外站或自由主题词：融合语义向量 + 词元主题相似度
      const vectorSim = await loadVectorSimilaritiesForText(rawQuery);
      return computeTopicSimilarSites(rawQuery, snapshot.sites, snapshot.categories, {
        limit,
        categoryId: typeof q.categoryId === "string" ? q.categoryId : undefined,
        openSourceOnly: parseBoolFlag(q.openSource),
        healthyOnly: parseBoolFlag(q.healthyOnly),
        sort: parseSort(q.sort),
        vectorSimilarityById: vectorSim,
      });
    },
  );

  /**
   * 3. 精选热门种子站点（跨大类均衡抽样，用于 /similar 首页一键探索）
   */
  app.get(
    "/api/similar/suggestions",
    { config: { scope: "public", cache: { maxAge: 300, etag: true } } },
    async (req) => {
      const q = (req.query ?? {}) as Record<string, unknown>;
      const limit = Math.min(Math.max(Number(q.limit) || 12, 4), 24);
      const snapshot = await loadCatalogSnapshot();
      const catById = new Map<string, Category>();
      for (const c of snapshot.categories) catById.set(c.id, c);

      // 按热度降序，每类目最多取 2 条以保证领域多样性
      const ranked = [...snapshot.sites].sort(
        (a, b) => sitePopularityScore(b) - sitePopularityScore(a),
      );
      const perParentCount = new Map<string, number>();
      const picked: Array<{
        id: string;
        title: string;
        url: string;
        iconKey: string | null;
        description: string | null;
        categoryName: string | null;
        tags: string[];
      }> = [];

      for (const s of ranked) {
        const cat = catById.get(s.categoryId);
        const bucket = cat?.parentId ?? s.categoryId;
        const used = perParentCount.get(bucket) ?? 0;
        if (used >= 2) continue;
        perParentCount.set(bucket, used + 1);
        picked.push({
          id: s.id,
          title: s.title,
          url: s.url,
          iconKey: s.iconKey ?? null,
          description: s.description ?? null,
          categoryName: cat?.title ?? null,
          tags: (s.tags ?? []).slice(0, 3),
        });
        if (picked.length >= limit) break;
      }

      return {
        totalActiveSites: snapshot.sites.length,
        items: picked,
      };
    },
  );
};
