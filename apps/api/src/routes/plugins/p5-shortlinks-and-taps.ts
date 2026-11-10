/**
 * 插件市场路由 · 分段 5/5：短链与订阅源（shortlinks / taps / 审计）
 *
 * 自 routes/plugins.ts 按**原声明顺序**切出（连续区间），未做主题重排——
 * 路由顺序会影响路由表，保序切分让「改造前后 app.printRoutes() 逐字节一致」成立。
 * 本文件由 plugins.ts 的 pluginRoutes 直接调用（不经 register：register 会把路由
 * 延后到父级 ready 之后，改变注册顺序）。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { indexPluginsBatch, indexItemFromManifest, removePluginIndex, type IndexPluginItem } from "../../index-plugin.ts";
import { guardedFetch, assertUrlShape, isBlockedIp } from "@navhub/ai";
import { isIP } from "node:net";
import { randomBytes } from "node:crypto";
import {
  validatePluginManifestWithCatalog,
  httpUrl,
  isInternalShortLinkTarget,
  isSafeUrl,
  type PluginManifest,
} from "@navhub/core";
import { badRequest,
  conflict,
  notFound,
  } from "../shared.ts";
import {
  pluginIdentity,
  } from "../plugin-presentation.ts";
import type { AppContext } from "../../context.ts";

/**
 * 单次订阅源同步最多处理多少条清单条目（NAVHUB_TAP_IMPORT_MAX 可调）。
 * 清单长度来自远端，属于外部输入；处理上限必须在本侧成立。
 */
const MAX_TAP_IMPORT_ITEMS = Math.max(1, Number(process.env.NAVHUB_TAP_IMPORT_MAX || 500));

/**
 * 精选订阅源：2026-11-10 审计实测，原先写死的三条 navhub-org/community-taps
 * 外链（featured.json / ai-agents.json / homelab.json）全部返回 404——源根本
 * 不存在，却以「官方严选」名义展示给用户订阅，订阅必然失败。已全部摘除；
 * 之后要恢复精选源，先把真实清单文件发布到可访问的地址、验证 200 再加回来。
 */
export const FEATURED_TAPS: Array<{
  id: string;
  name: string;
  description: string;
  url: string;
  isFeatured: boolean;
  author: string;
}> = [];

