/**
 * 进程级出站预算（并发 + 窗口调用量）。
 *
 * 为什么需要它：路由级 rateLimit 只能限制「请求数」，一个请求却可能扇出上百次
 * 出站（插件体检按包内 URL 抽样）。5 次/分钟的请求限流在 200 条抽样下仍能变成
 * 每分钟上千次探活——出口 IP 被目标站拉黑，服务端连接也被长时间占住。
 *
 * 语义刻意做成**非阻塞**：超限立即 `tryAcquire` 返回 false，由调用方回 429/503。
 * 排队会把压力从上游转成进程内存（等待中的请求同样持有连接），违背预算的目的。
 *
 * 预算按进程计：多实例部署时每个副本各自持有一份，总量约为 副本数 × 阈值。
 * 要全局精确配额应放到共享存储（再做，而不是在进程里造一个假全局）。
 */
export interface OutboundBudgetOptions {
  /** 同时进行中的出站任务数上限 */
  maxConcurrent: number;
  /** 单窗口内允许的出站调用总量 */
  maxPerWindow: number;
  /** 窗口长度（毫秒） */
  windowMs: number;
}

export interface OutboundBudgetSnapshot {
  active: number;
  used: number;
  windowStart: number;
}

export class OutboundBudget {
  private readonly maxConcurrent: number;
  private readonly maxPerWindow: number;
  private readonly windowMs: number;
  private active = 0;
  private used = 0;
  private windowStart = 0;

  constructor(options: OutboundBudgetOptions) {
    this.maxConcurrent = Math.max(1, Math.floor(options.maxConcurrent));
    this.maxPerWindow = Math.max(1, Math.floor(options.maxPerWindow));
    this.windowMs = Math.max(1, Math.floor(options.windowMs));
  }

  /**
   * 申请一次出站额度。
   *
   * @param cost 本次任务预计消耗的调用数（例如抽样条数）；并发侧只占 1 个槽位。
   * @returns true 表示已占用，调用方必须在 finally 里 `release()`
   */
  tryAcquire(cost = 1): boolean {
    if (!Number.isFinite(cost) || cost <= 0) return false;
    const now = Date.now();
    if (this.windowStart === 0 || now - this.windowStart >= this.windowMs) {
      this.windowStart = now;
      this.used = 0;
    }
    if (this.active >= this.maxConcurrent) return false;
    if (this.used + cost > this.maxPerWindow) return false;
    this.active += 1;
    this.used += cost;
    return true;
  }

  /** 释放一个并发槽位；窗口用量不回退（已发生的出站不因失败而消失） */
  release(): void {
    if (this.active > 0) this.active -= 1;
  }

  snapshot(): OutboundBudgetSnapshot {
    return { active: this.active, used: this.used, windowStart: this.windowStart };
  }

  /** 仅测试用：把窗口与计数恢复到初始状态 */
  reset(): void {
    this.active = 0;
    this.used = 0;
    this.windowStart = 0;
  }
}
