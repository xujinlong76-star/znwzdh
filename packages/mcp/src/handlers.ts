/**
 * MCP 工具实现。
 *
 * 与 REST API 共用同一套仓储 / 检索引擎 / AI 能力（通过 AppContext 注入），
 * 因此 MCP 与网页端的所见所得完全一致，不会出现"两套逻辑算出两个答案"。
 *
 * 每个写操作都做三件事：权限校验 -> 幂等去重 -> 审计落库。
 */
import { hashSiteId } from "@navhub/store";
import { enrichUrl, siteEmbeddingText, guardedFetch } from "@navhub/ai";
// submissionNumber 与中枢 REST 共用同一实现（djb2）：MCP 返回的 number
// 必须和 GET /api/submissions 里的一致，否则前端按 number 审核会对不上。
import { submissionNumber, type AppContext } from "@navhub/api";
import {
  AddToCollectionInput,
  BatchImportInput,
  CreateSiteInput,
  DeleteSiteInput,
  ExportSitesInput,
  GetCollectionInput,
  GetSiteInput,
  GetTrendingInput,
  HealthCheckInput,
  ListCategoriesInput,
  ListCollectionsInput,
  ListSubmissionsInput,
  ListTagsInput,
  MAX_BATCH_ITEMS,
  RefreshSiteInput,
  ReviewSubmissionInput,
  RunJobInput,
  SearchSitesInput,
  SetStatusInput,
  UpdateSiteInput,
  requireScope,
  type ToolContext,
} from "./tools.ts";

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

