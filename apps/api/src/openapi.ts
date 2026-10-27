/**
 * OpenAPI 3.1 文档生成。
 *
 * 关键设计：**从 Fastify 路由表自动生成**，不手写第二份路由清单。
 * 手写清单必然漂移（本文档存在的唯一目的就是防漂移），而路由的
 * method / path / scope（config.scope）在注册时已确定，onRoute 钩子
 * 能在注册瞬间拿到——文档与真实路由同源。
 *
 * 覆盖不了的部分按最小约定给出：
 *   - path 参数从 `:name` 提取
 *   - scope → security（public 无锁；read/write/admin → Bearer）
 *   - 请求体 → **从 @navhub/core 的 zod 契约生成**（见 REST_SCHEMA_BINDINGS）
 *   - 响应体 → **同源契约生成 $ref**（见 RESPONSE_SCHEMA_BINDINGS）
 *
 * 请求体为什么不再手写：MCP 工具与 REST 端点本来就是同一批能力，
 * 两边各写一份字段清单必然漂移（改了 MCP 忘改 REST，或反过来）。
 * 现在 zod 契约只在 packages/core/src/mcp-schemas.ts 定义一次，
 * MCP 的 inputSchema 与本文件的 requestBody / query 参数都从它派生。
 * 响应体同理收敛到 packages/core/src/rest-responses.ts：文档与端到端
 * 契约测试共用同一份 schema，文档写错和实现跑偏会同时被抓住。
 * 未绑定契约的端点仍然退回「通用 object」——宁可不写，也不编造字段。
 */

import type { RouteScope } from "./auth.ts";
import {
  MCP_TOOL_DEFS,
  RESPONSE_SCHEMA_BINDINGS,
  REST_SCHEMA_BINDINGS,
  SiteCreateBody,
  SiteUpdateBody,
  zodSchemaToJsonSchema,
  type ZodSchemaLike,
} from "@navhub/core";

export interface RouteEntry {
  method: string;
  url: string;
  scope: RouteScope;
  /**
   * 路由是否**显式**声明了 scope。
   *
   * 注册期默认值是 "public"：漏写不会报错，只会让一条写路由静默变成匿名可写。
   * 把「有没有写」与「写的是什么」分开记录，登记闸门才能对这种静默失败给出
   * 精确归因（否则它只会在匿名写快照里以「多了一条」的形式出现，容易被当成
   * 正常新增而顺手补登记）。
   */
  scopeExplicit: boolean;
}

/** 端点中文描述（少量人工标注；未标注的走 URL 段推断） */
const DESCRIPTIONS: Record<string, string> = {
  "GET /api/health": "健康与能力：模式、capabilities、统计",
  "POST /api/warmup": "预热 embedding 模型（默认惰性加载）",
  "GET /api/search": "混合检索（四路召回 + RRF）；limit/offset 分页",
  "POST /api/search": "混合检索（JSON 体，与 GET 共用 schema）",
  "GET /api/sites": "站点列表（categoryId/status/limit 过滤，含软删排除）",
  "GET /api/sites/{id}": "站点详情，支持 id 或 URL（URL 须 encodeURIComponent）",
  "POST /api/sites": "创建站点（URL 重复 → 409）",
  "PATCH /api/sites/{id}": "部分更新站点",
  "DELETE /api/sites/{id}": "删除站点（**软删除** → 回收站，见 /api/trash）",
  "POST /api/sites/bulk": "批量操作 op=delete|setCategory|setStatus；dryRun 默认 true",
  "GET /api/trash": "回收站列表（软删站点，倒序）",
  "POST /api/trash/{id}/restore": "恢复软删站点（同 URL 已被占用 → 409）",
  "DELETE /api/trash/{id}": "彻底删除（连带标签关联与向量索引，不可恢复）",
  "GET /api/submissions": "投稿审核队列（仅 source=submission，status 筛选）",
  "PATCH /api/submissions/{number}": "审核投稿（approve → active / reject → archived，落审计）",
  "GET /api/profile": "读个性化画像（topCategories/topTags/visitedSiteIds…）",
  "DELETE /api/profile": "重置个性化画像（清画像 + 该身份行为事件；收藏与搜索历史保留）",
  "GET /api/admin/audit": "审计日志（分页 + action/actor 过滤 + actions 全集）",
  "GET /api/admin/health/trend": "健康巡检趋势（按天分桶：checked/failed/rate/avgLatencyMs）",
  "GET /api/admin/stats/trends": "运营看板（热门搜索/零结果/热度榜）",
  "GET /api/jobs/stream": "全量任务实时 SSE 事件流（控制台与运维仪表盘）",
  "GET /api/jobs/{id}/events": "单任务实时 SSE 事件流（等待任务执行完成）",
  "POST /api/tokens": "创建/签发 API 凭据（明文仅返回一次）",
  "GET /api/tokens": "列出所有 API 凭据（不含敏感明文与哈希）",
  "PATCH /api/tokens/{id}": "更新 API 凭据元数据与权限范围",
  "POST /api/tokens/{id}/rotate": "紧急轮换 API 凭据（立即换发新明文并废弃旧明文）",
  "POST /api/tokens/{id}/revoke": "软吊销 API 凭据（立刻失效保留审计痕迹）",
  "DELETE /api/tokens/{id}": "彻底硬删除 API 凭据记录",
  "POST /api/sites/heal": "死链故障自愈诊断与替代推荐",
  "POST /api/sites/alternatives": "双曲空间最佳平替与同生态推荐",
  "POST /api/wayback": "Internet Archive Wayback 快照时间机器解析",
  "GET /api/openapi.json": "本 OpenAPI 文档",
  "GET /api/docs": "API 文档（HTML 视图）",
};

