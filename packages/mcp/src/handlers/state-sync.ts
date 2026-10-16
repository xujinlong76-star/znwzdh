/**
 * 状态同步域工具：CRDT 操作日志合并与 P2P 网格节点消息交换。
 */
import {
  compactOperationLogs,
  mergeOperationLogs,
  P2PMeshNode,
  reduceOperationsToState,
  type CRDTOperation,
  type P2PMessage,
} from "@navhub/core";
import { ExchangeP2pMeshInput, SyncCrdtOperationsInput, requireScope, type ToolContext } from "../tools.ts";
import { ok, type Handler, type HandlerDeps } from "./shared.ts";

export const stateSyncHandlers = {
  async sync_crdt_operations(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
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

  async exchange_p2p_mesh(deps: HandlerDeps, args: unknown, tc: ToolContext) {
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
} satisfies Record<string, Handler>;
