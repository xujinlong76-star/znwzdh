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
import type { AppContext } from "@navhub/api";
import {
  BatchImportInput,
  CreateSiteInput,
  GetSiteInput,
  HealthCheckInput,
  ListCategoriesInput,
  MAX_BATCH_ITEMS,
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

const SQL_BROKEN = [
  "UPDATE sites SET health_ok = 0, health_error = ?, last_checked_at = ?, status = 'broken' WHERE id = ?",
].join("");

export function createHandlers(ctx: AppContext) {
  /**
   * 幂等键处理：命中则直接返回上次结果。
   * 这是防止 Agent 重试导致重复入库的关键 —— Agent 重试是常态，不是异常。
   */
  async function withIdempotency(key: string | undefined, compute: () => Promise<unknown>): Promise<ToolResult> {
    if (!key) return ok(await compute());
    const db = ctx.db;
    if (db.dialect === "sqlite") {
      const existing = db.sqlite!.prepare("SELECT response FROM idempotency WHERE key = ?").get(key) as { response: string } | undefined;
      if (existing?.response) return ok({ replayed: true, result: JSON.parse(existing.response) });
    }
    const result = await compute();
    if (db.dialect === "sqlite") {
      db.sqlite!.prepare("INSERT OR REPLACE INTO idempotency (key, response, created_at) VALUES (?,?,?)")
        .run(key, JSON.stringify(result), Date.now());
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
      if (ctx.db.dialect !== "sqlite") {
        return fail("health_check 目前仅在 lite(SQLite) 模式下可用");
      }

      const results: Array<{ url: string; ok: boolean; status: number | null; latencyMs: number; error?: string }> = [];
      for (const site of target) {
        const t0 = Date.now();
        try {
          const res = await guardedFetch(site.url, { ...ctx.config.fetch });
          const latency = Date.now() - t0;
          const ok = res.status >= 200 && res.status < 400;
          results.push({ url: site.url, ok, status: res.status, latencyMs: latency });
          ctx.db.sqlite!.prepare(
            "UPDATE sites SET http_status = ?, health_ok = ?, latency_ms = ?, redirect_to = ?, health_error = NULL, last_checked_at = ?, status = ? WHERE id = ?",
          ).run(res.status, ok ? 1 : 0, latency, res.redirects.at(-1) ?? null, Date.now(), ok ? site.status : "broken", site.id);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          results.push({ url: site.url, ok: false, status: null, latencyMs: Date.now() - t0, error: message });
          ctx.db.sqlite!.prepare(SQL_BROKEN).run(message, Date.now(), site.id);
        }
      }

      const broken = results.filter((r) => !r.ok);
      await ctx.repo.audit({ actor: tc.actor, actorKind: "mcp", action: "site.healthCheck", diff: { checked: results.length, broken: broken.length } });
      return ok({ checked: results.length, healthy: results.length - broken.length, broken, results });
    },
  };
}

export type Handlers = ReturnType<typeof createHandlers>;
