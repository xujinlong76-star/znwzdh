/**
 * 任务队列管理
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { RunJobInput } from "@navhub/core";

import type { AppContext } from "../context.ts";

export const jobRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* ------------------------ 任务队列管理 ------------------------ */

  /** 入队（管理端 / 脚本用）。Runner 每 30s 自动消费。 */
  app.post("/api/jobs", { config: { rateLimit: { max: 30, timeWindow: "1 minute" }, scope: "write" } }, async (req, reply) => {
    const body = RunJobInput.safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const id = await ctx.repo.enqueueJob(body.data.kind, body.data.payload ?? {});
    await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "job.enqueue", target: id, diff: { kind: body.data.kind } });
    reply.code(201);
    return { id, kind: body.data.kind };
  });

  app.get("/api/jobs", { config: { scope: "read" } }, async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const limit = Math.min(Number(q.limit) || 50, 200);
    return ctx.repo.listJobs(q.status, limit);
  });

};
