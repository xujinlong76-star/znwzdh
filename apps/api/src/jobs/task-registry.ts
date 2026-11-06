/**
 * 任务执行注册表（TaskRegistry）。
 *
 * 架构目标（ARC-02）：
 * 将 jobs.ts 中分散的庞大 Handler 逻辑抽象为可插拔、模块化、独立单测的任务处理器规范。
 */

import type { AppContext } from "../context.ts";
import type { JobKind, JobRunHandle } from "../jobs.ts";

export interface JobHandlerContext {
  ctx: AppContext;
  run: JobRunHandle;
  jobId: string;
  payload: unknown;
}

export type JobHandler = (context: JobHandlerContext) => Promise<void>;

export class TaskRegistry {
  private handlers = new Map<string, JobHandler>();

  /** 注册指定任务类型的 Handler */
  register(kind: JobKind | string, handler: JobHandler): this {
    if (this.handlers.has(kind)) {
      console.warn(`[task-registry] 覆盖已登记的任务处理器: ${kind}`);
    }
    this.handlers.set(kind, handler);
    return this;
  }

  /** 获取指定任务类型的 Handler */
  get(kind: JobKind | string): JobHandler | undefined {
    return this.handlers.get(kind);
  }

  /** 判断是否已注册该任务类型 */
  has(kind: JobKind | string): boolean {
    return this.handlers.has(kind);
  }

  /** 已注册任务类型列表 */
  list(): string[] {
    return Array.from(this.handlers.keys());
  }
}
