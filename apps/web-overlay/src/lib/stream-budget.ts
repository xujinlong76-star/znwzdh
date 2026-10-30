/**
 * 代理链路的资源预算（升级改造方案 P0-5）。
 *
 * B 站流代理与媒体封面代理都是「匿名可访问的出站通道」。修复前它们没有任何
 * 并发、时长与字节上限：慢上游能把 Node 的 socket 长期占死，超大响应能直接把
 * 进程内存吃穿。这里只放纯逻辑（预算、Range 夹紧、空闲读取），
 * 路由负责把它们接上，边界本身可以离线单测。
 *
 * 预算按**进程**计：多副本部署时每副本各持一份，总量约为 副本数 × 阈值。
 * 要全局精确配额得放到共享存储里，而不是在进程内造一个假全局。
 */

export interface StreamBudgetOptions {
  /** 进程级并发流上限 */
  maxConcurrent: number
  /** 单调用方（按 IP 归并）在一个窗口内允许的请求数 */
  maxPerWindow: number
  /** 窗口长度（毫秒） */
  windowMs: number
  /** 窗口表的最大条目数：防止被海量不同 IP 撑爆内存 */
  maxKeys?: number
}

/** 拒绝原因：限流（调用方自己打得太快）与饱和（进程并发满了）给不同的状态码 */
export type StreamBudgetDenial = "rate_limited" | "saturated"

export class StreamBudget {
  private readonly maxConcurrent: number;
  private readonly maxPerWindow: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private active = 0;
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(options: StreamBudgetOptions) {
    this.maxConcurrent = Math.max(1, Math.floor(options.maxConcurrent));
    this.maxPerWindow = Math.max(1, Math.floor(options.maxPerWindow));
    this.windowMs = Math.max(1, Math.floor(options.windowMs));
    this.maxKeys = Math.max(1, Math.floor(options.maxKeys ?? 10_000));
  }

  /**
   * 申请一个流槽位。
   *
   * @returns null 表示已占用（调用方必须在流结束/失败时 `release()`）；
   *          否则返回拒绝原因。
   */
  tryAcquire(key: string): StreamBudgetDenial | null {
    const now = Date.now();
    const window = this.windows.get(key);
    if (!window || now - window.start >= this.windowMs) {
      // 窗口表本身要有界：匿名端点不能靠伪造海量 IP 把 Map 撑大
      if (this.windows.size >= this.maxKeys) this.windows.clear();
      this.windows.set(key, { start: now, count: 1 });
    } else if (window.count >= this.maxPerWindow) {
      return "rate_limited";
    } else {
      window.count += 1;
    }

    if (this.active >= this.maxConcurrent) return "saturated";
    this.active += 1;
    return null;
  }

  /** 释放一个并发槽位；窗口计数不回退（请求确实发生过） */
  release(): void {
    if (this.active > 0) this.active -= 1;
  }

  snapshot(): { active: number; trackedKeys: number } {
    return { active: this.active, trackedKeys: this.windows.size };
  }

  /** 仅测试用：恢复到初始状态 */
  reset(): void {
    this.active = 0;
    this.windows.clear();
  }
}

/**
 * 夹紧 `Range: bytes=start-end`，把单次响应限制在 maxBytes 内。
 *
 * 玩家常用 `bytes=0-` 请求整条流；对上百 MB 的视频这就成了一次无上限的出站转发。
 * 只处理「单段、纯数字」这一种形式（播放器实际发的就是它）；解析不了的原样带回，
 * 让上游按标准 416 处理，而不是我们擅自改写成语义不同的请求。
 */
export function clampRangeHeader(raw: string | null, maxBytes: number): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const matched = /^bytes=(\d+)-(\d*)$/.exec(trimmed);
  if (!matched) return trimmed;
  const start = Number(matched[1]);
  const requestedEnd = matched[2] ? Number(matched[2]) : null;
  const ceiling = start + maxBytes - 1;
  const end = requestedEnd === null ? ceiling : Math.min(requestedEnd, ceiling);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return trimmed;
  return `bytes=${start}-${end}`;
}

export class StreamIdleTimeoutError extends Error {
  constructor(idleMs: number) {
    super(`上游流 ${idleMs}ms 内没有新数据`);
    this.name = "StreamIdleTimeoutError";
  }
}

export function isStreamIdleTimeout(err: unknown): boolean {
  return err instanceof StreamIdleTimeoutError;
}

/**
 * 给一次「读下一块」套上空闲超时。
 *
 * 关键取值时刻是**首块**：还没发出响应头时中止，路由可以如实回 504；
 * 首块之后中止只能截断流（状态码已经发出去了）。
 */
export function readWithIdleTimeout<T>(read: () => Promise<T>, idleMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new StreamIdleTimeoutError(idleMs)), idleMs);
    read().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** 读取超时环境变量：默认值面向公网，测试与慢链路可以下调 */
export function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