function ok(payload: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function createHandlers(ctx: AppContext) {
  /**
   * 幂等键处理：命中则直接返回上次结果。
   * 这是防止 Agent 重试导致重复入库的关键 —— Agent 重试是常态，不是异常。
   */
  async function withIdempotency(key: string | undefined, compute: () => Promise<unknown>): Promise<ToolResult> {
    if (!key) return ok(await compute());
    const db = ctx.db;
    if (db.dialect === "sqlite" && db.sqlite) {
      const existing = db.sqlite.prepare("SELECT response FROM idempotency WHERE key = ?").get(key) as { response: string } | undefined;
      if (existing?.response) return ok({ replayed: true, result: JSON.parse(existing.response) });
    } else if (db.dialect === "pg" && db.pg) {
      const { rows } = await db.pg.query("SELECT response FROM idempotency WHERE key = $1", [key]);
      const row = rows[0] as { response: string } | undefined;
      if (row?.response) return ok({ replayed: true, result: JSON.parse(row.response) });
    }
    const result = await compute();
    if (db.dialect === "sqlite" && db.sqlite) {
      db.sqlite.prepare("INSERT OR REPLACE INTO idempotency (key, response, created_at) VALUES (?,?,?)")
        .run(key, JSON.stringify(result), Date.now());
    } else if (db.dialect === "pg" && db.pg) {
      await db.pg.query(
        "INSERT INTO idempotency (key, response, created_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET response = $2, created_at = $3",
        [key, JSON.stringify(result), Date.now()]
      );
    }
    return ok(result);
  }

  async function indexSite(id: string, title: string, description: string | null, url: string) {
    if (!ctx.embedding) return;
    try {
      const vec = await ctx.embedding.encode(siteEmbeddingText({ title, description, url }));
      await ctx.vectors.upsert([{ key: hashSiteId(id), siteId: id, vector: vec }]);
      await ctx.repo.saveEmbedding(id, ctx.config.embedding.model, vec);
    } catch {
      // 模型不可用不该让写操作失败
    }
  }

  return {
    async search_sites(args: unknown, tc: ToolContext): Promise<ToolResult> {
      requireScope(tc, "read");
      const input = SearchSitesInput.parse(args ?? {});
      const result = await ctx.search.search({ q: input.query, limit: input.limit, categoryId: input.categoryId, tag: input.tag });
      const results = await Promise.all(result.hits.map(async (h) => {
        const site = await ctx.repo.getSite(h.siteId);
        return {
          title: site?.title, url: site?.url, description: site?.description,
          icon: site?.iconKey, tags: site?.tags ?? [],
          matchScore: Number(h.score.toFixed(6)),
          /** 解释「为什么是它」：每路召回的名次 */
          matchedBy: Object.fromEntries(Object.entries(h.contributions).map(([k, v]) => [k, v?.rank])),
        };
      }));
      return ok({
        query: input.query, count: results.length,
        channelsUsed: result.channelsUsed, semanticAvailable: result.semanticAvailable,
        tookMs: result.tookMs, results,
      });
    },

    async get_site(args: unknown, tc: ToolContext): Promise<ToolResult> {
      requireScope(tc, "read");
      const input = GetSiteInput.parse(args ?? {});
      const site = await ctx.repo.getSite(input.idOrUrl);
      if (!site) return fail("未找到站点：" + input.idOrUrl);
      return ok(site);
    },

    async list_categories(args: unknown, tc: ToolContext): Promise<ToolResult> {
      requireScope(tc, "read");
      const input = ListCategoriesInput.parse(args ?? {});
      const cats = await ctx.repo.listCategories();
      if (!input.includeCounts) return ok(cats);
      const all = await ctx.repo.listSites();
      const counts = new Map<string, number>();
      for (const s of all) counts.set(s.categoryId, (counts.get(s.categoryId) ?? 0) + 1);
      return ok(cats.map((c) => ({ ...c, siteCount: counts.get(c.id) ?? 0 })));
    },

    async get_stats(_args: unknown, tc: ToolContext): Promise<ToolResult> {
      requireScope(tc, "read");
      return ok({ ...(await ctx.repo.stats()), capabilities: ctx.capabilities });
    },

    async create_site(args: unknown, tc: ToolContext): Promise<ToolResult> {
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

        if (input.enrich) {
          const cats = await ctx.repo.listCategories();
          const e = await enrichUrl(input.url, {
            llm: ctx.config.llm, guard: ctx.config.fetch,
            knownCategories: cats.map((c) => c.title),
          });
          provenance = e.provenance;
          title = input.title ?? e.title;
          description = input.description ?? e.description;
          tags = input.tags ?? e.tags;
          if (!categoryId && e.suggestedCategory) {
            categoryId = cats.find((c) => c.title === e.suggestedCategory)?.id ?? null;
          }
        }

        if (!categoryId) {
          const cats = await ctx.repo.listCategories();
          categoryId = cats[0]?.id ?? (await ctx.repo.createCategory({ title: "未分类" })).id;
        }

        const site = await ctx.repo.createSite({ url: input.url, title, description, categoryId, tags, source: "mcp" });
        await indexSite(site.id, site.title, site.description ?? null, site.url);
        await ctx.repo.audit({ actor: tc.actor, actorKind: "mcp", action: "site.create", target: site.id, diff: { provenance } });
        return { created: true, site, provenance };
      });
    },

    async update_site(args: unknown, tc: ToolContext): Promise<ToolResult> {
      requireScope(tc, "write");
      const input = UpdateSiteInput.parse(args ?? {});
      const before = await ctx.repo.getSite(input.id);
      if (!before) return fail("未找到站点：" + input.id);
      const site = await ctx.repo.updateSite(input.id, {
        title: input.title,
        description: input.description as never,
        categoryId: input.categoryId,
        tags: input.tags,
        featured: input.featured,
      });
      if (site) await indexSite(site.id, site.title, site.description ?? null, site.url);
      await ctx.repo.audit({ actor: tc.actor, actorKind: "mcp", action: "site.update", target: input.id, diff: { patch: input } });
      return ok({ updated: true, site });
    },

    async set_status(args: unknown, tc: ToolContext): Promise<ToolResult> {
      requireScope(tc, "write");
      const input = SetStatusInput.parse(args ?? {});
      const site = await ctx.repo.updateSite(input.id, { status: input.status });
      if (!site) return fail("未找到站点：" + input.id);
      await ctx.repo.audit({ actor: tc.actor, actorKind: "mcp", action: "site.setStatus", target: input.id, diff: { status: input.status } });
      return ok({ updated: true, id: input.id, status: input.status });
    },

    async batch_import(args: unknown, tc: ToolContext): Promise<ToolResult> {
      requireScope(tc, "write");
      const input = BatchImportInput.parse(args ?? {});
      if (input.sites.length > MAX_BATCH_ITEMS) {
        return fail("单次导入不能超过 " + MAX_BATCH_ITEMS + " 条，收到 " + input.sites.length);
      }

      const plan: Array<{ url: string; action: string; title?: string; reason?: string }> = [];
      for (const s of input.sites) {
        const dup = await ctx.repo.findSiteByUrl(s.url);
        plan.push(dup
          ? { url: s.url, action: "skip", title: dup.title, reason: "已存在" }
          : { url: s.url, action: "create", title: s.title });
      }

      // dryRun 默认 true：先让调用方看到影响面再决定是否落库
      if (input.dryRun) {
        return ok({ dryRun: true, total: input.sites.length, wouldCreate: plan.filter((p) => p.action === "create").length, plan });
      }

      return withIdempotency(input.idempotencyKey, async () => {
        const cats = await ctx.repo.listCategories();
        const fallback = input.defaultCategoryId ?? cats[0]?.id ?? (await ctx.repo.createCategory({ title: "未分类" })).id;
        const created: string[] = [];
        for (const s of input.sites) {
          if (plan.find((p) => p.url === s.url)?.action === "skip") continue;
          const site = await ctx.repo.createSite({
            url: s.url, title: s.title ?? s.url, description: s.description ?? null,
            categoryId: s.categoryId ?? fallback, tags: s.tags ?? [], source: "mcp-batch",
          });
          await indexSite(site.id, site.title, site.description ?? null, site.url);
          created.push(site.id);
        }
        await ctx.repo.audit({ actor: tc.actor, actorKind: "mcp", action: "site.batchImport", diff: { created: created.length } });
        return { dryRun: false, created: created.length, ids: created };
      });
    },

    async health_check(args: unknown, tc: ToolContext): Promise<ToolResult> {
      requireScope(tc, "write");
      const input = HealthCheckInput.parse(args ?? {});
      const all = await ctx.repo.listSites({ limit: input.limit });
      const target = input.onlyUnchecked ? all.filter((s) => !s.health?.lastCheckedAt) : all;

      const results: Array<{ url: string; ok: boolean; status: number | null; latencyMs: number; error?: string }> = [];
      for (const site of target) {
        const t0 = Date.now();
        try {
          const res = await guardedFetch(site.url, { ...ctx.config.fetch });
          const latency = Date.now() - t0;
          const ok = res.status >= 200 && res.status < 400;
          results.push({ url: site.url, ok, status: res.status, latencyMs: latency });
          // 走 Repository 抽象（而非直接写 SQLite）：health_checks 表 + sites 冗余列，
          // 两种方言都由仓储层消化——此前 PG 模式直接 fail，属于"能力分裂"。
          await ctx.repo.updateSiteHealth(site.id, {
            httpStatus: res.status, ok, latencyMs: latency,
            redirectTo: res.redirects.at(-1) ?? null, error: null,
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
      return ok({ checked: results.length, healthy: results.length - broken.length, broken, results });
    },

    async delete_site(args: unknown, tc: ToolContext): Promise<ToolResult> {
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

    async export_sites(args: unknown, tc: ToolContext): Promise<ToolResult> {
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

    async get_trending(args: unknown, tc: ToolContext): Promise<ToolResult> {
      requireScope(tc, "read");
      const input = GetTrendingInput.parse(args ?? {});
      const sites = await ctx.repo.hotSites(input.limit);
      return ok({
        count: sites.length,
        // 带热度分量，Agent 可以解释「为什么排这儿」
        results: sites.map((s, i) => ({
          rank: i + 1,
          title: s.title,
          url: s.url,
          description: s.description,
          tags: s.tags,
          visits7d: s.visitCount ?? 0,
          trendScore: s.trendScore ?? 0,
        })),
      });
    },

    async list_tags(args: unknown, tc: ToolContext): Promise<ToolResult> {
      requireScope(tc, "read");
      const input = ListTagsInput.parse(args ?? {});
      const all = await ctx.repo.listTagsWithCounts(input.minCount);
      return ok({ count: Math.min(all.length, input.limit), tags: all.slice(0, input.limit) });
    },

    async refresh_site(args: unknown, tc: ToolContext): Promise<ToolResult> {
      requireScope(tc, "write");
      const input = RefreshSiteInput.parse(args ?? {});
      const site = await ctx.repo.getSite(input.idOrUrl);
      if (!site) return fail("未找到站点：" + input.idOrUrl);
      const jobId = await ctx.repo.enqueueJob("refetch_metadata", { siteId: site.id, llm: input.llm });
      await ctx.repo.audit({ actor: tc.actor, actorKind: "mcp", action: "job.enqueue", target: jobId, diff: { kind: "refetch_metadata", siteId: site.id } });
      return ok({ queued: true, jobId, siteId: site.id, url: site.url, note: "Runner 会在 30 秒内执行；刷新是异步的，不会立即返回新元数据。" });
    },

    async run_job(args: unknown, tc: ToolContext): Promise<ToolResult> {
      // run_job 需要 admin：它会触发全站扫描（健康巡检/重算/重建索引）
      requireScope(tc, "admin");
      const input = RunJobInput.parse(args ?? {});
      const jobId = await ctx.repo.enqueueJob(input.kind, input.payload ?? {});
      await ctx.repo.audit({ actor: tc.actor, actorKind: "mcp", action: "job.enqueue", target: jobId, diff: { kind: input.kind, payload: input.payload ?? {} } });
      return ok({ queued: true, jobId, kind: input.kind, note: "任务已入队，Runner 会在 30 秒内执行。用 GET /api/jobs 查询执行状态。" });
    },

    async list_collections(args: unknown, tc: ToolContext): Promise<ToolResult> {
      requireScope(tc, "read");
      const input = ListCollectionsInput.parse(args ?? {});
      const all = await ctx.repo.listCollections(!input.includeDisabled);
      return ok({
        count: all.length,
        collections: all.map((c) => ({
          slug: c.slug, title: c.title, description: c.description ?? null,
          kind: c.kind, enabled: c.enabled, sort: c.sort,
        })),
      });
    },

    async get_collection(args: unknown, tc: ToolContext): Promise<ToolResult> {
      requireScope(tc, "read");
      const input = GetCollectionInput.parse(args ?? {});
      const col = await ctx.repo.getCollectionBySlug(input.slug);
      if (!col) return fail("未找到专题：" + input.slug);
      const sites = (await ctx.repo.listCollectionSites(input.slug)).slice(0, input.limit);
      return ok({
        slug: col.slug, title: col.title, description: col.description ?? null, kind: col.kind,
        count: sites.length,
        sites: sites.map((s) => ({ title: s.title, url: s.url, description: s.description, tags: s.tags })),
      });
    },

    async add_to_collection(args: unknown, tc: ToolContext): Promise<ToolResult> {
      requireScope(tc, "write");
      const input = AddToCollectionInput.parse(args ?? {});
      const compute = async () => {
        const col = await ctx.repo.getCollectionBySlug(input.slug);
        if (!col) throw new Error("未找到专题：" + input.slug);
        const site = await ctx.repo.getSite(input.idOrUrl);
        if (!site) throw new Error("未找到站点：" + input.idOrUrl);
        const result = await ctx.repo.addCollectionItem(col.id, site.id);
        await ctx.repo.audit({ actor: tc.actor, actorKind: "mcp", action: "collection.add_item", target: col.id, diff: { siteId: site.id } });
        return { ok: true, slug: col.slug, siteId: site.id, ...result };
      };
      try {
        return await withIdempotency(input.idempotencyKey, compute);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },

    async list_submissions(args: unknown, tc: ToolContext): Promise<ToolResult> {
      requireScope(tc, "read");
      const input = ListSubmissionsInput.parse(args ?? {});
      const statusMap = { pending: "pending", approved: "active", rejected: "archived", all: undefined } as const;
      const sites = await ctx.repo.listSites({ source: "submission", status: statusMap[input.status] as never, limit: input.limit });
      return ok({
        status: input.status,
        count: sites.length,
        submissions: sites.map((s) => ({
          number: submissionNumber(s.id),
          siteId: s.id,
          title: s.title,
          url: s.url,
          description: s.description ?? "",
          categoryId: s.categoryId,
          state: s.status,
          createdAt: s.createdAt,
        })),
      });
    },

    async review_submission(args: unknown, tc: ToolContext): Promise<ToolResult> {
      requireScope(tc, "write");
      const input = ReviewSubmissionInput.parse(args ?? {});
      const compute = async () => {
        let site = input.siteId ? await ctx.repo.getSite(input.siteId) : null;
        if (!site && input.number !== undefined) {
          // 投稿池有限（与 REST 同策略）：逐个算 hash 反查，不另建映射表
          const candidates = await ctx.repo.listSites({ source: "submission", limit: 1000 });
          const found = candidates.find((s) => submissionNumber(s.id) === input.number);
          if (!found) throw new Error("未找到投稿：" + input.number);
          site = found;
        }
        if (!site) throw new Error("未找到投稿");
        if (site.source !== "submission") {
          throw new Error("该站点不是投稿（source=" + site.source + "），请用 update_site 修改");
        }
        const nextStatus = input.action === "approve" ? "active" : "archived";
        await ctx.repo.updateSite(site.id, { status: nextStatus as never });
        await ctx.repo.audit({
          actor: tc.actor, actorKind: "mcp",
          action: input.action === "approve" ? "submission.approve" : "submission.reject",
          target: site.id, diff: { url: site.url, title: site.title, reason: input.reason ?? null },
        });
        return {
          ok: true, siteId: site.id, number: submissionNumber(site.id),
          action: input.action, status: nextStatus,
        };
      };
      try {
        return await withIdempotency(input.idempotencyKey, compute);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };
}

export type Handlers = ReturnType<typeof createHandlers>;
