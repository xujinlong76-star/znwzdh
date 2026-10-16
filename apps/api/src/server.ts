/**
 * NavHub 中枢服务（Fastify）——装配与横切关注点。
 *
 * 业务路由已按域拆分至 ./routes/*.ts（升级改造方案 P1-3：原 2600+ 行单体按域拆为
 * 24 个路由插件 + shared/metrics，行为逐字节一致，OpenAPI 由 onRoute hook 同源收集，
 * 插件 register 顺序即原 server.ts 路由顺序）。
 * 本文件只保留：
 *   - Fastify 实例与横切插件装配（cors / rate-limit）
 *   - 指标采集 hook（数据与文本渲染在 ./metrics.ts）
 *   - 全局错误兜底 / OpenAPI 收集 / 响应缓存 / 鉴权（onRoute / onSend / onRequest）
 *   - 按原顺序 register 各域路由
 *
 * 设计原则：
 *  - 所有响应都带 capability 信息，让前端能如实提示「语义检索是否可用」，
 *    而不是在缺模型时静默返回更差的结果。
 *  - 写操作全部走 zod 校验 + 审计落库。
 *  - MCP 与 REST 共用同一套仓储与检索引擎（见 packages/mcp）。
 */
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { createHash } from "node:crypto";
import type { AppContext } from "./context.ts";
import { buildOpenApiDoc, renderDocsHtml, type RouteEntry } from "./openapi.ts";
import { recordHttpMetric } from "./metrics.ts";
import {
  ANONYMOUS_IDENTITY,
  bearerOf,
  hashToken,
  parseScopes,
  scopeSatisfies,
  secureEqual,
  type AuthIdentity,
  type RouteScope,
} from "./auth.ts";
import { healthRoutes } from "./routes/health.ts";
import { searchRoutes } from "./routes/search.ts";
import { siteRoutes } from "./routes/sites.ts";
import { trashRoutes } from "./routes/trash.ts";
import { categoryRoutes } from "./routes/categories.ts";
import { tagRoutes } from "./routes/tags.ts";
import { collectionRoutes } from "./routes/collections.ts";
import { recipeRoutes } from "./routes/recipes.ts";
import { visualRoutes } from "./routes/visual.ts";
import { favoriteRoutes } from "./routes/favorites.ts";
import { rankRoutes } from "./routes/rank.ts";
import { agentRoutes } from "./routes/agents.ts";
import { historyRoutes } from "./routes/history.ts";
import { profileRoutes } from "./routes/profile.ts";
import { vaultRoutes } from "./routes/vault.ts";
import { crdtRoutes } from "./routes/crdt.ts";
import { identityRoutes } from "./routes/identity.ts";
import { auditRoutes } from "./routes/audit.ts";
import { statsRoutes } from "./routes/stats.ts";
import { submissionRoutes } from "./routes/submissions.ts";
import { jobRoutes } from "./routes/jobs.ts";
import { enrichRoutes } from "./routes/enrich.ts";
import { telemetryRoutes } from "./routes/telemetry.ts";
import { navsphereRoutes } from "./routes/navsphere.ts";
import { tokenRoutes } from "./routes/tokens.ts";

/**
 * 鉴权失败审计的节流窗口：同一 IP + 同一失败动作，在这个间隔内只记一条。
 * 失败路径是未认证的，不节流会让"刷失败请求"变成撑爆 audit_logs 的新攻击面。
 */
const AUTH_FAIL_AUDIT_THROTTLE_MS = 10_000;
const AUTH_FAIL_AUDIT_AT = new Map<string, number>();

