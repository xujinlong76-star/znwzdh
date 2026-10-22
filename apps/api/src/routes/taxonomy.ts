/**
 * 分类与标签体系智能治理路由 (Taxonomy Governance Routes)
 *
 * 提供全站分类/标签健康度审计、治理提案查询、单条/批量人工审核采纳与驳回接口。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.ts";
import { badRequest, parsePagination } from "./shared.ts";

export const taxonomyRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /**
   * 查询治理提案列表
   */
  app.get("/api/taxonomy/proposals", { config: { scope: "read" } }, async (req) => {
    const query = req.query as Record<string, string | undefined>;
    const status = query.status;
    const kind = query.kind;
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });

    return ctx.repo.listTaxonomyProposals({ status, kind, limit, offset });
  });

  /**
   * 触发分类与标签全站健康度审计
   */
  app.post("/api/taxonomy/audit", { config: { scope: "write" } }, async (req, reply) => {
    const body = z.object({
      dryRun: z.boolean().optional().default(false),
      siteLimit: z.number().int().positive().optional().default(500),
    }).safeParse(req.body ?? {});

    if (!body.success) {
      return badRequest(reply, "参数无效", body.error.issues);
    }

    const result = await ctx.repo.runTaxonomyAudit(body.data);
    return {
      ok: true,
      dryRun: body.data.dryRun,
      proposalsCount: result.proposalsCount,
      byKind: result.byKind,
      proposals: result.proposals,
    };
  });

  /**
   * 采纳单条治理提案并执行相关业务变更
   *
   * body 可选：category_gap 需要审核人补齐「建在哪个父级下 / 英文名 / 图标」。
   * 一级根不由提案新增 —— 那必须是类目管理页上的显式决策。
   */
  app.post("/api/taxonomy/proposals/:id/apply", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const actor = req.auth.actor ?? "admin";
    const body = z
      .object({
        parentId: z.string().nullable().optional(),
        titleEn: z.string().max(60).nullable().optional(),
        icon: z.string().max(40).nullable().optional(),
      })
      .safeParse(req.body ?? {});
    if (!body.success) {
      return badRequest(reply, "参数无效", body.error.issues);
    }

    try {
      const result = await ctx.repo.applyTaxonomyProposal(id, actor, body.data);
      return { ok: true, message: result.message, proposal: result.proposal };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return badRequest(reply, msg);
    }
  });

  /**
   * 驳回单条治理提案
   */
  app.post("/api/taxonomy/proposals/:id/dismiss", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const actor = req.auth.actor ?? "admin";

    try {
      const result = await ctx.repo.dismissTaxonomyProposal(id, actor);
      return { ok: true, proposal: result.proposal };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return badRequest(reply, msg);
    }
  });

  /**
   * 批量采纳或驳回治理提案
   */
  app.post("/api/taxonomy/proposals/batch", { config: { scope: "write" } }, async (req, reply) => {
    const body = z.object({
      ids: z.array(z.string()).min(1).max(100),
      action: z.enum(["apply", "dismiss"]),
    }).safeParse(req.body ?? {});

    if (!body.success) {
      return badRequest(reply, "参数无效", body.error.issues);
    }

    const { ids, action } = body.data;
    const actor = req.auth.actor ?? "admin";
    let successCount = 0;
    const errors: string[] = [];

    for (const id of ids) {
      try {
        if (action === "apply") {
          await ctx.repo.applyTaxonomyProposal(id, actor);
        } else {
          await ctx.repo.dismissTaxonomyProposal(id, actor);
        }
        successCount++;
      } catch (err) {
        errors.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return {
      ok: true,
      action,
      total: ids.length,
      successCount,
      failedCount: errors.length,
      errors,
    };
  });
};
