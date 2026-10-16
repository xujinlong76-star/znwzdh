/**
 * 任务域工具：入队 / 查询后台任务。
 * run_job 需要 admin（会触发全站扫描）；list_jobs 只需 read。
 */
import { ListJobsInput, RunJobInput, requireScope, type ToolContext } from "../tools.ts";
import { ok, type Handler, type HandlerDeps } from "./shared.ts";

export const jobHandlers = {
  async run_job(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    // run_job 需要 admin：它会触发全站扫描（健康巡检/重算/重建索引）
    requireScope(tc, "admin");
    const input = RunJobInput.parse(args ?? {});
    const jobId = await ctx.repo.enqueueJob(input.kind, input.payload ?? {});
    await ctx.repo.audit({ actor: tc.actor, actorKind: "mcp", action: "job.enqueue", target: jobId, diff: { kind: input.kind, payload: input.payload ?? {} } });
    return ok({ queued: true, jobId, kind: input.kind, note: "任务已入队，Runner 会在 30 秒内执行。用 list_jobs 工具（或 GET /api/jobs）查询执行状态。" });
  },

  /**
   * 查询任务队列。
   *
   * run_job 的返回里写着「查询执行状态」，此前那是唯一提示、且指向 REST 端点 ——
   * 对只接 MCP 的 Agent 来说够不着：它拿到 jobId 却没有任何办法确认任务跑没跑、为什么失败。
   * 这里补上同一能力的工具入口（只读，按创建时间倒序）。
   */
  async list_jobs(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    requireScope(tc, "read");
    const input = ListJobsInput.parse(args ?? {});
    const jobs = await ctx.repo.listJobs(input.status, input.limit);
    return ok({ count: jobs.length, jobs });
  },
} satisfies Record<string, Handler>;
