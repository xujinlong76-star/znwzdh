/**
 * 架构配方 / 竞品对比 / 确定性 Favicon / 自洽愈合
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  analyzeStackCompatibility,
  autoClusterSites,
  computeGraphCentrality,
  findMatchingArchitectureRecipe,
  findShortestTechPath,
  generateDeterministicSvg,
  parseTechComparisonQuery,
  PRESET_RECIPES,
  PRESET_TECH_GRAPH,
  runAutonomousHealing,
} from "@navhub/core";

import { buildWaybackSaveUrl, buildWaybackSnapshotUrl, normalizeTargetUrl, parseWaybackAvailabilityResponse, type WaybackSnapshotInfo } from "@navhub/core";
import { guardedFetch } from "@navhub/ai";
import type { AppContext } from "../context.ts";

export const recipeRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* ----------------- 架构配方 & 竞品对比 & 确定性 Favicon ----------------- */

  /**
   * Graph-RAG 多跳技术栈链路配方查询
   */
  app.get("/api/recipes", { config: { scope: "public", cache: { maxAge: 300, etag: true } } }, async (req) => {
    const q = String((req.query as Record<string, string>)?.q ?? "").trim();
    if (!q) {
      return { items: PRESET_RECIPES };
    }
    const matched = findMatchingArchitectureRecipe(q);
    return { item: matched, items: matched ? [matched] : [] };
  });

  /**
   * 端侧竞品并排对比矩阵合成
   */
  app.get("/api/comparisons", { config: { scope: "public", cache: { maxAge: 300, etag: true } } }, async (req) => {
    const q = String((req.query as Record<string, string>)?.q ?? "").trim();
    if (!q) {
      return { ok: false, matrix: null };
    }
    const matrix = parseTechComparisonQuery(q);
    return { ok: Boolean(matrix), matrix };
  });

  /**
   * 结构化技术知识图谱：双向最短演进链路寻路 (Dijkstra)
   */
  app.get("/api/graph/path", { config: { scope: "public", cache: { maxAge: 60 } } }, async (req, reply) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const from = String(q.from ?? "").trim();
    const to = String(q.to ?? "").trim();
    if (!from || !to) {
      reply.code(400);
      return { ok: false, error: "需要指定 from 与 to 查询参数" };
    }
    const pathResult = findShortestTechPath(from, to, PRESET_TECH_GRAPH);
    return { ok: true, result: pathResult };
  });

  /**
   * 结构化技术知识图谱：技术栈兼容性诊断与补齐建议
   */
  app.get("/api/graph/compatibility", { config: { scope: "public", cache: { maxAge: 60 } } }, async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const rawTechs = String(q.techs ?? "").trim();
    const techList = rawTechs ? rawTechs.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const report = analyzeStackCompatibility(techList, PRESET_TECH_GRAPH);
    return { ok: true, report };
  });

  /**
   * 结构化技术知识图谱：Kleinberg HITS 权威度与枢纽度分析
   */
  app.get("/api/graph/centrality", { config: { scope: "public", cache: { maxAge: 300 } } }, async () => {
    const centrality = computeGraphCentrality(PRESET_TECH_GRAPH);
    return { ok: true, ...centrality };
  });


  /**
   * 确定性 SVG Favicon 代理端点（解决小众/外网站点 Favicon 裂开或 CORS 阻断）
   */
  app.get("/api/favicon/:id", { config: { scope: "public", cache: { maxAge: 86400, etag: true } } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const site = await ctx.repo.getSite(id);
    const title = site ? site.title : id;
    const url = site ? site.url : undefined;
    const svg = generateDeterministicSvg(title, url);
    reply.type("image/svg+xml; charset=utf-8");
    return svg;
  });

  /**
   * AI 自动自愈端点：对故障/失效站点诊断、提取 Wayback 快照并在同生态推荐最佳替代品
   */
  app.post("/api/sites/:id/heal", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const site = await ctx.repo.getSite(id);
    if (!site) { reply.code(404); return { error: "站点不存在" }; }

    const peers = await ctx.repo.listSites({ categoryId: site.categoryId, status: "active", limit: 20 });
    const report = runAutonomousHealing({
      siteId: site.id,
      url: site.url,
      title: site.title,
      categoryId: site.categoryId,
      tags: site.tags,
      availablePeers: peers,
    });

    await ctx.repo.audit({
      actor: req.auth.actor,
      actorKind: req.auth.kind,
      action: "site.heal",
      target: site.id,
      diff: {
        diagnosis: report.diagnosis,
        recommendedAction: report.recommendedAction,
        topReplacement: report.suggestedReplacements[0]?.url,
      },
    });

    return { ok: true, report };
  });

  /**
   * Wayback 时间机器自愈端点：查询指定站点的历史镜像快照与瞬时访问入口
   */
  app.get("/api/sites/:id/wayback", { config: { scope: "public", cache: { maxAge: 300 } } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const site = await ctx.repo.getSite(id);
    if (!site) {
      reply.code(404);
      return { ok: false, error: "站点不存在" };
    }
    const cleanUrl = normalizeTargetUrl(site.url);
    let snapshot: WaybackSnapshotInfo = { available: false };
    try {
      const apiUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(cleanUrl)}`;
      const res = await guardedFetch(apiUrl, { timeoutMs: 3000 });
      if (res.status === 200) {
        const data = JSON.parse(res.body);
        snapshot = parseWaybackAvailabilityResponse(data);
      }
    } catch {
      // 网络离线或超时降级
    }

    return {
      ok: true,
      siteId: site.id,
      url: cleanUrl,
      snapshot,
      recoveryUrl: buildWaybackSnapshotUrl(cleanUrl, snapshot.timestamp),
      saveUrl: buildWaybackSaveUrl(cleanUrl),
    };
  });

  /**
   * Next-Gen 5.0 语义聚类与自适应类目生成端点
   * 对未分类、批量导入或指定分类下的站点进行 K-Means++ 语义聚类与命名生成
   */
  app.post("/api/sites/cluster", { config: { scope: "public" } }, async (req, reply) => {
    const body = z.object({
      siteIds: z.array(z.string()).optional(),
      categoryId: z.string().optional(),
      targetK: z.number().int().min(1).max(20).optional().default(4),
    }).safeParse(req.body ?? {});

    if (!body.success) {
      reply.code(400);
      return { error: "参数无效", detail: body.error.issues };
    }

    let sitesToCluster: Array<{ id: string; title: string; url: string; tags: string[] }> = [];

    if (body.data.siteIds && body.data.siteIds.length > 0) {
      const all = await Promise.all(body.data.siteIds.map((id) => ctx.repo.getSite(id)));
      sitesToCluster = all.filter((s): s is NonNullable<typeof s> => Boolean(s)).map((s) => ({
        id: s.id,
        title: s.title,
        url: s.url,
        tags: s.tags || [],
      }));
    } else {
      const list = await ctx.repo.listSites({
        categoryId: body.data.categoryId,
        limit: 100,
        status: "active",
      });
      sitesToCluster = list.map((s) => ({
        id: s.id,
        title: s.title,
        url: s.url,
        tags: s.tags || [],
      }));
    }

    if (sitesToCluster.length === 0) {
      return { totalItems: 0, clusterCount: 0, clusters: [], averageCohesion: 100 };
    }

    const result = autoClusterSites(sitesToCluster, body.data.targetK);
    return { ok: true, result };
  });

};
