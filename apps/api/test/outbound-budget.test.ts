/**
 * OutboundBudget 单元测试（P0-4）。
 *
 * 这个类是非阻塞语义：超限立即返回 false，调用方回 429/503；
 * 任何「排队等待」都会把上游压力转成进程内存，测试同时锁住这一点。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { OutboundBudget } from "../src/outbound-budget.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("OutboundBudget", () => {
  it("并发槽位：占满后拒绝，release 后恢复", () => {
    const budget = new OutboundBudget({ maxConcurrent: 1, maxPerWindow: 100, windowMs: 60_000 });
    expect(budget.tryAcquire()).toBe(true);
    expect(budget.tryAcquire()).toBe(false);
    budget.release();
    expect(budget.tryAcquire()).toBe(true);
    expect(budget.snapshot().active).toBe(1);
  });

  it("窗口额度按 cost 累加，超出即拒绝（已发生的调用不因失败回退）", () => {
    const budget = new OutboundBudget({ maxConcurrent: 10, maxPerWindow: 5, windowMs: 60_000 });
    expect(budget.tryAcquire(3)).toBe(true);
    expect(budget.tryAcquire(3)).toBe(false);
    expect(budget.tryAcquire(2)).toBe(true);
    expect(budget.tryAcquire(1)).toBe(false);
    budget.release();
    // release 只回收并发槽位，窗口用量保持在 5
    expect(budget.snapshot().used).toBe(5);
  });

  it("窗口滚动后额度重置", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const budget = new OutboundBudget({ maxConcurrent: 1, maxPerWindow: 10, windowMs: 1000 });
    expect(budget.tryAcquire(10)).toBe(true);
    budget.release();
    expect(budget.tryAcquire(1)).toBe(false);
    vi.setSystemTime(1_001_000);
    expect(budget.tryAcquire(10)).toBe(true);
  });

  it("非法 cost 直接拒绝：0/负数/NaN/Infinity 不能白嫖或把计数污染成 NaN", () => {
    const budget = new OutboundBudget({ maxConcurrent: 2, maxPerWindow: 10, windowMs: 1000 });
    for (const cost of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(budget.tryAcquire(cost)).toBe(false);
    }
    expect(budget.snapshot().used).toBe(0);
  });

  it("构造参数做下界归一：0 或负数不会造出「永远放行」的预算", () => {
    const concurrency = new OutboundBudget({ maxConcurrent: 0, maxPerWindow: 10, windowMs: 1000 });
    expect(concurrency.tryAcquire(1)).toBe(true);
    expect(concurrency.tryAcquire(1)).toBe(false); // maxConcurrent 归一到 1

    const window = new OutboundBudget({ maxConcurrent: 10, maxPerWindow: 0, windowMs: 1000 });
    expect(window.tryAcquire(1)).toBe(true);
    expect(window.tryAcquire(1)).toBe(false); // maxPerWindow 归一到 1
  });

  it("reset 清空并发与窗口状态", () => {
    const budget = new OutboundBudget({ maxConcurrent: 1, maxPerWindow: 1, windowMs: 60_000 });
    expect(budget.tryAcquire(1)).toBe(true);
    expect(budget.tryAcquire(1)).toBe(false);
    budget.reset();
    expect(budget.snapshot()).toEqual({ active: 0, used: 0, windowStart: 0 });
    expect(budget.tryAcquire(1)).toBe(true);
  });
});
