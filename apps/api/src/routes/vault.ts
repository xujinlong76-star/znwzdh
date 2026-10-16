/**
 * E2EE 零知识云端金库同步
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { identityOf } from "./shared.ts";

import type { AppContext } from "../context.ts";

export const vaultRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* ------------------- E2EE 零知识云端金库同步 ------------------- */

  /**
   * 读云端密文金库。服务端零知识存储，永不触碰明文。
   */
  app.get("/api/vault/sync", async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    const vault = await ctx.repo.getUserVault(identity);
    return { ok: true, vault };
  });

  /**
   * 推送密文金库到云端中枢。
   */
  app.put("/api/vault/sync", async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
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
    await ctx.repo.deleteUserVault(identity);
    return { ok: true };
  });

};
