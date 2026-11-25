/**
 * F-02 回归锁：/drama 榜单/日历里同一剧名出现多次时不得报 React duplicate key。
 *
 * 根因（2026-11-24 点测 F-02）：开播日历「刚开播」区用裸剧名作 key，而
 * buildCalendarSnapshot 会把同一剧名的多次下榜都记进 dropped（掉榜→重回榜
 * →再掉榜），同名记录一多就撞 key（实测「早安，林思忆」）；榜单 entry.key
 * 是归一化剧名，源榜单同名多行同样会撞。修法是 key 一律加唯一后缀。
 *
 * 渲染层只测，不走真实网络：useDramaCalendar / useDramaRankings /
 * useWatchlist 用 vi.mock 注入固定数据；fetch 不跑（renderToString 不跑
 * effect）。
 *
 * 注意：React 的 duplicate key 警告只在客户端 reconciler 里打出，
 * renderToString（服务端渲染）下不触发——实测旧代码（裸剧名 key）下
 * console.error 也是空的，卡 console 抓不到这个 bug。所以 key 的唯一性
 * 用源码锁直接断言（与 me-pages / url-hygiene 等守卫同一做法），渲染
 * 断言只保证修 key 没有顺手把重复行吞掉（同名行必须都渲染出来）。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { DramaCalendarSection } from "../src/components/drama-calendar-section";
import { DramaRankingsSection } from "../src/components/drama-rankings-section";
import type {
  DramaCalendarResponse,
  DramaRankingsResponse,
} from "../src/lib/rest-contracts.generated";
import type { WatchEntry } from "../src/lib/watchlist";

const HERE = dirname(fileURLToPath(import.meta.url));
function overlayRoot(): string {
  const candidates = [resolve(HERE, ".."), resolve(HERE, "..", "..", "web-overlay")];
  const isOverlayDir = (p: string) => p.includes("/web-overlay/") || p.endsWith("/web-overlay");
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p));
  if (!hit) throw new Error("无法定位 web-overlay 根目录");
  return hit;
}
const ROOT = overlayRoot();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const watchlistState = vi.hoisted(() => ({
  ready: true,
  entries: [] as WatchEntry[],
  storageBlocked: null as string | null,
}));

const calendarState = vi.hoisted(() => ({
  data: null as DramaCalendarResponse | null,
  kind: "ready" as "loading" | "failed" | "ready",
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
    findByTitle: () => undefined,
    findByPlatformAndTitle: () => undefined,
    add: () => null,
    addReserved: () => null,
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
  useDramaCalendar: () =>
    calendarState.kind === "ready"
      ? { kind: "ready" as const, data: calendarState.data }
      : { kind: calendarState.kind },
}));

afterAll(() => {
  vi.resetModules();
});

const DUP_TITLE = "早安，林思忆";

function calendarData(): DramaCalendarResponse {
  return {
    ok: true,
    status: "ok",
    fetchedAt: Date.parse("2026-11-24T08:00:00+08:00"),
    sourceDateModified: null,
    sourceName: "搜短剧预约榜",
    sourceUrl: "https://www.soduanju.com/paihang/yuyue.html",
    lastError: null,
    days: [
      {
        date: "2026-11-26",
        label: "11月26日 周四",
        items: [
          { title: DUP_TITLE, premiereDate: "2026-11-26", reservations: 10, rawLabel: "预计11月26日上线" },
          { title: DUP_TITLE, premiereDate: "2026-11-26", reservations: 9, rawLabel: "预计11月26日上线" },
        ],
      },
    ],
    monthPending: [
      {
        month: 12,
        label: "12月",
        overdue: false,
        items: [
          { title: DUP_TITLE, reservations: 8, rawLabel: "预计12月上线" },
          { title: DUP_TITLE, reservations: 7, rawLabel: "预计12月上线" },
        ],
      },
    ],
    expired: [
      { title: DUP_TITLE, premiereDate: "2026-11-20", reservations: 6, rawLabel: "预计11月20日上线" },
      { title: DUP_TITLE, premiereDate: "2026-11-20", reservations: 5, rawLabel: "预计11月20日上线" },
    ],
    // 真实累积形状：同一剧名掉榜两次（掉榜→重回榜→再掉榜），at 不同。
    recentlyDropped: [
      { title: DUP_TITLE, lastLabel: "预计11月20日上线", lastDate: "2026-11-29", at: Date.parse("2026-11-23T08:00:00+08:00") },
      { title: DUP_TITLE, lastLabel: "预计11月18日上线", lastDate: "2026-11-29", at: Date.parse("2026-11-22T08:00:00+08:00") },
    ],
    recentChanges: [],
  };
}

function rankingEntry(rank: number, title: string): DramaRankingsResponse["lists"][number]["entries"][number] {
  return {
    rank,
    title,
    key: title,
    detailUrl: "https://www.soduanju.com/duanju/example.html",
    metric: 4000,
    metricLabel: "热度",
    rating: null,
    favorites: null,
    shares: null,
    likes: null,
    totalEpisodes: null,
    genre: null,
    actors: [],
  };
}

function rankingData(): DramaRankingsResponse {
  return {
    ok: true,
    status: "ok",
    fetchedAt: Date.parse("2026-11-24T08:00:00+08:00"),
    lists: [
      {
        kind: "rebo",
        label: "热播榜",
        sourceUrl: "https://www.soduanju.com/paihang/rebo.html",
        sourceName: "搜短剧热播榜",
        fetchedAt: Date.parse("2026-11-24T08:00:00+08:00"),
        sourceDateModified: null,
        status: "ok",
        lastError: null,
        droppedTitles: 0,
        entries: [rankingEntry(1, DUP_TITLE), rankingEntry(2, DUP_TITLE)],
      },
      {
        kind: "reso",
        label: "热搜榜",
        sourceUrl: "https://www.soduanju.com/paihang/reso.html",
        sourceName: "搜短剧热搜榜",
        fetchedAt: Date.parse("2026-11-24T08:00:00+08:00"),
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
        fetchedAt: Date.parse("2026-11-24T08:00:00+08:00"),
        sourceDateModified: null,
        status: "ok",
        lastError: null,
        droppedTitles: 0,
        entries: [],
      },
    ],
  };
}

/** 渲染并返回 html（renderToString 不跑 effect、不打 duplicate key 警告）。 */
function renderHtml(element: React.ReactElement): string {
  return renderToString(element);
}

