/**
 * 短剧真榜单解析 + 快照 + 视图测试（U-D1）。
 *
 * 固件说明：卡片骨架与文本值取自 2026-11-17 实测的搜短剧三榜页
 * （rebo/reso/shoucang），只删掉了 <img> 与 <svg>（解析器不读它们），
 * class 与文本节点逐字保留。数值断言即当时榜单的真实值。
 */
import { describe, expect, it } from "vitest";
import {
  buildDramaRankingsView,
  buildRankingsSnapshot,
  extractRankingsDateModified,
  parseRankingList,
  RANKINGS_MIN_ENTRIES,
  type DramaRankingsSnapshot,
  type RankingEntry,
} from "../src/drama/ranking-lists.ts";

/** 按真实卡片骨架拼一张卡（class 与文本节点与源站一致）。 */
function card(opts: {
  slug: string;
  title: string;
  left: string;
  right: string;
  meta: string;
  tag?: string;
  detailKind?: "duanju" | "manju";
}): string {
  const kind = opts.detailKind ?? "duanju";
  return (
    `<a href="/${kind}/${opts.slug}" title="短剧《${opts.title}》" class="group card card-hover overflow-hidden">` +
    `<div class="relative block overflow-hidden rounded-lg pb-[150%]">` +
    `<div class="absolute bottom-2 left-2 max-w-[70%] truncate rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white">${opts.left}</div>` +
    `<div class="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white">${opts.right}</div>` +
    `</div>` +
    `<div class="flex grow flex-col p-3">` +
    `<div class="line-clamp-2 min-h-[2.9rem]"><div class="text-base font-semibold leading-6 text-slate-700 transition-colors group-hover:text-primary dark:text-navy-100 dark:group-hover:text-accent-light">${opts.title}</div></div>` +
    `<div class="mt-2 line-clamp-1 text-sm text-slate-500 dark:text-navy-300">${opts.meta}</div>` +
    (opts.tag
      ? `<div class="mt-1 line-clamp-1 text-xs text-slate-400 dark:text-navy-400">${opts.tag}</div>`
      : "") +
    `</div></a>`
  );
}

function entry(overrides: Partial<RankingEntry> & { title: string }): RankingEntry {
  return {
    rank: 1,
    key: overrides.title.trim().toLowerCase(),
    detailUrl: `https://www.soduanju.com/duanju/${overrides.title}.html`,
    metric: null,
    metricLabel: null,
    rating: null,
    favorites: null,
    shares: null,
    likes: null,
    totalEpisodes: null,
    genre: null,
    actors: [],
    ...overrides,
  };
}

