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
import {
  findMatchingArchitectureRecipe,
  parseTechComparisonQuery,
  PRESET_RECIPES,
  runAutonomousHealing,
  findShortestTechPath,
  analyzeStackCompatibility,
  PRESET_TECH_GRAPH,
  autoClusterSites,
  auditPageHealth,
  mergeOperationLogs,
  compactOperationLogs,
  reduceOperationsToState,
  parseSpeculativeIntent,
  analyzeColorPalette,
  rankItemsWithPrivacy,
  privatizeVector,
  compileSpeculationRules,
  renderSpeculationRulesScript,
  generateFallbackLinkTags,
  synthesizeRestTool,
  synthesizeSiteSearchTool,
  parseOpenApiToSpecs,
  P2PMeshNode,
  clampToBall,
  poincareToLorentz,
  lorentzDistance,
  computeHyperbolicAlternativeScore,
  normalizeTargetUrl,
  buildWaybackSnapshotUrl,
  buildWaybackSaveUrl,
  parseWaybackAvailabilityResponse,
  type WaybackSnapshotInfo,
  type P2PMessage,
  type MinimalOpenApiSpec,
  type CRDTOperation,
} from "@navhub/core";
import type { AppContext } from "@navhub/api";
import {
  AnalyzeColorHarmonyInput,
  AnalyzeStackCompatibilityInput,
  BatchImportInput,
  ClusterSitesInput,
  CompareTechnologiesInput,
  CompileSpeculationRulesInput,
  CreateSiteInput,
  DeleteSiteInput,
  ExchangeP2pMeshInput,
  ExportSitesInput,
  FindTechPathInput,
  GetAlternativesInput,
  GetArchitectureRecipeInput,
  GetFederatedRecommendationsInput,
  GetSiteInput,
  GetTrendingInput,
  HealBrokenSiteInput,
  HealthCheckInput,
  ListCategoriesInput,
  ListTagsInput,
  MAX_BATCH_ITEMS,
  RefreshSiteInput,
  ResolveWaybackInput,
  RunJobInput,
  SearchSitesInput,
  SetStatusInput,
  SyncCrdtOperationsInput,
  SynthesizeAgentToolInput,
  EvaluateDeveloperIntentInput,
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

    async get_architecture_recipe(args: unknown, tc: ToolContext): Promise<ToolResult> {
      requireScope(tc, "read");
      const input = GetArchitectureRecipeInput.parse(args ?? {});
      const matched = findMatchingArchitectureRecipe(input.query);
      if (!matched) {
        return ok({ matched: false, query: input.query, availableRecipes: PRESET_RECIPES.map((r) => ({ id: r.id, title: r.title, targetGoal: r.targetGoal })) });
      }
      return ok({ matched: true, recipe: matched });
    },

    async compare_technologies(args: unknown, tc: ToolContext): Promise<ToolResult> {
      requireScope(tc, "read");
      const input = CompareTechnologiesInput.parse(args ?? {});
      const matrix = parseTechComparisonQuery(input.query);
      if (!matrix) {
        return ok({ matched: false, query: input.query, note: "未找到预设对比矩阵，请尝试 'react vs vue', 'cursor vs vscode', 'pnpm vs bun', 'ollama vs vllm'" });
      }
      return ok({ matched: true, matrix });
    },

    async heal_broken_site(args: unknown, tc: ToolContext): Promise<ToolResult> {
      requireScope(tc, "write");
      const input = HealBrokenSiteInput.parse(args ?? {});
      const site = await ctx.repo.getSite(input.idOrUrl);
      if (!site) return fail("未找到站点：" + input.idOrUrl);

      const peers = await ctx.repo.listSites({ categoryId: site.categoryId, status: "active", limit: 20 });
      const report = runAutonomousHealing({
        siteId: site.id,
        url: site.url,
        title: site.title,
        categoryId: site.categoryId,
        tags: site.tags,
        availablePeers: peers,
      });

      await ctx.repo.audit({
        actor: tc.actor,
        actorKind: "mcp",
        action: "site.heal",
        target: site.id,
        diff: {
          recommendedAction: report.recommendedAction,
          waybackFallbackUrl: report.waybackFallbackUrl,
          suggestedCount: report.suggestedReplacements.length,
        },
      });

      return ok({ healed: true, report });
    },

    async find_tech_path(args: unknown, tc: ToolContext): Promise<ToolResult> {
      requireScope(tc, "read");
      const input = FindTechPathInput.parse(args ?? {});
      const pathResult = findShortestTechPath(input.from, input.to, PRESET_TECH_GRAPH);
      return ok({ success: true, ...pathResult });
    },

    async analyze_stack_compatibility(args: unknown, tc: ToolContext): Promise<ToolResult> {
      requireScope(tc, "read");
      const input = AnalyzeStackCompatibilityInput.parse(args ?? {});
      const report = analyzeStackCompatibility(input.techs, PRESET_TECH_GRAPH);
      return ok({ success: true, ...report });
    },

    async cluster_sites(args: unknown, tc: ToolContext): Promise<ToolResult> {
      requireScope(tc, "read");
      const input = ClusterSitesInput.parse(args ?? {});
      const list = await ctx.repo.listSites({
        categoryId: input.categoryId,
        limit: 100,
        status: "active",
      });
      const items = list.map((s) => ({
        id: s.id,
        title: s.title,
        url: s.url,
        tags: s.tags || [],
      }));
      const result = autoClusterSites(items, input.targetK);
      return ok({ success: true, ...result });
    },

    async sync_crdt_operations(args: unknown, tc: ToolContext): Promise<ToolResult> {
      requireScope(tc, "write");
      const input = SyncCrdtOperationsInput.parse(args ?? {});
      const crdtKey = "crdt:" + input.userId;
      const existing = await ctx.repo.getUserVault(crdtKey);
      let serverOps: CRDTOperation[] = [];
      if (existing?.payload) {
        try {
          const parsed = JSON.parse(existing.payload) as { operations?: CRDTOperation[] };
          if (Array.isArray(parsed.operations)) {
            serverOps = parsed.operations;
          }
        } catch { /* 容错 */ }
      }

      const merged = mergeOperationLogs(serverOps, input.operations as CRDTOperation[]);
      const finalOps = merged.length > 100 ? compactOperationLogs(merged) : merged;
      const reduced = reduceOperationsToState(finalOps);

      await ctx.repo.saveUserVault(crdtKey, JSON.stringify({
        version: 1,
        operations: finalOps,
        state: reduced,
        updatedAt: Date.now(),
      }));

      await ctx.repo.audit({
        actor: tc.actor,
        actorKind: "mcp",
        action: "crdt.sync",
        target: input.userId,
        diff: { clientOps: input.operations.length, totalOps: finalOps.length },
      });

      return ok({
        merged: true,
        clientCount: input.operations.length,
        totalCount: finalOps.length,
        state: reduced,
      });
    },

    async evaluate_developer_intent(args: unknown, tc: ToolContext): Promise<ToolResult> {
      requireScope(tc, "read");
      const input = EvaluateDeveloperIntentInput.parse(args ?? {});
      const result = parseSpeculativeIntent(input.input);
      if (!result) {
        return ok({
          matched: false,
          query: input.input,
          message: "未匹配到特定开发者意图语法模式（可尝试输入 JWT、Cron、Curl、颜色、时间戳或 Base64）",
        });
      }
      return ok({ matched: true, ...result });
    },

    async analyze_color_harmony(args: unknown, tc: ToolContext): Promise<ToolResult> {
      requireScope(tc, "read");
      const input = AnalyzeColorHarmonyInput.parse(args ?? {});
      const report = analyzeColorPalette(input.palette, input.foreground, input.background);
      return ok({ success: true, ...report });
    },

    async get_federated_recommendations(args: unknown, tc: ToolContext): Promise<ToolResult> {
      requireScope(tc, "read");
      const input = GetFederatedRecommendationsInput.parse(args ?? {});
      const globalVec = input.globalVector ?? input.localVector.map(() => 0);
      const results = rankItemsWithPrivacy(
        input.localVector,
        globalVec,
        input.candidates,
        input.personalWeight
      );
      const privatized = input.privatize ? privatizeVector(input.localVector, input.epsilon) : undefined;
      return ok({
        count: results.length,
        recommendations: results,
        privacy: input.privatize ? { epsilon: input.epsilon, privatizedVector: privatized } : undefined,
      });
    },

    async compile_speculation_rules(args: unknown, tc: ToolContext): Promise<ToolResult> {
      requireScope(tc, "read");
      const input = CompileSpeculationRulesInput.parse(args ?? {});
      const payload = compileSpeculationRules(input.candidates, {
        prerenderConfidenceThreshold: input.prerenderConfidenceThreshold,
        prefetchConfidenceThreshold: input.prefetchConfidenceThreshold,
        maxPrerenderCount: input.maxPrerenderCount,
        maxPrefetchCount: input.maxPrefetchCount,
      });
      if (!payload) {
        return ok({
          hasRules: false,
          rules: null,
          script: "",
          fallbackTags: [],
          message: "无符合阈值或安全过滤条件的推测预加载规则",
        });
      }
      return ok({
        hasRules: true,
        rules: payload,
        script: renderSpeculationRulesScript(payload),
        fallbackTags: generateFallbackLinkTags(payload),
      });
    },

    async synthesize_agent_tool(args: unknown, tc: ToolContext): Promise<ToolResult> {
      requireScope(tc, "read");
      const input = SynthesizeAgentToolInput.parse(args ?? {});

      if (input.kind === "site_search" && input.siteSearchSpec) {
        const synthesized = synthesizeSiteSearchTool(input.siteSearchSpec);
        return ok({
          kind: "site_search",
          tool: synthesized.definition,
          exampleInvocation: synthesized.handler({ query: "example" }),
        });
      }

      if (input.kind === "openapi" && input.openApiSpec) {
        const specs = parseOpenApiToSpecs(input.openApiSpec as MinimalOpenApiSpec);
        const tools = specs.map((s) => synthesizeRestTool(s).definition);
        return ok({
          kind: "openapi",
          count: tools.length,
          tools,
        });
      }

      if (input.restSpec) {
        const synthesized = synthesizeRestTool(input.restSpec);
        return ok({
          kind: "rest",
          tool: synthesized.definition,
        });
      }

      return ok({
        kind: "unknown",
        message: "缺少 restSpec、siteSearchSpec 或 openApiSpec 有效配置",
      });
    },

    async exchange_p2p_mesh(args: unknown, tc: ToolContext): Promise<ToolResult> {
      requireScope(tc, "read");
      const input = ExchangeP2pMeshInput.parse(args ?? {});
      const node = new P2PMeshNode(input.nodeId);
      const outgoing = node.handleIncomingMessage(input.message as P2PMessage<any>);
      return ok({
        nodeId: input.nodeId,
        receivedType: input.message.type,
        peerState: node.getPeer(input.message.senderId)?.state ?? "READY",
        outgoingResponse: outgoing,
        vectorClock: node.store.getVectorClock(),
      });
    },

    async get_alternatives(args: unknown, tc: ToolContext): Promise<ToolResult> {
      requireScope(tc, "read");
      const input = GetAlternativesInput.parse(args ?? {});
      const targetSite = await ctx.repo.getSite(input.idOrUrl);
      if (!targetSite) return fail("未找到目标站点：" + input.idOrUrl);
      const limit = Math.min(input.limit || 6, 20);

      try {
        if (ctx.embedding && ctx.vectors) {
          const vec = await ctx.repo.getEmbedding(targetSite.id);
          if (vec) {
            const matches = await ctx.vectors.search(vec, Math.max(limit * 3, 24));
            const targetBall = clampToBall(Array.from(vec.slice(0, 16)).map((v) => v * 0.6));
            const targetLorentz = poincareToLorentz(targetBall);

            const scored = [];
            for (const m of matches) {
              if (m.siteId === targetSite.id) continue;
              const candSite = await ctx.repo.getSite(m.siteId);
              if (!candSite || candSite.status === "broken") continue;
              const candVec = await ctx.repo.getEmbedding(m.siteId);
              const candBall = candVec
                ? clampToBall(Array.from(candVec.slice(0, 16)).map((v) => v * 0.6))
                : targetBall.map((v, idx) => v * (idx % 2 === 0 ? 0.85 : 0.9));
              const candLorentz = poincareToLorentz(candBall);
              const lDist = lorentzDistance(targetLorentz, candLorentz);
              const altScore = computeHyperbolicAlternativeScore(targetBall, candBall);
              scored.push({
                site: { id: candSite.id, title: candSite.title, url: candSite.url, description: candSite.description },
                geodesicDistance: Number(lDist.toFixed(4)),
                alternativeScore: altScore,
                sameCategory: candSite.categoryId === targetSite.categoryId,
              });
            }
            scored.sort((a, b) => b.alternativeScore - a.alternativeScore);
            return ok({
              target: { id: targetSite.id, title: targetSite.title, url: targetSite.url },
              manifold: "lorentz-hyperboloid",
              alternatives: scored.slice(0, limit),
            });
          }
        }
      } catch {
        // 向量不可用平滑降级
      }

      // 启发式双曲特征投影兜底
      const allSites = await ctx.repo.listSites({ limit: 200 });
      const targetTags = new Set(targetSite.tags ?? []);
      const fallbackHits = allSites
        .filter((s) => s.id !== targetSite.id && s.status !== "broken")
        .map((cand) => {
          const candTags = new Set(cand.tags ?? []);
          let overlap = 0;
          for (const t of targetTags) if (candTags.has(t)) overlap++;
          const union = new Set([...targetTags, ...candTags]).size || 1;
          const jaccard = overlap / union;
          const catMatch = cand.categoryId === targetSite.categoryId ? 1 : 0;

          const uBall = [0.45, 0.35, 0.25];
          const vBall = [
            0.45 + (1 - catMatch) * 0.25,
            0.35 + (1 - jaccard) * 0.3,
            0.25,
          ];
          const lDist = lorentzDistance(poincareToLorentz(uBall), poincareToLorentz(vBall));
          const altScore = computeHyperbolicAlternativeScore(uBall, vBall);
          return {
            site: { id: cand.id, title: cand.title, url: cand.url, description: cand.description },
            geodesicDistance: Number(lDist.toFixed(4)),
            alternativeScore: Number((altScore + catMatch * 0.15 + jaccard * 0.2).toFixed(4)),
            sameCategory: Boolean(catMatch),
          };
        })
        .sort((a, b) => b.alternativeScore - a.alternativeScore)
        .slice(0, limit);

      return ok({
        target: { id: targetSite.id, title: targetSite.title, url: targetSite.url },
        manifold: "poincare-heuristic",
        alternatives: fallbackHits,
      });
    },

    async resolve_wayback(args: unknown, tc: ToolContext): Promise<ToolResult> {
      requireScope(tc, "read");
      const input = ResolveWaybackInput.parse(args ?? {});
      let targetUrl = input.url.trim();
      const existing = await ctx.repo.getSite(targetUrl);
      if (existing) {
        targetUrl = existing.url;
      }
      const cleanUrl = normalizeTargetUrl(targetUrl);
      if (!cleanUrl) return fail("无效的网址：" + input.url);

      let snapshot: WaybackSnapshotInfo = { available: false };
      try {
        const queryUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(cleanUrl)}${input.timestamp ? `&timestamp=${encodeURIComponent(input.timestamp)}` : ""}`;
        const res = await guardedFetch(queryUrl, { timeoutMs: 3000 });
        if (res.status === 200) {
          const data = JSON.parse(res.body);
          snapshot = parseWaybackAvailabilityResponse(data);
        }
      } catch {
        // 网络超时或脱机环境，平滑降级
      }

      const effectiveTimestamp = snapshot.timestamp || input.timestamp;
      return ok({
        targetUrl: cleanUrl,
        available: snapshot.available,
        snapshotUrl: snapshot.url ?? buildWaybackSnapshotUrl(cleanUrl, effectiveTimestamp),
        timestamp: snapshot.timestamp,
        recoveryUrl: buildWaybackSnapshotUrl(cleanUrl, effectiveTimestamp),
        saveUrl: buildWaybackSaveUrl(cleanUrl),
      });
    },
  };
}

export type Handlers = ReturnType<typeof createHandlers>;