describe("F-02：重复剧名不得报 duplicate key", () => {
  it("日历四区同名多行：同名行都渲染", () => {
    calendarState.kind = "ready";
    calendarState.data = calendarData();
    const html = renderHtml(createElement(DramaCalendarSection));
    // 刚开播区两条同名记录都在（修 key 不能顺手把重复行吞掉）。
    expect(html.match(new RegExp(DUP_TITLE, "g"))?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("刚开播");
  });

  it("榜单同 key 多行：两行都渲染", () => {
    rankingsState.kind = "ready";
    rankingsState.data = rankingData();
    const html = renderHtml(createElement(DramaRankingsSection));
    // 每行标题在链接文本与 title 属性各出现一次；锚文本出现两次 = 两行都在。
    expect(html.match(new RegExp(`>${DUP_TITLE}</a>`, "g"))?.length).toBe(2);
  });

  it("key 唯一性源码锁：日历/榜单/相关剧不得再用裸剧名（或裸归一化键）作 key", () => {
    const calendar = read("src/components/drama-calendar-section.tsx");
    expect(calendar).not.toContain("key={item.title}");
    expect(calendar).not.toContain("key={i.title}");
    expect(calendar).toContain("key={`${item.title}-${idx}`}");
    const rankings = read("src/components/drama-rankings-section.tsx");
    expect(rankings).not.toContain("key={entry.key}");
    expect(rankings).toContain("key={`${entry.key}-${entry.rank}`}");
    const content = read("src/components/drama-content.tsx");
    expect(content).not.toContain("key={`${r.label}-${r.title}`}");
    expect(content).not.toContain("key={`cal-${c.title}`}");
    expect(content).toContain("key={`${r.label}-${r.title}-${idx}`}");
    expect(content).toContain("key={`cal-${c.title}-${idx}`}");
  });
});

describe("F-03/F-04：匿名可读端点的 BFF 与视图接线", () => {
  it("BFF：无会话时 drama-check-states / custom-sites 的 GET 回空而不 401", () => {
    const src = read("src/app/api/me/[[...path]]/route.ts");
    expect(src).toContain("path[0] === 'drama-check-states'");
    expect(src).toContain("states: []");
    expect(src).toContain("path[0] === 'custom-sites'");
    expect(src).toContain("anonymous: true");
    // 其他端点仍 401：匿名短路只覆盖上面两条 GET。
    expect(src).toContain("return NextResponse.json({ error: '未登录' }, { status: 401");
  });

  it("我的站点视图：anonymous 标志走登录提示，401 兜底分支仍在", () => {
    const view = read("src/components/user-center/custom-sites-view.tsx");
    expect(view).toContain("data.anonymous");
    expect(view).toContain("setState('anonymous')");
    expect(view).toContain("if (res.status === 401) throw new Error('ANON')");
  });
});
