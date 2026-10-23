/**
 * 分面管理与检索路由 (Faceted Taxonomy Routes)
 *
 * 负责受控分面词表定义、分类/标签下分面热度分布统计，
 * 以及单个站点的分面属性维护。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { CONTROLLED_FACETS } from "@navhub/core";
import type { AppContext } from "../context.ts";
import { badRequest, notFound } from "./shared.ts";

export const facetRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /**
   * 获取分面体系定义及可选的类目/标签作用域下的取值分布频次
   */
  app.get(
    "/api/facets",
    { config: { scope: "public", cache: { maxAge: 60, etag: true } } },
    async (req) => {
      const q = (req.query ?? {}) as Record<string, string>;
      const categoryId = q.categoryId?.trim() || undefined;
      const tag = q.tag?.trim() || undefined;

      const summary = await ctx.repo.listFacetsSummary({ categoryId, tag });
      return {
        ok: true,
        definitions: CONTROLLED_FACETS,
        facets: summary,
      };
    }
  );

  /**
   * 获取指定站点的分面属性
   */
  app.get("/api/sites/:id/facets", { config: { scope: "public" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const site = await ctx.repo.getSite(id);
    if (!site) return notFound(reply, "站点不存在");

    const facets = await ctx.repo.getSiteFacets(id);
    return { ok: true, siteId: id, facets };
  });

  /**
   * 更新指定站点的分面属性
   */
  app.put("/api/sites/:id/facets", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const site = await ctx.repo.getSite(id);
    if (!site) return notFound(reply, "站点不存在");

    const body = z
      .object({
        facets: z
          .record(
            z.string().min(1).max(50),
            z.array(z.string().min(1).max(100)).max(50),
          )
          .refine((obj) => Object.keys(obj).length <= 50, {
            message: "最多允许 50 个分面维度",
          }),
      })
      .safeParse(req.body);

    if (!body.success) {
      return badRequest(reply, "参数无效", body.error.issues);
    }

    await ctx.repo.setSiteFacets(id, body.data.facets);
    await ctx.repo.audit({
      ip: req.ip,
      actor: req.auth.actor,
      actorKind: req.auth.kind,
      action: "site.facets.update",
      target: id,
      diff: body.data.facets,
    });

    return { ok: true, siteId: id, facets: body.data.facets };
  });
};
