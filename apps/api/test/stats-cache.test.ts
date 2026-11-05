/**
 * 高频计数缓存（P1-5）。
 *
 * 守四件事：
 *  1. 同版本 + TTL 内不再打 COUNT；
 *  2. 写入（data_version 变化）后立刻重算 —— 刚删站点不能还看到旧值；
 *  3. 并发请求共享同一次刷新（单飞），不放大成 N 次全量 COUNT；
 *  4. 版本号不可用时仍有 TTL 兜底，缓存不会永久冻结。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../src/context.ts";
import {
  cacheSnapshot,
  cachedDashboardOverview,
  cachedSiteStats,
  DASHBOARD_TTL_MS,
  SITE_STATS_TTL_MS,
} from "../src/stats-cache.ts";

interface Harness {
  ctx: AppContext;
  calls: { stats: number; dashboard: number };
  state: { sites: number; version: number | null };
}

function makeCtx(opts: { delayMs?: number } = {}): Harness {
  const calls = { stats: 0, dashboard: 0 };
  const state: Harness["state"] = { sites: 5, version: 1 };
  const ctx = {
    config: { mode: "lite" },
    capabilities: { semantic: false, fts: true, llm: false },
    repo: {
      readNavDataVersion: async () => state.version,
      stats: async () => {
        calls.stats += 1;
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
        return {
          sites: state.sites,
          categories: 1,
          tags: 1,
          broken: 0,
          pending: 0,
          trashed: 0,
        };
      },
      dashboardOverview: async () => {
        calls.dashboard += 1;
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
        return { overview: {}, metrics24h: {} } as never;
      },
    },
  } as unknown as AppContext;
  return { ctx, calls, state };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("全站计数缓存", () => {
  it("同版本 TTL 内只算一次", async () => {
    const h = makeCtx();
    const first = await cachedSiteStats(h.ctx);
    const second = await cachedSiteStats(h.ctx);
    expect(h.calls.stats).toBe(1);
    expect(second.sites).toBe(first.sites);
    expect(cacheSnapshot(h.ctx).stats.hits).toBe(1);
  });

  it("data_version 变化后立刻重算（写入不能看到旧值）", async () => {
    const h = makeCtx();
    expect((await cachedSiteStats(h.ctx)).sites).toBe(5);

    // 模拟「刚删了一个站点」：计数变了、版本号也被触发器 bump
    h.state.sites = 4;
    h.state.version = 2;

    expect((await cachedSiteStats(h.ctx)).sites).toBe(4);
    expect(h.calls.stats).toBe(2);
  });

  it("并发请求共享同一次刷新（单飞）", async () => {
    const h = makeCtx({ delayMs: 20 });
    const [a, b] = await Promise.all([cachedSiteStats(h.ctx), cachedSiteStats(h.ctx)]);
    expect(h.calls.stats).toBe(1);
    expect(a.sites).toBe(b.sites);
    const counters = cacheSnapshot(h.ctx).stats;
    expect(counters.shared).toBe(1);
    expect(counters.misses).toBe(1);
  });

  it("版本号不可用（触发器缺失的老库）时靠 TTL 兜底，不会永久冻结", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const h = makeCtx();
    h.state.version = null;

    await cachedSiteStats(h.ctx);
    await cachedSiteStats(h.ctx);
    expect(h.calls.stats).toBe(1);

    // 版本号恒为 null：TTL 内仍是命中，超过 TTL 必须重算
    h.state.sites = 9;
    vi.setSystemTime(1_000_000 + SITE_STATS_TTL_MS + 1);
    expect((await cachedSiteStats(h.ctx)).sites).toBe(9);
    expect(h.calls.stats).toBe(2);
  });

  it("缓存按上下文分桶：另一个上下文不会拿到这份计数", async () => {
    const a = makeCtx();
    const b = makeCtx();
    await cachedSiteStats(a.ctx);
    await cachedSiteStats(b.ctx);
    expect(a.calls.stats).toBe(1);
    expect(b.calls.stats).toBe(1);
    expect(cacheSnapshot(a.ctx).stats.misses).toBe(1);
    expect(cacheSnapshot(b.ctx).stats.misses).toBe(1);
  });
});

describe("管理总览缓存", () => {
  it("30s 内复用，过期后重算", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    const h = makeCtx();

    await cachedDashboardOverview(h.ctx);
    await cachedDashboardOverview(h.ctx);
    expect(h.calls.dashboard).toBe(1);

    vi.setSystemTime(2_000_000 + DASHBOARD_TTL_MS + 1);
    await cachedDashboardOverview(h.ctx);
    expect(h.calls.dashboard).toBe(2);
  });

  it("并发请求共享同一次刷新", async () => {
    const h = makeCtx({ delayMs: 20 });
    await Promise.all([cachedDashboardOverview(h.ctx), cachedDashboardOverview(h.ctx)]);
    expect(h.calls.dashboard).toBe(1);
    expect(cacheSnapshot(h.ctx).dashboard.shared).toBe(1);
  });
});
