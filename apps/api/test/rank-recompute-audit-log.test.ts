/**
 * recompute_rank 审计写库失败必须留痕（2026-11-16，进化第 94 轮顺带）。
 *
 * 真实故障模式：重算本身成功（trend_score 已是新的），审计写库
 * `recordEvent("recompute_rank")` 失败 → `lastRecomputeRankAt()` 读到的
 * 仍是上一次成功写入的时刻 → /hot 显示「热度分 X 小时前重算」，而分数实际
 * 是刚算的。旧实现 `.catch(() => {})` 把失败静默丢弃，系统内无人知道。
 *
 * 本测试直接调 handleRecomputeRank：mock recordEvent 抛错，断言
 * (a) 任务不抛错、trend_score 仍写入（回归现有行为）；
 * (b) 失败日志恰好记一条（含 sites 数与错误摘要）。
 */
import { describe, expect, it, vi } from "vitest";
import { handleRecomputeRank } from "../src/jobs/tasks/rank-recompute.task.ts";
import type { AppContext } from "../src/context.ts";

function makeCtx(recordEvent: (kind: string, opts?: unknown) => Promise<unknown>) {
  const setTrendScores = vi.fn(async () => undefined);
  const repo = {
    clickCountsSince: vi.fn(async () => new Map<string, number>()),
    favoriteCountsSince: vi.fn(async () => new Map<string, number>()),
    raw: vi.fn(async () => [{ id: "s1", created_at: Date.now() }]),
    setTrendScores,
    recordEvent: vi.fn(recordEvent),
  };
  return { ctx: { repo } as unknown as AppContext, setTrendScores, repo };
}

describe("handleRecomputeRank 审计写库失败", () => {
  it("recordEvent 抛错时任务不抛错、trend_score 仍写入、日志恰好一条", async () => {
    const { ctx, setTrendScores } = makeCtx(async () => {
      throw new Error("boom");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await expect(handleRecomputeRank(ctx)).resolves.toBeUndefined();
      expect(setTrendScores).toHaveBeenCalledTimes(1);
      expect(setTrendScores.mock.calls[0]![0]).toHaveLength(1);
      expect(warn).toHaveBeenCalledTimes(1);
      const [msg, detail] = warn.mock.calls[0]!;
      expect(msg).toContain("recompute_rank");
      expect(detail).toMatchObject({ sites: 1, error: "boom" });
    } finally {
      warn.mockRestore();
    }
  });

  it("recordEvent 成功时不记失败日志", async () => {
    const { ctx } = makeCtx(async () => ({ id: "e1" }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await handleRecomputeRank(ctx);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
