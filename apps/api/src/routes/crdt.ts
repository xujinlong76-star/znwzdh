/**
 * CRDT 零冲突操作日志漫游
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { identityTrusted, identityOf, resolveCanonicalIdentity } from "./shared.ts";
import {
  compactOperationLogs,
  mergeOperationLogs,
  reduceOperationsToState,
  type CRDTOperation,
} from "@navhub/core";

import type { AppContext } from "../context.ts";

export const crdtRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* --------------------- CRDT 零冲突操作日志漫游网络 --------------------- */

  /**
   * 拉取当前身份的 CRDT 操作日志与最新折叠状态
   */
  app.get("/api/crdt/sync", { config: { scope: "public" } }, async (req, reply) => {
    const rawIdentity = identityOf(req as never);
    if (!rawIdentity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    // 合并后旧 id 仍会从旧标签页发来：不解析就会读到一个空日志
    const identity = await resolveCanonicalIdentity(ctx, rawIdentity);
    const crdtRecord = await ctx.repo.getUserVault("crdt:" + identity);
    let serverOps: CRDTOperation[] = [];
    if (crdtRecord?.payload) {
      try {
        const parsed = JSON.parse(crdtRecord.payload) as { operations?: CRDTOperation[] };
        if (Array.isArray(parsed.operations)) {
          serverOps = parsed.operations;
        }
      } catch { /* 容错 */ }
    }
    const state = reduceOperationsToState(serverOps);
    return { ok: true, operations: serverOps, state };
  });

  /**
   * 提交本地原子操作日志，与云端合流、压缩并返回最新全局状态（带 CAS 乐观锁重试防并发覆盖）
   */
  app.post("/api/crdt/sync", { config: { scope: "public" } }, async (req, reply) => {
    const rawIdentity = identityOf(req as never);
    if (!rawIdentity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    // 写入落 canonical：否则会在 `crdt:<旧id>` 另起一行孤儿日志
    const identity = await resolveCanonicalIdentity(ctx, rawIdentity);
    const body = z.object({
      operations: z.array(z.object({
        id: z.string(),
        type: z.enum([
          "SET_CATEGORY_PIN",
          "REORDER_CATEGORIES",
          "PIN_SITE_IN_CATEGORY",
          "UNPIN_SITE_IN_CATEGORY",
          "UPSERT_CUSTOM_CATEGORY",
          "DELETE_CUSTOM_CATEGORY",
          "UPSERT_CUSTOM_SITE",
          "DELETE_CUSTOM_SITE",
        ]),
        entityId: z.string(),
        payload: z.unknown(),
        timestamp: z.number(),
        clientId: z.string(),
      })).max(200),
    }).safeParse(req.body ?? {});

    if (!body.success) {
      reply.code(400);
      return { error: "参数无效", detail: body.error.issues };
    }

    const crdtKey = "crdt:" + identity;
    let finalOps: CRDTOperation[] = [];
    let reduced: ReturnType<typeof reduceOperationsToState> = {
      pinnedCategoryIds: [],
      categoryOrder: [],
      pinnedSiteIdsByCategory: {},
      // 自定义分类是数组（带 items 的树），不是 map——写成 {} 会让 typecheck 直接失败
      customCategories: [],
    };

    const maxRetries = 3;
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

      const merged = mergeOperationLogs(serverOps, body.data.operations as CRDTOperation[]);
      finalOps = merged.length > 100 ? compactOperationLogs(merged) : merged;
      reduced = reduceOperationsToState(finalOps);

      const payloadStr = JSON.stringify({
        version: 1,
        operations: finalOps,
        state: reduced,
        updatedAt: Date.now(),
      });

      const expectedVersion = existing?.version ?? 0;
      const saveRes = await ctx.repo.saveUserVaultIfUnchanged(crdtKey, payloadStr, expectedVersion);
      if (saveRes.ok) {
        break;
      }
      if (attempt === maxRetries - 1) {
        // 重试耗尽后的兜底保底写入
        await ctx.repo.saveUserVault(crdtKey, payloadStr);
      }
    }

    return {
      ok: true,
      operations: finalOps,
      state: reduced,
      mergedCount: body.data.operations.length,
      totalCount: finalOps.length,
    };
  });

  /**
   * 清除 CRDT 漫游日志
   */
  app.delete("/api/crdt/sync", { config: { scope: "public" } }, async (req, reply) => {
    const rawIdentity = identityOf(req as never);
    if (!rawIdentity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    const identity = await resolveCanonicalIdentity(ctx, rawIdentity);
    await ctx.repo.deleteUserVault("crdt:" + identity);
    return { ok: true };
  });

};
