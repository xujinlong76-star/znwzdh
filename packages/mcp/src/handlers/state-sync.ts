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
import { ok, requireOwnerIdentity, type Handler, type HandlerDeps } from "./shared.ts";

export const stateSyncHandlers = {
  async sync_crdt_operations(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    requireScope(tc, "write");
    // 落库键只认令牌归属人：取自入参时，任何持 write 令牌的身份都能覆盖别人的 crdt:<userId> 行，
    // 而这张表就是云端金库用的 user_vault_sync —— 同令牌本应只能动自己的排版。
    const owner = requireOwnerIdentity(tc);
    const input = SyncCrdtOperationsInput.parse(args ?? {});
    if (input.userId && input.userId !== owner) {
      return ok({
        merged: false,
        rejected: "identity-mismatch",
        error: "只能同步令牌归属人自己的排版：入参 userId 与令牌归属身份不一致。",
        hint: "去掉 userId 参数（服务端按令牌归属人写入），或改用该用户自己的个人令牌。",
      });
    }

    const crdtKey = "crdt:" + owner;
    const expectedVersion = input.expectedVersion;
    const maxRetries = 3;
    let finalOps: CRDTOperation[] = [];
    let reduced = reduceOperationsToState([]);
    for (let attempt = 0; attempt < maxRetries; attempt++) {
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
      finalOps = merged.length > 100 ? compactOperationLogs(merged) : merged;
      reduced = reduceOperationsToState(finalOps);

      const payloadStr = JSON.stringify({
        version: 1,
        operations: finalOps,
        state: reduced,
        updatedAt: Date.now(),
      });

      // 与 apps/api/src/routes/crdt.ts 同口径：条件写进 UPDATE 的 WHERE，而不是先读后写
      const precondition = attempt === 0 && expectedVersion !== undefined ? expectedVersion : existing?.version ?? 0;
      const saved = await ctx.repo.saveUserVaultIfUnchanged(crdtKey, payloadStr, precondition);
      if (saved.ok) {
        await ctx.repo.audit({
          actor: tc.actor,
          actorKind: "mcp",
          action: "crdt.sync",
          target: owner,
          diff: { clientOps: input.operations.length, totalOps: finalOps.length, version: saved.version },
        });
        return ok({
          merged: true,
          owner,
          version: saved.version,
          clientCount: input.operations.length,
          totalCount: finalOps.length,
          state: reduced,
        });
      }
      // 调用方显式声明了它看到的版本：冲突就不重试、更不覆盖，把云端现状原样回给它
      if (attempt === 0 && expectedVersion !== undefined) {
        const latest = await ctx.repo.getUserVault(crdtKey);
        return ok({
          merged: false,
          conflict: true,
          owner,
          currentVersion: latest?.version ?? null,
          error: "云端排版已被其它端推进到新版本，本次未写入。",
          hint: "先读回最新一版再合流；确认以本机日志为准时省略 expectedVersion 重试。",
        });
      }
    }

    // 重试仍撞在同一竞争窗口：如实报冲突。这里绝不退回无条件覆盖 —— 那正是本次修掉的行为。
    const latest = await ctx.repo.getUserVault(crdtKey);
    return ok({
      merged: false,
      conflict: true,
      owner,
      currentVersion: latest?.version ?? null,
      error: "并发写入使版本前置条件反复失败，本次未写入云端排版。",
      hint: "稍后重试，或先从云端拉取最新一版再合流。",
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
