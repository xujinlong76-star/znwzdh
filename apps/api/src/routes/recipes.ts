/**
 * 架构配方 / 竞品对比 / 确定性 Favicon / 自洽愈合
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  analyzeStackCompatibility,
  autoClusterSites,
  computeGraphCentrality,
  findMatchingArchitectureRecipe,
  findShortestTechPath,
  generateDeterministicSvg,
  parseTechComparisonQuery,
  PRESET_RECIPES,
  PRESET_TECH_GRAPH,
  runAutonomousHealing,
  type ArchitectureRecipe,
  type TechComparisonMatrix,
} from "@navhub/core";

import { buildWaybackSaveUrl, buildWaybackSnapshotUrl, normalizeTargetUrl, parseWaybackAvailabilityResponse, type WaybackSnapshotInfo } from "@navhub/core";
import { guardedFetch } from "@navhub/ai";
import { indexSite } from "../index-site.ts";
import { resolveLlm } from "../llm-config.ts";
import { callLlm } from "../llm-usage.ts";
import type { AppContext } from "../context.ts";

export const recipeRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /**
   * 动态场景配方与对比矩阵内存缓存（避免高频搜索重复请求 LLM）
   */
  const dynamicRecipeCache = new Map<string, ArchitectureRecipe>();
  const dynamicComparisonCache = new Map<string, TechComparisonMatrix>();
  const dynamicScaffoldCache = new Map<string, any>();
  const actionIntentCache = new Map<string, any>();

  /* ----------------- 架构配方 & 竞品对比 & 确定性 Favicon ----------------- */

  /**
   * Graph-RAG 多跳技术栈链路配方查询 + Agnes 3.0 Flash 动态场景配方合成
   * 解决痛点：用户搜索任意业务/开发/创作场景（如“跨境电商出海”、“短视频创作”、“独立开发变现”）时，
   * 不再受限于 3 条静态预设，而是自动结合站内真实馆藏合成端到端分阶段工具链配方。
   */
  app.get("/api/recipes", { config: { scope: "public", cache: { maxAge: 300, etag: true } } }, async (req) => {
    const queryObj = (req.query ?? {}) as Record<string, string>;
    const q = String(queryObj.q ?? "").trim();
    if (!q) {
      return { items: PRESET_RECIPES };
    }
    const matched = findMatchingArchitectureRecipe(q);
    if (matched) {
      return { item: matched, items: [matched] };
    }

    const normKey = q.toLowerCase();
    const cached = dynamicRecipeCache.get(normKey);
    if (cached) {
      return { item: cached, items: [cached], aiGenerated: true, cached: true };
    }

    // 当查询长度 >= 2 且配置了有效 AI 密钥时，结合馆藏检索动态合成场景工作流配方
    const llm = await resolveLlm(ctx);
    if (q.length < 2 || !llm.provider.apiKey) {
      return { item: null, items: [] };
    }

    try {
      const searchRes = await ctx.search.search({ q, limit: 15, statuses: ["active"] });
      const hitIds = [...new Set((searchRes.hits ?? []).map((h) => h.siteId))];
      const byId = hitIds.length > 0 ? await ctx.repo.getSitesByIds(hitIds) : new Map();
      const matchedSites = hitIds.map((id) => byId.get(id)).filter((s) => Boolean(s));
      const candidates =
        matchedSites.length > 0
          ? matchedSites.map((s) => ({
              id: s!.id,
              title: s!.title,
              url: s!.url,
              description: s!.description || "",
            }))
          : (await ctx.repo.listSites({ status: "active", limit: 15 })).map((s) => ({
              id: s.id,
              title: s.title,
              url: s.url,
              description: s.description || "",
            }));

      const candidateContext = candidates
        .slice(0, 8)
        .map((c) => `- [id:${c.id}] ${c.title} (${c.url}): ${c.description.slice(0, 45)}`)
        .join("\n");

      const prompt = `你是全球顶尖的场景化工具链架构师。用户搜索场景需求：「${q}」。
请结合以下站内工具，定制一套包含 3 个阶段的精炼「场景工作流配方 (ArchitectureRecipe)」。

【站内候选工具】
${candidateContext || "（可结合全球知名免费/主流工具推荐）"}

请严格返回以下 JSON 格式（包含 3 个阶段 layers，文字精炼）：
{
  "id": "ai-recipe-slug",
  "title": "「${q}」全流程实战工具链配方",
  "targetGoal": "一句话说明核心目标（25字内）",
  "description": "简述分阶段协同思路（35字内）",
  "keywords": ["关键词1", "关键词2"],
  "layers": [
    {
      "layerName": "1. 阶段名",
      "category": "阶段分类",
      "recommended": {
        "id": "工具ID",
        "title": "首选工具",
        "url": "https://真实网址",
        "description": "首选理由（25字内）",
        "highlights": ["亮点1", "亮点2"]
      },
      "alternatives": [
        { "id": "alt-1", "title": "平替工具", "url": "https://真实网址" }
      ]
    }
  ],
  "quickStartSnippet": "一步启动建议（30字内）"
}`;

      const res = await callLlm(ctx, llm, {
        scenario: "dynamic_recipe",
        messages: [{ role: "user", content: prompt }],
        json: true,
        thinking: false,
        temperature: 0.2,
        maxTokens: 2048,
      });

      let parsed: ArchitectureRecipe | null = null;
      try {
        const raw = (res.content || "").replace(/```json/gi, "").replace(/```/g, "").trim();
        parsed = JSON.parse(raw) as ArchitectureRecipe;
      } catch {
        const m = (res.content || "").match(/\{[\s\S]*\}/);
        if (m) {
          try { parsed = JSON.parse(m[0]) as ArchitectureRecipe; } catch {}
        }
      }

      if (parsed && parsed.title && Array.isArray(parsed.layers) && parsed.layers.length > 0) {
        parsed.id = parsed.id || `ai-recipe-${Date.now()}`;
        parsed.keywords = Array.isArray(parsed.keywords) ? parsed.keywords : [q];
        if (dynamicRecipeCache.size >= 100) {
          const oldest = dynamicRecipeCache.keys().next().value;
          if (oldest) dynamicRecipeCache.delete(oldest);
        }
        dynamicRecipeCache.set(normKey, parsed);
        return { item: parsed, items: [parsed], aiGenerated: true };
      }
    } catch (err) {
      req.log.warn({ err: String(err), q }, "动态 AI 场景配方合成降级");
    }

    return { item: null, items: [] };
  });

  /**
   * 端侧竞品并排对比矩阵合成 + Agnes 3.0 Flash 动态任意工具 PK 矩阵
   * 解决痛点：用户输入任意两个工具对比（如 "ChatGPT vs Claude", "Notion vs Obsidian", "DeepSeek vs Kimi"）时，
   * 不再受限于 6 条预设，实时生成结构化优劣势、开源/收费协议与多维胜负裁决。
   */
  app.get("/api/comparisons", { config: { scope: "public", cache: { maxAge: 300, etag: true } } }, async (req) => {
    const q = String((req.query as Record<string, string>)?.q ?? "").trim();
    if (!q) {
      return { ok: false, matrix: null };
    }
    const matrix = parseTechComparisonQuery(q);
    if (matrix) {
      return { ok: true, matrix };
    }

    // 识别任意 "A vs B" / "A 对比 B" / "A pk B" / "A 和 B 哪个好" 语法
    const vsMatch = q.match(/^(.+?)\s*(?:\bvs\.?\b|\bVS\.?\b|\bpk\b|\bPK\b|对比|对决|与|和)\s*(.+?)(?:对比|哪个好|区别|选型|怎么选)?$/i);
    if (!vsMatch) {
      return { ok: false, matrix: null };
    }

    const rawA = vsMatch[1]!.trim();
    const rawB = vsMatch[2]!.trim();
    if (!rawA || !rawB || rawA.toLowerCase() === rawB.toLowerCase()) {
      return { ok: false, matrix: null };
    }

    const cacheKey = [rawA.toLowerCase(), rawB.toLowerCase()].sort().join("__vs__");
    const cached = dynamicComparisonCache.get(cacheKey);
    if (cached) {
      return { ok: true, matrix: cached, aiGenerated: true, cached: true };
    }

    const llm = await resolveLlm(ctx);
    if (!llm.provider.apiKey) {
      return { ok: false, matrix: null };
    }

    try {
      const [resA, resB] = await Promise.all([
        ctx.search.search({ q: rawA, limit: 2, statuses: ["active"] }),
        ctx.search.search({ q: rawB, limit: 2, statuses: ["active"] }),
      ]);
      const idA = resA.hits?.[0]?.siteId;
      const idB = resB.hits?.[0]?.siteId;
      const [hitA, hitB] = await Promise.all([
        idA ? ctx.repo.getSite(idA) : Promise.resolve(null),
        idB ? ctx.repo.getSite(idB) : Promise.resolve(null),
      ]);
      const infoA = hitA
        ? `${hitA.title} (${hitA.url}): ${hitA.description || ""}`
        : rawA;
      const infoB = hitB
        ? `${hitB.title} (${hitB.url}): ${hitB.description || ""}`
        : rawB;

      const prompt = `你是工具选型评测专家。请针对「${rawA}」与「${rawB}」进行精炼并排对比：
- A参考: ${infoA}
- B参考: ${infoB}

请严格返回以下 JSON 结构（文字简明扼要）：
{
  "id": "ai-cmp-slug",
  "title": "${rawA} vs ${rawB} 深度选型对比",
  "itemA": {
    "name": "${rawA}",
    "category": "所属品类",
    "license": "免费/订阅模式",
    "primaryPros": ["优势1", "优势2"],
    "tradeoffs": ["局限1"],
    "bestFor": "最适合人群与场景（25字内）"
  },
  "itemB": {
    "name": "${rawB}",
    "category": "所属品类",
    "license": "免费/订阅模式",
    "primaryPros": ["优势1", "优势2"],
    "tradeoffs": ["局限1"],
    "bestFor": "最适合人群与场景（25字内）"
  },
  "dimensions": [
    { "dimName": "核心能力", "valueA": "A表现（15字内）", "valueB": "B表现（15字内）", "winner": "A" },
    { "dimName": "免费与性价比", "valueA": "A定价（15字内）", "valueB": "B定价（15字内）", "winner": "B" },
    { "dimName": "上手与生态", "valueA": "A体验（15字内）", "valueB": "B体验（15字内）", "winner": "TIE" }
  ],
  "verdict": "终极选型建议：何时选 ${rawA}，何时选 ${rawB}（45字内）"
}`;

      const res = await callLlm(ctx, llm, {
        scenario: "dynamic_comparison",
        messages: [{ role: "user", content: prompt }],
        json: true,
        thinking: false,
        temperature: 0.2,
        maxTokens: 2048,
      });

      let parsed: TechComparisonMatrix | null = null;
      try {
        const raw = (res.content || "").replace(/```json/gi, "").replace(/```/g, "").trim();
        parsed = JSON.parse(raw) as TechComparisonMatrix;
      } catch {
        const m = (res.content || "").match(/\{[\s\S]*\}/);
        if (m) {
          try { parsed = JSON.parse(m[0]) as TechComparisonMatrix; } catch {}
        }
      }

      if (parsed && parsed.itemA && parsed.itemB && Array.isArray(parsed.dimensions)) {
        parsed.id = parsed.id || cacheKey;
        if (dynamicComparisonCache.size >= 100) {
          const oldest = dynamicComparisonCache.keys().next().value;
          if (oldest) dynamicComparisonCache.delete(oldest);
        }
        dynamicComparisonCache.set(cacheKey, parsed);
        return { ok: true, matrix: parsed, aiGenerated: true };
      }
    } catch (err) {
      req.log.warn({ err: String(err), q }, "动态 AI 竞品对比合成降级");
    }

    return { ok: false, matrix: null };
  });

  /**
   * 结构化技术知识图谱：双向最短演进链路寻路 (Dijkstra)
   */
  app.get("/api/graph/path", { config: { scope: "public", cache: { maxAge: 60 } } }, async (req, reply) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const from = String(q.from ?? q.start ?? "").trim();
    const to = String(q.to ?? q.target ?? "").trim();
    if (!from || !to) {
      reply.code(400);
      return { ok: false, error: "需要指定 from (或 start) 与 to (或 target) 查询参数" };
    }
    const pathResult = findShortestTechPath(from, to, PRESET_TECH_GRAPH);
    return { ok: true, result: pathResult, path: pathResult };
  });

  /**
   * 结构化技术知识图谱：技术栈兼容性诊断与补齐建议
   */
  app.get("/api/graph/compatibility", { config: { scope: "public", cache: { maxAge: 60 } } }, async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const rawTechs = String(q.techs ?? "").trim();
    const techList = rawTechs ? rawTechs.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const report = analyzeStackCompatibility(techList, PRESET_TECH_GRAPH);
    return { ok: true, report };
  });

  /**
   * 结构化技术知识图谱：Kleinberg HITS 权威度与枢纽度分析
   */
  app.get("/api/graph/centrality", { config: { scope: "public", cache: { maxAge: 300 } } }, async () => {
    const centrality = computeGraphCentrality(PRESET_TECH_GRAPH);
    return { ok: true, ...centrality };
  });


  /**
   * 确定性 SVG Favicon 代理端点（解决小众/外网站点 Favicon 裂开或 CORS 阻断）
   *
   * 字母标是从**站点标题**推出来的，而 `max-age=86400` 让浏览器一整天不回源：
   * 改名之后列表已经换新标题，图标却还是旧首字母，用户只能硬刷新。
   * 压到 300 秒：页面内重复请求照样命中本地缓存，过期后用 ETag 走 304，
   * 改名最多 5 分钟就跟上（这条路由每次请求都要读库 + 生成 SVG，再验证并不贵）。
   */
  app.get("/api/favicon/:id", { config: { scope: "public", cache: { maxAge: 300, etag: true } } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const site = await ctx.repo.getSite(id);
    const title = site ? site.title : id;
    const url = site ? site.url : undefined;
    const svg = generateDeterministicSvg(title, url);
    reply.type("image/svg+xml; charset=utf-8");
    return svg;
  });

  /**
   * AI 自动自愈端点：对故障/失效站点诊断、提取 Wayback 快照并在同生态推荐最佳替代品
   */
  app.post("/api/sites/:id/heal", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const site = await ctx.repo.getSite(id);
    if (!site) { reply.code(404); return { error: "站点不存在" }; }

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
      ip: req.ip,
      actor: req.auth.actor,
      actorKind: req.auth.kind,
      action: "site.heal", 
      target: site.id,
      diff: {
        diagnosis: report.diagnosis,
        recommendedAction: report.recommendedAction,
        topReplacement: report.suggestedReplacements[0]?.url,
      },
    });

    return { ok: true, report };
  });

  /**
   * Wayback 时间机器自愈端点：查询指定站点的历史镜像快照与瞬时访问入口
   */
  app.get("/api/sites/:id/wayback", { config: { scope: "public", cache: { maxAge: 300 } } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const site = await ctx.repo.getSite(id);
    if (!site) {
      reply.code(404);
      return { ok: false, error: "站点不存在" };
    }
    const cleanUrl = normalizeTargetUrl(site.url);
    let snapshot: WaybackSnapshotInfo = { available: false };
    try {
      const apiUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(cleanUrl)}`;
      const res = await guardedFetch(apiUrl, { timeoutMs: 3000 });
      if (res.status === 200) {
        const data = JSON.parse(res.body);
        snapshot = parseWaybackAvailabilityResponse(data);
      }
    } catch {
      // 网络离线或超时降级
    }

    return {
      ok: true,
      siteId: site.id,
      url: cleanUrl,
      snapshot,
      recoveryUrl: buildWaybackSnapshotUrl(cleanUrl, snapshot.timestamp),
      saveUrl: buildWaybackSaveUrl(cleanUrl),
    };
  });

  /**
   * Wayback 时间机器一键自愈端点：若站点失活/死链，尝试调取 Wayback Machine 历史快照并自愈
   */
  app.post("/api/sites/:id/wayback/heal", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const site = await ctx.repo.getSite(id);
    if (!site) {
      reply.code(404);
      return { ok: false, error: "站点不存在" };
    }
    const body = z.object({
      replaceUrl: z.boolean().default(true),
      markActive: z.boolean().default(true),
    }).safeParse(req.body ?? {});

    const cleanUrl = normalizeTargetUrl(site.url);
    let snapshot: WaybackSnapshotInfo = { available: false };
    try {
      const apiUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(cleanUrl)}`;
      const res = await guardedFetch(apiUrl, { timeoutMs: 3000 });
      if (res.status === 200) {
        const data = JSON.parse(res.body);
        snapshot = parseWaybackAvailabilityResponse(data);
      }
    } catch {
      // 降级
    }

    const recoveryUrl = buildWaybackSnapshotUrl(cleanUrl, snapshot.timestamp);
    const saveUrl = buildWaybackSaveUrl(cleanUrl);

    const replaceUrl = body.success ? body.data.replaceUrl : true;
    const markActive = body.success ? body.data.markActive : true;

    const updates: { url?: string; status?: "active" } = {};
    if (replaceUrl && recoveryUrl) {
      updates.url = recoveryUrl;
    }
    if (markActive) {
      updates.status = "active";
    }

    const updated = Object.keys(updates).length > 0 ? await ctx.repo.updateSite(site.id, updates) : site;
    if (updated) {
      await indexSite(ctx, updated.id, updated.title, updated.description ?? null, updated.url);
      await ctx.repo.audit({
        ip: req.ip,
        actor: req.auth.actor,
        actorKind: req.auth.kind,
        action: "site.wayback_heal",
        target: site.id,
        diff: { before: { url: site.url, status: site.status }, after: updates },
      });
    }

    return {
      ok: true,
      healed: Boolean(recoveryUrl),
      site: updated ?? site,
      recoveryUrl,
      saveUrl,
      snapshot,
      message: recoveryUrl
        ? "已成功将死链地址无缝自愈替换为 Wayback Machine 历史快照镜像"
        : "未检索到远程历史快照，建议点击即时归档保存当前页面",
    };
  });

  /**
   * Next-Gen 5.0 语义聚类与自适应类目生成端点
   * 对未分类、批量导入或指定分类下的站点进行 K-Means++ 语义聚类与命名生成
   */
  app.post(
    "/api/sites/cluster",
    {
      config: {
        scope: "public",
        rateLimit: { max: process.env.NODE_ENV === "test" ? 10_000 : 30, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
    const body = z.object({
      siteIds: z.array(z.string()).max(100).optional(),
      categoryId: z.string().optional(),
      targetK: z.number().int().min(1).max(20).optional().default(4),
    }).safeParse(req.body ?? {});

    if (!body.success) {
      reply.code(400);
      return { error: "参数无效", detail: body.error.issues };
    }

    let sitesToCluster: Array<{ id: string; title: string; url: string; tags: string[] }> = [];

    if (body.data.siteIds && body.data.siteIds.length > 0) {
      const ids = [...new Set(body.data.siteIds.filter(Boolean))];
      const siteMap = await ctx.repo.getSitesByIds(ids);
      sitesToCluster = ids
        .map((id) => siteMap.get(id))
        .filter((s): s is NonNullable<typeof s> => Boolean(s))
        .map((s) => ({
          id: s.id,
          title: s.title,
          url: s.url,
          tags: s.tags || [],
        }));
    } else {
      const list = await ctx.repo.listSites({
        categoryId: body.data.categoryId,
        limit: 100,
        status: "active",
      });
      sitesToCluster = list.map((s) => ({
        id: s.id,
        title: s.title,
        url: s.url,
        tags: s.tags || [],
      }));
    }

    if (sitesToCluster.length === 0) {
      return { totalItems: 0, clusterCount: 0, clusters: [], averageCohesion: 100 };
    }

    const result = autoClusterSites(sitesToCluster, body.data.targetK);
    return { ok: true, result };
  });

  /**
   * 痛点解决：配方实战脚手架与保姆级实操清单生成 (Playbook & Scaffold Generator)
   * 解决痛点：用户获取架构配方后，仍需花费大量时间拼凑 .env、编写跨工具粘合代码与理清执行顺序的痛点。
   */
  app.post(
    "/api/recipes/scaffold",
    {
      config: {
        scope: "public",
        rateLimit: { max: process.env.NODE_ENV === "test" ? 10_000 : 20, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
      const body = z.object({
        recipeTitle: z.string().min(1).max(200),
        targetGoal: z.string().min(1).max(1000),
        layers: z.array(z.object({
          layerName: z.string(),
          category: z.string().optional(),
          recommended: z.object({
            title: z.string(),
            url: z.string().optional(),
            description: z.string().optional(),
          }),
          alternatives: z.array(z.object({
            title: z.string(),
            url: z.string().optional(),
          })).optional(),
        })).min(1).max(8),
      }).safeParse(req.body ?? {});

      if (!body.success) {
        reply.code(400);
        return { error: "参数无效", detail: body.error.issues };
      }

      const { recipeTitle, targetGoal, layers } = body.data;
      // key 必须覆盖整段提示词的输入：旧 key 只含配方标题与工具名，
      // 同一个标题换个目标场景（或工具描述被改）就会命中别人那一份脚手架，
      // 而且返回的是与本次提问无关的 envTemplate/SOP——这是答非所问，不是「缓存加速」。
      const cacheKey = `scaffold:${createHash("sha256")
        .update(JSON.stringify([recipeTitle, targetGoal, layers]))
        .digest("hex")
        .slice(0, 32)}`;
      const cached = dynamicScaffoldCache.get(cacheKey);
      if (cached) {
        return { ok: true, cached: true, ...cached };
      }

      const llm = await resolveLlm(ctx);
      if (!llm.provider.apiKey) {
        reply.code(503);
        return { ok: false, error: "AI 服务尚未就绪" };
      }

      const toolSummary = layers
        .map(
          (l, i) =>
            `${i + 1}. [${l.layerName}] 工具名: ${l.recommended.title} (说明: ${l.recommended.description || "无"}, 官网: ${l.recommended.url || "无"})`
        )
        .join("\n");

      const prompt = `你是精通现代前后端架构与生产力工具整合的资深全栈系统架构师。
针对以下业务落地配方，生成开箱即用的工程实战脚手架、环境变量整合清单与保姆级执行SOP：

【配方标题】: ${recipeTitle}
【目标场景】: ${targetGoal}
【工具链条】:
${toolSummary}

请严格按以下 JSON 结构输出（严禁输出任何客套寒暄）：
{
  "recipeType": "coding_tech" 或 "creator_business",
  "envTemplate": "# 跨工具整合所需环境变量\\n# 注释必须说明从哪个工具后台哪个具体菜单复制获取\\nNEXT_PUBLIC_EXAMPLE_KEY=xxx",
  "glueCodeSnippet": {
    "filename": "例如 lib/integration.ts 或 scripts/bootstrap.sh",
    "language": "typescript" 或 "bash" 或 "python",
    "content": "核心跨工具粘合代码（20-30行左右，真实可用，含关键错误处理）",
    "explanation": "一句话说明此粘合代码实现了哪两个工具之间的数据流连通"
  },
  "cliQuickStart": "极简一键依赖安装或初始化命令（如 pnpm add @supabase/supabase-js stripe resend）",
  "sopChecklist": [
    {
      "step": 1,
      "title": "阶段简短标题",
      "toolName": "工具名称",
      "action": "精准实操动作（不超过30字）",
      "pitfallWarning": "该步骤最容易踩的暗坑与避坑指引（不超过35字）"
    }
  ]
}`;

      try {
        const res = await callLlm(ctx, llm, {
          scenario: "recipe_scaffold",
          messages: [{ role: "user", content: prompt }],
          json: true,
          thinking: false,
          temperature: 0.2,
          maxTokens: 2048,
        });

        let parsed: any = null;
        try {
          const raw = (res.content || "").replace(/```json/gi, "").replace(/```/g, "").trim();
          parsed = JSON.parse(raw);
        } catch {
          const m = (res.content || "").match(/\{[\s\S]*\}/);
          if (m) {
            try { parsed = JSON.parse(m[0]); } catch {}
          }
        }

        if (!parsed || typeof parsed !== "object") {
          reply.code(502);
          return { ok: false, error: "AI 输出格式异常" };
        }

        const result = {
          recipeType: parsed.recipeType || "coding_tech",
          envTemplate: parsed.envTemplate || "",
          glueCodeSnippet: parsed.glueCodeSnippet || null,
          cliQuickStart: parsed.cliQuickStart || "",
          sopChecklist: Array.isArray(parsed.sopChecklist) ? parsed.sopChecklist : [],
          model: res.model,
        };

        if (dynamicScaffoldCache.size >= 100) {
          const oldest = dynamicScaffoldCache.keys().next().value;
          if (oldest) dynamicScaffoldCache.delete(oldest);
        }
        dynamicScaffoldCache.set(cacheKey, result);
        return { ok: true, cached: false, ...result };
      } catch (err: any) {
        reply.code(500);
        return { ok: false, error: "生成实战脚手架失败: " + (err?.message || String(err)) };
      }
    }
  );

  /**
   * 痛点解决：全局自然语言意图动作派调度器 (Intent Action Dispatcher)
   * 解决痛点：用户输入自然语言长句或实操提问时（“怎么把录音转文字并区分说话人”），
   * 传统关键词分词检索 0 结果，而 AI 能直接给出：最佳单一工具直达 + 3步极简法 + 避坑指南。
   */
  app.get(
    "/api/intent/action",
    {
      config: {
        scope: "public",
        rateLimit: { max: process.env.NODE_ENV === "test" ? 10_000 : 30, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
      const queryObj = (req.query ?? {}) as Record<string, string>;
      const q = String(queryObj.q ?? "").trim();
      if (!q || q.length < 3) {
        return { ok: false, isActionable: false, reason: "查询词过短" };
      }

      // 召回站内候选站点
      const searchRes = await ctx.search.search({
        q,
        limit: 8,
        statuses: ["active"],
      });
      const hitIds = [...new Set((searchRes.hits || []).map((h) => h.siteId))];
      if (hitIds.length === 0) {
        return { ok: false, isActionable: false, reason: "站内未检索到相关工具" };
      }

      const siteMap = await ctx.repo.getSitesByIds(hitIds);
      const candidateSites = hitIds
        .map((id) => siteMap.get(id))
        .filter((s): s is NonNullable<typeof s> => Boolean(s));

      if (candidateSites.length === 0) {
        return { ok: false, isActionable: false, reason: "候选站点无效" };
      }

      const candidateContext = candidateSites
        .map((s) => `- ${s.title} (${s.url}): ${(s.description || "").slice(0, 70)}`)
        .join("\n");

      const prompt = `你是全球顶级数字生产力调度与效率专家。针对用户的自然语言实操提问，从候选工具中选出最契合的 1 个王牌工具，并输出 3 步极简操作法。

【用户提问】: "${q}"

【站内候选工具】:
${candidateContext}

请严格按以下 JSON 结构返回：
{
  "isActionable": true,
  "actionSummary": "3步完成：[动作提炼，15字内]",
  "primaryTool": {
    "title": "必须精准对应候选工具中的某个标题",
    "whyBest": "入选核心理由（如：免登录每日赠送额度、支持声纹切分，30字内）"
  },
  "steps": [
    "1. 实操第一步（18字内）",
    "2. 实操第二步（18字内）",
    "3. 实操第三步（18字内）"
  ],
  "proTip": "关键防坑或提效小贴士（30字内）",
  "alternativeTool": {
    "title": "候选工具中的另一个工具标题（选填）",
    "reason": "备选理由（如：完全开源支持本地离线运行）"
  }
}`;

      // 命中判据取整段提示词：结论同时取决于用户提问与这次召回到的候选工具，
      // 只按 q 缓存会让站内新增/改名/下架工具之后继续供着针对旧候选集的推荐，
      // 而 primaryTool/alternativeTool 的标题必须能在当前候选里落地，否则点进去就是死链。
      const cacheKey = `intent:${createHash("sha256").update(prompt).digest("hex").slice(0, 32)}`;
      const cached = actionIntentCache.get(cacheKey);
      if (cached) {
        return { ok: true, cached: true, ...cached };
      }

      const llm = await resolveLlm(ctx);
      if (!llm.provider.apiKey) {
        reply.code(503);
        return { ok: false, error: "AI 服务尚未就绪" };
      }

      try {
        const res = await callLlm(ctx, llm, {
          scenario: "intent_action",
          messages: [{ role: "user", content: prompt }],
          json: true,
          thinking: false,
          temperature: 0.2,
          maxTokens: 1024,
        });

        let parsed: any = null;
        try {
          const raw = (res.content || "").replace(/```json/gi, "").replace(/```/g, "").trim();
          parsed = JSON.parse(raw);
        } catch {
          const m = (res.content || "").match(/\{[\s\S]*\}/);
          if (m) {
            try { parsed = JSON.parse(m[0]); } catch {}
          }
        }

        if (!parsed || !parsed.isActionable || !parsed.primaryTool?.title) {
          return { ok: false, isActionable: false };
        }

        // 校验 primaryTool 真实性并补全链接
        const primaryMatch =
          candidateSites.find(
            (s) =>
              s.title.toLowerCase().includes(parsed.primaryTool.title.toLowerCase()) ||
              parsed.primaryTool.title.toLowerCase().includes(s.title.toLowerCase())
          ) || candidateSites[0];

        // candidateSites 为空时 find 与 [0] 都是 undefined —— 直接读 .id/.title 会崩。
        // 这是「无候选站点」的合法降级路径（本站尚未收录任何站点），返回可解释的空结果。
        if (!primaryMatch) {
          return { ok: true, cached: false, isActionable: false, actionSummary: "本站尚未收录可执行工具，建议先收录相关站点", primaryTool: null, steps: [], proTip: "", alternativeTool: undefined, model: res.model };
        }

        let altMatch = undefined;
        if (parsed.alternativeTool?.title) {
          const found = candidateSites.find(
            (s) =>
              s.id !== primaryMatch.id &&
              (s.title.toLowerCase().includes(parsed.alternativeTool.title.toLowerCase()) ||
                parsed.alternativeTool.title.toLowerCase().includes(s.title.toLowerCase()))
          );
          if (found) {
            altMatch = {
              id: found.id,
              title: found.title,
              url: found.url,
              reason: parsed.alternativeTool.reason || "备选平替方案",
            };
          }
        }

        const result = {
          isActionable: true,
          actionSummary: parsed.actionSummary || `针对「${q}」的极速实操方案`,
          primaryTool: {
            id: primaryMatch.id,
            title: primaryMatch.title,
            url: primaryMatch.url,
            whyBest: parsed.primaryTool.whyBest || (primaryMatch.description || "").slice(0, 50),
          },
          steps:
            Array.isArray(parsed.steps) && parsed.steps.length > 0
              ? parsed.steps.slice(0, 3)
              : ["1. 进入工具主页", "2. 按需选择功能与配置", "3. 导出或应用成果"],
          proTip: parsed.proTip || "优先使用最新版本以获得最佳稳定性与免费额度。",
          alternativeTool: altMatch,
          model: res.model,
        };

        if (actionIntentCache.size >= 100) {
          const oldest = actionIntentCache.keys().next().value;
          if (oldest) actionIntentCache.delete(oldest);
        }
        actionIntentCache.set(cacheKey, result);
        return { ok: true, cached: false, ...result };
      } catch (err: any) {
        reply.code(500);
        return { ok: false, error: "意图解析失败: " + (err?.message || String(err)) };
      }
    }
  );

};
