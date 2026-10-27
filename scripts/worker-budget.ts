/**
 * 测试 worker 与堆预算（提案 5：按可用资源自适应，消除套件 flake）。
 *
 * 为什么要独立成可测试的纯函数：
 *  - 实测证据（2026-10-23）：`apps/api/test` 用 vitest 默认并发在 16GB 机器上以
 *    exit 1 失败，`--maxWorkers=6` 复跑 98 文件 / 915 用例全绿——并发不是越大越快，
 *    超过内存预算就是随机红灯，而红灯的归属极难判断；
 *  - 历史上 `maxWorkers` 是写死的常量：小内存机器（CI runner / 4GB 笔记本）照跑
 *    大预算，N 个 fork 各自的 `--max-old-space-size` 加总直接压垮机器。
 *
 * 设计约束：
 *  - 并发**只向下收缩，不越过 3**：3 是 docs/NEXT-STEPS-PLAN D2 的稳定上限
 *    （isolate 灰度实验里更大的并发把跨文件污染放大成随机红灯）；
 *  - 堆上限维持 4096（内存充裕时的实测值，测试确有需要），只在内存紧张（<8GB）
 *    时按 worker 预算折算，保证「workers × heap」不越机内存。
 */

export interface WorkerBudget {
  /** vitest maxWorkers */
  workers: number;
  /** 每个 fork 的 --max-old-space-size（MB） */
  heapMB: number;
}

/** 内存充裕时的堆上限（MB）：历史实测值，测试确有需要，不要无脑调小 */
export const HEAP_CAP_MB = 4096;
/** 并发稳定上限：超过它，非隔离的跨文件污染会放大成随机红灯 */
export const WORKER_CAP = 3;
/** 低于该内存（GB）视为「紧张机器」，堆按预算折算 */
export const CONSTRAINED_MEM_GB = 8;

export function computeWorkerBudget(cpuCount: number, memGB: number): WorkerBudget {
  const cpus = Number.isFinite(cpuCount) && cpuCount >= 1 ? Math.floor(cpuCount) : 1;
  const mem = Number.isFinite(memGB) && memGB > 0 ? memGB : 1;

  // 三重上界取最小：稳定上限（3）、留一个核给宿主与 dev server、每 2GB 内存 1 个 worker。
  // 16C/16GB → 3（与历史常量一致）；4C/4GB → 2；1C/2GB → 1。
  const workers = Math.max(1, Math.min(WORKER_CAP, cpus - 1, Math.floor(mem / 2)));

  // 紧张机器：按「内存 × 45% ÷ workers」折算单 fork 堆预算，夹在 [1024, 4096]。
  // 4GB/2 workers → 1024MB；8GB 以上维持 4096，不改变任何现有绿灯行为。
  const heapMB =
    mem < CONSTRAINED_MEM_GB
      ? Math.max(1024, Math.min(HEAP_CAP_MB, Math.floor((mem * 1024 * 0.45) / workers)))
      : HEAP_CAP_MB;

  return { workers, heapMB };
}
