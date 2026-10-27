/**
 * 跨实例告警去重：把「5 分钟内同一故障只喊一次」从进程内 Map 挪到 system_states。
 *
 * 为什么需要：Runner 的单实例锁只保证「同一时刻一个副本在跑任务」，
 * 但轮次间会换副本（锁过期/重启/滚动发布），而 webhook 告警是按轮次触发的。
 * 进程内 Map 在副本切换后归零，同一次持续故障会按副本数重复投递。
 *
 * 存储不可用时**放行**而不是拦截：宁可多喊一条，也不能因为去重表读写失败
 * 把真正的告警静默吞掉（调用方前面还有进程内 deduper 兜底）。
 */
import { createHash } from "node:crypto";
import type { Repository } from "@navhub/store";
import type { AlertDeduper } from "./alerts.ts";

export function createStoreAlertDeduper(repo: Repository, windowMs: number): AlertDeduper {
  // 原始键含 \u0000 与最多 400 字符的自由文本；sha1 后键短且无控制字符，
  // 也不会把错误原文（可能含内部路径/主机名）写进 system_states。
  const keyOf = (raw: string) => "alert:dedupe:" + createHash("sha1").update(raw).digest("base64url");

  return {
    async claim(raw, now) {
      try {
        return await repo.claimSystemState(keyOf(raw), { at: now }, windowMs, now);
      } catch {
        return true;
      }
    },
    async release(raw) {
      try {
        await repo.deleteSystemState(keyOf(raw));
      } catch {
        // 释放失败最多影响下一次重试的去重窗口，不影响本次投递结果
      }
    },
  };
}
