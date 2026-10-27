import { describe, expect, it } from "vitest";
import { Deadline, RetryBudget, clampToDeadline, isRetryableLlmCode } from "../src/deadline.ts";

describe("Deadline", () => {
  it("按绝对时间点计算剩余预算，过期即 0", () => {
    const d = Deadline.after(2_000, 1_000);
    expect(d.expiresAt).toBe(3_000);
    expect(d.remainingMs(1_500)).toBe(1_500);
    expect(d.expired(2_999)).toBe(false);
    expect(d.expired(3_000)).toBe(true);
    expect(d.remainingMs(5_000)).toBe(0);
  });

  it("负预算视为立即过期，而不是回绕成未来", () => {
    const d = Deadline.after(-100, 1_000);
    expect(d.expiresAt).toBe(1_000);
    expect(d.expired(1_000)).toBe(true);
  });

  it("clampTimeout 把单次超时钳进剩余预算", () => {
    const d = Deadline.after(10_000, 0);
    expect(d.clampTimeout(60_000, 2_000)).toBe(8_000);
    expect(d.clampTimeout(800, 2_000)).toBe(800);
    expect(d.clampTimeout(60_000, 10_000)).toBe(0);
  });

  it("非法超时值按剩余预算处理，不会返回 NaN", () => {
    const d = Deadline.after(5_000, 0);
    expect(d.clampTimeout(Number.NaN, 1_000)).toBe(4_000);
    expect(d.clampTimeout(0, 1_000)).toBe(4_000);
  });

  it("clampToDeadline 无截止时间时原样返回", () => {
    expect(clampToDeadline(60_000)).toBe(60_000);
    expect(clampToDeadline(60_000, 7_000, 2_000)).toBe(5_000);
  });
});

describe("RetryBudget", () => {
  it("低流量时先给最小配额，用完再按成功率放行", () => {
    const budget = new RetryBudget({ ratio: 0.2, minRetries: 2, windowMs: 10_000 });
    // 没有任何成功记录也能先重试 2 次（低流量兜底）
    expect(budget.canRetry(0)).toBe(true);
    budget.recordRetry(0);
    expect(budget.canRetry(1)).toBe(true);
    budget.recordRetry(1);
    expect(budget.canRetry(2)).toBe(false);
    // 10 次成功 → 允许 2 次重试（retries < successes * 0.2 为假，改为 <= 语义检查）
    for (let i = 0; i < 12; i++) budget.recordSuccess(10 + i);
    const snap = budget.snapshot(30);
    expect(snap.successes).toBe(12);
    expect(snap.retries).toBe(2);
    expect(snap.allowed).toBe(true);
  });

  it("成功率下降时预算收紧", () => {
    const budget = new RetryBudget({ ratio: 0.2, minRetries: 0, windowMs: 10_000 });
    budget.recordSuccess(0);
    budget.recordSuccess(1);
    budget.recordRetry(2);
    // 0.2 × 2 = 0.4，1 次重试已超预算
    expect(budget.canRetry(3)).toBe(false);
    for (let i = 0; i < 6; i++) budget.recordSuccess(10 + i);
    // 0.2 × 8 = 1.6：已用 1 次，还剩 0.6 的额度 ⇒ 还能再重试一次，但不能第二次
    expect(budget.canRetry(20)).toBe(true);
    budget.recordRetry(20);
    expect(budget.canRetry(21)).toBe(false);
  });

  it("滑出窗口的事件不再计入", () => {
    const budget = new RetryBudget({ ratio: 0, minRetries: 0, windowMs: 1_000 });
    budget.recordSuccess(0);
    budget.recordRetry(10);
    expect(budget.canRetry(20)).toBe(false);
    // ratio=0 且无最小配额 ⇒ 空窗口也不放行；计数本身必须归零
    expect(budget.snapshot(2_000)).toEqual({ successes: 0, retries: 0, allowed: false });
  });

  it("窗口内重试数有硬上限", () => {
    const budget = new RetryBudget({ ratio: 1, minRetries: 100, windowMs: 10_000, maxRetries: 3 });
    for (let i = 0; i < 3; i++) budget.recordRetry(i);
    expect(budget.canRetry(3)).toBe(false);
  });
});

describe("isRetryableLlmCode", () => {
  it("限流/网络/超时/5xx 可换 provider 再试", () => {
    expect(isRetryableLlmCode("rate_limit")).toBe(true);
    expect(isRetryableLlmCode("network")).toBe(true);
    expect(isRetryableLlmCode("timeout")).toBe(true);
    expect(isRetryableLlmCode("http", 500)).toBe(true);
    expect(isRetryableLlmCode("http", 503)).toBe(true);
  });

  it("鉴权/配置/取消/坏响应/4xx 换谁都一样，不再轮换", () => {
    expect(isRetryableLlmCode("auth", 401)).toBe(false);
    expect(isRetryableLlmCode("config")).toBe(false);
    expect(isRetryableLlmCode("cancelled")).toBe(false);
    expect(isRetryableLlmCode("invalid_response", 200)).toBe(false);
    expect(isRetryableLlmCode("ssrf")).toBe(false);
    expect(isRetryableLlmCode("http", 400)).toBe(false);
    expect(isRetryableLlmCode("http")).toBe(false);
  });
});