export async function buildServer(ctx: AppContext) {
  // 测试里默认静音，避免日志淹没断言输出；生产用 NAVHUB_LOG_LEVEL 控制
  const logLevel = process.env.NAVHUB_LOG_LEVEL ?? (process.env.VITEST ? "silent" : "info");
  // 信任 X-Forwarded-For：只有经过自家 /api/hub/* 代理时才开（由 ctx.config.trustProxy 统一解析，见 config.ts）。
  // 默认关闭（直连公网伪造 XFF 可绕过按 IP 限流）；docker/docker-compose.yml 经代理时默认注入 NAVHUB_TRUST_PROXY=1。
  // 不开启时 req.ip 会退化成代理地址，按 IP 的限流（300/min、投稿 5/hour）会整站共享一桶——按部署拓扑二选一。
  const app = Fastify({
    logger: { level: logLevel },
    bodyLimit: 4 * 1024 * 1024,
    trustProxy: ctx.config.trustProxy,
  });

  // CORS：credentials:true 不能配 origin:*（浏览器会拒绝），* 时退为不带凭据
  const allowAll = ctx.config.corsOrigins.includes("*");
  await app.register(cors, {
    origin: allowAll ? true : ctx.config.corsOrigins,
    credentials: !allowAll,
  });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

  /* ---------------------------- 指标采集（Prometheus） ---------------------------- */

  /**
   * 采集状态与文本渲染都在 ./metrics.ts（不引入 prom-client，避免为一个端点加依赖）。
   * 这里只挂 hook——/api/metrics 自身不计入，避免自反馈噪音。
   */
  app.addHook("onResponse", async (req, reply) => {
    const route = (req.routeOptions?.url as string | undefined) ?? "unmatched";
    if (route === "/api/metrics") return;
    recordHttpMetric(route, req.method, reply.statusCode, Number(reply.elapsedTime ?? 0));
  });


  // 全局错误兜底：统一 500 形态，避免 Fastify 默认 HTML 泄漏栈
  app.setErrorHandler((err, _req, reply) => {
    app.log.error(err);
    const status = typeof (err as { statusCode?: unknown }).statusCode === "number"
      ? (err as { statusCode: number }).statusCode : 500;
    reply.code(status >= 400 && status < 600 ? status : 500).send({ error: status === 500 ? "内部错误" : (err as Error).message });
  });

  /* ---------------------------- OpenAPI 路由收集 ---------------------------- */

  /**
   * onRoute 在每条路由注册时触发——文档与真实路由**同源**，不会手写漂移。
   * 必须在任何 app.get/post… 之前注册，否则收不到已有路由。
   */
  const routeEntries: RouteEntry[] = [];
  app.addHook("onRoute", (route) => {
    const method = typeof route.method === "string" ? route.method : String(route.method);
    const scope = ((route.config as { scope?: RouteScope } | undefined)?.scope ?? "public") as RouteScope;
    routeEntries.push({ method: method.toUpperCase(), url: route.url, scope });
  });

  app.get("/api/openapi.json", { config: { scope: "public", cache: { maxAge: 60 } } }, async () =>
    buildOpenApiDoc(routeEntries.filter((r) => r.url !== "/api/openapi.json" && r.url !== "/api/docs")),
  );
  app.get("/api/docs", { config: { scope: "public", cache: { maxAge: 60 } } }, async (_req, reply) => {
    const doc = buildOpenApiDoc(routeEntries.filter((r) => r.url !== "/api/openapi.json" && r.url !== "/api/docs"));
    reply.header("content-type", "text/html; charset=utf-8");
    return renderDocsHtml(doc);
  });

  /* ---------------------------- 响应缓存 ---------------------------- */

  /**
   * 路由级缓存策略（在 route config 里声明 `cache: { maxAge, etag }`）。
   * 不声明 = `no-store`（见下方 hook）——这是刻意的安全默认：
   * GET 缺缓存头时，浏览器与中间代理会走「启发式缓存」，
   * 可能把管理面/含身份的数据缓存下来，属于静默的正确性风险。
   */
  interface CachePolicy {
    /** 秒；0 = 每次再验证（`private, no-cache`，配合 ETag 用 304 省流量） */
    maxAge: number;
    /** 生成 ETag 并处理 If-None-Match → 304 */
    etag?: boolean;
  }

  app.addHook("onSend", async (req, reply, payload) => {
    const policy = (req.routeOptions?.config as { cache?: CachePolicy } | undefined)?.cache;
    if (req.method !== "GET" || !policy || reply.statusCode !== 200) {
      reply.header("cache-control", "no-store");
      return payload;
    }
    // private：避免共享代理（CDN/nginx）把不同用户/不同 token 的响应串在一起。
    // TTL 只省浏览器端重复请求，不牺牲隔离性。
    reply.header("cache-control", policy.maxAge > 0 ? "private, max-age=" + policy.maxAge : "private, no-cache");

    if (!policy.etag || typeof payload !== "string") return payload;
    const etag = '"' + createHash("sha1").update(payload).digest("base64url") + '"';
    reply.header("etag", etag);
    const inm = String(req.headers["if-none-match"] ?? "");
    const matched = inm.split(",").some((v) => v.trim().replace(/^W\//, "") === etag);
    if (matched) {
      reply.code(304);
      // 304 不允许带 body；Fastify 不会自动清这两个头，残留会与空 body 冲突
      reply.removeHeader("content-type");
      reply.removeHeader("content-length");
      return "";
    }
    return payload;
  });

  /* ---------------------------- 鉴权 ---------------------------- */

  /**
   * 路由分级：
   *   public  终端用户功能（搜索 / 事件 / 收藏 / 投稿 / 榜单 / 健康），匿名可用
   *   read    管理面只读（列表 / 统计 / 审计查询）
   *   write   管理面写入（站点与类目 CRUD / 任务入队 / 存储写入 / 富化）
   *   admin   高危（token 管理 / 删除站点）
   *
   * 开放模式（默认）下 hook 只挂载身份、不做拦截，行为与历史版本完全一致；
   * 开启 NAVHUB_AUTH_REQUIRED 后，read/write/admin 路由必须带 Bearer token，
   * 且 token 的 scope 不低于路由要求（admin ⊇ write ⊇ read）。
   */
  app.addHook("onRequest", async (req, reply) => {
    const required = ((req.routeOptions?.config as { scope?: RouteScope } | undefined)?.scope ?? "public") as RouteScope;
    const auth: AuthIdentity = { ...ANONYMOUS_IDENTITY };
    req.auth = auth;

    if (!ctx.config.authRequired || required === "public") return;

    /**
     * 鉴权失败落审计。
     *
     * 此前 401/403 只回一个错误体就结束，审计日志里一片空白。后果是：
     * 有人拿泄露的凭据在扫接口、或在枚举 token，运维完全看不见，
     * 事后也无法还原"哪条凭据被滥用过"。
     *
     * 两条硬约束：
     *  1. **绝不记录凭据本身**——明文与哈希都不写进 diff，只写原因与路径。
     *  2. **按 IP+动作节流**：失败路径是未认证的，不节流的话攻击者可以
     *     用一堆失败请求把 audit_logs 撑爆，反而形成新的 DoS 面。
     */
    const auditAuthFailure = (action: string, detail: string, target: string | null = null): void => {
      const now = Date.now();
      const key = action + "|" + (req.ip ?? "-");
      const last = AUTH_FAIL_AUDIT_AT.get(key) ?? 0;
      if (now - last < AUTH_FAIL_AUDIT_THROTTLE_MS) return;
      AUTH_FAIL_AUDIT_AT.set(key, now);
      void ctx.repo.audit({
        ip: req.ip,
        actor: "anonymous",
        actorKind: "anonymous",
        action,
        target: target ?? undefined,
        diff: { detail, path: req.url, required },
      }).catch(() => undefined);
    };

    const token = bearerOf(req);
    if (!token) {
      void auditAuthFailure("auth.missing_token", "缺少 Bearer token，要求 " + required);
      return reply.code(401).send({ error: "缺少 Bearer token（该路由要求 " + required + " 权限）" });
    }

    // 引导 token / 会话特权：内存比对，视同 admin。用于首次创建库内 token 的 bootstrap 或 Web 管理端会话委托
    if (
      (ctx.config.bootstrapToken && secureEqual(token, ctx.config.bootstrapToken)) ||
      (ctx.config.sessionSecret && secureEqual(token, ctx.config.sessionSecret))
    ) {
      auth.actor = ctx.config.bootstrapToken && secureEqual(token, ctx.config.bootstrapToken) ? "bootstrap" : "admin_session";
      auth.kind = "static";
      auth.scopes = ["read", "write", "admin"];
      return;
    }

    const record = await ctx.repo.findApiTokenByHash(hashToken(token));
    if (!record) {
      void auditAuthFailure("auth.invalid_token", "token 无效 / 已过期 / 已吊销");
      return reply.code(401).send({ error: "token 无效或已过期" });
    }
    const tokenScopes = parseScopes(Array.isArray(record.scopes) ? record.scopes.join(",") : String(record.scopes ?? ""));
    if (!scopeSatisfies(tokenScopes, required)) {
      void auditAuthFailure("auth.scope_denied", "需要 " + required + "，当前 " + tokenScopes.join(","), record.id);
      return reply.code(403).send({ error: "token 的 scope 不足以执行该操作（需要 " + required + "，当前 " + tokenScopes.join(",") + "）" });
    }

    // 鉴权通过：写入真实身份，审计从这一刻起记录「谁」而不是笼统的 "api"
    auth.actor = record.name;
    auth.kind = "token";
    auth.tokenId = record.id;
    auth.scopes = tokenScopes;
    void ctx.repo.touchApiToken(record.id).catch(() => undefined);
  });

  /* ---------------------------- 业务路由（按域 register） ---------------------------- */

  await app.register(healthRoutes, { ctx });
  await app.register(searchRoutes, { ctx });
  await app.register(siteRoutes, { ctx });
  await app.register(trashRoutes, { ctx });
  await app.register(categoryRoutes, { ctx });
  await app.register(tagRoutes, { ctx });
  await app.register(collectionRoutes, { ctx });
  await app.register(recipeRoutes, { ctx });
  await app.register(visualRoutes, { ctx });
  await app.register(favoriteRoutes, { ctx });
  await app.register(rankRoutes, { ctx });
  await app.register(agentRoutes, { ctx });
  await app.register(historyRoutes, { ctx });
  await app.register(profileRoutes, { ctx });
  await app.register(vaultRoutes, { ctx });
  await app.register(crdtRoutes, { ctx });
  await app.register(identityRoutes, { ctx });
  await app.register(auditRoutes, { ctx });
  await app.register(statsRoutes, { ctx });
  await app.register(submissionRoutes, { ctx });
  await app.register(jobRoutes, { ctx });
  await app.register(enrichRoutes, { ctx });
  await app.register(telemetryRoutes, { ctx });
  await app.register(navsphereRoutes, { ctx });
  await app.register(tokenRoutes, { ctx });

  return app;
}
