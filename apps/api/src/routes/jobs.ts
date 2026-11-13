/**
 * 任务队列管理路由 (Task Queue Management Routes)
 *
 * 负责后台任务的入队、明细查询、状态取消、重试、历史修剪以及 SSE 实时事件推流。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { JobPayloadSchemas, JobPruneInput, RunJobInput, validateJobPayload } from "@navhub/core";
import { encodeKeysetCursor, jobKeysetValues } from "@navhub/store";

import type { AppContext } from "../context.ts";
import { scopeSatisfies } from "../auth.ts";
import { ADMIN_NOTIFICATION_IDENTITY } from "../notifications.ts";
import {
  jobEnqueueScope,
  jobEventBus,
  previewDataRetention,
  requestJobAbort,
  type DataRetentionPayload,
  type JobEventPayload,
} from "../jobs.ts";
import {
  badRequest,
  created,
  forbidden,
  notFound,
  parsePagination,
  setupSseStream,
} from "./shared.ts";

export const jobRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  app.get("/api/admin/notifications/deliveries", { config: { scope: "admin" } }, async (req, reply) => {
    const parsed = z.object({
      status: z.enum(["pending", "delivered", "deferred", "failed"]).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).max(100_000).default(0),
      // Keyset 游标（M12）：传了就走 WHERE (created_at,id) 谓词，不再 OFFSET；
      // nextCursor 随页返回，无下一页时为 null。
      cursor: z.string().max(4096).optional(),
    }).safeParse(req.query ?? {});
    if (!parsed.success) return badRequest(reply, "投递状态筛选无效", parsed.error.issues);
    reply.header("cache-control", "private, no-store");
    const result = await ctx.repo.listNotificationDeliveries(parsed.data);
    return { ...result, nextOffset: parsed.data.offset + result.items.length };
  });

  app.get("/api/admin/notifications", { config: { scope: "admin" } }, async (req, reply) => {
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 50 });
    const q = (req.query ?? {}) as Record<string, unknown>;
    // Keyset 游标（M12）：传了就走 WHERE (created_at,id) 谓词，不再 OFFSET。
    const cursor = typeof q.cursor === "string" && q.cursor ? q.cursor : undefined;
    const [page, unread] = await Promise.all([
      ctx.repo.listNotificationsPage(ADMIN_NOTIFICATION_IDENTITY, limit, offset, false, cursor),
      ctx.repo.countUnreadNotifications(ADMIN_NOTIFICATION_IDENTITY),
    ]);
    reply.header("cache-control", "private, no-store");
    return { ...page, unread, nextOffset: offset + page.items.length };
  });

  app.post("/api/admin/notifications/read-all", { config: { scope: "admin" } }, async () => ({
    ok: true,
    marked: await ctx.repo.markAllNotificationsRead(ADMIN_NOTIFICATION_IDENTITY),
  }));

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
      const payload = validateJobPayload(parsed.data.kind, parsed.data.payload);
      if (!payload.ok) {
        return badRequest(reply, "任务参数无效", payload.issues);
      }

      /**
       * 路由级别只能标一个 scope，而这条路由下既有常规巡检也有不可逆操作。
       * 破坏性 kind 在这里二次判权：write 令牌入队恢复/清空/真删 → 403。
       * 开放模式下匿名身份持有全部 scope，个人/NAS 部署行为不变。
       */
      const requiredScope = jobEnqueueScope(parsed.data.kind, payload.payload);
      if (!scopeSatisfies(req.auth.scopes, requiredScope)) {
        return forbidden(reply, `任务 ${parsed.data.kind} 需要 ${requiredScope} 权限（当前令牌不足）`);
      }
      if (requiredScope === "admin" && parsed.data.confirm !== true) {
        return badRequest(reply, "破坏性任务需要在请求体里显式 confirm: true");
      }

      const id = await ctx.repo.enqueueJob(parsed.data.kind, payload.payload);
      await ctx.repo.audit({
        ip: req.ip,
        actor: req.auth.actor,
        actorKind: req.auth.kind,
        action: requiredScope === "admin" ? "job.enqueue_destructive" : "job.enqueue",
        target: id,
        diff: { kind: parsed.data.kind, requiredScope },
      });

      return created(reply, { id, kind: parsed.data.kind });
    }
  );

  app.post(
    "/api/jobs/retention/preview",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" }, scope: "admin" } },
    async (req, reply) => {
      const parsed = JobPayloadSchemas.data_retention.safeParse(req.body ?? {});
      if (!parsed.success) return badRequest(reply, "保留策略参数无效", parsed.error.issues);
      const payload: DataRetentionPayload = { ...parsed.data, apply: false };
      const summary = await previewDataRetention(ctx, payload);
      await ctx.repo.audit({
        ip: req.ip,
        actor: req.auth.actor,
        actorKind: req.auth.kind,
        action: "job.retention_preview",
        target: "data_retention",
        diff: { mode: payload.mode ?? "rollup", apply: false },
      });
      return summary;
    },
  );

  /**
   * 分页筛选获取任务列表。
   *
   * 返回 `{ items, nextOffset, hasMore }` 而不是裸数组（P1-7）：任务历史是排查
   * 事故的主要入口，此前只有 limit、没有 offset —— 第 201 条以后的任务在 HTTP
   * 层完全不可达，只能直连数据库。多取一行来判定 hasMore，避免「最后一页恰好
   * 满页」时客户端还要再请求一次空页。排序带 id 第二键，保证同毫秒批量入队时
   * 翻页无重复、无遗漏。
   */
  app.get("/api/jobs", { config: { scope: "read" } }, async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });
    // Keyset 游标（M12）：`?cursor=` 走 WHERE (created_at,id) 谓词，不再 OFFSET；
    // nextCursor 随页返回，无下一页时为 null。无效游标由全局错误处理器映射成
    // 400 INVALID_CURSOR。
    const cursor = typeof q.cursor === "string" && q.cursor ? q.cursor : undefined;
    const rows = await ctx.repo.listJobs(q.status, limit + 1, offset, { cursor });
    const items = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    // 有余行就给 nextCursor（offset 页也给，客户端可以从第 1 页直接切到游标翻页）。
    const last = hasMore ? items[items.length - 1] : undefined;
    return {
      items,
      nextOffset: offset + items.length,
      hasMore,
      nextCursor: last ? encodeKeysetCursor(jobKeysetValues(last)) : null,
    };
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
   * 取消任务（仅处于 pending 或 running 状态的任务可被取消）。
   *
   * 返回值是**真实结果**而不是一律 "cancelled"，三种情况语义不同：
   *   - "cancelled"  pending，没有执行体可等，已直接落终态；
   *   - "cancelling" running，执行体还在跑，此刻停在「已要求停手」；
   *   真正的 cancelled 由 Runner 在 handler 于分片边界确认停手后写入；
   *   - null         已是终态，两条 UPDATE 都不命中，什么事都没做。
   */
  app.post("/api/jobs/:id/cancel", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = await ctx.repo.getJob(id);
    if (!job) {
      return notFound(reply, "任务不存在");
    }

    const result = await ctx.repo.cancelJob(id);

    /**
     * 终态任务：如实回「没做任何事」，不要回 200 + 一个看起来成功的消息。
     * 旧实现无条件 emit status:"cancelled" 并返回 status:"cancelled"，于是管理端
     * 对一个已经 done 的任务也会显示「已取消」——这正是 P1-4 要治的假状态。
     */
    if (!result) {
      reply.code(409);
      return {
        error: "JOB_NOT_CANCELLABLE",
        message: `任务状态为 ${job.status}，已处于终态，未做任何变更`,
        id,
        status: job.status,
      };
    }

    /**
     * 立刻中止本进程的执行体（如果有）。
     *
     * 为什么必须补这一句：库状态改成 cancelling 只是「登记了要求」，handler 自己
     * 并不会看库——它只在分片边界读 AbortSignal 与截止时间。少了这一句，同进程
     * 按取消后执行体要等下一次任务心跳（默认 60s）读到 cancelling 才停；对没有
     * 分片让出的 handler，那就是「界面说已取消、库里还在写」。
     *
     * 返回 false 表示本进程没有它的执行体（别的实例在跑），那种情况下只能靠对方
     * 的心跳发现——这是跨实例的固有时延，不是缺陷，但要如实区分开。
     */
    const abortedLocally = requestJobAbort(id, "cancelled");

    /**
     * emit 与响应都按真实状态走：running 的任务此刻是 cancelling，写 cancelled
     * 等于给前端一个还没发生的终态（管理端会立刻给出「重试」入口，而重试会和
     * 仍在跑的执行体并发写同一批数据）。
     */
    jobEventBus.emitJobUpdate({
      jobId: id,
      kind: job.kind,
      status: result,
      attempts: job.attempts,
      timestamp: Date.now(),
    });

    await ctx.repo.audit({
      ip: req.ip,
      actor: req.auth.actor,
      actorKind: req.auth.kind,
      action: "job.cancel",
      target: id,
      diff: { kind: job.kind, result, abortedLocally },
    });

    return { ok: true, id, status: result, abortedLocally };
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
    // 仓储层的 CAS 会兜住并发，但这里先给出明确原因：
    // pending/running 重试会清零 attempts 或造成双跑，done 重试会抹掉历史结果。
    if (job.status !== "failed" && job.status !== "cancelled") {
      reply.code(409);
      return { error: "JOB_NOT_RETRYABLE", message: `任务状态为 ${job.status}，仅失败或已取消的任务可重试` };
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
    const parsed = JobPruneInput.safeParse(req.body ?? {});

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
      target: "jobs",
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

    let cleaned = false;
    let heartbeat: NodeJS.Timeout | null = null;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      jobEventBus.off("job", onJob);
    };

    const onJob = (payload: JobEventPayload) => {
      try {
        reply.raw.write(`event: job\ndata: ${JSON.stringify(payload)}\n\n`);
      } catch {
        cleanup();
      }
    };

    jobEventBus.on("job", onJob);

    heartbeat = setInterval(() => {
      try {
        reply.raw.write(": ping\n\n");
      } catch {
        cleanup();
      }
    }, 15_000);

    req.raw.on("close", cleanup);
  });

  /**
   * 单任务实时 SSE 事件流（用于客户端追踪特定任务的完成状态）
   */
  app.get("/api/jobs/:id/events", { config: { scope: "read" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    setupSseStream(reply);
    reply.raw.write(": connected\n\n");

    let cleaned = false;
    let heartbeat: NodeJS.Timeout | null = null;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      jobEventBus.off(`job:${id}`, onJobUpdate);
    };

    const onJobUpdate = (payload: JobEventPayload) => {
      try {
        reply.raw.write(`event: update\ndata: ${JSON.stringify(payload)}\n\n`);
        if (payload.status === "completed" || payload.status === "failed") {
          cleanup();
          reply.raw.end();
        }
      } catch {
        cleanup();
      }
    };

    jobEventBus.on(`job:${id}`, onJobUpdate);

    heartbeat = setInterval(() => {
      try {
        reply.raw.write(": ping\n\n");
      } catch {
        cleanup();
      }
    }, 15_000);

    req.raw.on("close", cleanup);
  });
};
