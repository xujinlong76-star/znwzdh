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
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  runAutonomousHealing,
  httpUrl,
  canonicalizeUrl,
  evaluateSiteQuality,
  SiteAuditApplyInput,
  type SiteHealthAuditSummary,
  type SiteHealthAuditIssue,
} from "@navhub/core";
import { indexSite } from "../index-site.ts";
import { buildSiteQualityAssessments } from "../site-quality-assessment.ts";
import { llmProviderReady, resolveLlm } from "../llm-config.ts";
import { callLlm } from "../llm-usage.ts";
import { reserveLlmQuota, settleLlmQuota } from "../llm-quota.ts";
import { probeCandidates, rankCandidate, type StructuredReplacementCandidate } from "../candidate-probe.ts";
import { requestIdentityOf, identityTrusted } from "./shared.ts";
import type { AppContext } from "../context.ts";

const SENSITIVE_EVIDENCE_KEY = /^(?:password|passwd|secret|token|authorization|cookie|set-cookie|api[_-]?key|access[_-]?key|private[_-]?key|__proto__|prototype|constructor)$/i;

function containsSensitiveEvidenceKey(value: unknown, depth = 0): boolean {
  if (depth > 8) return true;
  if (Array.isArray(value)) return value.some((item) => containsSensitiveEvidenceKey(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.entries(value).some(([key, nested]) =>
      SENSITIVE_EVIDENCE_KEY.test(key) || containsSensitiveEvidenceKey(nested, depth + 1),
    );
  }
  return false;
}

export const healthAuditRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /**
   * 自动采集候选进入隔离队列；采集端永远不能直接把站点发布到导航目录。
   */
  app.post("/api/discovery/candidates", {
    config: { scope: "write", rateLimit: { max: 60, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    const body = z.object({
      url: httpUrl(),
      source: z.enum(["manual", "import", "submission", "ai", "seed", "navsphere", "api", "mcp"]),
      title: z.string().trim().min(1).max(120).optional(),
      description: z.string().trim().max(500).optional(),
      categoryId: z.string().max(64).optional(),
      tags: z.array(z.string().trim().min(1).max(32)).max(20).optional(),
      confidence: z.number().min(0).max(1).optional(),
      evidence: z.record(z.string(), z.unknown()).optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) {
      reply.code(400);
      return { ok: false, error: "采集候选参数无效", details: body.error.issues };
    }
    const evidence = body.data.evidence ?? {};
    if (containsSensitiveEvidenceKey(evidence)) {
      reply.code(400);
      return { ok: false, error: "采集证据不能包含密码、令牌、Cookie 或密钥字段" };
    }
    if (JSON.stringify(evidence).length > 16_384) {
      reply.code(413);
      return { ok: false, error: "采集证据超过 16KB 限制" };
    }
    const canonicalUrl = canonicalizeUrl(body.data.url);
    const id = randomUUID();
    const candidate = await ctx.repo.upsertSiteDiscoveryCandidate({
      id,
      url: body.data.url,
      canonicalUrl,
      title: body.data.title ?? null,
      description: body.data.description ?? null,
      categoryId: body.data.categoryId ?? null,
      tags: body.data.tags ?? [],
      source: body.data.source,
      confidence: body.data.confidence ?? null,
      evidence,
    });
    await ctx.repo.audit({
      ip: req.ip,
      actor: req.auth.actor,
      actorKind: req.auth.kind,
      action: "discovery.candidate_submitted",
      target: candidate.id,
      diff: { source: candidate.source, canonicalUrl: candidate.canonicalUrl, duplicate: candidate.id !== id },
    });
    reply.code(202);
    return { ok: true, duplicate: candidate.id !== id, candidate };
  });

  /** 管理端只读候选队列；分页总数与状态筛选保持一致。 */
  app.get("/api/admin/discovery/candidates", { config: { scope: "admin" } }, async (req, reply) => {
    const query = z.object({
      status: z.enum(["pending", "approved", "rejected"]).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).max(100_000).default(0),
    }).safeParse(req.query ?? {});
    if (!query.success) {
      reply.code(400);
      return { ok: false, error: "筛选参数无效", details: query.error.issues };
    }
    const [items, total] = await Promise.all([
      ctx.repo.listSiteDiscoveryCandidates(query.data),
      ctx.repo.countSiteDiscoveryCandidates(query.data.status),
    ]);
    return { ok: true, items, total, limit: query.data.limit, offset: query.data.offset, status: query.data.status ?? "all" };
  });

  /** 审核在单个事务内锁定候选、写入站点并更新审核状态；索引写入在提交后执行。 */
  app.post("/api/admin/discovery/candidates/:id/review", {
    config: { scope: "admin", rateLimit: { max: 30, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      action: z.enum(["approve", "reject"]),
      categoryId: z.string().max(64).optional(),
      rejectionReason: z.string().trim().max(500).optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) {
      reply.code(400);
      return { ok: false, error: "审核参数无效", details: body.error.issues };
    }

    const result = await ctx.repo.withTransaction(async () => {
      const candidate = await ctx.repo.getSiteDiscoveryCandidateForUpdate(id);
      if (!candidate) return { kind: "not_found" as const };
      if (candidate.status !== "pending") {
        return { kind: "conflict" as const, status: candidate.status };
      }

      if (body.data.action === "reject") {
        const reviewed = await ctx.repo.reviewSiteDiscoveryCandidate({
          id,
          status: "rejected",
          reviewer: req.auth.actor,
          rejectionReason: body.data.rejectionReason || "人工审核未通过",
        });
        if (!reviewed || reviewed.status !== "rejected" || reviewed.reviewedBy !== req.auth.actor) {
          throw new Error("候选审核状态更新失败");
        }
        await ctx.repo.audit({
          ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind,
          action: "discovery.candidate_rejected", target: id,
          diff: { source: candidate.source, reason: reviewed.rejectionReason },
        });
        return { kind: "rejected" as const, candidate: reviewed };
      }

      let categoryId: string | null = body.data.categoryId ?? candidate.categoryId;
      let categoryFallback = false;
      if (categoryId) {
        const categoryCheck = await ctx.repo.checkSiteCategoryAttachment(categoryId);
        if (!categoryCheck.ok && body.data.categoryId) {
          return { kind: "invalid_category" as const, error: categoryCheck.error };
        }
        if (!categoryCheck.ok) {
          // 采集器的类目建议失效时，人工通过仍可入库到「未分类」，避免候选永久卡死。
          categoryId = null;
          categoryFallback = true;
        } else {
          categoryId = categoryCheck.categoryId;
        }
      }
      const resolvedCategoryId = categoryId ?? await ctx.repo.ensureUncategorized();

      let site = await ctx.repo.findSiteByUrl(candidate.url);
      let created = false;
      if (!site) {
        site = await ctx.repo.createSite({
          url: candidate.url,
          title: candidate.title || new URL(candidate.url).hostname,
          description: candidate.description,
          categoryId: resolvedCategoryId,
          tags: candidate.tags,
          source: candidate.source,
          status: "active",
        });
        created = true;
      }
      const reviewed = await ctx.repo.reviewSiteDiscoveryCandidate({
        id,
        status: "approved",
        reviewer: req.auth.actor,
        siteId: site.id,
      });
      if (!reviewed || reviewed.status !== "approved" || reviewed.siteId !== site.id) {
        throw new Error("候选审核状态更新失败");
      }
      await ctx.repo.audit({
        ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind,
        action: "discovery.candidate_approved", target: id,
        diff: { siteId: site.id, created, source: candidate.source, categoryFallback },
      });
      return { kind: "approved" as const, candidate: reviewed, site, created, categoryFallback };
    });

    if (result.kind === "not_found") {
      reply.code(404);
      return { ok: false, error: "采集候选不存在" };
    }
    if (result.kind === "conflict") {
      reply.code(409);
      return { ok: false, error: "该候选已完成审核，不能重复处理", status: result.status };
    }
    if (result.kind === "invalid_category") {
      reply.code(400);
      return { ok: false, error: "分类不可用于站点入库", detail: result.error };
    }
    if (result.kind === "rejected") return { ok: true, candidate: result.candidate };

    if (result.created) {
      await indexSite(ctx, result.site.id, result.site.title, result.site.description ?? null, result.site.url);
    }
    return { ok: true, created: result.created, categoryFallback: result.categoryFallback, site: result.site, candidate: result.candidate };
  });

  /**
   * 分批补算既有站点质量快照。只读取现有目录字段与巡检历史，不发起外网请求。
   */
  app.post("/api/admin/quality/rebuild", { config: { scope: "admin", rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = z.object({
      offset: z.coerce.number().int().min(0).max(100_000).default(0),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }).safeParse(req.body ?? {});
    if (!body.success) {
      reply.code(400);
      return { ok: false, error: "补算参数无效", details: body.error.issues };
    }
    const sites = await ctx.repo.listSites({ limit: body.data.limit, offset: body.data.offset });
    let saved = 0;
    for (const site of sites) {
      const samples = await ctx.repo.recentHealthChecks(site.id, 5);
      const dimensions = buildSiteQualityAssessments(site, samples);
      const assessment = evaluateSiteQuality(dimensions);
      await ctx.repo.saveSiteQualityAssessment(site.id, assessment);
      saved += 1;
    }
    const nextOffset = sites.length === body.data.limit ? body.data.offset + sites.length : null;
    await ctx.repo.audit({
      ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind,
      action: "quality.shadow_rebuild",
      diff: { offset: body.data.offset, requested: body.data.limit, saved, nextOffset },
    });
    return { ok: true, saved, offset: body.data.offset, nextOffset, done: nextOffset === null };
  });

  /**
   * 站点质量治理工作台数据。
   * 只读最新影子评分，不触发重算、不执行自动下架或自动排序。
   */
  app.get("/api/admin/quality/report", { config: { scope: "admin" } }, async (req, reply) => {
    const query = (req.query ?? {}) as Record<string, unknown>;
    const allowedBands = ["high", "medium", "low", "high_risk", "insufficient_evidence"] as const;
    const band = typeof query.band === "string" && (allowedBands as readonly string[]).includes(query.band)
      ? query.band as (typeof allowedBands)[number]
      : undefined;
    const limit = Math.min(100, Math.max(1, Math.floor(Number(query.limit) || 50)));
    const offset = Math.max(0, Math.floor(Number(query.offset) || 0));
    const [summary, items, total] = await Promise.all([
      ctx.repo.siteQualityOverview(),
      ctx.repo.listSiteQualityAssessments({ band, limit, offset }),
      ctx.repo.countSiteQualityAssessments(band),
    ]);
    return { ok: true, summary, items, total, limit, offset, band: band ?? "all" };
  });

  /**
   * 1. 获取全站健康度评分与自愈提案
   */
  app.get("/api/admin/audit/report", { config: { scope: "read" } }, async () => {
    const allSites = await ctx.repo.listSites({ limit: 500 });
    // 归档 = 运营已经决定不要了（dismiss、或平替到站内既有条目）：它既不该继续占着
    // 「待治愈」，也不该把健康分永久压住。此前把 archived 也算作异常，导致 dismiss
    // 点了等于没点、健康分永远上不去。
    const sites = allSites.filter((s) => s.status !== "archived");
    const totalSites = sites.length;
    const activeSites = sites.filter((s) => s.status === "active");
    const brokenSites = sites.filter((s) => s.status === "broken");

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
    const allSites = await ctx.repo.listSites({ limit: 100 });
    // 与报告同一口径：已归档的不参与巡检（见 GET /api/admin/audit/report 的说明）
    const sites = allSites.filter((s) => s.status !== "archived");
    const totalSites = sites.length;
    const activeSites = sites.filter((s) => s.status === "active");
    const brokenSites = sites.filter((s) => s.status === "broken");

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
    const body = SiteAuditApplyInput.safeParse(req.body ?? {});

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

    /**
     * 目标 URL 已经在站内收录时不能走「改写 URL」：兜底候选本来就取自站内同分类站点，
     * 模型也常推荐已收录的站，直接写会撞 `sites.url` 唯一约束，运营只看到 500。
     * 正确语义是「关联」——失效站点归档，平替结果指向既有条目，不产生重复行。
     */
    if (targetUrl && targetUrl !== site.url) {
      const occupant = await ctx.repo.findSiteByUrl(targetUrl);
      if (occupant && occupant.id !== site.id) {
        await ctx.repo.updateSite(site.id, { status: "archived" });
        await ctx.repo.audit({
          ip: req.ip,
          actor: req.auth.actor,
          actorKind: req.auth.kind,
          action: "audit.site_healed",
          target: site.id,
          diff: {
            before: { url: site.url, status: site.status },
            archivedFor: { siteId: occupant.id, url: occupant.url, title: occupant.title },
            action,
          },
        });
        return {
          ok: true,
          action,
          site: occupant,
          archivedSiteId: site.id,
          merged: { siteId: occupant.id, title: occupant.title, url: occupant.url },
        };
      }
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
      siteId: p.id,
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
      // 目录中已收录的候选可附加质量快照；未知/高风险/低覆盖证据只展示，不影响排序。
      const qualityEnriched = await Promise.all(probed.candidates.map(async (candidate) => {
        const matchedSite = candidate.siteId
          ? null
          : await ctx.repo.findSiteByUrl(candidate.url);
        const candidateSiteId = candidate.siteId ?? matchedSite?.id;
        if (!candidateSiteId) return candidate;
        const quality = await ctx.repo.getSiteQualityAssessment(candidateSiteId);
        if (!quality) return { ...candidate, siteId: candidateSiteId };
        return {
          ...candidate,
          siteId: candidateSiteId,
          catalogQuality: {
            score: quality.score,
            evidenceCoverage: quality.evidenceCoverage,
            band: quality.band,
          },
        };
      }));
      qualityEnriched.sort((a, b) => rankCandidate(b) - rankCandidate(a));
      return {
        ok: true,
        siteId: site.id,
        recommendations: qualityEnriched,
        probe: probed.summary,
        ...extra,
      };
    };

    const identity = identityTrusted(ctx, req as never) ? requestIdentityOf(req as never) : null;
    // 这里在闸门之后才 resolveLlm，所以 source 未知 → 按最保守的 system 申报。
    // 少占的那点系统额度换来的是「不会放过脚本」：宁可让在途的用户自带 key
    // 临时占住预算（结算即释放，占用量受并发数约束），也不能反过来。
    const quota = await reserveLlmQuota(ctx, identity);
    if (!quota.ok) {
      return respondWithProbe(fallbackCandidates, {
        model: "fallback-heuristics",
        aiDegraded: "quota" as const,
        quota: {
          scope: quota.error.scope,
          metric: quota.error.metric,
          limit: quota.error.limit,
          used: quota.error.used,
          blockedBy: quota.error.blockedBy,
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
    } finally {
      // JSON 解析失败、结构不合 schema、模型不可用这三条都从这里过：
      // 走到降级出口不等于没花钱，预留照样要交还。
      await settleLlmQuota(ctx, quota.hold);
    }

    return respondWithProbe(fallbackCandidates, {
      model: "fallback-heuristics",
      aiDegraded: "error" as const,
      ...(degradedReason ? { degradedReason } : {}),
    });
  });
};
