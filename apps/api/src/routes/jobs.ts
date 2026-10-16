/**
 * 任务队列管理
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { RunJobInput } from "@navhub/core";

import type { AppContext } from "../context.ts";
import { jobEventBus, type JobEventPayload } from "../jobs.ts";

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

  /**
   * 全量任务实时 SSE 事件流（控制台与运维仪表盘用）
   */
  app.get("/api/jobs/stream", { config: { scope: "read" } }, async (req, reply) => {
    reply.hijack();
    reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("X-Accel-Buffering", "no");
    reply.raw.flushHeaders?.();

    reply.raw.write(": connected\n\n");

    const onJob = (payload: JobEventPayload) => {
      try {
        reply.raw.write(`event: job\ndata: ${JSON.stringify(payload)}\n\n`);
      } catch {
        // 连接可能已关闭
      }
    };

    jobEventBus.on("job", onJob);

    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(": ping\n\n");
      } catch {
        // ignore
      }
    }, 15_000);

    req.raw.on("close", () => {
      clearInterval(heartbeat);
      jobEventBus.off("job", onJob);
    });
  });

  /**
   * 单任务实时 SSE 事件流（客户端追踪特定任务生命周期用）
   */
  app.get("/api/jobs/:id/events", { config: { scope: "read" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.hijack();
    reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("X-Accel-Buffering", "no");
    reply.raw.flushHeaders?.();

    reply.raw.write(": connected\n\n");

    const onJobUpdate = (payload: JobEventPayload) => {
      try {
        reply.raw.write(`event: update\ndata: ${JSON.stringify(payload)}\n\n`);
        if (payload.status === "completed" || payload.status === "failed") {
          reply.raw.end();
        }
      } catch {
        // 连接可能已关闭
      }
    };

    jobEventBus.on(`job:${id}`, onJobUpdate);

    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(": ping\n\n");
      } catch {
        // ignore
      }
    }, 15_000);

    req.raw.on("close", () => {
      clearInterval(heartbeat);
      jobEventBus.off(`job:${id}`, onJobUpdate);
    });
  });
};
