import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.ts";

export function registerJobRoutes(app: FastifyInstance, ctx: AppContext): void {
  /* ------------------------ 任务队列管理 ------------------------ */

  // 注意：JobRunner 还支持 "site_self_healing"（见 jobs.ts），但不经 HTTP 暴露——
  // 自愈任务会触发网络抓取与站点改写，只允许由服务端内部调度，避免开放模式被滥用。
  const JOB_KIND_LIST = ["health_check", "refetch_metadata", "recompute_rank", "reindex"] as const;

  /** 入队（管理端 / 脚本用）。Runner 每 30s 自动消费。 */
  app.post("/api/jobs", { config: { rateLimit: { max: 30, timeWindow: "1 minute" }, scope: "write" } }, async (req, reply) => {
    const body = z.object({
      kind: z.enum(JOB_KIND_LIST),
      payload: z.record(z.unknown()).optional(),
    }).safeParse(req.body ?? {});
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
}
