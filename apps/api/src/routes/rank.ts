/**
 * 推荐排序（热度/新品/相似/双曲平替/LinUCB/联邦隐私）
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  clampToBall,
  computeHyperbolicAlternativeScore,
  lorentzDistance,
  poincareToLorentz,
} from "@navhub/core";
import { identityOf } from "./shared.ts";

import { privatizeVector, rankItemsWithPrivacy } from "@navhub/core";
import type { AppContext } from "../context.ts";

export const rankRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* ------------------------ 推荐排序 ------------------------ */

  /** 热度榜（trend_score 由 recompute_rank 任务重算） */
  app.get("/api/rank/trending", { config: { cache: { maxAge: 60, etag: true } } }, async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const limit = Math.min(Number(q.limit) || 20, 100);
    const sites = await ctx.repo.hotSites(limit);
    return {
      hits: sites.map((s) => ({
        site: s,
        // 可解释的热度分量：前端 tooltip 展示「为什么排在这儿」
        trend: { visits: s.visitCount ?? 0, trendScore: s.trendScore ?? 0, lastVisitedAt: s.lastVisitedAt ?? null },
      })),
    };
  });

  /** 新品榜 */
  app.get("/api/rank/new", { config: { cache: { maxAge: 60, etag: true } } }, async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const limit = Math.min(Number(q.limit) || 20, 100);
    return { hits: (await ctx.repo.newestSites(limit)).map((s) => ({ site: s })) };
  });

  /** 相似站点（向量 KNN，零新依赖的相关推荐） */
  app.get("/api/rank/similar/:siteId", async (req, reply) => {
    const { siteId } = req.params as { siteId: string };
    const q = (req.query ?? {}) as Record<string, string>;
    const limit = Math.min(Number(q.limit) || 6, 20);
    if (!ctx.embedding || !ctx.vectors) {
      return { hits: [], semanticAvailable: false, reason: "语义检索不可用" };
    }
    try {
      const vec = await ctx.repo.getEmbedding(siteId);
      if (!vec) return { hits: [], semanticAvailable: true, reason: "该站点暂无向量" };
      const matches = await ctx.vectors.search(vec, limit + 1);
      // 批量取站点：matches 逐个 getSite 是 N+1，改为一次 IN 查询
      const wanted = matches.filter((m) => m.siteId !== siteId).slice(0, limit);
      const similarMap = await ctx.repo.getSitesByIds(wanted.map((m) => m.siteId));
      const hits = wanted.map((m) => ({ site: similarMap.get(m.siteId) ?? null, distance: m.distance }));
      return { hits: hits.filter((h) => h.site), semanticAvailable: true };
    } catch {
      // 模型不可用不该让推荐端点 5xx
      return { hits: [], semanticAvailable: false, reason: "向量检索失败" };
    }
  });

  /**
   * 洛伦兹/庞加莱双曲空间平替推理端点（Hyperbolic Alternative Inference）
   * 结合真实 BGE 语义向量（或标签/类目特征降级投影）计算双曲测地线距离与同层级平替得分。
   */
  app.get("/api/rank/alternatives/:siteId", { config: { scope: "public" } }, async (req, reply) => {
    const { siteId } = req.params as { siteId: string };
    const q = (req.query ?? {}) as Record<string, string>;
    const limit = Math.min(Number(q.limit) || 6, 20);

    const targetSite = await ctx.repo.getSite(siteId);
    if (!targetSite) {
      reply.code(404);
      return { error: "站点不存在" };
    }

    try {
      // 优先尝试真实向量召回 + 洛伦兹双曲流形重排
      if (ctx.embedding && ctx.vectors) {
        const vec = await ctx.repo.getEmbedding(siteId);
        if (vec) {
          const matches = await ctx.vectors.search(vec, Math.max(limit * 3, 24));
          const targetBall = clampToBall(Array.from(vec.slice(0, 16)).map((v) => v * 0.6));
          const targetLorentz = poincareToLorentz(targetBall);

          const scored = [];
          for (const m of matches) {
            if (m.siteId === siteId) continue;
            const candSite = await ctx.repo.getSite(m.siteId);
            if (!candSite || candSite.status === "broken") continue;
            const candVec = await ctx.repo.getEmbedding(m.siteId);
            const candBall = candVec
              ? clampToBall(Array.from(candVec.slice(0, 16)).map((v) => v * 0.6))
              : targetBall.map((v, idx) => v * (idx % 2 === 0 ? 0.85 : 0.9));
            const candLorentz = poincareToLorentz(candBall);
            const lDist = lorentzDistance(targetLorentz, candLorentz);
            const altScore = computeHyperbolicAlternativeScore(targetBall, candBall);
            scored.push({
              site: candSite,
              geodesicDistance: Number(lDist.toFixed(4)),
              alternativeScore: altScore,
              sameCategory: candSite.categoryId === targetSite.categoryId,
            });
          }
          scored.sort((a, b) => b.alternativeScore - a.alternativeScore);
          return {
            hits: scored.slice(0, limit),
            manifold: "lorentz-hyperboloid",
            semanticAvailable: true,
          };
        }
      }

      // 启发式双曲特征投影兜底（无本地向量时按同分类 + 标签 Jaccard 构造双曲坐标）
      const allSites = await ctx.repo.listSites({ limit: 200 });
      const targetTags = new Set(targetSite.tags ?? []);
      const fallbackHits = allSites
        .filter((s) => s.id !== siteId && s.status !== "broken")
        .map((cand) => {
          const candTags = new Set(cand.tags ?? []);
          let overlap = 0;
          for (const t of targetTags) if (candTags.has(t)) overlap++;
          const union = new Set([...targetTags, ...candTags]).size || 1;
          const jaccard = overlap / union;
          const catMatch = cand.categoryId === targetSite.categoryId ? 1 : 0;

          const uBall = [0.45, 0.35, 0.25];
          const vBall = [
            0.45 + (1 - catMatch) * 0.25,
            0.35 + (1 - jaccard) * 0.3,
            0.25,
          ];
          const lDist = lorentzDistance(poincareToLorentz(uBall), poincareToLorentz(vBall));
          const altScore = computeHyperbolicAlternativeScore(uBall, vBall);
          return {
            site: cand,
            geodesicDistance: Number(lDist.toFixed(4)),
            alternativeScore: Number((altScore + catMatch * 0.15 + jaccard * 0.2).toFixed(4)),
            sameCategory: Boolean(catMatch),
          };
        })
        .sort((a, b) => b.alternativeScore - a.alternativeScore)
        .slice(0, limit);

      return {
        hits: fallbackHits,
        manifold: "lorentz-heuristic",
        semanticAvailable: false,
      };
    } catch {
      return { hits: [], manifold: "none", semanticAvailable: false };
    }
  });

  /** 在线 Discounted-LinUCB 检索模型状态探针 */
  app.get("/api/search/linucb", { config: { scope: "public" } }, async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    return ctx.search.getLinUCBStatus(q.q || "react");
  });

  /**
   * 客户端本地差分隐私 (Local Differential Privacy, LDP Laplace) 联邦协同推荐排序端点
   */
  app.post("/api/rank/federated", { config: { scope: "public" } }, async (req, reply) => {
    const body = z.object({
      localVector: z.array(z.number()),
      globalVector: z.array(z.number()).optional(),
      candidates: z.array(z.object({
        id: z.string(),
        name: z.string(),
        featureVector: z.array(z.number()),
      })).optional(),
      personalWeight: z.number().min(0).max(1).default(0.6),
      privatize: z.boolean().default(false),
      epsilon: z.number().positive().default(1.0),
    }).safeParse(req.body ?? {});

    if (!body.success) {
      reply.code(400);
      return { error: "参数无效", detail: body.error.issues };
    }

    let candidates = body.data.candidates;
    if (!candidates || candidates.length === 0) {
      const sites = await ctx.repo.listSites({ limit: 30 });
      const dim = body.data.localVector.length || 4;
      candidates = sites.map((s, idx) => ({
        id: s.id,
        name: s.title,
        featureVector: Array.from({ length: dim }, (_, i) => Math.round((Math.sin(idx + i + 1) * 0.5 + 0.5) * 100) / 100),
      }));
    }

    const globalVec = body.data.globalVector ?? body.data.localVector.map(() => 0.5);
    const results = rankItemsWithPrivacy(
      body.data.localVector,
      globalVec,
      candidates,
      body.data.personalWeight
    );

    const privatized = body.data.privatize ? privatizeVector(body.data.localVector, body.data.epsilon) : undefined;
    return {
      ok: true,
      count: results.length,
      recommendations: results,
      privacy: body.data.privatize ? { epsilon: body.data.epsilon, privatizedVector: privatized } : undefined,
    };
  });
};