describe("parseRankingList", () => {
  it("热播榜首卡：全部数字与题材都解析出来", () => {
    const html = card({
      slug: "wangmazaigujiadangbaomuhouquanjiazhihuigaoxiaole.html",
      title: "王妈在顾家当保姆后全家只会搞笑了",
      left: "5001万热度",
      right: "全 86 集",
      meta: "评分9.1 / 347万收藏 / 902.7万次点赞",
      tag: "喜剧 / 王志欣 / 何雅馨",
    });
    const { entries, droppedTitles } = parseRankingList(html, "rebo");
    expect(droppedTitles).toBe(0);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      rank: 1,
      title: "王妈在顾家当保姆后全家只会搞笑了",
      detailUrl:
        "https://www.soduanju.com/duanju/wangmazaigujiadangbaomuhouquanjiazhihuigaoxiaole.html",
      metric: 5001,
      metricLabel: "热度",
      rating: 9.1,
      favorites: 347,
      likes: 902.7,
      totalEpisodes: 86,
      genre: "喜剧",
      actors: ["王志欣", "何雅馨"],
    });
  });

  it("缺失的数字留 null，不拿别的数凑（热播榜第 3 名无评分）", () => {
    const html = card({
      slug: "maidiaoyanglaofangnatianwochonghuoxinsheng.html",
      title: "卖掉养老房那天，我重获新生",
      left: "4848万热度",
      right: "全 64 集",
      meta: "66万收藏 / 144.8万次点赞",
      tag: "家庭 / 董薇 / 穆森",
    });
    const { entries } = parseRankingList(html, "rebo");
    expect(entries[0]).toMatchObject({
      rating: null,
      favorites: 66,
      likes: 144.8,
      totalEpisodes: 64,
      genre: "家庭",
    });
  });

  it("热搜榜：主数字是热搜，meta 里没有评分与收藏也照实留空", () => {
    const html = card({
      slug: "wodechexiangyaowodeming.html",
      title: "我的车想要我的命",
      left: "115万热搜",
      right: "全 61 集",
      meta: "4312万热度 / 170.7万次点赞",
      tag: "悬疑 / 黄兴饶 / 范祺",
    });
    const { entries } = parseRankingList(html, "reso");
    expect(entries[0]).toMatchObject({
      metric: 115,
      metricLabel: "热搜",
      rating: null,
      favorites: null,
      likes: 170.7,
      totalEpisodes: 61,
      genre: "悬疑",
    });
  });

  it("收藏榜：分享代替收藏时解析 shares；题材行以格式词开头时跳过格式词", () => {
    const html = card({
      slug: "shanhunhoufuxianshengmajiazangbuzhule.html",
      title: "闪婚后，傅先生马甲藏不住了",
      left: "1107万收藏",
      right: "全 100 集",
      meta: "评分9.1 / 10.3万分享 / 1013万次点赞",
      tag: "真人剧 / 爱情 / 孙樾 / 徐艺真",
    });
    const { entries } = parseRankingList(html, "shoucang");
    expect(entries[0]).toMatchObject({
      metric: 1107,
      metricLabel: "收藏",
      rating: 9.1,
      favorites: null,
      shares: 10.3,
      likes: 1013,
      totalEpisodes: 100,
      genre: "爱情",
      actors: ["孙樾", "徐艺真"],
    });
  });

  it("题材行只有格式词与演员时题材为 null，不拿演员名冒充", () => {
    const html = card({
      slug: "jubaopen.html",
      title: "聚宝仙盆之杂灵根才是真BOSS第十四季",
      left: "6913万热度",
      right: "全 100 集",
      meta: "评分9.0 / 100万收藏 / 100万次点赞",
      tag: "3D / 贺平生 / 乔慧珠",
    });
    const { entries } = parseRankingList(html, "rebo");
    expect(entries[0]?.genre).toBeNull();
    expect(entries[0]?.actors).toEqual(["贺平生", "乔慧珠"]);
  });

  it("单字标题疑似截断行丢弃并计数", () => {
    const html =
      card({
        slug: "a.html",
        title: "不",
        left: "1万热度",
        right: "全 10 集",
        meta: "评分9.0",
        tag: "喜剧",
      }) +
      card({
        slug: "b.html",
        title: "正常剧名",
        left: "2万热度",
        right: "全 20 集",
        meta: "评分8.0",
        tag: "喜剧",
      });
    const { entries, droppedTitles } = parseRankingList(html, "rebo");
    expect(droppedTitles).toBe(1);
    expect(entries.map((e) => e.title)).toEqual(["正常剧名"]);
  });

  it("同一剧名只取第一次出现（榜首位置）", () => {
    const html =
      card({
        slug: "a.html",
        title: "重名剧",
        left: "100万热度",
        right: "全 10 集",
        meta: "评分9.0",
        tag: "喜剧",
      }) +
      card({
        slug: "b.html",
        title: "重名剧",
        left: "90万热度",
        right: "全 10 集",
        meta: "评分8.0",
        tag: "喜剧",
      });
    const { entries } = parseRankingList(html, "rebo");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.metric).toBe(100);
  });

  it("空 HTML 返回空列表", () => {
    expect(parseRankingList("", "rebo")).toEqual({ entries: [], droppedTitles: 0 });
  });

  it("manju 详情页地址同样解析（/manju/ 前缀）", () => {
    const html = card({
      slug: "wanyaotuluchuandishisiji.html",
      title: "万妖图录传第十四季",
      left: "100万热度",
      right: "全 202 集",
      meta: "评分9.5 / 10万收藏 / 20万次点赞",
      tag: "玄幻",
      detailKind: "manju",
    });
    const { entries } = parseRankingList(html, "rebo");
    expect(entries[0]?.detailUrl).toBe(
      "https://www.soduanju.com/manju/wanyaotuluchuandishisiji.html",
    );
    expect(entries[0]?.genre).toBe("玄幻");
  });
});

