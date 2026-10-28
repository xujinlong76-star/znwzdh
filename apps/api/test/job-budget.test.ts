import { describe, expect, it } from "vitest";
import { JobBudgetExceededError, runWithBudget } from "../src/jobs.ts";

/**
 * 单次执行预算（P1「任务执行器」）。
 *
 * 旧实现里 `timeoutMs` 只是声明值：一个卡住的 handler 会把整轮 tick 拖死，
 * 后续任务全部排队（tick 串行）。这里验证预算真的会打断等待，且不误伤正常结果。
 */
describe("runWithBudget", () => {
  it("在预算内完成 → 原样返回结果", async () => {
    await expect(runWithBudget(Promise.resolve("ok"), 1_000, "reindex")).resolves.toBe("ok");
  });

  it("超出预算 → 抛 JobBudgetExceededError，带上 kind 与预算", async () => {
    const never = new Promise<string>(() => undefined);
    await expect(runWithBudget(never, 20, "health_check")).rejects.toBeInstanceOf(JobBudgetExceededError);
    await expect(runWithBudget(never, 20, "health_check")).rejects.toMatchObject({
      kind: "health_check",
      budgetMs: 20,
    });
  });

  it("业务异常优先于预算：不会被误报成超时", async () => {
    await expect(runWithBudget(Promise.reject(new Error("boom")), 1_000, "reindex")).rejects.toThrow("boom");
  });

  it("budget<=0 表示不设预算（手动/测试路径）", async () => {
    await expect(runWithBudget(Promise.resolve(42), 0, "backup_restore")).resolves.toBe(42);
  });

  it("超时后不会留下未清理的定时器（进程可正常退出）", async () => {
    // 若能留下 ref'd timer，本用例所在 worker 会被拖住；这里只断言快速返回。
    const started = Date.now();
    await expect(runWithBudget(new Promise(() => undefined), 10, "token_audit")).rejects.toBeInstanceOf(
      JobBudgetExceededError,
    );
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
