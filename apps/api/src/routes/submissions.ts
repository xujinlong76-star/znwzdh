/**
 * 投稿与审核（收编中枢）
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { canonicalizeUrl, httpUrl, SubmissionReviewInput } from "@navhub/core";
import { extractMetadata, guardedFetch } from "@navhub/ai";
import { indexSite } from "../index-site.ts";
import { resolveLlm } from "../llm-config.ts";
import { callLlm } from "../llm-usage.ts";
import { reserveLlmQuota, settleLlmQuota, type LlmQuotaError, type LlmQuotaHold } from "../llm-quota.ts";
import { ADMIN_NOTIFICATION_IDENTITY } from "../notifications.ts";
import { safeJsonParse, identityTrusted, requestIdentityOf, submissionNumber } from "./shared.ts";

import type { AppContext } from "../context.ts";

/**
 * 额度拒绝的结构化信息，与 `LlmQuotaError.toResponseBody().quota` 同口径。
 * 降级响应必须说清「是额度用完」而不是让调用方猜成模型坏了。
 */
function quotaInfo(error: LlmQuotaError) {
  return {
    scope: error.scope,
    metric: error.metric,
    limit: error.limit,
    used: error.used,
    blockedBy: error.blockedBy,
    retryAfterSeconds: Math.max(1, Math.ceil(error.retryAfterMs / 1000)),
  };
}