describe("extractRankingsDateModified", () => {
  it("取 JSON-LD 的 dateModified，取不到为 null", () => {
    expect(
      extractRankingsDateModified(`{"@type":"ItemList","dateModified":"2026-11-17T08:00:00+08:00"}`),
    ).toBe("2026-11-17T08:00:00+08:00");
    expect(extractRankingsDateModified("<html></html>")).toBeNull();
  });
});

function manyEntries(n: number, kind: "rebo" | "reso" | "shoucang"): RankingEntry[] {
  return Array.from({ length: n }, (_, i) =>
    entry({ title: `剧${i + 1}`, rank: i + 1, metric: 1000 - i }),
  );
}

describe("buildRankingsSnapshot", () => {
  it("三榜都成功时替换快照、清空 lastError", () => {
    const now = Date.now();
    const next = buildRankingsSnapshot(
      null,
      {
        rebo: { entries: manyEntries(25, "rebo"), droppedTitles: 0 },
        reso: { entries: manyEntries(34, "reso"), droppedTitles: 1 },
        shoucang: { entries: manyEntries(99, "shoucang"), droppedTitles: 0 },
      },
      now,
      { rebo: "2026-11-17T08:00:00+08:00" },
      {},
    );
    expect(next.version).toBe(1);
    expect(next.lists.rebo.entries).toHaveLength(25);
    expect(next.lists.rebo.lastError).toBeNull();
    expect(next.lists.rebo.lastOkAt).toBe(now);
    expect(next.lists.reso.droppedTitles).toBe(1);
    expect(next.lists.shoucang.entries).toHaveLength(99);
    expect(next.lists.shoucang.sourceDateModified).toBeNull();
  });

  it("单榜解析过少时只保留该榜上一轮快照、记 lastError，其余榜照常更新", () => {
    const prev = buildRankingsSnapshot(
      null,
      {
        rebo: { entries: manyEntries(25, "rebo"), droppedTitles: 0 },
        reso: { entries: manyEntries(34, "reso"), droppedTitles: 0 },
        shoucang: { entries: manyEntries(99, "shoucang"), droppedTitles: 0 },
      },
      1000,
      {},
      {},
    );
    const next = buildRankingsSnapshot(
      prev,
      {
        rebo: { entries: manyEntries(5, "rebo"), droppedTitles: 0 },
        reso: { entries: manyEntries(34, "reso"), droppedTitles: 0 },
        shoucang: { entries: manyEntries(99, "shoucang"), droppedTitles: 0 },
      },
      2000,
      {},
      {},
    );
    expect(next.lists.rebo.entries).toHaveLength(25);
    expect(next.lists.rebo.lastError).toMatch(/解析条目过少/);
    expect(next.lists.rebo.lastOkAt).toBe(1000);
    expect(next.lists.reso.lastError).toBeNull();
  });

  it("单榜抓取失败（parsed 为 null）时保留上一轮、记失败原因", () => {
    const prev = buildRankingsSnapshot(
      null,
      {
        rebo: { entries: manyEntries(25, "rebo"), droppedTitles: 0 },
        reso: { entries: manyEntries(34, "reso"), droppedTitles: 0 },
        shoucang: { entries: manyEntries(99, "shoucang"), droppedTitles: 0 },
      },
      1000,
      {},
      {},
    );
    const next = buildRankingsSnapshot(
      prev,
      { rebo: null, reso: { entries: manyEntries(34, "reso"), droppedTitles: 0 } },
      2000,
      {},
      { rebo: "热播榜返回 HTTP 500" },
    );
    expect(next.lists.rebo.entries).toHaveLength(25);
    expect(next.lists.rebo.lastError).toBe("热播榜返回 HTTP 500");
    expect(next.lists.shoucang.entries).toHaveLength(99);
    expect(next.lists.shoucang.lastError).toMatch(/未抓到/);
  });

  it(`阈值边界：恰好 ${RANKINGS_MIN_ENTRIES} 条算成功`, () => {
    const next = buildRankingsSnapshot(
      null,
      { rebo: { entries: manyEntries(20, "rebo"), droppedTitles: 0 } },
      1000,
      {},
      {},
    );
    expect(next.lists.rebo.lastError).toBeNull();
    expect(next.lists.rebo.entries).toHaveLength(20);
  });
});

