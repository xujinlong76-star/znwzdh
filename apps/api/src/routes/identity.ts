import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  compactOperationLogs,
  mergeOperationLogs,
  reduceOperationsToState,
  type CRDTOperation,
} from "@navhub/core";
import type { AppContext } from "../context.ts";
import { resetUserProfile } from "../profile-service.ts";
import { identityAllowed, identityOf } from "./shared.ts";

export function registerIdentityRoutes(app: FastifyInstance, ctx: AppContext): void {
  const favoriteInput = z.object({
    siteId: z.string().min(1),
    folderId: z.string().nullable().optional(),
    note: z.string().max(200).nullable().optional(),
  });

  /* --------------------- 收藏夹（终端用户） --------------------- */

  /**
   * 身份由调用方传入（登录用户的 canonical userId，或前端 localStorage 里的 anonId）。
   * 说明：这是个人导航站的轻量方案——不引入终端用户鉴权体系；
   * 多用户公开场景应改为 Bearer token（api_tokens 表已具备能力）。
   */


  app.get("/api/favorites", async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) return { error: "缺少 userId 或 anonId" };
    if (!identityAllowed(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    const items = await ctx.repo.listFavorites(identity);
    const folders = await ctx.repo.listFavoriteFolders(identity);
    // 批量取站点（同 runSearch 的 N+1 优化）
    const favSiteMap = await ctx.repo.getSitesByIds(items.map((f) => f.siteId));
    const sites = items.map((f) => favSiteMap.get(f.siteId) ?? null);
    return {
      items: items.map((f, i) => ({ ...f, site: sites[i] })),
      folders,
    };
  });

  app.post("/api/favorites", async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    if (!identityAllowed(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    const body = favoriteInput.safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const site = await ctx.repo.getSite(body.data.siteId);
    if (!site) { reply.code(404); return { error: "站点不存在" }; }
    const { favorite, existed } = await ctx.repo.addFavorite({
      userId: identity,
      siteId: body.data.siteId,
      folderId: body.data.folderId ?? null,
      note: body.data.note ?? null,
    });
    await ctx.repo.recordEvent("favorite", { siteId: body.data.siteId, meta: { identity } }).catch(() => undefined);
    reply.code(existed ? 200 : 201);
    return { favorite, existed };
  });

  app.delete("/api/favorites/:siteId", async (req, reply) => {
    const { siteId } = req.params as { siteId: string };
    const identity = identityOf(req as never);
    if (!identity) return { error: "缺少 userId 或 anonId" };
    if (!identityAllowed(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    const removed = await ctx.repo.removeFavorite(identity, siteId);
    if (removed) {
      await ctx.repo.recordEvent("unfavorite", { siteId, meta: { identity } }).catch(() => undefined);
    }
    return { ok: true, removed };
  });

  app.post("/api/favorites/folders", async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    if (!identityAllowed(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    const body = z.object({ name: z.string().min(1).max(30) }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const folder = await ctx.repo.createFavoriteFolder(identity, body.data.name);
    reply.code(201);
    return folder;
  });

  app.delete("/api/favorites/folders/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const identity = identityOf(req as never);
    if (!identity) return { error: "缺少 userId 或 anonId" };
    if (!identityAllowed(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    await ctx.repo.deleteFavoriteFolder(identity, id);
    return { ok: true };
  });

  /* ------------------------ 搜索历史 ------------------------ */

  app.get("/api/search-history", async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) return { items: [] };
    if (!identityAllowed(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    const q = (req.query ?? {}) as Record<string, string>;
    const limit = Math.min(Number(q.limit) || 10, 50);
    return { items: await ctx.repo.listSearchHistory(identity, limit) };
  });

  app.delete("/api/search-history", async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) return { ok: false, error: "缺少 userId 或 anonId" };
    if (!identityAllowed(ctx, req as never)) { reply.code(401); return { ok: false, error: "需要 Bearer token" }; }
    await ctx.repo.clearSearchHistory(identity);
    return { ok: true };
  });

  /* --------------------- 个性化画像（「我的偏好」） --------------------- */

  /** 读画像：让终端用户看到「系统据我的行为推断出了什么」——可解释性即信任 */
  app.get("/api/profile", async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) return { error: "缺少 userId 或 anonId" };
    if (!identityAllowed(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    return { profile: await ctx.repo.getUserProfile(identity) };
  });

  /**
   * 重置画像：清 user_profiles + 该身份的行为事件（画像是从中聚合的）。
   * 收藏夹与搜索历史保留——那是用户自己的数据，不是被推断的偏好。
   */
  app.delete("/api/profile", async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) return { ok: false, error: "缺少 userId 或 anonId" };
    if (!identityAllowed(ctx, req as never)) { reply.code(401); return { ok: false, error: "需要 Bearer token" }; }
    const result = await resetUserProfile(ctx, identity);
    return { ok: true, ...result };
  });

  /* ------------------- E2EE 零知识云端金库同步 ------------------- */

  /**
   * 读云端密文金库。服务端零知识存储，永不触碰明文。
   */
  app.get("/api/vault/sync", async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    if (!identityAllowed(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    const vault = await ctx.repo.getUserVault(identity);
    return { ok: true, vault };
  });

  /**
   * 推送密文金库到云端中枢。
   */
  app.put("/api/vault/sync", async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    if (!identityAllowed(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    const body = z.object({
      payload: z.string().min(1).max(512 * 1024),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const result = await ctx.repo.saveUserVault(identity, body.data.payload);
    return { ok: true, ...result };
  });

  /**
   * 清除云端金库。
   */
  app.delete("/api/vault/sync", async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    if (!identityAllowed(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    await ctx.repo.deleteUserVault(identity);
    return { ok: true };
  });

  /* --------------------- CRDT 零冲突操作日志漫游网络 --------------------- */

  /**
   * 拉取当前身份的 CRDT 操作日志与最新折叠状态
   */
  app.get("/api/crdt/sync", { config: { scope: "public" } }, async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    if (!identityAllowed(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
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
   * 提交本地原子操作日志，与云端合流、压缩并返回最新全局状态
   */
  app.post("/api/crdt/sync", { config: { scope: "public" } }, async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    if (!identityAllowed(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
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
    const finalOps = merged.length > 100 ? compactOperationLogs(merged) : merged;
    const reduced = reduceOperationsToState(finalOps);

    await ctx.repo.saveUserVault(crdtKey, JSON.stringify({
      version: 1,
      operations: finalOps,
      state: reduced,
      updatedAt: Date.now(),
    }));

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
    const identity = identityOf(req as never);
    if (!identity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    if (!identityAllowed(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    await ctx.repo.deleteUserVault("crdt:" + identity);
    return { ok: true };
  });

  /* --------------------- 终端用户身份同步 --------------------- */

  /**
   * OAuth 登录后由 Web 前端调用：把 GitHub 身份 upsert 进 users 表，
   * 返回 canonical userId（后续收藏夹 / 画像都用它，保证多端一致）。
   */
  app.post("/api/users/sync", async (req, reply) => {
    // 身份伪造面：开放模式保持历史行为；开启鉴权后必须带有效 token，
    // 否则任意调用方可冒用任意 provider:providerId 写入 users 表。
    if (!identityAllowed(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    const body = z.object({
      provider: z.string().min(1).default("github"),
      providerId: z.string().min(1),
      username: z.string().min(1).max(64),
      email: z.string().email().nullable().optional(),
      avatar: z.string().url().nullable().optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const user = await ctx.repo.upsertOauthUser({
      id: body.data.provider + ":" + body.data.providerId,
      username: body.data.username,
      email: body.data.email ?? null,
      avatar: body.data.avatar ?? null,
    });
    return user;
  });
}
