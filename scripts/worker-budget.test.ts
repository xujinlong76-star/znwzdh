/**
 * worker 预算纯函数的守卫（提案 5）。
 *
 * 锁三条不变量：
 *  1. 并发永远不超过稳定上限 3，也永远 ≥ 1（0 会让 vitest 退化成串行甚至报错）；
 *  2. 内存充裕（≥8GB）时堆维持 4096——不能因为「自适应」把历史绿灯改小成 OOM；
 *  3. 紧张机器上 workers × heap 不越机内存（两者的乘积是 fork 真实压力的上界）。
 */
import { describe, expect, it } from "vitest";
import {
  HEAP_CAP_MB,
  WORKER_CAP,
  CONSTRAINED_MEM_GB,
  computeWorkerBudget,
} from "./worker-budget.ts";

describe("computeWorkerBudget", () => {
  it("常规开发机（16C/16GB）：与历史常量一致，不改变现有绿灯行为", () => {
    const b = computeWorkerBudget(16, 16);
    expect(b.workers).toBe(WORKER_CAP);
    expect(b.heapMB).toBe(HEAP_CAP_MB);
  });

  it("并发只向下收缩：多核大内存也不越过稳定上限", () => {
    expect(computeWorkerBudget(64, 128).workers).toBe(WORKER_CAP);
    // 单核机器退化成 1，而不是 0 或负数
    expect(computeWorkerBudget(1, 16).workers).toBe(1);
    // 内存主导：2C 配 6GB → min(3, 1, 3) = 1
    expect(computeWorkerBudget(2, 6).workers).toBe(1);
  });

  it("内存充裕（≥8GB）时堆保持 4096，不被自适应调小", () => {
    expect(computeWorkerBudget(4, CONSTRAINED_MEM_GB).heapMB).toBe(HEAP_CAP_MB);
    expect(computeWorkerBudget(8, 32).heapMB).toBe(HEAP_CAP_MB);
  });

  it("紧张机器（<8GB）：堆按预算折算且不越机内存", () => {
    // 4GB / 2 workers → floor(4*1024*0.45/2)=921 → 夹到下界 1024
    const small = computeWorkerBudget(4, 4);
    expect(small.workers).toBe(2);
    expect(small.heapMB).toBe(1024);
    // workers × heap（MB）≤ 机内存（MB）的可承受比例：总堆不超过内存的 ~60%
    expect(small.workers * small.heapMB).toBeLessThanOrEqual(4 * 1024 * 0.6);

    // 6GB / 3 workers → floor(6*1024*0.45/3)=921 → 1024；仍满足总堆约束
    const mid = computeWorkerBudget(8, 6);
    expect(mid.workers).toBe(3);
    expect(mid.workers * mid.heapMB).toBeLessThanOrEqual(6 * 1024 * 0.7);
  });

  it("异常输入不产出 0 或 NaN（否则 vitest 直接起不来）", () => {
    for (const [cpu, mem] of [
      [0, 0],
      [-4, -1],
      [Number.NaN, Number.NaN],
    ] as Array<[number, number]>) {
      const b = computeWorkerBudget(cpu, mem);
      expect(Number.isInteger(b.workers)).toBe(true);
      expect(b.workers).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(b.heapMB)).toBe(true);
      expect(b.heapMB).toBeGreaterThanOrEqual(1024);
    }
  });
});
