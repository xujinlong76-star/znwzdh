/**
 * /drama 页内搜剧 + 题材筛选测试（U-D2）。
 *
 * 验收口径：题材筛选与搜剧名可叠加；日历标题无题材、只参与搜剧名；
 * 空结果返回空数组（调用方如实写“这个题材暂无收录”，不拿别的题材凑数）。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  collectDramaExtraResults,
  countDramasWithGenres,
  dramaGenreOptions,
  dramaTitleMatches,
  filterFeaturedDramas,
} from "../src/lib/drama-search";
import { loadDramaFeatured, type DramaFeatured } from "../src/lib/drama-featured";
import type {
  DramaCalendarResponse,
  DramaRankingsResponse,
} from "../src/lib/rest-contracts.generated";

function featured(title: string, genres?: string[]): DramaFeatured {
  return {
    title,
    platformSiteId: "nav-557388e01d50",
    platformTitle: "红果短剧",
    url: "https://example.com/drama",
    linkNote: "剧目页",
    episodesKnown: null,
    totalEpisodes: null,
    ...(genres ? { genres } : {}),
    check: { kind: "none", reason: "测试" },
  };
}

const DRAMAS = [
  featured("万妖图录传 第十四季", ["玄幻"]),
  featured("魔神人生：弃子问天 第二季", ["玄幻"]),
  featured("漂亮的恶意"),
  featured("装穷提亲，娶到全家嫌弃的她", ["恋爱"]),
];

function rankings(): DramaRankingsResponse {
  return {
    ok: true,
    status: "ok",
    fetchedAt: 1,
    lists: [
      {
        kind: "rebo",
        label: "热播榜",
        sourceUrl: "https://example.com/rebo",
        sourceName: "搜短剧热播榜",
        fetchedAt: 1,
        sourceDateModified: null,
        status: "ok",
        lastError: null,
        droppedTitles: 0,
        entries: [
          { rank: 1, title: "王妈在顾家当保姆后全家只会搞笑了", key: "王妈", detailUrl: "https://example.com/1", metric: 5001, metricLabel: "热度", rating: 9.1, favorites: 347, shares: null, likes: 902.7, totalEpisodes: 86, genre: "喜剧", actors: [] },
          { rank: 2, title: "万妖图录传 第十四季", key: "万妖", detailUrl: "https://example.com/2", metric: 4000, metricLabel: "热度", rating: null, favorites: 100, shares: null, likes: 200, totalEpisodes: 202, genre: "玄幻", actors: [] },
        ],
      },
      {
        kind: "reso",
        label: "热搜榜",
        sourceUrl: "https://example.com/reso",
        sourceName: "搜短剧热搜榜",
        fetchedAt: 1,
        sourceDateModified: null,
        status: "ok",
        lastError: null,
        droppedTitles: 0,
        entries: [],
      },
      {
        kind: "shoucang",
        label: "收藏榜",
        sourceUrl: "https://example.com/shoucang",
        sourceName: "搜短剧收藏榜",
        fetchedAt: 1,
        sourceDateModified: null,
        status: "ok",
        lastError: null,
        droppedTitles: 0,
        entries: [],
      },
    ],
  };
}

function calendar(): DramaCalendarResponse {
  return {
    ok: true,
    status: "ok",
    fetchedAt: 1,
    sourceDateModified: null,
    sourceName: "搜短剧预约榜",
    sourceUrl: "https://example.com/yuyue",
    lastError: null,
    days: [
      { date: "2026-11-30", label: "11月30日", items: [{ title: "他深情侵入2", premiereDate: "2026-11-30", reservations: 100, rawLabel: "预告" }] },
    ],
    monthPending: [
      { month: 12, label: "12月", overdue: false, items: [{ title: "雾锁情迷2", reservations: 50, rawLabel: "预告" }] },
    ],
    expired: [],
    recentlyDropped: [],
    recentChanges: [],
  };
}

describe("filterFeaturedDramas", () => {
  it("无筛选时全量；题材筛选只留该题材（无题材的剧不参与）", () => {
    expect(filterFeaturedDramas(DRAMAS, "", "")).toHaveLength(4);
    expect(filterFeaturedDramas(DRAMAS, "", "玄幻").map((d) => d.title)).toEqual([
      "万妖图录传 第十四季",
      "魔神人生：弃子问天 第二季",
    ]);
    expect(filterFeaturedDramas(DRAMAS, "", "种田")).toEqual([]);
  });

  it("搜剧名与题材筛选可叠加", () => {
    expect(filterFeaturedDramas(DRAMAS, "万妖", "玄幻").map((d) => d.title)).toEqual([
      "万妖图录传 第十四季",
    ]);
    expect(filterFeaturedDramas(DRAMAS, "万妖", "恋爱")).toEqual([]);
    expect(filterFeaturedDramas(DRAMAS, "恶意", "").map((d) => d.title)).toEqual([
      "漂亮的恶意",
    ]);
  });
});

describe("dramaTitleMatches", () => {
  it("空查询全命中；子串命中；大小写与空白归一化", () => {
    expect(dramaTitleMatches("万妖图录传 第十四季", "")).toBe(true);
    expect(dramaTitleMatches("万妖图录传 第十四季", "万妖")).toBe(true);
    expect(dramaTitleMatches("万妖图录传 第十四季", "万妖图录传第十四季")).toBe(true);
    expect(dramaTitleMatches("万妖图录传 第十四季", "魔神")).toBe(false);
  });
});

describe("dramaGenreOptions", () => {
  it("题材并集按次数倒序；日历标题不进 chips", () => {
    const options = dramaGenreOptions(DRAMAS, rankings());
    expect(options).toEqual([
      { name: "玄幻", count: 3 },
      { name: "恋爱", count: 1 },
      { name: "喜剧", count: 1 },
    ]);
  });

  it("榜单未加载时只用热门 18 的题材", () => {
    expect(dramaGenreOptions(DRAMAS, null)).toEqual([
      { name: "玄幻", count: 2 },
      { name: "恋爱", count: 1 },
    ]);
  });
});

describe("collectDramaExtraResults", () => {
  it("搜剧名：榜单条目与日历标题都命中；同名去重", () => {
    const res = collectDramaExtraResults(rankings(), calendar(), "万妖", "");
    expect(res.ranking.map((r) => r.title)).toEqual(["万妖图录传 第十四季"]);
    expect(res.calendar).toEqual([]);
    const res2 = collectDramaExtraResults(rankings(), calendar(), "深情", "");
    expect(res2.ranking).toEqual([]);
    expect(res2.calendar).toEqual([{ title: "他深情侵入2", label: "预计 2026-11-30 上线" }]);
  });

  it("题材筛选时日历标题不参与；榜单条目按题材过滤", () => {
    const res = collectDramaExtraResults(rankings(), calendar(), "", "玄幻");
    expect(res.ranking.map((r) => r.title)).toEqual(["万妖图录传 第十四季"]);
    expect(res.calendar).toEqual([]);
  });

  it("月份待定与过期区的日历标题同样可搜", () => {
    const res = collectDramaExtraResults(rankings(), calendar(), "雾锁", "");
    expect(res.calendar).toEqual([{ title: "雾锁情迷2", label: "12月待上线" }]);
  });
});

describe("U-397 搜索框占位示例必须搜得到", () => {
  it("「红果」是平台名不是剧名、0 命中；「万妖图录」命中真实剧名", () => {
    const { dramas } = loadDramaFeatured();
    expect(dramas.length).toBe(18);
    expect(filterFeaturedDramas(dramas, "红果", "")).toEqual([]);
    expect(filterFeaturedDramas(dramas, "万妖图录", "").map((d) => d.title)).toEqual([
      "万妖图录传 第十四季",
    ]);
  });

  it("源码守卫：占位文案不再拿「红果」举例，只举真实剧名", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "..", "src/components/drama-content.tsx"), "utf8");
    expect(src).not.toContain("「红果」");
    expect(src).toContain("「万妖图录」");
  });
});

describe("U-398 有题材标签的热门剧数是算出来的", () => {
  it("夹具：只数 genres 非空的剧", () => {
    expect(countDramasWithGenres(DRAMAS)).toBe(3);
    expect(countDramasWithGenres([])).toBe(0);
    expect(countDramasWithGenres([featured("无题材剧")])).toBe(0);
  });

  it("真实 featured.json：8 部有题材（旧文案手写 7 部是错的）", () => {
    const { dramas } = loadDramaFeatured();
    expect(countDramasWithGenres(dramas)).toBe(8);
  });

  it("源码守卫：文案用 countDramasWithGenres，不再手写「7 部」", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "..", "src/components/drama-content.tsx"), "utf8");
    expect(src).toContain("countDramasWithGenres");
    expect(src).toContain("featuredGenreCount");
    expect(src).not.toContain("热门剧里 7 部有题材标签");
    expect(src).not.toContain("热门剧里 8 部有题材标签");
  });
});
