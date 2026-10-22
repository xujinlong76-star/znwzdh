/**
 * E2EE 零知识云端金库同步
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { identityTrusted, identityOf, resolveCanonicalIdentity } from "./shared.ts";

import type { AppContext } from "../context.ts";

export const vaultRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* ------------------- E2EE 零知识云端金库同步 ------------------- */

  /**
   * 读云端密文金库。服务端零知识存储，永不触碰明文。
   */
  app.get("/api/vault/sync", async (req, reply) => {
    const rawIdentity = identityOf(req as never);
    if (!rawIdentity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    // 身份合并后的旧 id 必须解析到 canonical：否则金库看起来「丢了」
    const identity = await resolveCanonicalIdentity(ctx, rawIdentity);
    const vault = await ctx.repo.getUserVault(identity);
    return { ok: true, vault };
  });

  /**
   * 推送密文金库到云端中枢。
   *
   * 可选前置条件：body.version 或 `If-Match: "<version>"`（也接受裸数字 / W/ 前缀）。
   * 带上时只有云端仍是这一版才写入，否则回 409 并把最新版本交回客户端。
   * 不带时保持旧行为（无条件覆盖），兼容已有扩展与旧客户端。
   */
  app.put("/api/vault/sync", async (req, reply) => {
    const rawIdentity = identityOf(req as never);
    if (!rawIdentity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    // 写入同样落 canonical：旧 id 推上来的密文不能另起一行
    const identity = await resolveCanonicalIdentity(ctx, rawIdentity);
    const body = z.object({
      payload: z.string().min(1).max(512 * 1024),
      version: z.number().int().min(0).optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }

    const ifMatch = req.headers["if-match"];
    let headerVersion = NaN;
    if (typeof ifMatch === "string") {
      const match = ifMatch.trim().match(/^(?:W\/)?"?(\d+)"?$/);
      if (match) {
        headerVersion = Number(match[1]);
      }
    }
    const expected = body.data.version ?? (Number.isFinite(headerVersion) ? headerVersion : undefined);

    if (expected === undefined) {
      const result = await ctx.repo.saveUserVault(identity, body.data.payload);
      return { ok: true, ...result };
    }

    const result = await ctx.repo.saveUserVaultIfUnchanged(identity, body.data.payload, expected);
    if (!result.ok) {
      reply.code(409);
      if (result.current) reply.header("etag", `"${result.current.version}"`);
      return {
        error: "版本冲突：云端金库已被其它设备更新",
        current: result.current,
      };
    }
    reply.header("etag", `"${result.version}"`);
    return { ok: true, version: result.version, updatedAt: result.updatedAt };
  });

  /**
   * 清除云端金库。
   */
  app.delete("/api/vault/sync", async (req, reply) => {
    const rawIdentity = identityOf(req as never);
    if (!rawIdentity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    const identity = await resolveCanonicalIdentity(ctx, rawIdentity);
    await ctx.repo.deleteUserVault(identity);
    return { ok: true };
  });

};