describe("buildDramaRankingsView", () => {
  function snapshotWith(
    counts: Partial<Record<"rebo" | "reso" | "shoucang", number>>,
    errors: Partial<Record<"rebo" | "reso" | "shoucang", string | null>> = {},
  ): DramaRankingsSnapshot {
    const lists = {} as DramaRankingsSnapshot["lists"];
    for (const kind of ["rebo", "reso", "shoucang"] as const) {
      const n = counts[kind] ?? 0;
      lists[kind] = {
        kind,
        label: kind,
        sourceUrl: `https://example.invalid/${kind}`,
        sourceName: kind,
        fetchedAt: 1000,
        sourceDateModified: null,
        entries: manyEntries(n, kind),
        droppedTitles: 0,
        lastError: errors[kind] ?? null,
        lastOkAt: n > 0 ? 1000 : null,
      };
    }
    return { version: 1, source: "soduanju-rankings", fetchedAt: 1000, lists };
  }

  it("每榜只展示前 30 部", () => {
    const view = buildDramaRankingsView(snapshotWith({ shoucang: 99 }));
    expect(view.lists.find((l) => l.kind === "shoucang")?.entries).toHaveLength(30);
    expect(view.lists.find((l) => l.kind === "shoucang")?.entries[0]?.rank).toBe(1);
    expect(view.lists.find((l) => l.kind === "shoucang")?.entries[29]?.rank).toBe(30);
  });

  it("三榜都成功时 status ok", () => {
    const view = buildDramaRankingsView(snapshotWith({ rebo: 25, reso: 34, shoucang: 99 }));
    expect(view.status).toBe("ok");
    expect(view.lists.every((l) => l.status === "ok")).toBe(true);
  });

  it("任一榜失败时整体 stale，该榜仍下发上一日快照", () => {
    const view = buildDramaRankingsView(
      snapshotWith({ rebo: 25, reso: 34, shoucang: 99 }, { reso: "热搜榜返回 HTTP 500" }),
    );
    expect(view.status).toBe("stale");
    expect(view.lists.find((l) => l.kind === "reso")?.status).toBe("stale");
    expect(view.lists.find((l) => l.kind === "reso")?.entries).toHaveLength(30);
  });

  it("从未抓到过时 status empty、各榜为空", () => {
    const view = buildDramaRankingsView(null);
    expect(view.status).toBe("empty");
    expect(view.lists.every((l) => l.status === "empty" && l.entries.length === 0)).toBe(true);
    expect(view.fetchedAt).toBeNull();
  });
});

