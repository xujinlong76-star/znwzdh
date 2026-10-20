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
  type MinimalOpenApiSpec,
  type P2PMessage,
} from "@navhub/core";
import { guardedFetch } from "@navhub/ai";
import { webMcp } from "./visual.ts";

import type { AppContext } from "../context.ts";
import { identityAllowed } from "./shared.ts";

/** 动态 REST 工具只放行 GET：写请求需要额外的 CSRF/重放与请求体语义评估。 */
function isGetRestSpec(spec: { method?: string }): boolean {
  return (spec.method ?? "GET").toUpperCase() === "GET";
}

/**
 * 把 @navhub/ai 的 guardedFetch 适配成 fetch 形态供动态工具执行器使用。
 *
 * core 的执行器只做字面 IP/重定向校验，无法识别解析到私网的域名；
 * guardedFetch 会解析 DNS 并拒绝私网/环回/云元数据地址，堵住
 * `127.0.0.1.nip.io` 这类 SSRF 绕过。这里只允许 GET，且不透传调用方
 * 自定义 Header，避免把内部凭据带到任意公网端点。
 */
const guardedToolFetch: typeof fetch = async (input, init = {}) => {
  const rawUrl =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET") {
    throw new Error("动态 REST 工具仅允许 GET 请求");
  }

  const result = await guardedFetch(rawUrl, {
    timeoutMs: 8_000,
    maxBytes: 512 * 1024,
    maxRedirects: 3,
    allowPrivateNetworks: false,
    userAgent: "NavHub-Agent/5.0 (Dynamic-Synthesizer; guarded)",
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
        url: z.string(),
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
        searchUrlTemplate: z.string().optional(),
        apiEndpoint: z.string().optional(),
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
      if (!webMcp.registerTool(syn.definition, (p) => syn.handler(p))) {
        reply.code(429);
        return { error: "工具注册表已满（上限 " + webMcp.maxToolCount + "），请联系管理员清理" };
      }
      return {
        ok: true,
        kind: "site_search",
        tool: syn.definition,
        registered: true,
      };
    }

    if (body.data.kind === "openapi" && body.data.openApiSpec) {
      const allSpecs = parseOpenApiToSpecs(body.data.openApiSpec as MinimalOpenApiSpec);
      // 写请求不在动态工具放行范围：只注册 GET，避免 SSRF 防护之外的
      // CSRF/重放/请求体语义问题。
      const specs = allSpecs.filter(isGetRestSpec);
      const tools = [];
      for (const s of specs) {
        const syn = synthesizeRestTool(s, { fetchFn: guardedToolFetch });
        if (!webMcp.registerTool(syn.definition, (p) => syn.handler(p))) break;
        tools.push(syn.definition);
      }
      return {
        ok: true,
        kind: "openapi",
        count: tools.length,
        tools,
        registered: tools.length > 0,
        skipped: allSpecs.length - specs.length,
        capped: tools.length < specs.length,
      };
    }

    if (body.data.restSpec) {
      if (!isGetRestSpec(body.data.restSpec)) {
        reply.code(400);
        return { error: "动态 REST 工具当前仅支持 GET 请求" };
      }
      const syn = synthesizeRestTool(body.data.restSpec, { fetchFn: guardedToolFetch });
      if (!webMcp.registerTool(syn.definition, (p) => syn.handler(p))) {
        reply.code(429);
        return { error: "工具注册表已满（上限 " + webMcp.maxToolCount + "），请联系管理员清理" };
      }
      return {
        ok: true,
        kind: "rest",
        tool: syn.definition,
        registered: true,
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

  app.post("/api/p2p/signal", { config: { scope: "public" } }, async (req, reply) => {
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
