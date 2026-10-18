/**
 * 前端错误上报（P2-5）。
 *
 * 设计要点：
 *   - **隐私优先**：只收 kind（前端已分类）+ pathname + digest + 消息指纹
 *     （SHA-256 前 12 位，见前端 `lib/client-error-report.ts`）。
 *     不收 URL query、不收错误原文、不收任何身份标识——错误消息里可能
 *     夹带用户输入，指纹足够做去重与关联。
 *   - **绝不阻断**：写入失败静默（与 /api/vitals 一致的容错语义），
 *     调用方（sendBeacon）本就是 fire-and-forget。
 *   - **去重在服务端**：同一指纹 count 累计，避免一次 ChunkLoadError
 *     风暴把 events 表写爆（聚合实现见 ../client-errors.ts）。
 *   - **看板**：GET /api/admin/client-errors 给聚合视图（分 kind 计数 +
 *     最近条目），后台「前端错误」卡片消费它。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.ts";
import { CLIENT_ERROR_KINDS, ClientErrorStore } from "../client-errors.ts";

/** 指纹格式：12 位小写十六进制（前端 SHA-256 截断） */
const FINGERPRINT = /^[0-9a-f]{12}$/;

export const clientErrorRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;
  const store = new ClientErrorStore();

  app.post("/api/errors", { config: { scope: "public" } }, async (req, reply) => {
    const body = z
      .object({
        kind: z.enum(CLIENT_ERROR_KINDS),
        fingerprint: z.string().regex(FINGERPRINT),
        /**
         * pathname only（`/hot`）。带 `?` 一律 400：query 里可能有用户内容，
         * 契约要求它根本不离开浏览器；收到带 query 的 path 说明客户端违规。
         */
        path: z.string().max(200).refine((v) => !v.includes("?"), "path 不含 query").optional(),
        digest: z.string().max(64).optional(),
      })
      .safeParse(req.body ?? {});
    if (!body.success) {
      reply.code(400);
      return { error: "参数无效", detail: body.error.issues };
    }

    const { kind, fingerprint, path, digest } = body.data;
    const entry = store.record({ kind, fingerprint, path: path ?? null, digest: digest ?? null });

    // 明细入 events 表（长期审计）；失败静默——上报链路不能影响主站
    await ctx.repo
      .recordEvent("client_error", {
        meta: { kind, fingerprint, path: path ?? null, digest: digest ?? null, count: entry.count },
      })
      .catch(() => undefined);

    reply.code(204);
    return null;
  });

  app.get("/api/admin/client-errors", { config: { scope: "admin" } }, async (req) => {
    await ctx.repo.audit({
      ip: req.ip,
      actor: req.auth.actor,
      actorKind: req.auth.kind,
      action: "client_errors.view",
      target: "client-errors",
    }).catch(() => undefined);
    return { ...store.summary(20), retention: "process-memory" };
  });

  /** 测试 / 运维用：清空聚合（不清 events 表） */
  app.delete("/api/admin/client-errors", { config: { scope: "admin" } }, async (req) => {
    store.clear();
    await ctx.repo.audit({
      ip: req.ip,
      actor: req.auth.actor,
      actorKind: req.auth.kind,
      action: "client_errors.clear",
      target: "client-errors",
    }).catch(() => undefined);
    return { ok: true };
  });
};
