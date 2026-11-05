/**
 * 高频聚合读数的进程内缓存（升级改造方案 P1-5）。
 *
 * 问题：`/api/health`（探针轮询）、`/api/stats`、管理台 SSE 心跳（3s）与
 * Prometheus 抓取都会调 `repo.stats()` —— 6 个 COUNT 子查询；管理总览更重，
 * 一次 20+ 个 COUNT。N 个标签页各开一天 = N 倍重复扫描，PG 上全是顺序扫描。
 *
 * 三层防护：
 *   1. **版本号优先失效**：`stats` 只统计 sites/categories/tags，这几张表的写入
 *      会 bump `data_version`（P1-1 的触发器）。命中缓存前先点查版本号（单行主键，
 *      微秒级），写入后立刻重算 —— 刚删了站点，统计不会还停在旧值。
 *   2. **TTL 兜底**：版本号不可用（老库/触发器缺失）时仍按 TTL 失效，最多落后
 *      一个周期；即使触发器部分缺失，缓存也不会无限期冻结。
 *   3. **单飞**：并发请求共享同一次刷新，避免「10 个标签页同时到期 = 10 次全量 COUNT」。
 *
 * 缓存按 AppContext 分桶（WeakMap）：同一进程里多个上下文（测试）互不串味，
 * 上下文被回收时缓存自然消失。
 */
import type { AppContext } from "./context.ts";

/** 全站计数最多缓存多久；与 SSE 心跳（3s）同量级，留出 timer 抖动余量 */
export const SITE_STATS_TTL_MS = 5_000;
/** 管理总览的缓存时长：运营看板对「秒级新鲜」没有需求，30s 换来一个数量级的查询下降 */
export const DASHBOARD_TTL_MS = 30_000;

export type SiteStats = Awaited<ReturnType<AppContext["repo"]["stats"]>>;
export type DashboardOverview = Awaited<ReturnType<AppContext["repo"]["dashboardOverview"]>>;

export interface CacheCounters {
  hits: number;
  misses: number;
  shared: number;
  /** 最近一次刷新的耗时（毫秒）；从未刷新为 0 */
  lastMs: number;
}

interface Entry<T> {
  at: number;
  /** 读完计数后对应的 data_version；null = 版本号不可用，只靠 TTL */
  version: number | null;
  value: T;
}

interface Slot<T> extends CacheCounters {
  entry: Entry<T> | null;
  inflight: Promise<T> | null;
}

interface Bucket {
  stats: Slot<SiteStats>;
  dashboard: Slot<DashboardOverview>;
}

const buckets = new WeakMap<AppContext, Bucket>();

function emptySlot<T>(): Slot<T> {
  return { entry: null, inflight: null, hits: 0, misses: 0, shared: 0, lastMs: 0 };
}

function bucketOf(ctx: AppContext): Bucket {
  let b = buckets.get(ctx);
  if (!b) {
    b = { stats: emptySlot<SiteStats>(), dashboard: emptySlot<DashboardOverview>() };
    buckets.set(ctx, b);
  }
  return b;
}

function countersOf(slot: Slot<unknown>): CacheCounters {
  return { hits: slot.hits, misses: slot.misses, shared: slot.shared, lastMs: slot.lastMs };
}

/** 当前进程内两类缓存的命中读数（Prometheus 导出用） */
export function cacheSnapshot(ctx: AppContext): { stats: CacheCounters; dashboard: CacheCounters } {
  const b = bucketOf(ctx);
  return { stats: countersOf(b.stats), dashboard: countersOf(b.dashboard) };
}

/** 测试用：丢掉某个上下文的缓存（不影响其它上下文） */
export function resetStatsCacheForTest(ctx: AppContext): void {
  buckets.delete(ctx);
}

/**
 * 全站计数（带缓存）。version 刻意在 COUNT **之前**读：计数期间发生的写入
 * 会让存下来的版本号偏旧，下一次请求自然判定不一致并重算 —— 宁可多算一次，
 * 也不要把写入后的旧值配上新版本号（那才是永久性的脏缓存）。
 */
export async function cachedSiteStats(ctx: AppContext): Promise<SiteStats> {
  const slot = bucketOf(ctx).stats;
  // 仓储能力缺失（测试替身/裁剪实现）时退回 TTL 失效，不因缺版本号而不可用
  const version =
    typeof ctx.repo.readNavDataVersion === "function" ? await ctx.repo.readNavDataVersion() : null;
  const now = Date.now();
  if (slot.entry && slot.entry.version === version && now - slot.entry.at < SITE_STATS_TTL_MS) {
    slot.hits += 1;
    return slot.entry.value;
  }
  if (slot.inflight) {
    slot.shared += 1;
    return slot.inflight;
  }
  slot.misses += 1;
  const startedAt = Date.now();
  slot.inflight = (async () => {
    const value = await ctx.repo.stats();
    slot.entry = { at: Date.now(), version, value };
    slot.lastMs = Date.now() - startedAt;
    return value;
  })().finally(() => {
    slot.inflight = null;
  });
  return slot.inflight;
}

/**
 * 管理总览（带缓存）。
 *
 * 这里不做版本号失效：总览跨 events/audit_logs/jobs 等表，P1-1 的版本号只覆盖
 * 导航数据；30s 的 TTL 是运营看板可接受的口径（HTTP 层本来还有 5s 缓存）。
 * 需要「马上看到刚发生的事」时用具体明细端点，不要依赖总览。
 */
export async function cachedDashboardOverview(ctx: AppContext): Promise<DashboardOverview> {
  const slot = bucketOf(ctx).dashboard;
  const now = Date.now();
  if (slot.entry && now - slot.entry.at < DASHBOARD_TTL_MS) {
    slot.hits += 1;
    return slot.entry.value;
  }
  if (slot.inflight) {
    slot.shared += 1;
    return slot.inflight;
  }
  slot.misses += 1;
  const startedAt = Date.now();
  slot.inflight = (async () => {
    const value = await ctx.repo.dashboardOverview();
    slot.entry = { at: Date.now(), version: null, value };
    slot.lastMs = Date.now() - startedAt;
    return value;
  })().finally(() => {
    slot.inflight = null;
  });
  return slot.inflight;
}