import { afterAll, beforeAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { createContext, type AppContext } from "../src/context.ts";
import {
  handleDramaRankingsRefresh,
  loadDramaRankingsSnapshot,
} from "../src/jobs/tasks/drama-rankings.task.ts";
import { RANKING_LISTS } from "../src/drama/ranking-lists.ts";

/** 2026-11-17 18:00 CST（与三榜可行性探针同一天）。 */
const NOW = Date.parse("2026-11-17T18:00:00+08:00");

describe("handleDramaRankingsRefresh", () => {
  let dir: string;
  let ctx: AppContext;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "navhub-drama-rankings-"));
    const config = loadConfig({
      mode: "lite",
      sqlitePath: join(dir, "drama-rankings.db"),
      embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
      llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
      fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
      corsOrigins: ["*"],
    });
    ctx = await createContext(config);
  });

  afterAll(async () => {
    await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function listHtml(kind: string, n: number): string {
    const cards = Array.from({ length: n }, (_, i) =>
      card({
        slug: `${kind}-ju-${i + 1}.html`,
        title: `${kind}剧${i + 1}`,
        left: `${1000 - i}万热度`,
        right: `全 ${10 + i} 集`,
        meta: "评分9.0 / 10万收藏 / 20万次点赞",
        tag: "喜剧 / 演员甲 / 演员乙",
      }),
    ).join("");
    return `<html><head><script type="application/ld+json">{"@type":"ItemList","dateModified":"2026-11-17T08:00:00+08:00"}</script></head><body>${cards}</body></html>`;
  }

  function fakeFetch(
    bodies: Partial<Record<string, { status: number; body: string }>>,
  ) {
    return async (url: string) => {
      const config = RANKING_LISTS.find((c) => c.url === url);
      expect(config).toBeDefined();
      const entry = bodies[config!.kind];
      expect(entry).toBeDefined();
      return { status: entry!.status, body: entry!.body };
    };
  }

  it("三榜都成功时写快照、记事件", async () => {
    const summary = await handleDramaRankingsRefresh(ctx, {
      fetchImpl: fakeFetch({
        rebo: { status: 200, body: listHtml("rebo", 25) },
        reso: { status: 200, body: listHtml("reso", 34) },
        shoucang: { status: 200, body: listHtml("shoucang", 99) },
      }),
      now: () => NOW,
    });
    expect(summary.ok).toBe(true);
    expect(summary.lists.rebo.entries).toBe(25);
    expect(summary.lists.reso.entries).toBe(34);
    expect(summary.lists.shoucang.entries).toBe(99);
    const snap = await loadDramaRankingsSnapshot(ctx);
    expect(snap?.fetchedAt).toBe(NOW);
    expect(snap?.lists.rebo.sourceDateModified).toBe("2026-11-17T08:00:00+08:00");
    expect(snap?.lists.rebo.lastError).toBeNull();
    const rows = await ctx.repo.raw(
      "SELECT meta FROM events WHERE kind =? ORDER BY id DESC LIMIT 1",
      ["drama_rankings_refresh"],
    );
    expect(rows.length).toBe(1);
    expect(JSON.parse(String(rows[0]?.meta)).ok).toBe(true);
  });

  it("单榜失败只记该榜 lastError、保留上一日快照，其余榜照常更新", async () => {
    const before = await loadDramaRankingsSnapshot(ctx);
    expect(before).not.toBeNull();
    const summary = await handleDramaRankingsRefresh(ctx, {
      fetchImpl: fakeFetch({
        rebo: { status: 200, body: listHtml("rebo", 25) },
        reso: { status: 500, body: "" },
        shoucang: { status: 200, body: listHtml("shoucang", 99) },
      }),
      now: () => NOW + 1000,
    });
    expect(summary.ok).toBe(false);
    expect(summary.lists.reso.error).toContain("HTTP 500");
    expect(summary.lists.rebo.entries).toBe(25);
    const after = await loadDramaRankingsSnapshot(ctx);
    expect(after?.lists.reso.entries).toEqual(before?.lists.reso.entries);
    expect(after?.lists.reso.lastError).toContain("HTTP 500");
    expect(after?.lists.rebo.lastError).toBeNull();
    expect(after?.lists.rebo.fetchedAt).toBe(NOW + 1000);
  });

  it("单榜解析条目过少视为疑似改版，不覆盖该榜快照", async () => {
    const before = await loadDramaRankingsSnapshot(ctx);
    const summary = await handleDramaRankingsRefresh(ctx, {
      fetchImpl: fakeFetch({
        rebo: { status: 200, body: listHtml("rebo", 1) },
        reso: { status: 200, body: listHtml("reso", 34) },
        shoucang: { status: 200, body: listHtml("shoucang", 99) },
      }),
      now: () => NOW + 2000,
    });
    expect(summary.ok).toBe(false);
    expect(summary.lists.rebo.error).toContain("解析条目过少");
    const after = await loadDramaRankingsSnapshot(ctx);
    expect(after?.lists.rebo.entries).toEqual(before?.lists.rebo.entries);
    expect(after?.lists.rebo.lastError).toContain("解析条目过少");
  });
});
