import { describe, expect, it, vi } from "vitest";
import { TaskRegistry } from "../src/jobs/task-registry.ts";

describe("任务执行注册表（ARC-02）", () => {
  it("支持注册、获取与判断任务 Handler", async () => {
    const registry = new TaskRegistry();
    expect(registry.has("custom_task")).toBe(false);
    expect(registry.get("custom_task")).toBeUndefined();

    const handler = vi.fn().mockResolvedValue(undefined);
    registry.register("custom_task", handler);

    expect(registry.has("custom_task")).toBe(true);
    expect(registry.get("custom_task")).toBe(handler);
    expect(registry.list()).toEqual(["custom_task"]);

    const mockCtx = {
      ctx: {} as any,
      run: {} as any,
      jobId: "job-123",
      payload: { foo: "bar" },
    };
    await registry.get("custom_task")!(mockCtx);
    expect(handler).toHaveBeenCalledWith(mockCtx);
  });
});
