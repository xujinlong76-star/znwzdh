/**
 * 推测规则编译 / 工具合成 / P2P 网格信令
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  compileSpeculationRules,
  generateFallbackLinkTags,
  parseOpenApiToSpecs,
  P2PMeshNode,
  renderSpeculationRulesScript,
  synthesizeRestTool,
  synthesizeSiteSearchTool,
  httpUrl,
  type MinimalOpenApiSpec,
  type P2PMessage,
} from "@navhub/core";
import { guardedFetch } from "@navhub/ai";
import { webMcp } from "./visual.ts";

import type { AppContext } from "../context.ts";
import { identityAllowed, requestIdentityOf } from "./shared.ts";
import { scopeSatisfies } from "../auth.ts";

/** 动态 REST 工具允许的方法；HEAD/OPTIONS/TRACE 不注册，避免无意义的合成工具。 */
const REST_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
function isSupportedRestSpec(spec: { method?: string }): boolean {
  return REST_METHODS.has((spec.method ?? "GET").toUpperCase());
}

function headersToRecord(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input) return out;
  if (input instanceof Headers) {
    input.forEach((value, key) => { out[key] = value; });
    return out;
  }
  if (Array.isArray(input)) {
    for (const [key, value] of input as Array<[string, string]>) out[key] = String(value);
    return out;
  }
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    out[key] = String(value);
  }
  return out;
}

/**
 * 把 @navhub/ai 的 guardedFetch 适配成 fetch 形态供动态工具执行器使用。
 *
 * core 的执行器只做字面 IP/重定向校验，无法识别解析到私网的域名；
 * guardedFetch 会解析 DNS 并拒绝私网/环回/云元数据地址，堵住
 * `127.0.0.1.nip.io` 这类 SSRF 绕过。这里透传方法/请求头/请求体，但由
 * guardedFetch 统一做逐跳校验、跨源凭据剥离和 301/302/303 方法降级。
 */
const guardedToolFetch: typeof fetch = async (input, init = {}) => {
  const rawUrl =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

  const method = (init.method ?? "GET").toUpperCase();
  if (!REST_METHODS.has(method)) {
    throw new Error("动态 REST 工具不支持该方法: " + method);
  }

  const body = init.body == null
    ? undefined
    : typeof init.body === "string"
      ? init.body
      : init.body instanceof URLSearchParams
        ? init.body
        : undefined;
  if (init.body != null && body === undefined) {
    throw new Error("动态 REST 工具仅支持字符串或表单请求体");
  }

  const result = await guardedFetch(rawUrl, {
    timeoutMs: 8_000,
    maxBytes: 512 * 1024,
    maxRedirects: 3,
    allowPrivateNetworks: false,
    userAgent: "NavHub-Agent/5.0 (Dynamic-Synthesizer; guarded)",
  }, {
    method,
    body,
    headers: headersToRecord(init.headers),
    accept: "application/json, text/plain, */*",
  });

  const headers = result.contentType
    ? { "content-type": result.contentType }
    : undefined;

  // Response 构造器禁止 204/205/304 携带 body。
  if (result.status === 204 || result.status === 205 || result.status === 304) {
    return new Response(null, { status: result.status, headers });
  }
  return new Response(result.body, { status: result.status, headers });
};

