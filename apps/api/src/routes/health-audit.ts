/**
 * 站点自治巡检与自愈路由 (Site Health Audit & Autonomous Healing Routes)
 *
 * 核心能力：
 * 1. GET  /api/admin/audit/report - 获取全站健康度评分、异常站点诊断与同生态替代建议列表
 * 2. POST /api/admin/audit/scan   - 触发一次站点自治巡检并生成诊断报告
 * 3. POST /api/admin/audit/apply  - 一键采纳自愈建议（Wayback 镜像修复或替代站点平替）
 * 4. POST /api/sites/:id/recommend-alternative - 调用 Agnes 3.0 Flash 生成精选替代品
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  runAutonomousHealing,
  buildWaybackSnapshotUrl,
  normalizeTargetUrl,
  type SiteHealthAuditSummary,
  type SiteHealthAuditIssue,
} from "@navhub/core";
import { indexSite } from "../index-site.ts";
import { llmProviderReady, resolveLlm } from "../llm-config.ts";
import { callLlm } from "../llm-usage.ts";
import type { AppContext } from "../context.ts";

export const healthAuditRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /**
   * 1. 获取全站健康度评分与自愈提案
   */
  app.get("/api/admin/audit/report", { config: { scope: "read" } }, async () => {
    const sites = await ctx.repo.listSites({ limit: 500 });
    const totalSites = sites.length;
    const activeSites = sites.filter((s) => s.status === "active");
    const brokenSites = sites.filter((s) => s.status === "broken" || s.status === "archived");

    const issues: SiteHealthAuditIssue[] = [];

    for (const site of brokenSites) {
      const peers = sites.filter(
        (p) => p.categoryId === site.categoryId && p.id !== site.id && p.status === "active"
      );
      const healing = runAutonomousHealing({
        siteId: site.id,
        url: site.url,
        title: site.title,
        categoryId: site.categoryId,
        tags: site.tags,
        availablePeers: peers,
      });

      issues.push({
        siteId: site.id,
        url: site.url,
        title: site.title,
        status: site.status as any,
        cause: healing.diagnosis.cause,
        severity: healing.diagnosis.severity,
        description: healing.diagnosis.description,
        diagnosedAt: healing.diagnosedAt,
        waybackRecoveryUrl: healing.waybackFallbackUrl,
        suggestedReplacements: healing.suggestedReplacements,
        recommendedAction: healing.recommendedAction,
        autoResolvable: healing.autoResolvable,
      });
    }

    const healthScore = totalSites === 0 ? 100 : Math.round((activeSites.length / totalSites) * 100);

    const summary: SiteHealthAuditSummary = {
      scannedAt: Date.now(),
      totalSites,
      activeCount: activeSites.length,
      brokenCount: brokenSites.length,
      healthScore,
      issues,
    };

    return { ok: true, summary };
  });

  /**
   * 2. 触发一次站点自治巡检
   */
  app.post("/api/admin/audit/scan", { config: { scope: "write" } }, async (req) => {
    const sites = await ctx.repo.listSites({ limit: 100 });
    const totalSites = sites.length;
    const activeSites = sites.filter((s) => s.status === "active");
    const brokenSites = sites.filter((s) => s.status === "broken" || s.status === "archived");

    const issues: SiteHealthAuditIssue[] = [];
    for (const site of brokenSites) {
      const peers = sites.filter(
        (p) => p.categoryId === site.categoryId && p.id !== site.id && p.status === "active"
      );
      const healing = runAutonomousHealing({
        siteId: site.id,
        url: site.url,
        title: site.title,
        categoryId: site.categoryId,
        tags: site.tags,
        availablePeers: peers,
      });

      issues.push({
        siteId: site.id,
        url: site.url,
        title: site.title,
        status: site.status as any,
        cause: healing.diagnosis.cause,
        severity: healing.diagnosis.severity,
        description: healing.diagnosis.description,
        diagnosedAt: healing.diagnosedAt,
        waybackRecoveryUrl: healing.waybackFallbackUrl,
        suggestedReplacements: healing.suggestedReplacements,
        recommendedAction: healing.recommendedAction,
        autoResolvable: healing.autoResolvable,
      });
    }

    await ctx.repo.audit({
      ip: req.ip,
      actor: req.auth.actor,
      actorKind: req.auth.kind,
      action: "audit.site_health_scan",
      diff: { totalSites, brokenFound: brokenSites.length },
    });

    const healthScore = totalSites === 0 ? 100 : Math.round((activeSites.length / totalSites) * 100);

    return {
      ok: true,
      scanned: totalSites,
      summary: {
        scannedAt: Date.now(),
        totalSites,
        activeCount: activeSites.length,
        brokenCount: brokenSites.length,
        healthScore,
        issues,
      },
    };
  });

  /**
   * 3. 一键采纳自愈建议
   */
  app.post("/api/admin/audit/apply", { config: { scope: "write" } }, async (req, reply) => {
    const body = z.object({
      siteId: z.string().min(1),
      action: z.enum(["wayback", "replacement", "dismiss"]),
      targetUrl: z.string().url().optional(),
      targetTitle: z.string().min(1).optional(),
    }).safeParse(req.body ?? {});

    if (!body.success) {
      reply.code(400);
      return { ok: false, error: "参数无效", details: body.error.issues };
    }

    const { siteId, action, targetUrl, targetTitle } = body.data;
    const site = await ctx.repo.getSite(siteId);
    if (!site) {
      reply.code(404);
      return { ok: false, error: "站点不存在" };
    }

    if (action === "dismiss") {
      // 仅标记归档或已审校
      await ctx.repo.updateSite(site.id, { status: "archived" });
      await ctx.repo.audit({
        ip: req.ip,
        actor: req.auth.actor,
        actorKind: req.auth.kind,
        action: "audit.site_dismiss",
        target: site.id,
      });
      return { ok: true, action: "dismiss", siteId: site.id };
    }

    const updates: { url?: string; title?: string; status?: "active" } = { status: "active" };
    if (targetUrl) {
      updates.url = targetUrl;
    }
    if (targetTitle) {
      updates.title = targetTitle;
    }

    const updated = await ctx.repo.updateSite(site.id, updates);
    if (updated) {
      await indexSite(ctx, updated.id, updated.title, updated.description ?? null, updated.url);
      await ctx.repo.audit({
        ip: req.ip,
        actor: req.auth.actor,
        actorKind: req.auth.kind,
        action: "audit.site_healed",
        target: site.id,
        diff: { before: { url: site.url, status: site.status }, after: updates, action },
      });
    }

    return { ok: true, action, site: updated };
  });

  /**
   * 4. 调用 Agnes 3.0 Flash 针对失效站点生成精选替代品
   */
  app.post("/api/sites/:id/recommend-alternative", { config: { scope: "read" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const site = await ctx.repo.getSite(id);
    if (!site) {
      reply.code(404);
      return { ok: false, error: "站点不存在" };
    }

    // 默认回退候选
    const peers = await ctx.repo.listSites({ categoryId: site.categoryId, status: "active", limit: 10 });
    const fallbackList = peers.slice(0, 3).map((p) => ({
      title: p.title,
      url: p.url,
      reason: `同属于分类【${site.categoryId}】的高活跃度替代站点`,
    }));

    try {
      const llm = await resolveLlm(ctx);
      if (llmProviderReady(llm.provider)) {
        const prompt = `你是一个资深互联网工具导航专家。用户收藏的站点【${site.title}】（URL: ${site.url}，描述: ${site.description || "无"}）目前已失效或下线。
请推荐 3 个与该站点功能最相似、目前稳定可用且知名度高的替代工具或官网。
请以 JSON 格式输出，格式必须为严格的 JSON 数组：
[
  { "title": "替代站名称", "url": "https://...", "reason": "为什么推荐它作为平替" }
]
不要输出任何 markdown 格式标记，直接输出纯 JSON 字符串。`;

        const res = await callLlm(ctx, llm, {
          scenario: "health_audit",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
          maxTokens: 600,
          json: true,
        });

        if (res.content) {
          const cleaned = res.content.replace(/^```json/i, "").replace(/```$/i, "").trim();
          const items = JSON.parse(cleaned);
          if (Array.isArray(items) && items.length > 0) {
            return {
              ok: true,
              siteId: site.id,
              model: llm.provider.model,
              recommendations: items.slice(0, 3),
            };
          }
        }
      }
    } catch {
      // 容错降级
    }

    return {
      ok: true,
      siteId: site.id,
      model: "fallback-heuristics",
      recommendations: fallbackList,
    };
  });
};
