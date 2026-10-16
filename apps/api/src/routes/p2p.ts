import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { P2PMeshNode, type P2PMessage } from "@navhub/core";
import { identityAllowed } from "./shared.ts";
import type { AppContext } from "../context.ts";

export function registerP2pRoutes(app: FastifyInstance, ctx: AppContext): void {

  /**
   * P2P 网格信令与去中心化 WebRTC 状态协商端点 (P2P Mesh Signaling & Consensus Broker)
   */
  const p2pBrokerNodes = new Map<string, P2PMeshNode>();
  // 信令 broker 容量与空闲驱逐：Map 无上限增长 = 内存耗尽风险。
  // 驱逐是惰性的（每次请求顺带检查，避免在 buildServer 里挂 setInterval 导致测试多实例泄漏 timer）。
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
}
