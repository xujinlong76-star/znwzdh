/**
 * 投稿与审核（收编中枢）
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { indexSite } from "../index-site.ts";
import { submissionNumber } from "./shared.ts";

import type { AppContext } from "../context.ts";

export const submissionRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* -------------------------- 投稿 -------------------------- */

  /**
   * 匿名投稿：创建 status=pending、source=submission 的站点，进入审核队列。
   * 比全局限流（300/min）严格得多：5 次/小时/IP，防垃圾提交。
   * 重复 URL 返回 409（与 create_site 一致的去重语义）。
   */
  app.post("/api/submissions", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (req, reply) => {
    const body = z.object({
      title: z.string().min(1).max(120),
      url: z.string().url(),
      description: z.string().max(500).default(""),
      categoryId: z.string().min(1),
      subCategoryId: z.string().nullable().optional(),
      submitterNote: z.string().max(500).nullable().optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { success: false, message: "请填写完整的投稿信息" }; }

    const dup = await ctx.repo.findSiteByUrl(body.data.url);
    if (dup) {
      reply.code(409);
      return { success: false, message: "该网址已存在", siteId: dup.id };
    }

    const category = await ctx.repo.getCategory(body.data.categoryId);
    if (!category) { reply.code(400); return { success: false, message: "投稿类目不存在" }; }

    const site = await ctx.repo.createSite({
      url: body.data.url,
      title: body.data.title,
      description: body.data.description || null,
      categoryId: body.data.categoryId,
      subCategoryId: body.data.subCategoryId ?? null,
      status: "pending",
      source: "submission",
    });
    await indexSite(ctx, site.id, site.title, site.description ?? null, site.url);
    await ctx.repo.recordEvent("submission", { siteId: site.id, categoryId: category.id }).catch(() => undefined);
    await ctx.repo.audit({ ip: req.ip, actor: "anonymous", actorKind: "user", action: "site.submit", target: site.id, diff: { url: site.url, title: site.title } });
    reply.code(201);
    return { success: true, message: "投稿已提交，等待审核", siteId: site.id };
  });

  /* --------------------- 投稿审核（收编中枢） --------------------- */

  /**
   * 投稿列表（审核队列数据源）。
   *
   * 与 Next 端 /api/submissions 的 GitHub 通道**同形状**（success + submissions），
   * 前端审核队列无论走哪条通道都拿到同样的数据结构。
   * number 是 site.id 的稳定数值 hash（见 submissionNumber），
   * 让沿用 GitHub Issue 语义的前端拿到的 id 仍是 GitHub 路径可用的形态。
   */
  app.get("/api/submissions", { config: { scope: "read", cache: { maxAge: 0 } } }, async (req, reply) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const requested = q.status ?? "pending";
    const statusMap: Record<string, string | undefined> = {
      pending: "pending", approved: "active", rejected: "archived", all: undefined,
    };
    if (!(requested in statusMap)) { reply.code(400); return { success: false, message: "无效的状态筛选" }; }
    const siteStatus = statusMap[requested];
    // 精准按 source=submission 过滤，避免全站站点 >200 时投稿被截断
    const sites = await ctx.repo.listSites({
      source: "submission",
      status: siteStatus as never,
      limit: 1000,
    });
    const submissions = sites
      .map((site) => {
        const isPending = site.status === "pending";
        const label = isPending ? "pending" : (site.status === "active" ? "approved" : "rejected");
        return {
          id: submissionNumber(site.id),
          number: submissionNumber(site.id),
          title: site.title,
          body: site.description ?? "",
          state: isPending ? "open" : "closed",
          created_at: new Date(site.createdAt).toISOString(),
          updated_at: new Date(site.updatedAt).toISOString(),
          html_url: site.url,
          submissionData: {
            title: site.title,
            url: site.url,
            description: site.description ?? "",
            category: site.categoryId,
            subcategory: site.subCategoryId ?? undefined,
          },
          _status: site.status,
          _label: label,
          siteId: site.id,
        };
      });
    return { success: true, submissions };
  });

  /**
   * 审核投稿（approve → active / reject → archived）。
   *
   * :number 是前端沿用的 GitHub Issue number（site.id 的 hash），这里反查回
   * 真实 site id——此前 Next 的 hub 回退直接拿 hash number 调 /api/sites/:id，
   * 必然 404，审核按钮在 NavHub 模式下是**静默失效**的（本次收编修复）。
   * 审核动作落 submission.approve / submission.reject 审计（此前只有 POST 有审计）。
   */
  app.patch("/api/submissions/:number", { config: { scope: "write" } }, async (req, reply) => {
    const { number } = req.params as { number: string };
    const body = z.object({
      action: z.enum(["approve", "reject"]),
      reason: z.string().max(500).optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { success: false, message: "无效的操作" }; }

    const wanted = Number(number);
    if (!Number.isFinite(wanted)) { reply.code(400); return { success: false, message: "无效的投稿编号" }; }
    // 精准按 source=submission 过滤查询反查 hash，不受全站常规站点数量影响
    // 注意：djb2 截断风险——投稿超 1000 会被 limit 截断而 404；兼容旧前端，新前端请直传 siteId。
    const candidates = await ctx.repo.listSites({ source: "submission", limit: 1000 });
    const site = candidates.find((s) => submissionNumber(s.id) === wanted);
    if (!site) { reply.code(404); return { success: false, message: "投稿不存在" }; }

    const nextStatus = body.data.action === "approve" ? "active" : "archived";
    await ctx.repo.updateSite(site.id, { status: nextStatus as never });
    await ctx.repo.audit({
      ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind,
      action: body.data.action === "approve" ? "submission.approve" : "submission.reject",
      target: site.id, diff: { url: site.url, title: site.title, reason: body.data.reason ?? null },
    });
    return {
      success: true,
      message: body.data.action === "approve" ? "投稿已通过并已上架" : "投稿已拒绝",
      siteId: site.id,
    };
  });

};
