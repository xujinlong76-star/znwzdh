/**
 * 真榜单区渲染测试（U-D1）。
 *
 * 渲染层只测，不走真实网络：useDramaRankings / useWatchlist 用 vi.mock
 * 注入固定数据；fetch 不跑（renderToString 不跑 effect）。
 * 固件数值取自 2026-11-17 实测的搜短剧热播榜首卡（王妈 5001万热度、
 * 评分 9.1、全 86 集）。
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { DramaRankingsSection } from "../src/components/drama-rankings-section";
import type { DramaRankingsResponse } from "../src/lib/rest-contracts.generated";
import type { WatchEntry } from "../src/lib/watchlist";
import { dramaKeyFor } from "../src/lib/watchlist";

const watchlistState = vi.hoisted(() => ({
  ready: true,
  entries: [] as WatchEntry[],
  storageBlocked: null as string | null,
}));

const rankingsState = vi.hoisted(() => ({
  data: null as DramaRankingsResponse | null,
  kind: "ready" as "loading" | "failed" | "ready",
}));

vi.mock("@/hooks/useWatchlist", () => ({
  useWatchlist: () => ({
    ready: watchlistState.ready,
    entries: watchlistState.entries,
    storageBlocked: watchlistState.storageBlocked,
    isWatching: () => false,
    findByPlatformAndTitle: () => undefined,
    add: () => null,
    setEpisode: () => false,
    update: () => false,
    dismissToday: () => false,
    remove: () => undefined,
    replaceAll: () => false,
    resetLocal: () => ({ backedUp: true }),
  }),
}));

vi.mock("@/hooks/useDramaData", () => ({
  useDramaRankings: () =>
    rankingsState.kind === "ready"
      ? { kind: "ready" as const, data: rankingsState.data }
      : { kind: rankingsState.kind },
  useDramaCalendar: () => ({ kind: "loading" as const }),
}));

afterAll(() => {
  vi.resetModules();
});

function rankingData(status: "ok" | "stale"): DramaRankingsResponse {
  return {
    ok: true,
    status,
    fetchedAt: Date.parse("2026-11-17T08:00:00+08:00"),
    lists: [
      {
        kind: "rebo",
        label: "热播榜",
        sourceUrl: "https://www.soduanju.com/paihang/rebo.html",
        sourceName: "搜短剧热播榜",
        fetchedAt: Date.parse("2026-11-17T08:00:00+08:00"),
        sourceDateModified: "2026-11-17T08:00:00+08:00",
        status: status === "stale" ? "stale" : "ok",
        lastError: status === "stale" ? "热播榜返回 HTTP 500" : null,
        droppedTitles: 0,
        entries: [
          {
            rank: 1,
            title: "王妈在顾家当保姆后全家只会搞笑了",
            key: "王妈在顾家当保姆后全家只会搞笑了",
            detailUrl: "https://www.soduanju.com/duanju/wangmazaigujiadangbaomuhouquanjiazhihuigaoxiaole.html",
            metric: 5001,
            metricLabel: "热度",
            rating: 9.1,
            favorites: 347,
            shares: null,
            likes: 902.7,
            totalEpisodes: 86,
            genre: "喜剧",
            actors: ["王志欣", "何雅馨"],
          },
          {
            rank: 2,
            title: "无评分剧",
            key: "无评分剧",
            detailUrl: "https://www.soduanju.com/duanju/wupingfen.html",
            metric: 4800,
            metricLabel: "热度",
            rating: null,
            favorites: 66,
            shares: null,
            likes: 144.8,
            totalEpisodes: 64,
            genre: null,
            actors: [],
          },
        ],
      },
      {
        kind: "reso",
        label: "热搜榜",
        sourceUrl: "https://www.soduanju.com/paihang/reso.html",
        sourceName: "搜短剧热搜榜",
        fetchedAt: Date.parse("2026-11-17T08:00:00+08:00"),
        sourceDateModified: null,
        status: "ok",
        lastError: null,
        droppedTitles: 0,
        entries: [],
      },
      {
        kind: "shoucang",
        label: "收藏榜",
        sourceUrl: "https://www.soduanju.com/paihang/shoucang.html",
        sourceName: "搜短剧收藏榜",
        fetchedAt: Date.parse("2026-11-17T08:00:00+08:00"),
        sourceDateModified: null,
        status: "ok",
        lastError: null,
        droppedTitles: 0,
        entries: [],
      },
    ],
  };
}

function render(): string {
  return renderToString(createElement(DramaRankingsSection));
}

describe("DramaRankingsSection", () => {
  it("默认热播榜：首卡标题、主数字、评分、集数与题材都渲染", () => {
    rankingsState.kind = "ready";
    rankingsState.data = rankingData("ok");
    watchlistState.entries = [];
    const html = render();
    expect(html).toContain("真榜单");
    expect(html).toContain("热播榜");
    expect(html).toContain("王妈在顾家当保姆后全家只会搞笑了");
    expect(html).toContain("5001万热度");
    expect(html).toContain("评分 9.1");
    expect(html).toContain("全 86 集");
    expect(html).toContain("喜剧");
    // 缺失的评分留空：第二行不写“评分 9.x”，只写有的数。
    expect(html).toContain("66万收藏");
    expect(html.match(/评分 [\d.]+/g)?.length).toBe(1);
  });

  it("在追的剧贴“在追”角标", () => {
    rankingsState.kind = "ready";
    rankingsState.data = rankingData("ok");
    watchlistState.entries = [
      {
        key: dramaKeyFor("nav-557388e01d50", "王妈在顾家当保姆后全家只会搞笑了"),
        title: "王妈在顾家当保姆后全家只会搞笑了",
        platformSiteId: "nav-557388e01d50",
        platformTitle: "红果短剧",
        playUrl: "https://example.com/play",
        episode: 10,
        priority: "normal",
        cadence: { kind: "daily" },
        remind: true,
        createdAt: 1,
        updatedAt: 1,
        lastProgressAt: 1,
      },
    ];
    const html = render();
    expect(html).toContain("在追");
  });

  it("stale 时如实写展示上一日快照", () => {
    rankingsState.kind = "ready";
    rankingsState.data = rankingData("stale");
    watchlistState.entries = [];
    const html = render();
    expect(html).toContain("今日榜单未更新，展示上一日快照");
  });

  it("empty 时只留一行说明，不编榜单", () => {
    rankingsState.kind = "ready";
    rankingsState.data = {
      ok: true,
      status: "empty",
      fetchedAt: null,
      lists: [
        { kind: "rebo", label: "热播榜", sourceUrl: "https://example.com/rebo", sourceName: "搜短剧热播榜", fetchedAt: null, sourceDateModified: null, status: "empty", lastError: null, droppedTitles: 0, entries: [] },
        { kind: "reso", label: "热搜榜", sourceUrl: "https://example.com/reso", sourceName: "搜短剧热搜榜", fetchedAt: null, sourceDateModified: null, status: "empty", lastError: null, droppedTitles: 0, entries: [] },
        { kind: "shoucang", label: "收藏榜", sourceUrl: "https://example.com/shoucang", sourceName: "搜短剧收藏榜", fetchedAt: null, sourceDateModified: null, status: "empty", lastError: null, droppedTitles: 0, entries: [] },
      ],
    };
    watchlistState.entries = [];
    const html = render();
    expect(html).toContain("真榜单暂无数据");
    expect(html).not.toContain("王妈在顾家当保姆后全家只会搞笑了");
  });

  it("加载失败时留一行说明，不挂页", () => {
    rankingsState.kind = "failed";
    rankingsState.data = null;
    watchlistState.entries = [];
    const html = render();
    expect(html).toContain("真榜单这次没加载出来");
  });
});
