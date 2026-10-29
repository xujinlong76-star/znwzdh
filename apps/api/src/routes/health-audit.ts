/**
 * 站点自治巡检与自愈路由 (Site Health Audit & Autonomous Healing Routes)
 *
 * 核心能力：
 * 1. GET  /api/admin/audit/report - 获取全站健康度评分、异常站点诊断与同生态替代建议列表
 * 2. POST /api/admin/audit/scan   - 触发一次站点自治巡检并生成诊断报告
 * 3. POST /api/admin/audit/apply  - 一键采纳自愈建议（Wayback 镜像修复或替代站点平替）
 * 4. POST /api/sites/:id/recommend-alternative - 用当前配置的大模型生成精选替代品（模型名以响应 model 字段为准）
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  runAutonomousHealing,
  httpUrl,
  type SiteHealthAuditSummary,
  type SiteHealthAuditIssue,
} from "@navhub/core";
import { indexSite } from "../index-site.ts";
import { llmProviderReady, resolveLlm } from "../llm-config.ts";
import { callLlm } from "../llm-usage.ts";
import { checkLlmQuota } from "../llm-quota.ts";
import { probeCandidates, type StructuredReplacementCandidate } from "../candidate-probe.ts";
import { requestIdentityOf, identityTrusted } from "./shared.ts";
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
      targetUrl: httpUrl().optional(),
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
   * 4. 用当前配置的模型针对失效站点生成精选替代品
   *
   * 这里不写死模型名：实际用了谁由 `llm.provider.model` 如实带回，
   * 没接上可用 provider 时统一报 `fallback-heuristics`，绝不冒充「模型跑过了」。
   *
   * 这是一条 `scope:"read"` 的**会花钱**的路由：改造前它没有 rateLimit、
   * 用 `resolveLlm(ctx)` 直接吃系统 key、用量记成 `identity:null`，而且整段
   * try/catch 把失败（包括额度、鉴权、超时）统统吞成一次「看起来成功的」
   * 启发式返回。现在三件事一起修：身份过第二轴、进额度闸门、降级必须写明原因。
   *
   * 降级不是失败：同分类的活跃站点本来就是可用答案，所以额度耗尽时仍回 200
   * 平替列表，只是 `aiDegraded` 与 `retryAfterSeconds` 要如实带上，
   * 前端才不会把「今天到顶了」渲染成「模型坏了」。
   *
   * [AI-4b] 补的是另一半诚实：**每条候选都实测**。改造前这条路由一个探活请求都不发，
   * 模型说什么就返回什么——停放页、拼错的域名、已下线的官网都能顶着「智能平替」的标签
   * 被一键写进 `sites` 并置为 active。现在三条出口（额度降级 / 模型成功 / 模型失败）
   * 都走同一套候选探活（档位、可信度、耗时与口径声明随响应返回），
   * 排序按实测档位，不可达的不删除而是标注 —— 分歧本身就是要给运营看的信息。
   */
  app.post(
    "/api/sites/:id/recommend-alternative",
    { config: { scope: "read", rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
    const { id } = req.params as { id: string };
    const site = await ctx.repo.getSite(id);
    if (!site) {
      reply.code(404);
      return { ok: false, error: "站点不存在" };
    }

    // 默认回退候选（站内同类目活跃站点：领域匹配按「同类目 85」计）
    const peers = await ctx.repo.listSites({ categoryId: site.categoryId, status: "active", limit: 10 });
    const fallbackCandidates: StructuredReplacementCandidate[] = peers.slice(0, 3).map((p) => ({
      title: p.title,
      url: p.url,
      reason: `同属于分类【${site.categoryId}】的高活跃度替代站点`,
      source: "catalog" as const,
      domainFit: 85,
    }));

    /**
     * 统一出口：先实测再返回。
     *
     * 三个分支各自 return 一份「recommendations」是这套代码此前的毛病 —— 探活只补进
     * 成功分支的话，额度降级那条路（恰恰是运营最常看到的列表）仍然全是未验的。
     */
    const respondWithProbe = async (
      candidates: StructuredReplacementCandidate[],
      extra: Record<string, unknown>,
    ) => {
      const probed = await probeCandidates(candidates);
      return {
        ok: true,
        siteId: site.id,
        recommendations: probed.candidates,
        probe: probed.summary,
        ...extra,
      };
    };

    const identity = identityTrusted(ctx, req as never) ? requestIdentityOf(req as never) : null;
    const quota = await checkLlmQuota(ctx, identity);
    if (!quota.ok) {
      return respondWithProbe(fallbackCandidates, {
        model: "fallback-heuristics",
        aiDegraded: "quota" as const,
        quota: {
          scope: quota.error.scope,
          metric: quota.error.metric,
          limit: quota.error.limit,
          used: quota.error.used,
          retryAfterSeconds: Math.max(1, Math.ceil(quota.error.retryAfterMs / 1000)),
        },
      });
    }

    let degradedReason: string | null = null;
    try {
      const llm = await resolveLlm(ctx, identity);
      if (llmProviderReady(llm.provider)) {
        const safeTitle = (site.title || "").replace(/[\r\n]/g, " ").slice(0, 100);
        const safeUrl = (site.url || "").replace(/[\r\n]/g, "").slice(0, 200);
        const safeDesc = (site.description || "无").replace(/[\r\n]/g, " ").slice(0, 300);
        const prompt = `你是一个资深互联网工具导航专家。用户收藏的站点【${safeTitle}】（URL: ${safeUrl}，描述: ${safeDesc}）目前已失效或下线。
请推荐 3 个与该站点功能最相似、目前稳定可用且知名度高的替代工具或官网。
请以 JSON 格式输出，格式必须为严格的 JSON 数组：
[
  { "title": "替代站名称", "url": "https://...", "reason": "为什么推荐它作为平替" }
]
不要输出任何 markdown 格式标记，直接输出纯 JSON 字符串。`;

        const res = await callLlm(ctx, llm, {
          scenario: "health_audit",
          identity,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
          maxTokens: 600,
          json: true,
        });

        if (res.content) {
          const cleaned = res.content.replace(/^```json/i, "").replace(/```$/i, "").trim();
          const items = JSON.parse(cleaned);
          const RecSchema = z.object({
            title: z.string().min(1).max(200),
            url: httpUrl(),
            reason: z.string().min(1).max(500),
          });
          const parsed = z.array(RecSchema).safeParse(items);
          if (parsed.success && parsed.data.length > 0) {
            // 模型自述的「知名度高、稳定可用」不充当证据：领域匹配给 75，可达性交给实测
            const llmCandidates: StructuredReplacementCandidate[] = parsed.data.slice(0, 3).map((r) => ({
              ...r,
              source: "ai" as const,
              domainFit: 75,
            }));
            return respondWithProbe(llmCandidates, { model: llm.provider.model });
          }
          // 模型回了但结构不可用：这也是一次降级，不能与「模型不可用」混为一谈
          degradedReason = "invalid-model-output";
        } else {
          degradedReason = "empty-model-output";
        }
      } else {
        degradedReason = "llm-not-configured";
      }
    } catch (err) {
      degradedReason = err instanceof Error ? err.name.toLowerCase() : "unknown";
    }

    return respondWithProbe(fallbackCandidates, {
      model: "fallback-heuristics",
      aiDegraded: "error" as const,
      ...(degradedReason ? { degradedReason } : {}),
    });
  });
};
