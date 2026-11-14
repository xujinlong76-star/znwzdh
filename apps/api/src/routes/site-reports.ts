/**
 * 站点纠错上报与复核（升级第 10 条）。
 *
 * 详情页是首个调用方；搜索 P0-4 落地时，它的纠错弹窗调同一个
 * `reportSiteIssue`（`source: 'search'`），不建第二端点、不建第二张表
 * （见附录 B · 第 10 条纠错接口预留）。
 *
 * 红线：上报只进复核队列，绝不直接改数据；匿名可报，不设登录门槛。
 * 限流是防刷的底线（10 次/小时/IP），不用登录换取。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { AppContext } from "../context.ts";

export const SITE_REPORT_KINDS = [
  "wrong-description",
  "dead-link",
  "wrong-category",
  "wrong-pricing",
  "other",
] as const;

export type SiteReportKind = (typeof SITE_REPORT_KINDS)[number];

export const SITE_REPORT_SOURCES = ["site-detail", "search"] as const;

export type SiteReportSource = (typeof SITE_REPORT_SOURCES)[number];

export const SITE_REPORT_STATUSES = ["open", "in_progress", "resolved", "rejected"] as const;

export type SiteReportStatus = (typeof SITE_REPORT_STATUSES)[number];

const KIND_LABELS: Record<SiteReportKind, string> = {
  "wrong-description": "描述写错",
  "dead-link": "链接打不开",
  "wrong-category": "分类不对",
  "wrong-pricing": "定价不对",
  other: "其它",
};

export const SITE_REPORT_KIND_LABELS = KIND_LABELS;

const ReportBody = z.object({
  kinds: z
    .array(z.enum(SITE_REPORT_KINDS))
    .min(1, "请至少选择一种问题类型"),
  detail: z
    .string()
    .trim()
    .min(5, "请填写 5–2000 字的具体情况")
    .max(2000, "请填写 5–2000 字的具体情况"),
  contact: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  source: z.enum(SITE_REPORT_SOURCES),
});

const ReviewBody = z.object({
  status: z.enum(SITE_REPORT_STATUSES),
});

export interface SiteReportRow {
  id: string;
  site_id: string;
  kinds: string;
  detail: string;
  contact: string | null;
  source: string;
  status: string;
  created_at: number;
}

function toReport(row: SiteReportRow, site: { title: string; url: string } | null) {
  let kinds: SiteReportKind[] = [];
  try {
    const parsed: unknown = JSON.parse(row.kinds);
    if (Array.isArray(parsed)) {
      kinds = parsed.filter((k): k is SiteReportKind =>
        typeof k === "string" && (SITE_REPORT_KINDS as readonly string[]).includes(k),
      );
    }
  } catch {
    kinds = [];
  }
  return {
    id: row.id,
    siteId: row.site_id,
    siteTitle: site?.title ?? null,
    siteUrl: site?.url ?? null,
    kinds,
    kindLabels: kinds.map((k) => KIND_LABELS[k]),
    detail: row.detail,
    contact: row.contact,
    source: row.source,
    status: row.status,
    createdAt: row.created_at,
  };
}

export const siteReportRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* -------------------------- 上报（匿名可报） -------------------------- */

  /**
   * 上报站点问题：匿名可报，10 次/小时/IP。
   * siteId 不存在 → 404；kinds 为空 → 400；detail 不在 5–2000 字 → 400。
   * 成功只返回 { ok, id }（附录 B 冻结契约），不直接改任何站点数据。
   */
  app.post(
    "/api/sites/:id/reports",
    {
      config: {
        scope: "public",
        rateLimit: { max: 10, timeWindow: "1 hour" },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const site = await ctx.repo.getSite(id);
      if (!site) {
        reply.code(404);
        return { success: false, message: "站点不存在" };
      }
      const body = ReportBody.safeParse(req.body ?? {});
      if (!body.success) {
        reply.code(400);
        return { success: false, message: body.error.issues[0]?.message ?? "请填写完整的上报信息" };
      }
      const reportId = randomUUID();
      await ctx.repo.run(
        "INSERT INTO site_reports (id, site_id, kinds, detail, contact, source, status, created_at) VALUES (?,?,?,?,?,?,?,?)",
        [
          reportId,
          site.id,
          JSON.stringify(body.data.kinds),
          body.data.detail,
          body.data.contact,
          body.data.source,
          "open",
          Date.now(),
        ],
      );
      await ctx.repo.audit({
        ip: req.ip,
        actor: "anonymous",
        actorKind: "user",
        action: "site.report",
        target: site.id,
        diff: { reportId, kinds: body.data.kinds, source: body.data.source },
      });
      reply.code(201);
      return { ok: true, id: reportId };
    },
  );

  /* -------------------------- 复核（管理员） -------------------------- */

  /**
   * 复核列表：只读，管理员 scope。status 默认为 open；
   * all 不过滤。按创建时间倒序，limit 默认 50、上限 200。
   */
  app.get(
    "/api/admin/site-reports",
    { config: { scope: "admin", cache: { maxAge: 0 } } },
    async (req, reply) => {
      const q = (req.query ?? {}) as Record<string, string>;
      const requested = q.status ?? "open";
      if (!["open", "in_progress", "resolved", "rejected", "all"].includes(requested)) {
        reply.code(400);
        return { success: false, message: "无效的状态筛选" };
      }
      const limit = Math.min(Math.max(Number(q.limit ?? 50) || 50, 1), 200);
      const offset = Math.max(Number(q.offset ?? 0) || 0, 0);
      const where = requested === "all" ? "" : "WHERE status = ?";
      const params = requested === "all" ? [] : [requested];
      const totalRows = (await ctx.repo.raw(
        `SELECT COUNT(*) AS n FROM site_reports ${where}`,
        params,
      )) as Array<{ n: number }>;
      const rows = (await ctx.repo.raw(
        `SELECT * FROM site_reports ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      )) as SiteReportRow[];
      const items = [];
      for (const row of rows) {
        const site = await ctx.repo.getSite(row.site_id);
        items.push(toReport(row, site ? { title: site.title, url: site.url } : null));
      }
      return { success: true, items, total: totalRows[0]?.n ?? 0, limit, offset };
    },
  );

  /**
   * 复核流转：open → in_progress → resolved / rejected。
   * 只改状态，不动任何站点数据；流转落审计。
   */
  app.patch(
    "/api/admin/site-reports/:id",
    { config: { scope: "admin" } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = ReviewBody.safeParse(req.body ?? {});
      if (!body.success) {
        reply.code(400);
        return { success: false, message: "无效的状态" };
      }
      const rows = (await ctx.repo.raw(
        "SELECT * FROM site_reports WHERE id = ?",
        [id],
      )) as SiteReportRow[];
      const row = rows[0];
      if (!row) {
        reply.code(404);
        return { success: false, message: "上报不存在" };
      }
      if (row.status !== body.data.status) {
        await ctx.repo.run("UPDATE site_reports SET status = ? WHERE id = ?", [
          body.data.status,
          id,
        ]);
        await ctx.repo.audit({
          ip: req.ip,
          actor: req.auth.actor,
          actorKind: req.auth.kind,
          action: "site.report.review",
          target: row.site_id,
          diff: { reportId: id, from: row.status, to: body.data.status },
        });
      }
      return { success: true, id, status: body.data.status };
    },
  );
};
