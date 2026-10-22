/**
 * 站点域工具：检索 / 读取 / 增删改 / 批量导入 / 导出 / 健康巡检 / 刷新排队。
 *
 * 写操作一律「权限校验 -> （必要时）幂等去重 -> 审计落库」，与 REST 侧语义一致。
 */
import { enrichUrl, guardedFetch } from "@navhub/ai";
import { enrichLlmOf, resolveLlm } from "@navhub/api";
import { auditPageHealth, resolveCategoryTitleSuggestion } from "@navhub/core";
import {
  BatchImportInput,
  CreateSiteInput,
  DeleteSiteInput,
  ExportSitesInput,
  GetSiteInput,
  HealthCheckInput,
  MAX_BATCH_ITEMS,
  RefreshSiteInput,
  SearchSitesInput,
  SetStatusInput,
  UpdateSiteInput,
  requireScope,
  type ToolContext,
} from "../tools.ts";
import { fail, ok, type Handler, type HandlerDeps } from "./shared.ts";

export const siteHandlers = {
  async search_sites(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    requireScope(tc, "read");
    const input = SearchSitesInput.parse(args ?? {});
    // facets 在 schema 里是对外承诺过的过滤维度（MCP inputSchema / OpenAPI 都从那份契约生成），
    // 漏传等于"文档说能筛、实际静默不过滤"，Agent 会拿到超集还以为是结果。
    const result = await ctx.search.search({ q: input.query, limit: input.limit, categoryId: input.categoryId, tag: input.tag, facets: input.facets });
    const byId = await ctx.repo.getSitesByIds(result.hits.map((h) => h.siteId));
    const results = result.hits.map((h) => {
      const site = byId.get(h.siteId);
      return {
        title: site?.title, url: site?.url, description: site?.description,
        icon: site?.iconKey, tags: site?.tags ?? [],
        matchScore: Number(h.score.toFixed(6)),
        /** 解释「为什么是它」：每路召回的名次 */
        matchedBy: Object.fromEntries(Object.entries(h.contributions).map(([k, v]) => [k, v?.rank])),
      };
    });
    return ok({
      query: input.query, count: results.length,
      channelsUsed: result.channelsUsed, semanticAvailable: result.semanticAvailable,
      tookMs: result.tookMs, results,
    });
  },

  async get_site(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    requireScope(tc, "read");
    const input = GetSiteInput.parse(args ?? {});
    const site = await ctx.repo.getSite(input.idOrUrl);
    if (!site) return fail("未找到站点：" + input.idOrUrl);
    return ok(site);
  },

  async create_site(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx, withIdempotency, indexSite } = deps;
    requireScope(tc, "write");
    const input = CreateSiteInput.parse(args ?? {});
    return withIdempotency(input.idempotencyKey, async () => {
      const dup = await ctx.repo.findSiteByUrl(input.url);
      // 已存在不算错误：Agent 无法预知库里有什么，报错会让它进入无效重试
      if (dup) return { created: false, reason: "already_exists", site: dup };

      let title = input.title ?? input.url;
      let description = input.description ?? null;
      let categoryId = input.categoryId ?? null;
      let tags = input.tags ?? [];
      let provenance: string | null = null;
      let gapTitle: string | null = null;
      let ambiguousCategoryIds: string[] = [];

      if (input.enrich) {
        const cats = await ctx.repo.listCategories();
        // 与 HTTP 入口共用同一解析链：系统配置 > 环境变量 > 内置默认（Agnes）
        const resolved = await resolveLlm(ctx);
        const e = await enrichUrl(input.url, {
          llm: enrichLlmOf(resolved), guard: ctx.config.fetch,
          knownCategories: cats.map((c) => c.title),
        });
        provenance = e.provenance;
        title = input.title ?? e.title;
        description = input.description ?? e.description;
        tags = input.tags ?? e.tags;
        if (!categoryId && e.suggestedCategory) {
          const r = resolveCategoryTitleSuggestion(
            e.suggestedCategory,
            cats.map((c) => ({ id: c.id, title: c.title, altLabels: c.altLabels })),
          );
          if (r.status === "unique") categoryId = r.categoryId;
          else {
            gapTitle = e.suggestedCategory;
            if (r.status === "ambiguous") ambiguousCategoryIds = r.categoryIds;
          }
        }
      }

      if (!categoryId) {
        // 兜底走固定 id 的「未分类」，不是 cats[0]（那等于随机塞进第一个领域类目）
        categoryId = await ctx.repo.ensureUncategorized();
      }

      const site = await ctx.repo.createSite({ url: input.url, title, description, categoryId, tags, facets: input.facets, source: "mcp" });
      // Agent 建议的类目名不再自动进树：记账成提案，由编辑在后台判定（见 category_gap）
      const categoryGap = gapTitle
        ? await ctx.repo.recordCategoryGap({ title: gapTitle, siteId: site.id, siteUrl: site.url, source: "MCP create_site", ambiguousCategoryIds })
        : null;
      await indexSite(site.id, site.title, site.description ?? null, site.url);
      await ctx.repo.audit({ actor: tc.actor, actorKind: "mcp", action: "site.create", target: site.id, diff: { provenance, categoryGap: categoryGap?.proposalId ?? null } });
      return { created: true, site, provenance, categoryGap };
    });
  },

  async update_site(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx, indexSite } = deps;
    requireScope(tc, "write");
    const input = UpdateSiteInput.parse(args ?? {});
    const before = await ctx.repo.getSite(input.id);
    if (!before) return fail("未找到站点：" + input.id);
    const site = await ctx.repo.updateSite(input.id, {
      title: input.title,
      description: input.description as never,
      categoryId: input.categoryId,
      tags: input.tags,
      facets: input.facets,
      featured: input.featured,
    });
    if (site) await indexSite(site.id, site.title, site.description ?? null, site.url);
    await ctx.repo.audit({ actor: tc.actor, actorKind: "mcp", action: "site.update", target: input.id, diff: { patch: input } });
    return ok({ updated: true, site });
  },

  async set_status(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    requireScope(tc, "write");
    const input = SetStatusInput.parse(args ?? {});
    const site = await ctx.repo.updateSite(input.id, { status: input.status });
    if (!site) return fail("未找到站点：" + input.id);
    await ctx.repo.audit({ actor: tc.actor, actorKind: "mcp", action: "site.setStatus", target: input.id, diff: { status: input.status } });
    return ok({ updated: true, id: input.id, status: input.status });
  },

  async batch_import(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx, withIdempotency, indexSite } = deps;
    requireScope(tc, "write");
    const input = BatchImportInput.parse(args ?? {});
    if (input.sites.length > MAX_BATCH_ITEMS) {
      return fail("单次导入不能超过 " + MAX_BATCH_ITEMS + " 条，收到 " + input.sites.length);
    }

    // 先按 URL 去重再规划：findSiteByUrl 只看"这批开始之前"的库状态，
    // 同一份 payload 里重复的 url 会被判成两条 create，落库时真的多出两行站点。
    const unique: typeof input.sites = [];
    const duplicateUrls: string[] = [];
    for (const s of input.sites) {
      if (unique.some((u) => u.url === s.url)) { duplicateUrls.push(s.url); continue; }
      unique.push(s);
    }

    const plan: Array<{ url: string; action: string; title?: string; reason?: string }> = [];
    for (const s of unique) {
      const dup = await ctx.repo.findSiteByUrl(s.url);
      plan.push(dup
        ? { url: s.url, action: "skip", title: dup.title, reason: "已存在" }
        : { url: s.url, action: "create", title: s.title });
    }

    // dryRun 默认 true：先让调用方看到影响面再决定是否落库
    if (input.dryRun) {
      return ok({ dryRun: true, total: input.sites.length, wouldCreate: plan.filter((p) => p.action === "create").length, duplicateUrls, plan });
    }

    return withIdempotency(input.idempotencyKey, async () => {
      // 兜底走固定 id 的「未分类」：批导入没给 defaultCategoryId 时，
      // 旧的 cats[0] 会把整批站点塞进 sort 最靠前的真实类目。
      const fallback = input.defaultCategoryId ?? (await ctx.repo.ensureUncategorized());
      const created: string[] = [];
      for (let i = 0; i < unique.length; i++) {
        if (plan[i]!.action !== "create") continue;
        const s = unique[i]!;
        const site = await ctx.repo.createSite({
          url: s.url, title: s.title ?? s.url, description: s.description ?? null,
          categoryId: s.categoryId ?? fallback, tags: s.tags ?? [], source: "mcp-batch",
        });
        await indexSite(site.id, site.title, site.description ?? null, site.url);
        created.push(site.id);
      }
      await ctx.repo.audit({ actor: tc.actor, actorKind: "mcp", action: "site.batchImport", diff: { created: created.length, duplicateUrls: duplicateUrls.length } });
      return { dryRun: false, created: created.length, ids: created, duplicateUrls };
    });
  },

  async health_check(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    requireScope(tc, "write");
    const input = HealthCheckInput.parse(args ?? {});
    // onlyUnchecked 必须"先筛后截"：limit 约束的是本次巡检几条，不是候选池几条。
    // 原实现先 listSites({ limit }) 再 filter，等于只在最前面 limit 条里找未巡检的——
    // 未巡检的站点排在后面时，这一轮扫到 0 条却报告 checked:0（看起来"都巡检过了"）。
    // 放大窗口只是把排序靠后的候选捞回来，上限取仓储层的硬钳制值 1000。
    const scanLimit = input.onlyUnchecked ? Math.min(input.limit * 10, 1000) : input.limit;
    const all = await ctx.repo.listSites({ limit: scanLimit });
    const target = input.onlyUnchecked
      ? all.filter((s) => !s.health?.lastCheckedAt).slice(0, input.limit)
      : all;

    const results: Array<{ url: string; ok: boolean; status: number | null; latencyMs: number; error?: string }> = [];
    for (const site of target) {
      const t0 = Date.now();
      try {
        const res = await guardedFetch(site.url, { ...ctx.config.fetch });
        const latency = Date.now() - t0;
        let ok = res.status >= 200 && res.status < 400;
        let reason: string | null = null;
        if (ok && res.body) {
          const audit = auditPageHealth(site.url, res.body);
          if (audit.status === "SUSPICIOUS_PARKED" || audit.status === "SOFT_404") {
            ok = false;
            reason = "伪健康识别: " + audit.reason;
          }
        }
        results.push({ url: site.url, ok, status: res.status, latencyMs: latency, error: reason ?? undefined });
        // 走 Repository 抽象（而非直接写 SQLite）：health_checks 表 + sites 冗余列，
        // 两种方言都由仓储层消化——此前 PG 模式直接 fail，属于"能力分裂"。
        await ctx.repo.updateSiteHealth(site.id, {
          httpStatus: res.status, ok, latencyMs: latency,
          redirectTo: res.redirects.at(-1) ?? null, error: reason,
          currentStatus: site.status,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ url: site.url, ok: false, status: null, latencyMs: Date.now() - t0, error: message });
        await ctx.repo.updateSiteHealth(site.id, {
          httpStatus: null, ok: false, latencyMs: Date.now() - t0,
          redirectTo: null, error: message, currentStatus: site.status,
        });
      }
    }

    const broken = results.filter((r) => !r.ok);
    await ctx.repo.audit({ actor: tc.actor, actorKind: "mcp", action: "site.healthCheck", diff: { checked: results.length, broken: broken.length } });
    return ok({ checked: results.length, scanned: all.length, healthy: results.length - broken.length, broken, results });
  },

  async delete_site(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx, withIdempotency } = deps;
    requireScope(tc, "write");
    const input = DeleteSiteInput.parse(args ?? {});
    return withIdempotency(input.idempotencyKey, async () => {
      const site = await ctx.repo.getSite(input.idOrUrl);
      // 幂等：站点不存在不算错误——Agent 重试或并发删除是常态，报错会引发无效重试
      if (!site) return { deleted: false, reason: "not_found", idOrUrl: input.idOrUrl };
      await ctx.repo.deleteSite(site.id);
      await ctx.repo.audit({ actor: tc.actor, actorKind: "mcp", action: "site.delete", target: site.id, diff: { soft: true, url: site.url } });
      // 软删除（进回收站），恢复走 REST：POST /api/trash/:id/restore
      return { deleted: true, id: site.id, url: site.url, mode: "soft", note: "已移入回收站，可通过 /api/trash/:id/restore 恢复" };
    });
  },

  async export_sites(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    requireScope(tc, "read");
    const input = ExportSitesInput.parse(args ?? {});
    const sites = await ctx.repo.listSites({
      categoryId: input.categoryId,
      status: input.status as never,
      limit: input.limit,
    });
    if (input.format === "csv") {
      // CSV 里公式注入是真实风险（=、+、-、@ 开头会被 Excel 当公式执行）：
      // 给这些值加前导单引号转义。
      const esc = (v: unknown) => {
        const s = v === null || v === undefined ? "" : String(v);
        return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
      };
      const header = "id,url,title,description,categoryId,tags,status,featured";
      const lines = sites.map((s) =>
        [s.id, s.url, s.title, s.description ?? "", s.categoryId, (s.tags ?? []).join("|"), s.status, s.featured ? 1 : 0]
          .map((v) => '"' + esc(v).replace(/"/g, '""') + '"').join(","));
      await ctx.repo.audit({ actor: tc.actor, actorKind: "mcp", action: "site.export", diff: { format: "csv", count: sites.length } });
      return ok({ format: "csv", count: sites.length, csv: [header, ...lines].join("\n") });
    }
    await ctx.repo.audit({ actor: tc.actor, actorKind: "mcp", action: "site.export", diff: { format: "json", count: sites.length } });
    return ok({ format: "json", count: sites.length, sites });
  },

  async refresh_site(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    requireScope(tc, "write");
    const input = RefreshSiteInput.parse(args ?? {});
    const site = await ctx.repo.getSite(input.idOrUrl);
    if (!site) return fail("未找到站点：" + input.idOrUrl);
    const jobId = await ctx.repo.enqueueJob("refetch_metadata", { siteId: site.id, llm: input.llm });
    await ctx.repo.audit({ actor: tc.actor, actorKind: "mcp", action: "job.enqueue", target: jobId, diff: { kind: "refetch_metadata", siteId: site.id } });
    return ok({ queued: true, jobId, siteId: site.id, url: site.url, note: "Runner 会在 30 秒内执行；刷新是异步的，不会立即返回新元数据。" });
  },
} satisfies Record<string, Handler>;
