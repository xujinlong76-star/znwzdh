/**
 * /drama「继续追」统计口径测试（U-D8）+ 本地进度日志测试。
 *
 * 口径（lib/drama-watch-stats.ts 唯一定义）：
 * - 在追 X 部：节奏非“已完结”的条目数；
 * - 本周看了 Y 集：本地进度日志本周正向增量合计（周一 00:00 起）；
 * - 有新集 Z 部：服务端基线里最新集数大于“看到第几集”的在追剧数；
 *   无基线时为 null（不显示），已完结的剧不计入。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeDramaWatchStats,
  hasNewEpisodes,
  latestEpisodeText,
  type DramaCheckState,
} from "../src/lib/drama-watch-stats";
import {
  episodesWatchedThisWeek,
  readWatchProgressLog,
  recordWatchProgress,
  WATCH_PROGRESS_LOG_KEY,
  type WatchProgressLogEntry,
} from "../src/lib/watch-progress-log";
import type { WatchEntry } from "../src/lib/watchlist";
import { dramaKeyFor } from "../src/lib/watchlist";

function entry(overrides: Partial<WatchEntry> & { title: string }): WatchEntry {
  return {
    key: dramaKeyFor("nav-test", overrides.title),
    platformSiteId: "nav-test",
    platformTitle: "红果短剧",
    playUrl: "https://example.com/play",
    episode: 0,
    priority: "normal",
    cadence: { kind: "daily" },
    remind: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastProgressAt: Date.now(),
    ...overrides,
  };
}

function state(dramaKey: string, latestEpisode: number | null): DramaCheckState {
  return { dramaKey, latestEpisode, lastCheckedAt: Date.now(), lastError: null };
}

describe("computeDramaWatchStats", () => {
  it("在追只数非完结；有新集只数在追且基线大于已看集数", () => {
    const entries = [
      entry({ title: "剧A", episode: 10, cadence: { kind: "daily" } }),
      entry({ title: "剧B", episode: 100, cadence: { kind: "daily" } }),
      entry({ title: "剧C", episode: 50, cadence: { kind: "finished" } }),
    ];
    const states = new Map<string, DramaCheckState>([
      ["nav-test::剧a", state("nav-test::剧a", 12)],
      ["nav-test::剧b", state("nav-test::剧b", 100)],
      // 剧C 已完结：基线 200 大于已看 50，但不计入“有新集”。
      ["nav-test::剧c", state("nav-test::剧c", 200)],
    ]);
    const stats = computeDramaWatchStats(entries, states, [], new Date("2026-11-17T12:00:00+08:00"));
    expect(stats.tracking).toBe(2);
    expect(stats.hasNew).toBe(1);
  });

  it("无服务端基线时 hasNew 为 null（不显示，不编 0）", () => {
    const stats = computeDramaWatchStats(
      [entry({ title: "剧A", episode: 1 })],
      new Map(),
      [],
      new Date("2026-11-17T12:00:00+08:00"),
    );
    expect(stats.tracking).toBe(1);
    expect(stats.hasNew).toBeNull();
  });

  it("基线等于已看集数时不算有新集", () => {
    const entries = [entry({ title: "剧A", episode: 86 })];
    const states = new Map([["nav-test::剧a", state("nav-test::剧a", 86)]]);
    const stats = computeDramaWatchStats(entries, states, [], new Date("2026-11-17T12:00:00+08:00"));
    expect(stats.hasNew).toBe(0);
  });
});

describe("latestEpisodeText / hasNewEpisodes", () => {
  it("有基线显示已更至第 X 集；基线 null 显示未查到最新集数；无基线返回 null", () => {
    expect(latestEpisodeText(state("k", 86))).toBe("已更至第 86 集");
    expect(latestEpisodeText(state("k", null))).toBe("未查到最新集数");
    expect(latestEpisodeText(undefined)).toBeNull();
  });

  it("已完结的剧不贴有新集角标", () => {
    const finished = entry({ title: "剧C", episode: 50, cadence: { kind: "finished" } });
    expect(hasNewEpisodes(finished, state("nav-test::剧c", 200))).toBe(false);
    const active = entry({ title: "剧A", episode: 10 });
    expect(hasNewEpisodes(active, state("nav-test::剧a", 12))).toBe(true);
    expect(hasNewEpisodes(active, state("nav-test::剧a", 10))).toBe(false);
    expect(hasNewEpisodes(active, undefined)).toBe(false);
  });

  it("预约态（U-377）：不计入在追、不贴有新集角标——不进新集检查，无「未查到最新集数」噪音", () => {
    const reserved: WatchEntry = {
      ...entry({ title: "待开播剧", episode: 0, cadence: { kind: "unknown" } }),
      key: "reserved::待开播剧",
      platformSiteId: "",
      platformTitle: "平台待确认",
      playUrl: "",
      premiereDate: "2026-11-30",
    };
    const stats = computeDramaWatchStats([reserved], new Map(), [], new Date());
    expect(stats.tracking).toBe(0);
    expect(stats.hasNew).toBeNull();
    // 即使服务端误带一条基线，预约行也不贴角标、不显示已更集数
    expect(hasNewEpisodes(reserved, state(reserved.key, 99))).toBe(false);
    expect(latestEpisodeText(undefined)).toBeNull();
  });
});

describe("episodesWatchedThisWeek", () => {
  // 2026-11-17 是周二；本周一起点为 2026-11-16 00:00（本地时间）。
  const now = new Date("2026-11-17T12:00:00+08:00");
  const log: WatchProgressLogEntry[] = [
    { key: "a", at: Date.parse("2026-11-16T10:00:00+08:00"), from: 3, to: 5 },
    { key: "b", at: Date.parse("2026-11-17T09:00:00+08:00"), from: 0, to: 4 },
    // 上周的（周日 23:00）不计入本周。
    { key: "c", at: Date.parse("2026-11-15T23:00:00+08:00"), from: 0, to: 10 },
    // 往回改的负增量不计入。
    { key: "d", at: Date.parse("2026-11-17T10:00:00+08:00"), from: 8, to: 6 },
  ];
  it("只加本周正向增量", () => {
    expect(episodesWatchedThisWeek(log, now)).toBe(6);
  });
});

describe("recordWatchProgress（localStorage 桩）", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("只记正向增量；往回改不记", () => {
    recordWatchProgress("a", 3, 5, Date.parse("2026-11-17T10:00:00+08:00"));
    recordWatchProgress("a", 5, 4, Date.parse("2026-11-17T11:00:00+08:00"));
    const log = readWatchProgressLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toEqual({ key: "a", at: Date.parse("2026-11-17T10:00:00+08:00"), from: 3, to: 5 });
  });

  it("坏日志读出来是空数组，不抛错", () => {
    store.set(WATCH_PROGRESS_LOG_KEY, "not json");
    expect(readWatchProgressLog()).toEqual([]);
    store.set(WATCH_PROGRESS_LOG_KEY, JSON.stringify([{ key: 1, at: "x" }]));
    expect(readWatchProgressLog()).toEqual([]);
  });
});