export const pluginRoutesPart5: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;
  /**
   * 违规举报（理由不能为空）
   */
  app.post(
    "/api/plugins/:slug/report",
    { config: { scope: "public", rateLimit: { max: 5, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const body = (req.body ?? {}) as { reason?: string };
      const reason = (body.reason ?? "").trim();

      if (!reason) {
        return badRequest(reply, "请填写举报理由（不可为空）");
      }
      if (reason.length > 500) {
        return badRequest(reply, "举报理由长度不能超过 500 字");
      }

      const identity = pluginIdentity(ctx, req) || undefined;
      const callerAuth = (req as { auth?: { actor?: string; kind?: string } }).auth;
      try {
                const result = await ctx.repo.reportPlugin(
          slug,
          {
            reason,
            identity,
          },
          {
            actor: callerAuth?.actor || identity || "anonymous",
            actorKind: callerAuth?.kind,
            ip: req.ip,
          }
        );
        if (result.quarantined) {
          try {
            await removePluginIndex(ctx, slug);
          } catch {
            // 索引清理失败不阻断
          }
        }
        return {
          success: true,
          message: "举报已受理",
          ...result,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return badRequest(reply, message);
      }
    }
  );

  /* ------------------------------------------------------------------ *
   * 分享短链 (Short Links)
   * ------------------------------------------------------------------ */

  /**
   * 创建插件分享短链：只允许 /marketplace/ 内部目标，防开放重定向。
   * 前端用返回的 path 拼 origin 生成可复制链接。
   */
  app.post(
    "/api/shortlinks",
    { config: { scope: "public", rateLimit: { max: 30, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const body = (req.body ?? {}) as { slug?: unknown; target?: unknown; install?: unknown };
      const slug = typeof body.slug === "string" ? body.slug.trim() : "";
      let target = typeof body.target === "string" ? body.target.trim() : "";
      if (slug) {
        const plugin = await ctx.repo.getPluginBySlug(slug);
        if (!plugin || plugin.status !== "published") return notFound(reply, `插件未上架或不存在: ${slug}`);
        // 分享深链保留 ?install=1：接收方落地即弹安装确认（与长链兜底一致）
        target = `/marketplace/${encodeURIComponent(plugin.slug)}${body.install === true ? "?install=1" : ""}`;
      }
      if (!isInternalShortLinkTarget(target)) {
        return badRequest(reply, "短链目标必须是站内 /marketplace/ 路径");
      }
      try {
        const link = await ctx.repo.createShortLink({ target, pluginSlug: slug || null });
        return { success: true, code: link.code, path: `/s/${link.code}`, target: link.target };
      } catch (err) {
        return badRequest(reply, err instanceof Error ? err.message : "创建短链失败");
      }
    }
  );

  /** 解析短链并累计点击（Next /s/[code] 与外部调用共用） */
  app.get(
    "/api/shortlinks/:code",
    { config: { scope: "public", cache: { maxAge: 0 } } },
    async (req, reply) => {
      const code = (req.params as { code: string }).code;
      const link = await ctx.repo.resolveShortLink(code);
      if (!link) return notFound(reply, "短链不存在或已失效");
      return { code: link.code, target: link.target, clicks: link.clicks };
    }
  );

  /* ------------------------------ 开放生态 2.0: Taps 远程订阅源 ------------------------------ */



  /**
   * 获取已配置的远程插件市场订阅源 (Taps)。
   *
   * 原先是 `public`，与同一组里的 POST / DELETE / sync（全部 `write`）不一致：
   * 匿名访客能读出管理员配置的第三方源 URL 清单。Taps 只服务于「订阅源管理中心」
   * 这一个管理面弹窗——市场列表本身读的是已导入的插件，不会实时拉取订阅清单——
   * 而这些 URL 常带访问凭据（GitHub raw 的 `?token=` 一类），属于不该外发的配置。
   */
  app.get(
    "/api/plugins/taps/public",
    { config: { scope: "public" } },
    async () => {
      const taps = (await ctx.repo.getSystemState<any[]>("plugins:taps")) ?? [];
      const publicItems = taps.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        pluginCount: t.pluginCount ?? 0,
        lastSyncedAt: t.lastSyncedAt ?? null,
      }));
      return { ok: true, items: publicItems, featuredTaps: FEATURED_TAPS };
    }
  );

  app.get(
    "/api/plugins/taps",
    { config: { scope: "admin" } },
    async () => {
      const taps = (await ctx.repo.getSystemState<any[]>("plugins:taps")) ?? [];
      return { ok: true, items: taps, featuredTaps: FEATURED_TAPS };
    }
  );

  /** 添加远程插件市场订阅源 (Taps) */
  app.post(
    "/api/plugins/taps",
    { config: { scope: "admin" } },
    async (req, reply) => {
      const body = z.object({
        name: z.string().min(1).max(50),
        url: httpUrl().max(500),
        description: z.string().max(200).optional(),
      }).safeParse(req.body ?? {});

      if (!body.success) {
        return badRequest(reply, "参数无效", body.error.issues);
      }

      // 安全校验：防止 SSRF（协议、凭据、高危内网端口、IPv4/IPv6 映射及 nip.io 泛解析私网域名）
      const cleanUrl = body.data.url.trim();
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(cleanUrl);
        assertUrlShape(cleanUrl);
      } catch (err) {
        return badRequest(reply, err instanceof Error ? err.message : "Taps 源地址格式不合法");
      }
      const rawHost = parsedUrl.hostname.replace(/^\[|\]$/g, "").toLowerCase();
      const safeCheck = isSafeUrl(cleanUrl, false);
      if (
        !safeCheck.safe ||
        (isIP(rawHost) !== 0 && isBlockedIp(rawHost)) ||
        rawHost.includes("::")
      ) {
        return badRequest(reply, "禁止添加私有网络地址或本地回环作为 Taps 插件源");
      }

      const taps = (await ctx.repo.getSystemState<any[]>("plugins:taps")) ?? [];
      if (taps.some((t) => t.url.toLowerCase() === cleanUrl.toLowerCase())) {
        return conflict(reply, "已存在相同 URL 的 Taps 订阅源");
      }

      const newTap = {
        id: `tap-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`,
        name: body.data.name.trim(),
        url: cleanUrl,
        description: body.data.description?.trim(),
        enabled: true,
        pluginCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      taps.push(newTap);
      await ctx.repo.setSystemState("plugins:taps", taps);
      await ctx.repo.audit({
        ip: req.ip,
        actor: req.auth.actor,
        actorKind: req.auth.kind,
        action: "plugin.tap_create",
        target: newTap.id,
        diff: newTap,
      });

      return { ok: true, tap: newTap };
    }
  );

  /** 移除远程插件订阅源 */
  app.delete(
    "/api/plugins/taps/:id",
    { config: { scope: "admin" } },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const taps = (await ctx.repo.getSystemState<any[]>("plugins:taps")) ?? [];
      const filtered = taps.filter((t) => t.id !== id);
      if (filtered.length === taps.length) {
        return notFound(reply, "订阅源不存在");
      }
      await ctx.repo.setSystemState("plugins:taps", filtered);
      await ctx.repo.audit({
        ip: req.ip,
        actor: req.auth.actor,
        actorKind: req.auth.kind,
        action: "plugin.tap_delete",
        target: id,
      });
      return { ok: true };
    }
  );

  /** 同步远程插件订阅源并更新本地索引 */
  app.post(
    "/api/plugins/taps/:id/sync",
    { config: { scope: "admin" } },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const taps = (await ctx.repo.getSystemState<any[]>("plugins:taps")) ?? [];
      const targetTap = taps.find((t) => t.id === id);
      if (!targetTap) {
        return notFound(reply, "订阅源不存在");
      }

      let fetchedCount = 0;
      let processedCount = 0;
      let importedCount = 0;
      let updatedCount = 0;
      let skippedDuplicate = 0;
      let rejectedInvalid = 0;
      let failedWrite = 0;
      let truncated = false;
      try {
        const res = await guardedFetch(targetTap.url, { timeoutMs: 8000 });
        if (res.status !== 200) {
          return badRequest(reply, `订阅源响应异常 (HTTP ${res.status})`);
        }
        const data = JSON.parse(res.body);
        const pluginList: unknown[] = Array.isArray(data)
          ? data
          : Array.isArray(data?.plugins)
          ? data.plugins
          : [];

        fetchedCount = pluginList.length;
        const items = pluginList.slice(0, MAX_TAP_IMPORT_ITEMS);
        truncated = pluginList.length > items.length;
        processedCount = items.length;

        const existingRows = await ctx.repo.raw("SELECT name FROM plugins");
        const existingNames = new Set<string>(
          existingRows.map((r: Record<string, any>) => String(r.name)),
        );

        const pendingIndex: IndexPluginItem[] = [];
        for (const item of items) {
          const validated = validatePluginManifestWithCatalog(item);
          // 每一条被跳过的原因都要计数：以前 continue 什么都不留，
          // 管理员只看到「发现 40 个、导入 3 个」，无从判断剩下 37 个是重复、不合规还是写库失败。
          if (!validated.ok) {
            rejectedInvalid += 1;
            continue;
          }
          if (existingNames.has(validated.manifest.name)) {
            skippedDuplicate += 1;
            continue;
          }

          try {
            const imported = await ctx.repo.createPlugin(
              {
                manifest: validated.manifest,
                author: validated.manifest.author || targetTap.name,
                authorKind: "tap",
                source: "tap",
                status: "published",
              },
              {
                actor: targetTap.name,
                actorKind: "tap",
                ip: req.ip,
              }
            );
            // 同一份清单里的重名也要挡住（原来靠每次都查库才碰巧挡住）
            existingNames.add(validated.manifest.name);
            pendingIndex.push(indexItemFromManifest(imported.slug, imported.manifest));
            importedCount++;
          } catch {
            // 单条导入失败不阻断整批，但条数必须报出来
            failedWrite += 1;
          }
        }
        await indexPluginsBatch(ctx, pendingIndex);
      } catch (err) {
        return badRequest(reply, `获取订阅源失败: ${err instanceof Error ? err.message : String(err)}`);
      }

      targetTap.lastSyncedAt = Date.now();
      targetTap.pluginCount = importedCount + skippedDuplicate;
      targetTap.updatedAt = Date.now();
      await ctx.repo.setSystemState("plugins:taps", taps);

      return {
        ok: true,
        fetchedCount,
        processedCount,
        importedCount,
        updatedCount,
        skippedDuplicate,
        /** 清单校验不通过（缺字段 / 不在目录 / 名称非法） */
        rejectedInvalid,
        /** 校验通过但写库失败 */
        failedWrite,
        // 清单被处理上限截断时必须说出来：否则调用方看到 importedCount 远小于
        // fetchedCount 会以为订阅源里都是重复项。
        truncated,
        importCap: MAX_TAP_IMPORT_ITEMS,
        tap: targetTap,
      };
    }
  );

  /* ------------------------------ 开放生态 2.0: 插件安全沙盒扫描 ------------------------------ */

  /** 插件全自动安全扫描评估与作者认证 */
  app.get(
    "/api/plugins/:slug/audit",
    { config: { scope: "public" } },
    async (req, reply) => {
      const slug = (req.params as { slug: string }).slug;
      const plugin = await ctx.repo.getPluginBySlug(slug);
      if (!plugin) return notFound(reply, "插件不存在");

      const manifest = plugin.manifest as PluginManifest;
      const checks: Array<{ name: string; passed: boolean; detail: string }> = [];
      let deductions = 0;

      // 1. 作者认证检查
      // 严格认证判定：必须基于数据库权威信任标记，绝不信任 manifest.author 任意文本
      const isVerifiedAuthor = Boolean(
        Boolean(plugin.authorVerified) ||
        plugin.source === "seed" ||
        plugin.ownerIdentity === "seed" ||
        plugin.ownerIdentity === "official" ||
        (plugin.authorKind === "token" && plugin.ownerIdentity?.startsWith("admin:"))
      );
      checks.push({
        name: "开发者认证 (Author Authenticity)",
        passed: isVerifiedAuthor,
        detail: isVerifiedAuthor ? "官方已认证或已授权凭据作者" : "社区自建未签名作者（建议仔细甄别）",
      });
      if (!isVerifiedAuthor) deductions += 10;

      // 2. URL 协议安全性扫描（覆盖全部 4 类插件的外部 URL 字段）
      const urls: string[] = [];
      if (manifest.icon) urls.push(manifest.icon);
      if (manifest.homepage) urls.push(manifest.homepage);
      const payloadAny = (manifest.payload ?? {}) as Record<string, any>;
      if (manifest.kind === "site-pack" && Array.isArray(payloadAny.sites)) {
        for (const s of payloadAny.sites) {
          if (s?.url) urls.push(String(s.url));
          if (s?.icon) urls.push(String(s.icon));
        }
      } else if (manifest.kind === "theme") {
        if (payloadAny.previewUrl) urls.push(String(payloadAny.previewUrl));
        if (payloadAny.backgroundImage) urls.push(String(payloadAny.backgroundImage));
      } else if (manifest.kind === "search-pack") {
        if (payloadAny.endpoint) urls.push(String(payloadAny.endpoint));
      }

      let allHttps = true;
      let dangerousScheme = false;
      let internalHost = false;

      for (const u of urls) {
        const lower = u.trim().toLowerCase();
        if (
          lower.startsWith("javascript:") ||
          lower.startsWith("vbscript:") ||
          lower.startsWith("data:") ||
          lower.startsWith("file:")
        ) {
          dangerousScheme = true;
        }
        if (lower.startsWith("http://")) {
          allHttps = false;
        }
        try {
          const parsed = new URL(u);
          const rawHost = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
          const safeCheck = isSafeUrl(u, false);
          if (!safeCheck.safe || (isIP(rawHost) !== 0 && isBlockedIp(rawHost))) {
            internalHost = true;
          }
        } catch {
          // not a valid URL format
        }
      }

      checks.push({
        name: "协议加密性 (HTTPS Enforcement)",
        passed: allHttps,
        detail: allHttps ? "所有外链与资源图标均强制采用 HTTPS 加密传输" : "检测到包含明文 HTTP 未加密外链",
      });
      if (!allHttps) deductions += 15;

      checks.push({
        name: "代码注入与 XSS 防护 (Script Injection Guard)",
        passed: !dangerousScheme,
        detail: !dangerousScheme ? "未检出危险伪协议 (javascript:, data: 等)" : "严重威胁：检测到恶意伪协议注入",
      });
      if (dangerousScheme) deductions += 50;

      checks.push({
        name: "内网穿透防护 (Anti-SSRF Guard)",
        passed: !internalHost,
        detail: !internalHost ? "所有链接均指向公网合法域名，无内网渗透特征" : "严重威胁：检测到包含私有内网或回环地址",
      });
      if (internalHost) deductions += 50;

      let parsedNote: any = null;
      if (plugin.reviewNote) {
        try {
          parsedNote = JSON.parse(plugin.reviewNote);
        } catch {
          // not json
        }
      }

      /**
       * 有没有真正的审理报告，决定这份数据能说什么、不能说什么。
       *
       * 上面这四项是**确实跑过**的静态检查，扣分本身是真的；假的地方在于
       * 「100 - 扣分」会被前端当成完整安全分并亮出「安全」徽章，好像合规、
       * 相关性、外链存活也都测过一样（它们没跑）。所以无报告时：
       *  - 只给 security 一维，其余显式 null（不是 0，0 是「测了且不及格」）；
       *  - level 不允许出现 safe，最高只能到 low_risk；
       *  - decision 固定 pending_review，不再用 status 反推「approve」。
       */
      const hasAuditNote = parsedNote !== null && typeof parsedNote.score === "number";

      if (!hasAuditNote) {
        const staticScore = Math.max(0, 100 - deductions);
        return {
          ok: true,
          report: {
            slug,
            score: staticScore,
            level: staticScore >= 85 ? "low_risk" : staticScore >= 60 ? "medium_risk" : "high_risk",
            decision: "pending_review",
            aiRationale: `本次仅完成 ${checks.length} 项静态清单检查（作者签名、协议、伪协议注入、内网穿透），未做模型合规研判与外链探活，结论待人工或 AI 复核。`,
            dimensionScores: { security: staticScore, availability: null, compliance: null, relevance: null },
            linkSurvivalRate: null,
            model: "none",
            llmReviewed: false,
            reviewSkipped: "not_audited",
            scoreBasis: "static_only",
            verifiedAuthor: isVerifiedAuthor,
            checks: checks.map((c) => ({ ...c, skipped: false })),
            auditedAt: plugin.reviewedAt || plugin.updatedAt || Date.now(),
          },
        };
      }

      return {
        ok: true,
        report: {
          slug,
          score: parsedNote.score,
          level: parsedNote.level,
          decision: parsedNote.decision ?? "pending_review",
          aiRationale: parsedNote.rationale,
          dimensionScores: parsedNote.dimensionScores,
          linkSurvivalRate: parsedNote.linkSurvivalRate,
          model: parsedNote.model,
          llmReviewed: parsedNote.llmReviewed === true,
          // 旧报告里没有这几个字段，缺省按「不确定 = 保守」解释：说没审理，而不是谎称审过
          reviewSkipped: parsedNote.reviewSkipped ?? (parsedNote.llmReviewed === true ? null : "error"),
          // scoreBasis 同理：没有标注时不能冒充「全维度已测」
          scoreBasis: parsedNote.scoreBasis ?? "static_plus_probe",
          quota: parsedNote.quota ?? null,
          verifiedAuthor: isVerifiedAuthor,
          checks: checks.map((c) => ({ ...c, skipped: false })),
          auditedAt: parsedNote.auditedAt || plugin.reviewedAt || Date.now(),
        },
      };
    }
  );
};
