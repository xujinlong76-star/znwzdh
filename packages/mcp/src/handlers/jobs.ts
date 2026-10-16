/**
 * 任务域工具：入队后台任务。run_job 需要 admin（会触发全站扫描）。
 */
import { RunJobInput, requireScope, type ToolContext } from "../tools.ts";
import { ok, type Handler, type HandlerDeps } from "./shared.ts";

export const jobHandlers = {
  async run_job(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    // run_job 需要 admin：它会触发全站扫描（健康巡检/重算/重建索引）
    requireScope(tc, "admin");
    const input = RunJobInput.parse(args ?? {});
    const jobId = await ctx.repo.enqueueJob(input.kind, input.payload ?? {});
    await ctx.repo.audit({ actor: tc.actor, actorKind: "mcp", action: "job.enqueue", target: jobId, diff: { kind: input.kind, payload: input.payload ?? {} } });
    return ok({ queued: true, jobId, kind: input.kind, note: "任务已入队，Runner 会在 30 秒内执行。用 GET /api/jobs 查询执行状态。" });
  },
} satisfies Record<string, Handler>;