/** 从 URL 段推断描述（取最后一段业务名 + 方法语义） */
function inferDescription(method: string, url: string): string {
  const seg = url.replace(/^\/api\//, "").split("/").filter(Boolean);
  const noun = seg[0] ?? "root";
  const verb: Record<string, string> = { GET: "查询", POST: "创建/执行", PATCH: "更新", PUT: "写入", DELETE: "删除" };
  return (verb[method] ?? method) + " " + noun;
}

/** `:name` → OpenAPI path 模板与参数列表 */
function pathOf(url: string): { template: string; params: string[] } {
  const params: string[] = [];
  const template = url.replace(/:([A-Za-z0-9_]+)/g, (_m, name: string) => {
    params.push(name);
    return "{" + name + "}";
  });
  return { template, params };
}

/* ------------------------------------------------------------------ *
 * zod -> JSON Schema（OpenAPI 组件）
 * ------------------------------------------------------------------ */

const MCP_COMPONENT_PREFIX = "MCP_";

function buildComponentSchemas(): {
  schemas: Record<string, unknown>;
  refOf: Map<ZodSchemaLike, string>;
} {
  const schemas: Record<string, unknown> = {
    SiteCreateBody: zodSchemaToJsonSchema(SiteCreateBody),
    SiteUpdateBody: zodSchemaToJsonSchema(SiteUpdateBody),
  };
  const refOf = new Map<ZodSchemaLike, string>();
  refOf.set(SiteCreateBody as ZodSchemaLike, "SiteCreateBody");
  refOf.set(SiteUpdateBody as ZodSchemaLike, "SiteUpdateBody");

  for (const def of MCP_TOOL_DEFS) {
    if (!def.inputSchema) continue;
    const key = MCP_COMPONENT_PREFIX + def.name;
    schemas[key] = zodSchemaToJsonSchema(def.inputSchema);
    refOf.set(def.inputSchema, key);
  }

  for (const [bindingKey, item] of Object.entries(REST_SCHEMA_BINDINGS)) {
    if (item.in === "body" && !refOf.has(item.schema)) {
      const parts = bindingKey.split(" ");
      const method = (parts[0] ?? "").toLowerCase();
      const pathPart = (parts[1] ?? "").replace(/^\/api\//, "").replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "");
      const key = "REST_" + method + "_" + pathPart + "_Body";
      schemas[key] = zodSchemaToJsonSchema(item.schema);
      refOf.set(item.schema, key);
    }
  }

  // 响应契约：显式组件名，多个端点可指向同一组件（GET/POST 共用处理器时必须同源）
  for (const item of Object.values(RESPONSE_SCHEMA_BINDINGS)) {
    schemas[item.name] = zodSchemaToJsonSchema(item.schema);
  }

  return { schemas, refOf };
}

/** 把 zod 契约展开成 query 参数列表（GET 端点用） */
function queryParametersOf(schema: ZodSchemaLike): Array<Record<string, unknown>> {
  const js = zodSchemaToJsonSchema(schema);
  const props = (js.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set(Array.isArray(js.required) ? (js.required as string[]) : []);
  return Object.entries(props).map(([name, sub]) => ({
    name,
    in: "query",
    required: required.has(name),
    schema: sub,
    description: typeof sub?.description === "string" ? sub.description : name,
  }));
}

export function buildOpenApiDoc(routes: RouteEntry[]): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  const { schemas, refOf } = buildComponentSchemas();

  for (const r of routes) {
    const method = r.method.toLowerCase();
    if (method === "head" || method === "options") continue;
    const { template, params } = pathOf(r.url);
    const key = r.method.toUpperCase() + " " + template;

    const security = r.scope === "public" ? [] : [{ bearerAuth: [] }];
    // 响应契约：有绑定就挂 $ref，没有则保持通用 object（不编造形状）
    const responseBinding = RESPONSE_SCHEMA_BINDINGS[key];
    const okSchema = responseBinding
      ? { $ref: "#/components/schemas/" + responseBinding.name }
      : { type: "object" };
    const operation: Record<string, unknown> = {
      summary: DESCRIPTIONS[key] ?? inferDescription(r.method.toUpperCase(), r.url),
      description: DESCRIPTIONS[key] ?? inferDescription(r.method.toUpperCase(), r.url),
      tags: [template.split("/")[2] ?? "misc"],
      operationId: (r.method + "_" + template.replace(/[^\w]+/g, "_")).toLowerCase(),
      security,
      responses: {
        "200": { description: "成功", content: { "application/json": { schema: okSchema } } },
      },
    };
    const pathParams = params.map((name) => ({
      name, in: "path", required: true,
      schema: { type: "string" },
      description: name === "id" ? "资源 id（站点可传 URL，需 encodeURIComponent）" : name,
    }));

    // 契约绑定：请求体 / query 参数都从 core 的 zod 契约生成，不手写
    const binding = REST_SCHEMA_BINDINGS[key];
    const queryParams = binding?.in === "query" ? queryParametersOf(binding.schema) : [];
    if (pathParams.length + queryParams.length > 0) {
      operation.parameters = [...pathParams, ...queryParams];
    }

    if (["post", "put", "patch"].includes(method)) {
      const refName = binding?.in === "body" ? refOf.get(binding.schema) : undefined;
      operation.requestBody = {
        required: method !== "patch",
        content: {
          "application/json": {
            schema: refName
              ? { $ref: "#/components/schemas/" + refName }
              : { type: "object", additionalProperties: true },
          },
        },
      };
    }
    // 错误响应：写操作与详情类端点可能 400/401/404/409 —— 只声明确有语义的
    const responses = operation.responses as Record<string, unknown>;
    if (r.scope !== "public") {
      responses["401"] = { description: "缺少/无效 Bearer token（NAVHUB_AUTH_REQUIRED 开启时）" };
      responses["403"] = { description: "token scope 不足（需要 " + r.scope + "）" };
    }
    if (["post"].includes(method) || params.length > 0) {
      responses["400"] = { description: "参数校验失败" };
      responses["404"] = { description: "资源不存在" };
    }
    if (key === "POST /api/sites" || key === "POST /api/trash/{id}/restore") {
      responses["409"] = { description: "URL 冲突（已存在 / 恢复目标 URL 被占用）" };
    }

    paths[template] = paths[template] ?? {};
    paths[template]![method] = operation;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "山羊胡中枢 API",
      version: "0.1.0",
      description:
        "导航站中枢（Fastify）。**自动生成**自 Fastify 路由表——路由增删时本文档同步变化，不存在手写清单漂移。" +
        "鉴权：开启 NAVHUB_AUTH_REQUIRED 后 read/write/admin 路由需 Bearer token（api_tokens 表），scope 满足 admin ⊇ write ⊇ read；public 路由匿名可用。" +
        "响应缓存：声明了策略的 GET 返回 private + max-age/ETag，其余一律 no-store。",
    },
    servers: [{ url: "/", description: "当前实例" }],
    // MCP 工具契约同源发布：Agent 拿这份文档就能直接知道每个工具收什么参数
    "x-mcp-tools": MCP_TOOL_DEFS.map((t) => ({
      name: t.name,
      description: t.description,
      scope: t.scope,
      mutating: t.mutating,
      inputSchema: { $ref: "#/components/schemas/" + MCP_COMPONENT_PREFIX + t.name },
    })),
    components: {
      // 全部由 zod 契约生成，这里是唯一出口
      schemas,
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: "API token 明文（POST /api/tokens 创建，仅创建时返回一次）" },
      },
    },
    tags: [
      { name: "health", description: "健康与能力" },
      { name: "search", description: "检索" },
      { name: "sites", description: "站点 CRUD 与批量操作" },
      { name: "trash", description: "回收站（软删除）" },
      { name: "categories", description: "类目" },
      { name: "tags", description: "标签" },
      { name: "collections", description: "精选专题" },
      { name: "favorites", description: "收藏夹" },
      { name: "rank", description: "榜单" },
      { name: "admin", description: "管理面（审计/统计/巡检趋势）" },
      { name: "submissions", description: "投稿与审核" },
      { name: "profile", description: "个性化画像" },
      { name: "jobs", description: "任务队列" },
      { name: "storage", description: "NavSphere 兼容存储" },
      { name: "tokens", description: "API token 管理" },
      { name: "events", description: "行为事件" },
      { name: "users", description: "终端用户身份" },
    ],
    paths,
  };
}

