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
import { webMcp } from "./visual.ts";

import type { AppContext } from "../context.ts";

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
      })).min(1),
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
    const body = z.object({
      kind: z.enum(["rest", "site_search", "openapi"]).default("rest"),
      restSpec: z.object({
        name: z.string(),
        description: z.string(),
        url: z.string(),
        method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("GET"),
        headers: z.record(z.string()).optional(),
        parameters: z.array(z.object({
          name: z.string(),
          type: z.enum(["string", "number", "boolean"]),
          description: z.string().optional(),
          required: z.boolean().optional(),
          in: z.enum(["query", "path", "body", "header"]),
          default: z.union([z.string(), z.number(), z.boolean()]).optional(),
        })).optional(),
        bodyType: z.enum(["json", "form"]).optional(),
      }).optional(),
      siteSearchSpec: z.object({
        siteId: z.string(),
        siteName: z.string(),
        searchUrlTemplate: z.string().optional(),
        apiEndpoint: z.string().optional(),
        category: z.string().optional(),
      }).optional(),
      openApiSpec: z.record(z.unknown()).optional(),
    }).safeParse(req.body ?? {});

    if (!body.success) {
      reply.code(400);
      return { error: "参数无效", detail: body.error.issues };
    }

    if (body.data.kind === "site_search" && body.data.siteSearchSpec) {
      const syn = synthesizeSiteSearchTool(body.data.siteSearchSpec);
      webMcp.registerTool(syn.definition, (p) => syn.handler(p));
      return {
        ok: true,
        kind: "site_search",
        tool: syn.definition,
        registered: true,
      };
    }

    if (body.data.kind === "openapi" && body.data.openApiSpec) {
      const specs = parseOpenApiToSpecs(body.data.openApiSpec as MinimalOpenApiSpec);
      const tools = specs.map((s) => {
        const syn = synthesizeRestTool(s);
        webMcp.registerTool(syn.definition, (p) => syn.handler(p));
        return syn.definition;
      });
      return {
        ok: true,
        kind: "openapi",
        count: tools.length,
        tools,
        registered: true,
      };
    }

    if (body.data.restSpec) {
      const syn = synthesizeRestTool(body.data.restSpec);
      webMcp.registerTool(syn.definition, (p) => syn.handler(p));
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

  app.post("/api/p2p/signal", { config: { scope: "public" } }, async (req, reply) => {
    const body = z.object({
      nodeId: z.string().min(1),
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
      node = new P2PMeshNode(body.data.nodeId);
      p2pBrokerNodes.set(body.data.nodeId, node);
    }

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
