import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  generateToken,
  hashToken,
  parseScopes,
} from "../auth.ts";
import type { AppContext } from "../context.ts";

export function registerTokenRoutes(app: FastifyInstance, ctx: AppContext): void {
  /* ------------------------ API Token 管理 ------------------------ */
  /**
   * token 是鉴权体系的入口，因此创建/列出/删除全部要求 admin。
   * 明文只在创建响应里返回一次，库里只有 sha256 —— 之后无法再取回。
   *
   * 首次启用鉴权的引导路径：
   *   NAVHUB_AUTH_REQUIRED=true NAVHUB_BOOTSTRAP_TOKEN=<自定义串> 启动
   *   → 用该串作为 Bearer 调 POST /api/tokens 建正式 token
   *   → 删除 NAVHUB_BOOTSTRAP_TOKEN 重启
   */
  app.post("/api/tokens", { config: { scope: "admin" } }, async (req, reply) => {
    const body = z.object({
      name: z.string().min(1).max(64),
      /** 逗号分隔：read / write / admin；默认只读 */
      scopes: z.string().default("read"),
      /** 过期时间（毫秒时间戳）；不传则长期有效 */
      expiresAt: z.number().int().positive().nullable().optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }

    const scopes = parseScopes(body.data.scopes);
    if (scopes.length === 0) { reply.code(400); return { error: "scopes 至少要有一个有效值（read / write / admin）" }; }

    const raw = generateToken();
    const record = await ctx.repo.createApiToken({
      name: body.data.name,
      tokenHash: hashToken(raw),
      scopes: scopes.join(","),
      expiresAt: body.data.expiresAt ?? null,
    });
    await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "token.create", target: record.id, diff: { name: record.name, scopes } });
    reply.code(201);
    // 明文只在这里出现一次
    return { token: raw, ...record, note: "请立即保存：明文只显示这一次，库里只存 sha256。" };
  });

  app.get("/api/tokens", { config: { scope: "admin" } }, async () => ctx.repo.listApiTokens());

  app.delete("/api/tokens/:id", { config: { scope: "admin" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await ctx.repo.deleteApiToken(id);
    await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "token.delete", target: id });
    reply.code(204);
    return null;
  });
}