/** 文档用 HTML 视图（不依赖外部 CDN，离线/内网可直接看） */
export function renderDocsHtml(doc: Record<string, unknown>): string {
  const paths = (doc.paths ?? {}) as Record<string, Record<string, Record<string, unknown>>>;
  const rows: string[] = [];
  for (const [template, ops] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(ops)) {
      const security = (op.security as Array<Record<string, unknown>>) ?? [];
      const scope = security.length === 0 ? "public" : "bearer";
      rows.push(
        "<tr><td class='m'>" + method.toUpperCase() + "</td><td class='p'>" +
          template.replace(/[<>]/g, (c) => (c === "<" ? "&lt;" : "&gt;")) +
          "</td><td>" + String(op.summary ?? "") +
          "</td><td><span class='s s-" + scope + "'>" + scope + "</span></td></tr>",
      );
    }
  }
  const info = (doc.info ?? {}) as { title?: string; version?: string; description?: string };
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${info.title ?? "API"} 文档</title>
<style>
  body{font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:32px;background:#0f1115;color:#e6e8eb}
  h1{font-size:22px;margin:0 0 4px}
  .meta{color:#9aa3af;font-size:13px;margin-bottom:20px}
  .meta a{color:#6ea8fe}
  table{border-collapse:collapse;width:100%;max-width:1100px}
  th,td{border-bottom:1px solid #23262d;padding:8px 12px;text-align:left;vertical-align:top}
  th{color:#9aa3af;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
  td.m{font-weight:700;color:#7ee787;width:70px}
  td.p{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#d2a8ff;white-space:nowrap}
  .s{font-size:11px;padding:1px 7px;border-radius:10px;border:1px solid #30363d}
  .s-public{color:#7ee787;border-color:#2ea043}
  .s-bearer{color:#ffa657;border-color:#d29922}
  .d{max-width:900px;color:#9aa3af;font-size:13px;white-space:pre-wrap}
</style></head><body>
<h1>${info.title ?? "API"} <span style="color:#9aa3af;font-weight:400;font-size:14px">v${info.version ?? ""}</span></h1>
<div class="d">${(info.description ?? "").replace(/[<>]/g, (c) => (c === "<" ? "&lt;" : "&gt;"))}</div>
<div class="meta">机器可读版本：<a href="/api/openapi.json">/api/openapi.json</a> · 共 ${rows.length} 个端点 · scope 标注 public = 匿名可用，bearer = 需 Bearer token</div>
<table><thead><tr><th>方法</th><th>路径</th><th>说明</th><th>鉴权</th></tr></thead>
<tbody>${rows.join("")}</tbody></table>
</body></html>`;
}