export const submissionRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* -------------------------- 投稿 -------------------------- */

  /**
   * 投稿前 AI 网址智能识别与一键自动填表（解决手动填 5 个字段的繁琐痛点）
   * 安全抓取网页标题与元信息，并调用 AI 模型自动生成中文简介、匹配主/子分类及推荐理由。
   */
  app.post(
    "/api/submissions/prefill",
    {
      config: {
        scope: "public",
        rateLimit: { max: process.env.NODE_ENV === "test" ? 10_000 : 15, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
      const raw = (req.body ?? {}) as {
        url?: string;
        categories?: Array<{
          id: string;
          title: string;
          description?: string;
          subCategories?: Array<{ id: string; title: string; description?: string }>;
        }>;
      };
      const parsedUrl = httpUrl().safeParse(String(raw.url ?? "").trim());
      if (!parsedUrl.success) {
        reply.code(400);
        return { success: false, message: "请输入合法的 http/https 网址" };
      }

      const targetUrl = parsedUrl.data;
      // 额度闸门要按「本次实际用来取密钥的身份」申报；public 端点没有强制身份，
      // 有可信身份就用它，否则走匿名合池（与 /api/enrich 同口径）。
      const identityRequest = { auth: req.auth, headers: req.headers, query: req.query };
      const identity = identityTrusted(ctx, req) ? requestIdentityOf(identityRequest) : null;
      let scrapedTitle = "";
      let scrapedDesc = "";
      let scrapedIcon = "";
      let scrapedImage = "";
      let scrapedLang = "";
      let scrapedText = "";
      try {
        const fetched = await guardedFetch(targetUrl, {
          ...ctx.config.fetch,
          timeoutMs: Math.min(ctx.config.fetch.timeoutMs || 5000, 4500),
        });
        if (fetched.body) {
          const meta = extractMetadata(fetched.body, fetched.finalUrl);
          // 抓取内容外部可控：截断防超长 title/desc 撑爆 prompt token（正文下方已限 600 字）
          scrapedTitle = (meta.title || "").slice(0, 300);
          scrapedDesc = (meta.description || "").slice(0, 800);
          scrapedIcon = meta.icon || "";
          scrapedImage = meta.image || "";
          scrapedLang = meta.lang || "";
          // 可见正文片段：剥标签取文本，给 LLM 多一点语料判断分类（title/desc
          // 被防爬清空或全是营销词时，正文往往还留着真实定位信息）。
          scrapedText = (fetched.body || "")
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/&[a-z#0-9]+;/gi, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 600);
        }
      } catch {
        // 网页防爬或超时不阻断：交由 LLM 根据域名与已知知识库补全
      }

      // 查重预告：已收录/已投稿的网址在识别阶段就提示，不让用户白填一遍
      // 表单才收到 409。查不到不算错（提示仅在确定重复时给出）。
      let duplicate: { siteId: string } | null = null;
      try {
        const existing = await ctx.repo.findSiteByUrl(targetUrl);
        if (existing) duplicate = { siteId: existing.id };
      } catch {
        // 查重失败不阻断识别：提交端仍有 409 兜底
      }

      // 分类树来自请求体，public 端点外部可控：限数量 + 截断每字段，防止
      // 数 MB 文本撑高 LLM 账单或塞入提示注入语。真实站点 14 主类/百余子类，
      // 上限 far above 正常规模，不影响合法识别。
      const catTree = (Array.isArray(raw.categories) ? raw.categories : []).slice(0, 200);
      const cap = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
      const catSpecRaw = catTree
        .slice(0, 200)
        .map((c) => {
          const subs = Array.isArray(c.subCategories) && c.subCategories.length > 0
            ? ` (子类目: ${c.subCategories.slice(0, 40).map((s) => {
                const sd = cap((s as { description?: string }).description, 80);
                return `${cap(s.id, 40)}=${cap(s.title, 40)}${sd ? `（${sd}）` : ""}`;
              }).join(", ")})`
            : "";
          // 分类简介入语料：只有名字时「AI 工具」与「设计与创意」这类边界分类
          // 很容易被名字相似误判（如 AI 绘图工具落设计分类），描述给足区分度。
          const desc = cap((c as { description?: string }).description, 150);
          return `- 主分类 ${cap(c.id, 40)}=${cap(c.title, 40)}${desc ? `：${desc}` : ""}${subs}`;
        })
        .join("\n")
        .slice(0, 12000);
      const catSpec = catSpecRaw;

      const fallbackHost = (() => {
        try { return new URL(targetUrl).hostname.replace(/^www\./, ""); } catch { return targetUrl; }
      })();

      // resolveLlm 内部读系统配置表；配置/DB 抖动时不能让整个 prefill 直接 500。
      // 解析失败按「无可用 key」走同一条启发式降级路径，识别永不空窗。
      let llm: Awaited<ReturnType<typeof resolveLlm>> | null = null;
      try {
        llm = await resolveLlm(ctx, identity);
      } catch (err) {
        req.log.warn({ err: String(err) }, "投稿识别 LLM 配置读取失败，降级启发式");
      }
      // 三种「没有模型答案」的出口共用同一形状：额度降级也不能漏字段破坏前端契约。
      // 分类判断不了就留空让用户自己选，不许默认塞分类树第一个（与内容无关的
      // 预填分类只会污染目录）。
      const heuristicPrefill = (submitterNote: string, descriptionFallback: string) => ({
        title: scrapedTitle || fallbackHost,
        description: scrapedDesc || descriptionFallback,
        category: "",
        subcategory: "",
        submitterNote,
        confidence: 0,
        candidates: [],
        icon: scrapedIcon || `/api/hub/assets/icon?url=${encodeURIComponent(targetUrl)}`,
        coverImage: scrapedImage || "",
        duplicate,
      });
      if (!llm?.provider.apiKey) {
        return {
          success: true,
          prefill: heuristicPrefill("系统启发式提取", `${scrapedTitle || fallbackHost} 官方网站与生产力工具。`),
          fallback: true,
        };
      }

      const prompt = `你是全球数字工具导航站的资深编辑。用户正在投稿推荐一个网站，请根据以下抓取到的线索自动补全投稿表单：
网址: ${targetUrl}
抓取到的网页标题: ${scrapedTitle || "（未抓取到，请根据网址与知名工具知识库推断）"}
抓取到的网页简介: ${scrapedDesc || "（未抓取到，请根据网址与知名工具知识库推断）"}
页面语言: ${scrapedLang || "（未知）"}
正文片段: ${scrapedText || "（未抓取到）"}

【可选分类树 (必须严格从以下 ID 中选择)】
${catSpec || "无指定分类树"}

请严格返回以下 JSON 格式：
{
  "title": "精炼准确的网站名称（如 Cursor / Notion / DeepSeek，25字内）",
  "description": "一句话中文核心功能与亮点介绍（25~60字，客观实用）",
  "category": "最匹配的主分类 ID（必须完全匹配上方主分类 ID）",
  "subcategory": "最匹配的子类目 ID（必须属于所选主分类下的子类目 ID；若无则填空字符串）",
  "submitterNote": "推荐理由、核心标签与收费模式说明（如：#AI编程 #免费额度充足，40字内）",
  "confidence": 0.0,
  "candidates": [
    {"category": "备选主分类 ID", "subcategory": "备选子类目 ID 或空字符串", "reason": "不超过20字的入选理由"}
  ]
}
confidence 为 0~1 的分类把握度（线索充足且分类唯一时 ≥0.8；标题/简介均缺失、或站点横跨多个分类时 <0.55）。
candidates 给第二、第三可能的分类（最多 2 条，不含已选的 category 组合；确无备选可为空数组）。`;

      let hold: LlmQuotaHold | undefined;
      try {
        // 额度闸门先于模型调用：public 端点被脚本循环打时不能烧穿系统 key。
        // 预留自身失败也走下面的降级出口——没占到位就不发模型请求（fail closed）。
        const quota = await reserveLlmQuota(ctx, identity, { source: llm.source });
        if (!quota.ok) {
          return {
            success: true,
            prefill: heuristicPrefill("系统启发式提取", `${scrapedTitle || fallbackHost} 官方网站与生产力工具。`),
            fallback: true,
            aiSkipped: "quota" as const,
            quota: quotaInfo(quota.error),
          };
        }
        hold = quota.hold;
        const res = await callLlm(ctx, llm!, {
          scenario: "submission_prefill",
          identity,
          messages: [{ role: "user", content: prompt }],
          json: true,
          thinking: false,
          temperature: 0.2,
          maxTokens: 1000,
        });

        let parsed: Record<string, unknown> | null = null;
        try {
          const text = (res.content || "").replace(/```json/gi, "").replace(/```/g, "").trim();
          parsed = JSON.parse(text) as Record<string, unknown>;
        } catch {
          const m = (res.content || "").match(/\{[\s\S]*\}/);
          if (m) {
            // 解析失败即按「无解析结果」继续（外层还有 !parsed 分支兜底）；不再静默吞异常
            parsed = safeJsonParse(m[0], parsed);
          }
        }

        // 归一化匹配：LLM 常给「ai-tools」或带空格的 id/标题变体，精确等值
        // 匹配会把明明选对的分类丢成空。trim + 大小写折叠后比较 id 与标题。
        const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
        const findCat = (v: unknown) => {
          const n = norm(v);
          return n ? catTree.find((c) => norm(c.id) === n || norm(c.title) === n) : undefined;
        };
        const findSub = (cat: { subCategories?: Array<{ id: string; title: string }> } | undefined, v: unknown) => {
          const n = norm(v);
          return n ? cat?.subCategories?.find((s) => norm(s.id) === n || norm(s.title) === n) : undefined;
        };
        const matchedCat = findCat(parsed?.category);
        const matchedSub = findSub(matchedCat, parsed?.subcategory);

        // 备选分类同样走归一化 + 父子一致性校验（子类必须属于该备选主分类）
        const candidates = Array.isArray(parsed?.candidates)
          ? (parsed.candidates as Array<Record<string, unknown>>)
              .map((c) => {
                const cat = findCat(c.category);
                if (!cat) return null;
                const sub = findSub(cat, c.subcategory);
                return {
                  category: cat.id,
                  subcategory: sub?.id || "",
                  reason: String(c.reason ?? "").trim().slice(0, 40),
                };
              })
              .filter((c): c is { category: string; subcategory: string; reason: string } => c !== null)
              // 去重已选组合，最多 2 条
              .filter((c) => !(c.category === (matchedCat?.id ?? "") && c.subcategory === (matchedSub?.id ?? "")))
              .slice(0, 2)
          : [];
        const rawConfidence = Number(parsed?.confidence);
        const confidence = Number.isFinite(rawConfidence) ? Math.min(1, Math.max(0, rawConfidence)) : 0.5;

        // 图标：优先抓到的 favicon，否则 hub 代取代理（前端只做预览，不落库）
        const iconPreview = scrapedIcon || `/api/hub/assets/icon?url=${encodeURIComponent(targetUrl)}`;

        return {
          success: true,
          prefill: {
            title: String(parsed?.title || scrapedTitle || fallbackHost).trim().slice(0, 100),
            description: String(parsed?.description || scrapedDesc || "").trim().slice(0, 400),
            // 模型给的分类对不回分类树就留空，不拿第一个分类/子类顶替
            category: matchedCat?.id || "",
            subcategory: matchedSub?.id || "",
            submitterNote: String(parsed?.submitterNote || "").trim().slice(0, 300),
            confidence,
            candidates,
            icon: iconPreview,
            coverImage: scrapedImage || "",
            duplicate,
          },
          model: res.model,
        };
      } catch (err) {
        req.log.warn({ err: String(err) }, "投稿 AI 自动填表降级");
        return {
          success: true,
          prefill: heuristicPrefill("", `${scrapedTitle || fallbackHost} 在线工具与资源站点。`),
          fallback: true,
        };
      } finally {
        // 走到降级出口也花过预留（模型调用可能已发出）：finally 必须结算，
        // 否则每次失败都白占一份额度直到 TTL。settleLlmQuota 自己不抛。
        await settleLlmQuota(ctx, hold);
      }
    }
  );

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

    // URL 规范化后再查重/入库：findSiteByUrl 内部按 canonicalizeUrl 比对，但
    // createSite 若写原始串（大小写、utm_ 追踪参数、尾斜杠），第二次以另一种
    // 形态投稿时查重漏判 → 409 去重被绕过、产生重复站点。统一规范化可对齐口径。
    const canonicalUrl = canonicalizeUrl(body.data.url);
    const dup = await ctx.repo.findSiteByUrl(canonicalUrl);
    if (dup) {
      reply.code(409);
      return { success: false, message: "该网址已存在", siteId: dup.id };
    }

    const category = await ctx.repo.getCategory(body.data.categoryId);
    if (!category) { reply.code(400); return { success: false, message: "投稿类目不存在" }; }
    // 子类必须属于所选主分类：prefill 路径已做父子一致性校验，手工投稿也要同口径，
    // 否则可构造 categoryId=A + subCategoryId=B子类 的跨类目脏数据。
    if (body.data.subCategoryId) {
      const sub = await ctx.repo.getCategory(body.data.subCategoryId);
      if (!sub || sub.parentId !== body.data.categoryId) {
        reply.code(400);
        return { success: false, message: "子类目不属于所选主分类" };
      }
    }

    // 投稿正文不参与归属；只使用经过身份闸门的凭据/签名身份。
    const identityRequest = { auth: req.auth, headers: req.headers, query: req.query };
    const rawIdentity = identityTrusted(ctx, req) ? requestIdentityOf(identityRequest) : null;
    const identity = rawIdentity ? await ctx.repo.resolveIdentity(rawIdentity) : null;
    if (rawIdentity === ADMIN_NOTIFICATION_IDENTITY || identity === ADMIN_NOTIFICATION_IDENTITY) {
      reply.code(403);
      return { success: false, message: "保留身份不能投稿" };
    }
    // 归属允许匿名身份：收录反馈页用 getIdentity() 查询，未登录投稿者的身份就是
    // anon-*，排除它会让投稿主力永远看不到自己的审核汇报。body 自称身份已被
    // 签名闸门挡在 rawIdentity 之外；这里只排保留身份与字面 anonymous。
    const owner = identity && identity !== ADMIN_NOTIFICATION_IDENTITY && identity !== "anonymous"
      ? identity
      : null;
    const site = await ctx.repo.withTransaction(async () => {
      const created = await ctx.repo.createSite({
        url: canonicalUrl,
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
    await ctx.repo.recordEvent("submission", { siteId: site.id, categoryId: category.id }).catch(() => {
      // 审计/遥测类写库是尽力而为：失败不阻断主操作，写失败即丢弃。
    });
    reply.code(201);
    return { success: true, message: "投稿已提交，等待审核。审核结果与原因说明将在「用户中心 → 收录反馈」展示", siteId: site.id };
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
    const body = SubmissionReviewInput.safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { success: false, message: "无效的操作" }; }

    // 优先按真实 siteId 匹配；若未匹配且传入的是纯数字编号，回退按 djb2 哈希编号查找。
    // 这条回退只服务旧客户端（新前端直接拿列表里的 siteId）。
    let site = await ctx.repo.getSite(number);
    if (!site || site.source !== "submission") {
      // 关键：非投稿站点必须显式清空。原实现只在「纯数字」分支里重新赋值，
      // UUID 形态的普通站点会原样留在 site 里，随后被 updateSite 改写状态——
      // 任何 write 令牌都能借审核接口下架/强行上架任意站点。
      site = null;
      const wanted = Number(number);
      if (Number.isFinite(wanted)) {
        // djb2 只有 32 位、还取了绝对值：1000 条投稿约 11% 概率撞号。命中多条时
        // 「取第一条」会把 A 的审核写到 B 上（状态/原因/通知全落到错的站点），
        // 而调用方拿到的回执还报着另一个 siteId——这是最难排查的一类误审。
        // 扫描全量投稿（listSites 上限 1000，撞号可能落在第 1001 条之后），
        // 多义编号直接 409 并给出可选 siteId，让管理员用精确 id 重试。
        const rows = await ctx.repo.raw(
          "SELECT id FROM sites WHERE source = 'submission' AND deleted_at IS NULL",
        );
        const matched = rows.map((r) => String(r.id)).filter((id) => submissionNumber(id) === wanted);
        if (matched.length > 1) {
          reply.code(409);
          return {
            success: false,
            message: "投稿编号存在冲突，请改用站点 siteId 重试",
            siteIds: matched,
          };
        }
        site = matched.length === 1 ? await ctx.repo.getSite(matched[0]!) : null;
      }
    }
    if (!site) { reply.code(404); return { success: false, message: "投稿不存在" }; }

    const nextStatus = body.data.action === "approve" ? "active" : "archived";
    const siteId = site.id;
    const transitionId = randomUUID();
    // 收录汇报的原因说明：AI 基于站点信息 + 审核动作 + 管理员备注生成面向投稿人
    // 的中文说明（通过=亮点与收录理由，未通过=改进建议）。生成失败/无 key 降级
    // 模板文案，汇报不空窗。放在事务前生成：LLM 慢或抖动不拖住审核事务。
    // 原因生成走管理员身份记账：审核入口必经 admin 闸门，actor 是可信身份，
    // 比「自报 anonId」更适合作为额度归属（否则脚本换 anonId 就能重置额度）。
    const review = await generateReviewReason(ctx, site, body.data.action, body.data.reason ?? null, req.auth.actor ?? null);
    const reviewReason = review.text;
    const reviewed = await ctx.repo.withTransaction(async () => {
      await ctx.repo.raw(
        "SELECT id FROM sites WHERE id = ?" + ctx.repo.rowLockClause,
        [siteId],
      );
      const current = await ctx.repo.getSite(siteId);
      if (!current || current.source !== "submission") return null;
      // 收录汇报：通过/未通过都写「状态 + 原因」，反馈目录据此展示（复审覆盖写）。
      // 必须在「同状态早退」之前写：管理员复审只改原因说明（状态不变，如先拒后
      // 补充更具体的拒绝理由）时，反馈页也要同步到最新原因——这正是需求承诺。
      // 状态本身没变则跳过 updateSite/audit/通知，避免重复通知与状态抖动。
      await ctx.repo.recordSubmissionReview({
        siteId,
        reviewStatus: body.data.action === "approve" ? "approved" : "rejected",
        reason: reviewReason,
        reviewerNote: body.data.reason ?? null,
      });
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
          body: JSON.stringify({ siteId, reason: reviewReason }),
        });
      }
      return current;
    });
    if (!reviewed) { reply.code(404); return { success: false, message: "投稿不存在" }; }
    if (body.data.action === "approve") {
      await indexSite(ctx, reviewed.id, reviewed.title, reviewed.description ?? null, reviewed.url);
      // 待找匹配通知（搜索容错纠错 · 出口一，v1 只钩投稿审核通过）：
      // 命中则站内通知一次（幂等键 + 状态机，一条待找只通知一次）。
      // 通知失败不影响审核结果本身（审核已提交，匹配是附加动作）。
      await ctx.repo
        .matchWantedSearches({ id: reviewed.id, title: reviewed.title, url: reviewed.url })
        .catch(() => { /* 待找匹配通知是附加动作：审核已提交，匹配失败不影响审核结果 */ });
    }
    return {
      success: true,
      message: body.data.action === "approve" ? "投稿已通过并已上架" : "投稿已拒绝",
      siteId: site.id,
      // 诚实标注原因来源：AI 生成 / 通用模板 / 额度用完降级（后者带恢复时间）。
      reasonSource: review.source,
      ...(review.quota ? { reasonQuota: review.quota } : {}),
    };
  });

  /**
   * 收录反馈（用户侧）：我的投稿 + 审核结果汇报（提交时间/网址/状态/原因）。
   * 状态与原因更新后重新拉取即最新（无缓存，反馈目录以拉取时刻为准）。
   * 身份闸门与 user/ai/config 同口径：开放模式 / 持票 / 签名绑定的身份均可读。
   */
  app.get("/api/submissions/feedback", { config: { scope: "public", rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const identity = requestIdentityOf(req as never);
    if (!identity) {
      reply.code(400);
      return { success: false, message: "缺少 userId 或 anonId" };
    }
    if (!identityTrusted(ctx, req as never)) {
      reply.code(401);
      return { success: false, message: "需要 Bearer token" };
    }
    const canonical = await ctx.repo.resolveIdentity(identity);
    const items = await ctx.repo.listSubmissionFeedback(canonical, 100);
    return { success: true, items };
  });

};

/** 原因来源必须可观测：模板与额度降级不能冒充 AI 生成 */
interface ReviewReasonResult {
  text: string;
  source: "ai" | "template" | "quota";
  quota?: ReturnType<typeof quotaInfo>;
}

/**
 * 审核原因说明（AI 生成，模板/额度降级）。
 *
 * 通过：说明亮点与收录价值；未通过：说明具体原因与改进建议。面向投稿人的
 * 口吻（不用"经审核"套话），50~100 字。LLM 无 key / 额度用完 / 调用失败时
 * 降级为按动作给的通用模板说明——汇报永不空窗；管理员备注仅作 AI 素材，
 * 绝不逐字外发。模型调用前必须过额度闸门（与其他 LLM 入口同口径）。
 */
async function generateReviewReason(
  ctx: AppContext,
  site: { title: string; url: string; description?: string | null },
  action: "approve" | "reject",
  reviewerNote: string | null,
  identity: string | null,
): Promise<ReviewReasonResult> {
  // 降级模板**不拼管理员备注原文**：备注是内部意见（可能含隐私/内部口径），
  // reason 走通知与反馈页两个外发出口，逐字带出会泄露（submission-plugin-
  // notifications 的隐私断言钉死这一点）。备注只作 AI 素材，输出要求转写。
  const fallback = (): ReviewReasonResult => ({
    source: "template",
    text: action === "approve"
      ? (reviewerNote && reviewerNote.trim()
        ? "已通过收录：内容与定位符合导航收录标准，已上架。"
        : "已通过收录：站点内容健康、定位清晰，已上架到导航。")
      : (reviewerNote && reviewerNote.trim()
        ? "暂未通过：与当前收录标准暂不匹配，欢迎完善后再投稿。"
        : "暂未通过：站点与导航收录标准暂不匹配，欢迎完善后再投稿。"),
  });

  let hold: LlmQuotaHold | undefined;
  try {
    const llm = await resolveLlm(ctx, identity);
    if (!llm.provider.apiKey) return fallback();
    // 闸门与 callLlm 用的是同一个 identity / source：按谁取 key 就按谁记账，
    // 否则「限额的是 A、扣费的是 B」让额度形同虚设。
    const quota = await reserveLlmQuota(ctx, identity, { source: llm.source });
    if (!quota.ok) {
      return { ...fallback(), source: "quota", quota: quotaInfo(quota.error) };
    }
    hold = quota.hold;
    const prompt = `你是导航站的收录编辑，请为一次投稿审核结果写一段面向投稿人的中文说明（50~100字，口吻友好具体，不用"经审核"套话）。
投稿站点：${site.title}（${site.url}）
站点简介：${site.description || "（无）"}
审核结果：${action === "approve" ? "通过并已上架" : "未通过"}
管理员备注（内部意见，仅供理解背景，禁止逐字复述到说明里）：${reviewerNote || "（无）"}
${action === "approve"
  ? "请说明这个站点被收录的亮点与价值（基于简介与管理员备注；备注为空则从站点定位推断）。"
  : "请说明未通过的具体原因与可操作的改进建议（基于管理员备注；备注为空则给通用但真诚的建议，不贬损）。"}
只输出说明文本本身，不要引号或前缀；说明里不得出现管理员备注的原文照搬。`;
    const res = await callLlm(ctx, llm, {
      scenario: "submission_review_reason",
      identity,
      messages: [{ role: "user", content: prompt }],
      json: false,
      thinking: false,
      temperature: 0.4,
      maxTokens: 300,
    });
    // 剥模型偶尔裹上的引号（中英引号对称清理）；原正则开头字符类重复、结尾漏右引号，清不干净
    const text = (res.content || "").trim().replace(/^[「」"']+|[「」"']+$/g, "").slice(0, 300);
    // 代码层兜底：prompt 的自然语言约束「禁止逐字复述」不保证模型遵守。备注是
    // 内部口径，reason 会外发到通知与反馈页。归一化不只去空白/小写，还要去掉
    // 标点与符号——模型常把「预算不足，暂不收录」写成「预算不足暂不收录」，
    // 只比空白会让这种逐字复述漏过。极短备注（2~3 字）不做包含检测（会误伤
    // 「不好」这类常见词），但若整段输出就是该备注，仍然丢弃。
    const normalizeForLeakCheck = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
    const note = reviewerNote ? normalizeForLeakCheck(reviewerNote) : "";
    const output = normalizeForLeakCheck(text);
    if (note) {
      const verbatim = note.length >= 4
        ? output.includes(note)
        : note.length >= 2 && output === note;
      if (verbatim) return fallback();
    }
    return { text: text || fallback().text, source: "ai" };
  } catch {
    return fallback();
  } finally {
    // 模型失败/降级也走这里：预留在，额度就被占着直到 TTL。
    await settleLlmQuota(ctx, hold);
  }
}
