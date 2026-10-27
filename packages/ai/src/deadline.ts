/**
 * 模型调用的端到端截止时间与重试预算。
 *
 * 为什么需要：
 *
 *  1. **超时是分层的，预算是端到端的。** 一次对话可能跨越多次上游请求
 *     （主模型超时 → 备用池轮换 → 端点拒收参数后再试一次）。
 *     每层各自 20s/60s 超时并不叠加成「最多 60s」，而是最坏 3 个 provider × 60s；
 *     主站实测用户按下「停止」时上游仍在计费。截止时间是绝对时间点，
 *     跨层传递时不重算、不漂移，越往后每一次单调用能用的时间只会更少。
 *
 *  2. **重试必须有预算。** 备用池轮换没有上限时，上游整体故障会让每个请求
 *     把整池打完：故障不是被吸收，而是被放大（重试风暴）。
 *     Finagle / Envoy 的 retry budget 用「窗口内重试占比」限流：
 *     正常时允许少量重试（低流量用最小配额兜底），故障时重试占比被动升高，
 *     预算耗尽即停止重试，把压力还给主路径的快速失败。
 */

/** 绝对截止时间。跨层传的是时间点（`Date.now() + 预算`），不是剩余毫秒。 */
export class Deadline {
  readonly expiresAt: number;

  constructor(expiresAt: number) {
    this.expiresAt = Number.isFinite(expiresAt) ? expiresAt : 0;
  }

  static after(ms: number, now = Date.now()): Deadline {
    const budget = Number.isFinite(ms) ? Math.max(0, ms) : 0;
    return new Deadline(now + budget);
  }

  remainingMs(now = Date.now()): number {
    return Math.max(0, this.expiresAt - now);
  }

  expired(now = Date.now()): boolean {
    return now >= this.expiresAt;
  }

  /**
   * 把单次调用的超时钳到剩余预算内。
   * 返回 0 表示预算已耗尽——调用方应直接失败，不要再发请求。
   */
  clampTimeout(timeoutMs: number, now = Date.now()): number {
    const remaining = this.remainingMs(now);
    if (remaining <= 0) return 0;
    const timeout = Math.floor(timeoutMs);
    if (!Number.isFinite(timeout) || timeout <= 0) return remaining;
    return Math.min(timeout, remaining);
  }
}

/** 裸的时间戳也能当截止时间用：`clampToDeadline(60_000, expiresAt)` */
export function clampToDeadline(timeoutMs: number, deadlineAt?: number, now = Date.now()): number {
  if (typeof deadlineAt !== "number" || !Number.isFinite(deadlineAt)) return Math.max(0, Math.floor(timeoutMs));
  return new Deadline(deadlineAt).clampTimeout(timeoutMs, now);
}

export interface RetryBudgetOptions {
  /** 窗口内允许的「重试 / 成功」比值；默认 0.2（每 10 次成功允许 2 次重试） */
  ratio?: number;
  /** 窗口内无条件允许的重试次数，避免低流量时预算恒为 0；默认 5 */
  minRetries?: number;
  /** 滑动窗口长度；默认 10s */
  windowMs?: number;
  /** 窗口内重试硬上限（防单点暴冲）；默认 50 */
  maxRetries?: number;
}

export interface RetryBudgetSnapshot {
  successes: number;
  retries: number;
  /** 此刻是否允许再一次重试 */
  allowed: boolean;
}

export class RetryBudget {
  private readonly ratio: number;
  private readonly minRetries: number;
  private readonly windowMs: number;
  private readonly maxRetries: number;
  /** 按时间递增；prune 只从头部裁剪，避免每次全量扫描 */
  private events: Array<{ at: number; retry: boolean }> = [];

  constructor(opts: RetryBudgetOptions = {}) {
    const ratio = Number.isFinite(opts.ratio) ? (opts.ratio as number) : 0.2;
    const minRetries = Number.isFinite(opts.minRetries) ? (opts.minRetries as number) : 5;
    const windowMs = Number.isFinite(opts.windowMs) ? (opts.windowMs as number) : 10_000;
    const maxRetries = Number.isFinite(opts.maxRetries) ? (opts.maxRetries as number) : 50;
    this.ratio = Math.min(Math.max(ratio, 0), 1);
    this.minRetries = Math.max(0, Math.floor(minRetries));
    this.windowMs = Math.max(1, windowMs);
    this.maxRetries = Math.max(0, Math.floor(maxRetries));
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    let cut = 0;
    while (cut < this.events.length && this.events[cut]!.at < cutoff) cut++;
    if (cut > 0) this.events.splice(0, cut);
  }

  recordSuccess(now = Date.now()): void {
    this.prune(now);
    this.events.push({ at: now, retry: false });
  }

  recordRetry(now = Date.now()): void {
    this.prune(now);
    this.events.push({ at: now, retry: true });
  }

  canRetry(now = Date.now()): boolean {
    this.prune(now);
    let successes = 0;
    let retries = 0;
    for (const ev of this.events) {
      if (ev.retry) retries++;
      else successes++;
    }
    if (retries >= this.maxRetries) return false;
    if (retries < this.minRetries) return true;
    return retries < successes * this.ratio;
  }

  snapshot(now = Date.now()): RetryBudgetSnapshot {
    this.prune(now);
    let successes = 0;
    let retries = 0;
    for (const ev of this.events) {
      if (ev.retry) retries++;
      else successes++;
    }
    return { successes, retries, allowed: this.canRetry(now) };
  }
}

/**
 * 哪些失败值得换 provider 再试一次：
 *  - rate_limit / network / timeout / 5xx 是「这家现在不行」，换一家可能行；
 *  - auth / config / invalid_response / cancelled / ssrf 换谁都一样：
 *    错密钥到哪都 401，坏响应是内容问题，取消是用户意图，内网地址本就不该放行。
 * 对这些错误继续轮换备用池只会拖长用户等待、放大失败记账。
 */
export function isRetryableLlmCode(code: string, status?: number): boolean {
  if (code === "rate_limit" || code === "network" || code === "timeout") return true;
  if (code === "http") return typeof status === "number" && status >= 500;
  return false;
}
