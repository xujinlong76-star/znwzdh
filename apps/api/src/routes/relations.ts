/**
 * 站点实体关系图谱与平替生态路由 (Site Relations & Knowledge Graph Routes)
 *
 * 负责站点间强类型关系（平替 alternative / 生态搭配 complementary / 套件 part_of / 基础 upstream / 镜像 mirror / 关联 related）、
 * 双向关联查询与局部自我中心图谱（Ego Knowledge Graph）API。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  CONTROLLED_RELATION_TYPES,
  SiteRelationSchema,
} from "@navhub/core";
import type { AppContext } from "../context.ts";
import { badRequest, notFound } from "./shared.ts";

export const relationRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /**
   * 获取支持的实体关系类型及其对称性、中英文说明
   */
  app.get("/api/relations/types", { config: { scope: "public", cache: { maxAge: 3600 } } }, async () => {
    return { types: Object.values(CONTROLLED_RELATION_TYPES) };
  });

  /**
   * 获取指定站点的双向实体关系
   */
  app.get("/api/sites/:id/relations", { config: { scope: "public", cache: { maxAge: 60, etag: true } } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const site = await ctx.repo.getSite(id);
    if (!site) {
      return notFound(reply, "站点不存在");
    }

    const detailed = await ctx.repo.getDetailedSiteRelations(id);
    return {
      siteId: id,
      siteTitle: site.title,
      outgoing: detailed.outgoing,
      incoming: detailed.incoming,
      all: detailed.all,
      total: detailed.all.length,
    };
  });

  /**
   * 覆盖设置站点的出边实体关系
   */
  app.put("/api/sites/:id/relations", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const site = await ctx.repo.getSite(id);
    if (!site) {
      return notFound(reply, "站点不存在");
    }

    const body = z.object({
      relations: z.array(SiteRelationSchema),
    }).safeParse(req.body ?? {});

    if (!body.success) {
      return badRequest(reply, "参数无效", body.error.issues);
    }

    await ctx.repo.setSiteRelations(id, body.data.relations);

    await ctx.repo.audit({
      ip: req.ip,
      actor: req.auth.actor,
      actorKind: req.auth.kind,
      action: "site.relations.update",
      target: id,
      diff: { count: body.data.relations.length },
    });

    const updated = await ctx.repo.getDetailedSiteRelations(id);
    return {
      ok: true,
      siteId: id,
      total: updated.all.length,
      relations: updated.all,
    };
  });

  /**
   * 获取以该站点为中心的局部知识图谱 (Ego-Graph)
   */
  app.get("/api/sites/:id/graph", { config: { scope: "public", cache: { maxAge: 60, etag: true } } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const maxNeighbors = Math.min(50, Math.max(1, Number((req.query as Record<string, string>)?.maxNeighbors ?? 15)));

    const graph = await ctx.repo.getSiteKnowledgeGraph(id, maxNeighbors);
    if (!graph) {
      return notFound(reply, "站点不存在");
    }

    return graph;
  });
};
