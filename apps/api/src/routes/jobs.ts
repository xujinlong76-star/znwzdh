/**
 * 任务队列管理路由 (Task Queue Management Routes)
 *
 * 负责后台任务的入队、明细查询、状态取消、重试、历史修剪以及 SSE 实时事件推流。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { RunJobInput } from "@navhub/core";

import type { AppContext } from "../context.ts";
import { jobEventBus, type JobEventPayload } from "../jobs.ts";
import {
  badRequest,
  created,
  notFound,
  parsePagination,
  setupSseStream,
} from "./shared.ts";

export const jobRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* ------------------------------------------------------------------ *
   * 任务队列查询与入队
   * ------------------------------------------------------------------ */

  /**
   * 手动派发任务入队（管理端 / 运维脚本使用）。后台 Runner 轮询消费。
   */
  app.post(
    "/api/jobs",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" }, scope: "write" } },
    async (req, reply) => {
      const parsed = RunJobInput.safeParse(req.body ?? {});
      if (!parsed.success) {
        return badRequest(reply, "参数无效", parsed.error.issues);
      }

      const id = await ctx.repo.enqueueJob(parsed.data.kind, parsed.data.payload ?? {});
      await ctx.repo.audit({
        ip: req.ip,
        actor: req.auth.actor,
        actorKind: req.auth.kind,
        action: "job.enqueue",
        target: id,
        diff: { kind: parsed.data.kind },
      });

      return created(reply, { id, kind: parsed.data.kind });
    }
  );

  /**
   * 分页筛选获取任务列表
   */
  app.get("/api/jobs", { config: { scope: "read" } }, async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const { limit } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });
    return ctx.repo.listJobs(q.status, limit);
  });

  /**
   * 获取单个任务详情
   */
  app.get("/api/jobs/:id", { config: { scope: "read" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = await ctx.repo.getJob(id);
    if (!job) {
      return notFound(reply, "任务不存在");
    }
    return job;
  });

  /* ------------------------------------------------------------------ *
   * 任务生命周期控制（取消 / 重试 / 清理）
   * ------------------------------------------------------------------ */

  /**
   * 取消任务（仅处于 pending 或 running 状态的任务可被取消）
   */
  app.post("/api/jobs/:id/cancel", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = await ctx.repo.getJob(id);
    if (!job) {
      return notFound(reply, "任务不存在");
    }

    await ctx.repo.cancelJob(id);
    jobEventBus.emitJobUpdate({
      jobId: id,
      kind: job.kind,
      status: "cancelled",
      attempts: job.attempts,
      timestamp: Date.now(),
    });

    await ctx.repo.audit({
      ip: req.ip,
      actor: req.auth.actor,
      actorKind: req.auth.kind,
      action: "job.cancel",
      target: id,
      diff: { kind: job.kind },
    });

    return { ok: true, id, status: "cancelled" };
  });

  /**
   * 重试任务（针对失败或已取消的任务，重置状态为 pending 并允许立即重新认领）
   */
  app.post("/api/jobs/:id/retry", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = await ctx.repo.getJob(id);
    if (!job) {
      return notFound(reply, "任务不存在");
    }

    const retried = await ctx.repo.retryJob(id);
    jobEventBus.emitJobUpdate({
      jobId: id,
      kind: job.kind,
      status: "pending",
      attempts: 0,
      timestamp: Date.now(),
    });

    await ctx.repo.audit({
      ip: req.ip,
      actor: req.auth.actor,
      actorKind: req.auth.kind,
      action: "job.retry",
      target: id,
      diff: { kind: job.kind },
    });

    return { ok: true, job: retried };
  });

  /**
   * 批量修剪历史终态任务（清除已完成、已失败或已取消的任务）
   */
  app.post("/api/jobs/prune", { config: { scope: "admin" } }, async (req, reply) => {
    const parsed = z
      .object({
        olderThanDays: z.number().int().min(0).max(365).default(7),
        statuses: z.array(z.string()).default(["done", "failed", "cancelled"]),
      })
      .safeParse(req.body ?? {});

    if (!parsed.success) {
      return badRequest(reply, "参数无效", parsed.error.issues);
    }

    const { olderThanDays, statuses } = parsed.data;
    const result = await ctx.repo.pruneJobs(olderThanDays, statuses);

    await ctx.repo.audit({
      ip: req.ip,
      actor: req.auth.actor,
      actorKind: req.auth.kind,
      action: "job.prune",
      diff: { olderThanDays, statuses, ...result },
    });

    return { ok: true, pruned: result.pruned, olderThanDays };
  });

  /* ------------------------------------------------------------------ *
   * SSE 实时事件推流通道
   * ------------------------------------------------------------------ */

  /**
   * 全量任务实时 SSE 事件流（控制台与运维仪表盘使用）
   */
  app.get("/api/jobs/stream", { config: { scope: "read" } }, async (req, reply) => {
    setupSseStream(reply);
    reply.raw.write(": connected\n\n");

    const onJob = (payload: JobEventPayload) => {
      try {
        reply.raw.write(`event: job\ndata: ${JSON.stringify(payload)}\n\n`);
      } catch {
        // 客户端连接中断容错
      }
    };

    jobEventBus.on("job", onJob);

    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(": ping\n\n");
      } catch {
        // 心跳容错
      }
    }, 15_000);

    req.raw.on("close", () => {
      clearInterval(heartbeat);
      jobEventBus.off("job", onJob);
    });
  });

  /**
   * 单任务实时 SSE 事件流（用于客户端追踪特定任务的完成状态）
   */
  app.get("/api/jobs/:id/events", { config: { scope: "read" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    setupSseStream(reply);
    reply.raw.write(": connected\n\n");

    const onJobUpdate = (payload: JobEventPayload) => {
      try {
        reply.raw.write(`event: update\ndata: ${JSON.stringify(payload)}\n\n`);
        if (payload.status === "completed" || payload.status === "failed") {
          reply.raw.end();
        }
      } catch {
        // 连接关闭容错
      }
    };

    jobEventBus.on(`job:${id}`, onJobUpdate);

    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(": ping\n\n");
      } catch {
        // 心跳容错
      }
    }, 15_000);

    req.raw.on("close", () => {
      clearInterval(heartbeat);
      jobEventBus.off(`job:${id}`, onJobUpdate);
    });
  });
};