export const agentRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /**
   * 原生 W3C Speculation Rules 预渲染与预取规则编译器端点
   */
  app.post("/api/speculation/rules", { config: { scope: "public" } }, async (req, reply) => {
    const body = z.object({
      candidates: z.array(z.object({
        url: httpUrl(),
        confidence: z.number().min(0).max(1),
        predictedArrivalMs: z.number().nonnegative(),
      })).min(1).max(200),
      prerenderConfidenceThreshold: z.number().min(0).max(1).optional(),
      prefetchConfidenceThreshold: z.number().min(0).max(1).optional(),
      maxPrerenderCount: z.number().int().min(1).max(5).optional(),
      maxPrefetchCount: z.number().int().min(1).max(10).optional(),
    }).safeParse(req.body ?? {});

    if (!body.success) {
      reply.code(400);
      return { error: "参数无效", detail: body.error.issues };
    }

    const payload = compileSpeculationRules(body.data.candidates, {
      prerenderConfidenceThreshold: body.data.prerenderConfidenceThreshold,
      prefetchConfidenceThreshold: body.data.prefetchConfidenceThreshold,
      maxPrerenderCount: body.data.maxPrerenderCount,
      maxPrefetchCount: body.data.maxPrefetchCount,
    });

    return {
      ok: true,
      hasRules: Boolean(payload),
      rules: payload,
      script: payload ? renderSpeculationRulesScript(payload) : "",
      fallbackTags: payload ? generateFallbackLinkTags(payload) : [],
    };
  });

  /**
   * 动态 WebMCP 智能体工具合成器端点 (支持 REST 单端点、站点检索动作与 OpenAPI 规格合成)
   */
  app.post("/api/tools/synthesize", { config: { scope: "public" } }, async (req, reply) => {
    // 公共写入面：开放模式保持可用；开启鉴权后必须带有效 token（防注册表被匿名滥用）。
    if (!identityAllowed(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    /**
     * 注册工具 = 写进程级共享状态。鉴权模式下只允许 write/admin：
     * 只读令牌若能注册，就等价于把「任意 URL/方法」注入到所有客户端可见的工具表，
     * 形成 tool poisoning + SSRF 跳板。开放模式（个人/NAS）维持原行为。
     */
    if (ctx.config.authRequired) {
      const scopes = req.auth?.scopes ?? [];
      if (!scopeSatisfies(scopes, "write")) {
        reply.code(403);
        return { error: "注册动态工具需要 write 权限（当前令牌不足）" };
      }
    }
    // 私有工具按注册者隔离：同一 owner 才能覆盖同名工具，其他人既看不到也调不到。
    const owner = requestIdentityOf(req as never);
    const body = z.object({
      kind: z.enum(["rest", "site_search", "openapi"]).default("rest"),
      restSpec: z.object({
        name: z.string(),
        description: z.string(),
        url: z.string(),
        method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("GET"),
        headers: z.record(z.string(), z.string()).optional(),
        parameters: z.array(z.object({
          name: z.string(),
          type: z.enum(["string", "number", "boolean"]),
          description: z.string().optional(),
          required: z.boolean().optional(),
          in: z.enum(["query", "path", "body", "header"]),
          default: z.union([z.string(), z.number(), z.boolean()]).optional(),
        })).max(50).optional(),
        bodyType: z.enum(["json", "form"]).optional(),
      }).optional(),
      siteSearchSpec: z.object({
        siteId: z.string(),
        siteName: z.string(),
        searchUrlTemplate: z.string().regex(/^https?:\/\//i, "searchUrlTemplate 必须以 http:// 或 https:// 开头").optional(),
        apiEndpoint: z.string().regex(/^https?:\/\//i, "apiEndpoint 必须以 http:// 或 https:// 开头").optional(),
        category: z.string().optional(),
      }).optional(),
      openApiSpec: z.record(z.string(), z.unknown()).optional(),
    }).safeParse(req.body ?? {});

    if (!body.success) {
      reply.code(400);
      return { error: "参数无效", detail: body.error.issues };
    }

    if (body.data.kind === "site_search" && body.data.siteSearchSpec) {
      const syn = synthesizeSiteSearchTool(body.data.siteSearchSpec);
      const reg = webMcp.registerOwnedTool(syn.definition, (p) => syn.handler(p), owner);
      if (!reg.ok) {
        reply.code(reg.reason === "conflict" ? 409 : 429);
        return {
          error:
            reg.reason === "conflict"
              ? "同名工具已被其他身份注册（工具名在同一实例内必须唯一）"
              : "工具注册表已满（上限 " + webMcp.maxToolCount + "），请联系管理员清理",
        };
      }
      return {
        ok: true,
        kind: "site_search",
        tool: syn.definition,
        registered: true,
        owner,
      };
    }

    if (body.data.kind === "openapi" && body.data.openApiSpec) {
      const allSpecs = parseOpenApiToSpecs(body.data.openApiSpec as MinimalOpenApiSpec);
      // 只注册受支持的方法；写请求同样走 guardedFetch 的逐跳 SSRF 校验。
      const specs = allSpecs.filter(isSupportedRestSpec);
      const tools = [];
      let conflicts = 0;
      for (const s of specs) {
        const syn = synthesizeRestTool(s, { fetchFn: guardedToolFetch });
        const reg = webMcp.registerOwnedTool(syn.definition, (p) => syn.handler(p), owner);
        if (!reg.ok) {
          if (reg.reason === "conflict") { conflicts++; continue; }
          break;
        }
        tools.push(syn.definition);
      }
      return {
        ok: true,
        kind: "openapi",
        count: tools.length,
        tools,
        registered: tools.length > 0,
        skipped: allSpecs.length - specs.length,
        conflicts,
        capped: tools.length + conflicts < specs.length,
        owner,
      };
    }

    if (body.data.restSpec) {
      if (!isSupportedRestSpec(body.data.restSpec)) {
        reply.code(400);
        return { error: "动态 REST 工具仅支持 GET/POST/PUT/PATCH/DELETE 请求" };
      }
      const syn = synthesizeRestTool(body.data.restSpec, { fetchFn: guardedToolFetch });
      const reg = webMcp.registerOwnedTool(syn.definition, (p) => syn.handler(p), owner);
      if (!reg.ok) {
        reply.code(reg.reason === "conflict" ? 409 : 429);
        return {
          error:
            reg.reason === "conflict"
              ? "同名工具已被其他身份注册（工具名在同一实例内必须唯一）"
              : "工具注册表已满（上限 " + webMcp.maxToolCount + "），请联系管理员清理",
        };
      }
      return {
        ok: true,
        kind: "rest",
        tool: syn.definition,
        registered: true,
        owner,
      };
    }

    reply.code(400);
    return { error: "缺少 restSpec、siteSearchSpec 或 openApiSpec 有效配置" };
  });

  /**
   * P2P 网格信令与去中心化 WebRTC 状态协商端点 (P2P Mesh Signaling & Consensus Broker)
   */
  const p2pBrokerNodes = new Map<string, P2PMeshNode>();
  // 信令 broker 容量与空闲驱逐：Map 无上限增长 = 内存耗尽风险。
  // 驱逐是惰性的（每次请求顺带检查，避免挂 setInterval 导致测试多实例泄漏 timer）。
  const MAX_P2P_NODES = 1000;
  const P2P_NODE_IDLE_MS = 30 * 60 * 1000;
  const P2P_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
  const p2pLastSeen = new Map<string, number>();
  let p2pLastSweep = 0;

  app.post("/api/p2p/signal", { config: { scope: "public", rateLimit: { max: process.env.NODE_ENV === "test" ? 10_000 : 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    // 公共写入面：开放模式保持可用；开启鉴权后必须带有效 token。
    if (!identityAllowed(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    const body = z.object({
      nodeId: z.string().min(1).max(128),
      message: z.object({
        type: z.enum(["HELLO", "SYNC_REQUEST", "DELTA_BATCH", "ACK", "HEARTBEAT"]),
        senderId: z.string().min(1),
        targetId: z.string().optional(),
        seq: z.number().int().nonnegative(),
        timestamp: z.number().int().positive(),
        payload: z.unknown(),
      }),
    }).safeParse(req.body ?? {});

    if (!body.success) {
      reply.code(400);
      return { error: "参数无效", detail: body.error.issues };
    }

    let node = p2pBrokerNodes.get(body.data.nodeId);
    if (!node) {
      const now = Date.now();
      // 惰性驱逐：超过清扫间隔时，删掉空闲超时的节点
      if (now - p2pLastSweep > P2P_SWEEP_INTERVAL_MS) {
        p2pLastSweep = now;
        for (const [id, seen] of p2pLastSeen) {
          if (now - seen > P2P_NODE_IDLE_MS) {
            p2pLastSeen.delete(id);
            p2pBrokerNodes.delete(id);
          }
        }
      }
      if (p2pBrokerNodes.size >= MAX_P2P_NODES) {
        reply.code(429);
        return { error: "信令节点已满（上限 " + MAX_P2P_NODES + "），请稍后重试" };
      }
      node = new P2PMeshNode(body.data.nodeId);
      p2pBrokerNodes.set(body.data.nodeId, node);
    }
    p2pLastSeen.set(body.data.nodeId, Date.now());

    const outgoing = node.handleIncomingMessage(body.data.message as P2PMessage<any>);
    const peer = node.getPeer(body.data.message.senderId);

    return {
      ok: true,
      nodeId: body.data.nodeId,
      receivedType: body.data.message.type,
      peerState: peer?.state ?? "READY",
      outgoingResponse: outgoing,
      vectorClock: node.store.getVectorClock(),
      activePeers: node.listPeers().length,
    };
  });
};
