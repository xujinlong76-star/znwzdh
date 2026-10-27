/**
 * 探活缓存的服务端接线（单例 + 写入节流）。
 *
 * 缓存实现本身在 `@navhub/core` 的 `probe-cache.ts`（纯逻辑 + 文件存储，可单测）；
 * 这里只解决两个只有运行时才知道的问题：
 *   1. 缓存放哪：默认 `./data/probe-cache.json`，与 SQLite 的 `./data/navhub.db` 同目录，
 *      可用 `NAVHUB_PROBE_CACHE_PATH` 覆盖（容器里挂卷用）；
 *   2. 什么时候落盘：不能每探一个就写一次（5000 条 JSON 会变成写放大），
 *      改成最多每 5 秒合并写一次；写失败只记日志——缓存坏了不能影响体检本身。
 */
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { openProbeCache, type ProbeCacheStore } from "@navhub/core";

const FLUSH_INTERVAL_MS = 5_000;

let storePromise: Promise<ProbeCacheStore> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function probeCachePath(): string {
  return resolve(process.env.NAVHUB_PROBE_CACHE_PATH || "data/probe-cache.json");
}

/** 取（或懒加载）单例缓存。并发调用共享同一个 Promise，不会重复读盘。 */
export function getProbeCache(): Promise<ProbeCacheStore> {
  const existing = storePromise;
  if (existing) return existing;
  const created = openProbeCache(probeCachePath()).catch((err: unknown) => {
    // 打开失败就把单例清掉，下次调用重试；本次调用方拿到的是临时目录里的一份缓存。
    storePromise = null;
    console.warn(`[probe-cache] 打开失败，降级到临时目录：${err instanceof Error ? err.message : String(err)}`);
    return openProbeCache(resolve(tmpdir(), "navhub-probe-cache.json"));
  });
  storePromise = created;
  return created;
}

/**
 * 合并写入：5 秒内的多次 record 只落盘一次。
 * 定时器 `unref()`，不阻止进程退出（缓存丢失最多慢一次，不该拖住优雅退出）。
 */
export function scheduleProbeCacheFlush(store: ProbeCacheStore): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void store.flush().catch((err: unknown) => {
      console.warn(`[probe-cache] 落盘失败：${err instanceof Error ? err.message : String(err)}`);
    });
  }, FLUSH_INTERVAL_MS);
  flushTimer.unref?.();
}

/** 测试与运维用：立即落盘并释放单例引用 */
export async function flushProbeCacheNow(): Promise<void> {
  if (!storePromise) return;
  const store = await storePromise;
  await store.flush();
}
