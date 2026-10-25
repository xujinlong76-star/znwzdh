/**
 * E2EE 零知识云端金库同步
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {identityTrusted, resolveCanonicalIdentity, requestIdentityOf, userDomainWriteAllowed } from "./shared.ts";

import type { AppContext } from "../context.ts";

export const vaultRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* ------------------- E2EE 零知识云端金库同步 ------------------- */

  /**
   * 读云端密文金库。服务端零知识存储，永不触碰明文。
   */
  app.get("/api/vault/sync", async (req, reply) => {
    const rawIdentity = requestIdentityOf(req as never);
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
    const rawIdentity = requestIdentityOf(req as never);
    // 个人令牌写守卫（T20）：自建令牌 v1 只发 read，写自己的数据需 write scope
    if (!userDomainWriteAllowed(req as never)) { reply.code(403); return { error: "当前令牌为只读，无法执行写操作" }; }
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
      /**
       * current === null 有两种完全不同的成因，不能合并成同一句话：
       *  - 云端金库被另一台设备清除（或已在别处注销）→ 本地版本号指向一份**已经不存在的**备份；
       *  - 云端仍有金库但版本号被推进 → 真正的「多端并发写冲突」。
       * 旧实现统一回「已被其它设备更新」，前者会被引向「先拉取最新」——而云端根本没有
       * 可拉取的内容，用户会在空循环里反复失败（WCAG 3.3.1 错误识别 / 3.3.3 纠正建议）。
       */
      if (!result.current) {
        return {
          error: "云端金库已被清除：本机版本号对应的云端备份已不存在",
          code: "VAULT_CLEARED",
          current: null,
          hint: "如确认以本机配置重建云端金库，请以 version=0（表示期望云端为空）重新推送；重建后的第一版是 v1",
        };
      }
      return {
        error: "版本冲突：云端金库已被其它设备更新",
        code: "VERSION_CONFLICT",
        current: result.current,
        hint: "请先从云端拉取并合并最新内容，再以返回的版本号重新推送",
      };
    }
    reply.header("etag", `"${result.version}"`);
    return { ok: true, version: result.version, updatedAt: result.updatedAt };
  });

  /**
   * 清除云端金库。
   */
  app.delete("/api/vault/sync", async (req, reply) => {
    const rawIdentity = requestIdentityOf(req as never);
    // 个人令牌写守卫（T20）：自建令牌 v1 只发 read，写自己的数据需 write scope
    if (!userDomainWriteAllowed(req as never)) { reply.code(403); return { error: "当前令牌为只读，无法执行写操作" }; }
    if (!rawIdentity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    const identity = await resolveCanonicalIdentity(ctx, rawIdentity);
    // 删除前先读现状：审计要能回答「真删到了东西吗」，而不是只记一次调用。
    const existing = await ctx.repo.getUserVault(identity);
    await ctx.repo.deleteUserVault(identity);
    // 金库是硬删且不可撤销，属于 /me/activity 必须能看到的动作；
    // 审计写入失败不影响主操作（仓储 audit() 自带 try/catch）。
    await ctx.repo.audit({
      ip: req.ip,
      actor: identity,
      actorKind: "user",
      action: "vault.delete",
      target: "vault",
      diff: { hadVault: Boolean(existing), version: existing?.version ?? null },
    });
    // 回执只说这次调用做了什么：deleted=false 表示云端本来就没有备份。
    // 客户端若一律说「已删除你的云端备份」，用户会以为自己拥有一份其实从未存在的备份。
    return { ok: true, deleted: Boolean(existing) };
  });

};
