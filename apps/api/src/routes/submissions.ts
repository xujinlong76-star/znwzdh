/**
 * 投稿与审核（收编中枢）
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { httpUrl } from "@navhub/core";
import { indexSite } from "../index-site.ts";
import { ADMIN_NOTIFICATION_IDENTITY } from "../notifications.ts";
import { identityTrusted, requestIdentityOf, submissionNumber } from "./shared.ts";

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
      url: httpUrl(),
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

    // 投稿正文不参与归属；只使用经过身份闸门的凭据/签名身份。
    const identityRequest = { auth: req.auth, headers: req.headers, query: req.query };
    const rawIdentity = identityTrusted(ctx, req) ? requestIdentityOf(identityRequest) : null;
    const identity = rawIdentity ? await ctx.repo.resolveIdentity(rawIdentity) : null;
    if (rawIdentity === ADMIN_NOTIFICATION_IDENTITY || identity === ADMIN_NOTIFICATION_IDENTITY) {
      reply.code(403);
      return { success: false, message: "保留身份不能投稿" };
    }
    const owner = identity && !identity.startsWith("anon-") && identity !== "anonymous" &&
      !rawIdentity?.startsWith("anon-") && rawIdentity !== "anonymous" ? identity : null;
    const site = await ctx.repo.withTransaction(async () => {
      const created = await ctx.repo.createSite({
        url: body.data.url,
        title: body.data.title,
        description: body.data.description || null,
        categoryId: body.data.categoryId,
        subCategoryId: body.data.subCategoryId ?? null,
        status: "pending",
        source: "submission",
      });
      if (owner) {
        await ctx.repo.run(
          "INSERT INTO submission_owners (site_id, identity, created_at) VALUES (?,?,?)",
          [created.id, owner, created.createdAt],
        );
      }
      await ctx.repo.audit({ ip: req.ip, actor: identity || rawIdentity || "anonymous", actorKind: "user", action: "site.submit", target: created.id, diff: { url: created.url, title: created.title } });
      await ctx.repo.emitNotification({
        identity: ADMIN_NOTIFICATION_IDENTITY,
        idempotencyKey: `submission:${created.id}:pending`,
        kind: "submission_pending",
        title: "有新投稿待审核",
        body: JSON.stringify({ siteId: created.id }),
      });
      return created;
    });
    await indexSite(ctx, site.id, site.title, site.description ?? null, site.url);
    await ctx.repo.recordEvent("submission", { siteId: site.id, categoryId: category.id }).catch(() => undefined);
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
   * :number 优先支持新前端直传 siteId；若查无结果且为数字则兼容旧版 djb2 哈希编号查找。
   * 审核动作落 submission.approve / submission.reject 审计（此前只有 POST 有审计）。
   */
  app.patch("/api/submissions/:number", { config: { scope: "admin" } }, async (req, reply) => {
    const { number } = req.params as { number: string };
    const body = z.object({
      action: z.enum(["approve", "reject"]),
      reason: z.string().max(500).optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { success: false, message: "无效的操作" }; }

    // 优先按真实 siteId 匹配；若未匹配且传入的是纯数字编号，回退按 djb2 哈希编号查找
    let site = await ctx.repo.getSite(number);
    if (!site || site.source !== "submission") {
      // 关键：非投稿站点必须显式清空。原实现只在「纯数字」分支里重新赋值，
      // UUID 形态的普通站点会原样留在 site 里，随后被 updateSite 改写状态——
      // 任何 write 令牌都能借审核接口下架/强行上架任意站点。
      site = null;
      const wanted = Number(number);
      if (Number.isFinite(wanted)) {
        const candidates = await ctx.repo.listSites({ source: "submission", limit: 1000 });
        site = candidates.find((s) => submissionNumber(s.id) === wanted) ?? null;
      }
    }
    if (!site) { reply.code(404); return { success: false, message: "投稿不存在" }; }

    const nextStatus = body.data.action === "approve" ? "active" : "archived";
    const siteId = site.id;
    const transitionId = randomUUID();
    const reviewed = await ctx.repo.withTransaction(async () => {
      await ctx.repo.raw(
        "SELECT id FROM sites WHERE id = ?" + (ctx.repo.db.dialect === "pg" ? " FOR UPDATE" : ""),
        [siteId],
      );
      const current = await ctx.repo.getSite(siteId);
      if (!current || current.source !== "submission") return null;
      if (current.status === nextStatus) return current;
      await ctx.repo.updateSite(siteId, { status: nextStatus });
      await ctx.repo.audit({
        ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind,
        action: body.data.action === "approve" ? "submission.approve" : "submission.reject",
        target: siteId, diff: { url: current.url, title: current.title, reason: body.data.reason ?? null },
      });
      const mapping = (await ctx.repo.raw("SELECT identity FROM submission_owners WHERE site_id = ?", [siteId]))[0];
      const owner = mapping ? await ctx.repo.resolveIdentity(String(mapping.identity)) : null;
      if (owner && owner !== ADMIN_NOTIFICATION_IDENTITY && !owner.startsWith("anon-") && owner !== "anonymous") {
        await ctx.repo.emitNotification({
          identity: owner,
          idempotencyKey: `submission:${siteId}:review:${transitionId}`,
          kind: body.data.action === "approve" ? "submission_approved" : "submission_rejected",
          title: body.data.action === "approve" ? "投稿已通过" : "投稿未通过",
          body: JSON.stringify({ siteId }),
        });
      }
      return current;
    });
    if (!reviewed) { reply.code(404); return { success: false, message: "投稿不存在" }; }
    if (body.data.action === "approve") {
      await indexSite(ctx, reviewed.id, reviewed.title, reviewed.description ?? null, reviewed.url);
    }
    return {
      success: true,
      message: body.data.action === "approve" ? "投稿已通过并已上架" : "投稿已拒绝",
      siteId: site.id,
    };
  });

};
