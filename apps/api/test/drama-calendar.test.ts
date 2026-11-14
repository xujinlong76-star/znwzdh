/**
 * 短剧开播日历（drama_calendar_refresh）任务测试。
 *
 * 用临时库 + 注入的夹具预约榜 HTML，不走真实网络。
 * 夹具卡片结构照抄搜短剧预约榜实测 markup：标题 div 后紧跟一行
 * `mt-2 line-clamp-1` 档期行（“预告 / N万人预约 / 预计M月D日上线”）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { createContext, type AppContext } from "../src/context.ts";
import {
  handleDramaCalendarRefresh,
  loadDramaCalendarSnapshot,
} from "../src/jobs/tasks/drama-calendar.task.ts";
import {
  buildCalendarSnapshot,
  buildDramaCalendarView,
  DRAMA_CALENDAR_SNAPSHOT_KEY,
  parseYuyueList,
  type DramaCalendarSnapshot,
  type YuyueEntry,
} from "../src/drama/calendar.ts";

/** 2026-11-14 18:00 CST（与可行性报告实测同一天）。 */
const NOW = Date.parse("2026-11-14T18:00:00+08:00");
const YUYUE_URL = "https://www.soduanju.com/paihang/yuyue.html";

function card(title: string, meta: string): string {
  return (
    `<div class="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white">${meta}</div>` +
    `<div class="flex grow flex-col p-3"><div class="line-clamp-2 min-h-[2.9rem]">` +
    `<div class="text-base font-semibold leading-6 text-slate-700 dark:text-navy-100">${title}</div></div>` +
    `<div class="mt-2 line-clamp-1 text-sm text-slate-500 dark:text-navy-300">${meta}</div>` +
    `<div class="mt-1 text-xs text-slate-400 dark:text-navy-300">言情 / 古代</div></div>`
  );
}

function yuyueHtml(cards: string[]): string {
  return (
    `<html><head><script type="application/ld+json">{"@type":"ItemList","dateModified":"2026-11-14T18:25:51+08:00"}</script></head>` +
    `<body>${cards.join("")}</body></html>`
  );
}

function entry(title: string, rawLabel: string, premiereDate: string | null, month: number, day: number | null, kind: YuyueEntry["dateKind"]): YuyueEntry {
  return {
    title,
    key: title,
    dateKind: kind,
    month,
    year: 2026,
    day,
    premiereDate,
    reservations: null,
    rawLabel,
  };
}

describe("parseYuyueList", () => {
  it("精确到日 / 仅到月 / 即将上线三分开，非档期卡跳过", () => {
    const html = yuyueHtml([
      card("他深情侵入2", "预告 / 546.1万人预约 / 预计11月30日上线"),
      card("步步登阶2", "预告 / 320.2万人预约 / 预计11月18日上线"),
      card("雾锁情迷2", "预告 / 100万人预约 / 预计12月上线"),
      card("昼以继夜3", "预告 / 443.3万人预约 / 预计2月上线"),
      card("某新剧", "预告 / 471.2万人预约 / 即将上线"),
      // 非档期卡：标题后第一行 mt-2 是体裁行，没有档期信息
      `<div class="flex grow flex-col p-3"><div class="text-base font-semibold leading-6 text-slate-700">体裁卡剧名</div>` +
        `<div class="mt-2 line-clamp-1 text-sm text-slate-500">玄幻言情 / 古代言情 / 打脸</div></div>`,
    ]);
    const entries = parseYuyueList(html, NOW);
    expect(entries.map((e) => e.title)).toEqual([
      "他深情侵入2",
      "步步登阶2",
      "雾锁情迷2",
      "昼以继夜3",
      "某新剧",
    ]);
    const [a, b, c, d, e] = entries;
    expect(a?.dateKind).toBe("day");
    expect(a?.premiereDate).toBe("2026-11-30");
    expect(a?.reservations).toBe(546.1);
    expect(b?.premiereDate).toBe("2026-11-18");
    expect(c?.dateKind).toBe("month");
    expect(c?.month).toBe(12);
    expect(c?.premiereDate).toBeNull();
    expect(d?.month).toBe(2);
    expect(d?.year).toBe(2027);
    expect(e?.dateKind).toBe("unknown");
    expect(e?.month).toBe(0);
  });

  it("同一剧名只取第一次出现", () => {
    const html = yuyueHtml([
      card("步步登阶2", "预告 / 320.2万人预约 / 预计11月18日上线"),
      card("步步登阶2", "预告 / 320.2万人预约 / 预计11月18日上线"),
    ]);
    expect(parseYuyueList(html, NOW)).toHaveLength(1);
  });

  it("年份规则：只落后 1 个月算当年（过期），落后更多算次年", () => {
    const html = yuyueHtml([
      card("上月剧", "预告 / 10万人预约 / 预计10月5日上线"),
      card("明年剧", "预告 / 10万人预约 / 预计2月5日上线"),
    ]);
    const entries = parseYuyueList(html, NOW);
    expect(entries[0]?.premiereDate).toBe("2026-10-05");
    expect(entries[1]?.premiereDate).toBe("2027-02-05");
  });

  it("空页面返回空数组", () => {
    expect(parseYuyueList("", NOW)).toEqual([]);
  });
});

describe("buildCalendarSnapshot", () => {
  it("改档留痕：同一剧名预计日期变化记 from → to", () => {
    const prev: DramaCalendarSnapshot = {
      version: 1,
      source: "soduanju-yuyue",
      sourceUrl: YUYUE_URL,
      sourceName: "搜短剧预约榜",
      fetchedAt: NOW - 86_400_000,
      sourceDateModified: null,
      entries: [entry("绝地生还第三季", "预计11月14日上线", "2026-11-14", 11, 14, "day")],
      changes: [],
      dropped: [],
      lastError: null,
      lastOkAt: NOW - 86_400_000,
    };
    const next = buildCalendarSnapshot(
      prev,
      [entry("绝地生还第三季", "预计11月21日上线", "2026-11-21", 11, 21, "day")],
      NOW,
      null,
    );
    expect(next.changes).toHaveLength(1);
    expect(next.changes[0]).toMatchObject({
      title: "绝地生还第三季",
      from: "2026-11-14",
      to: "2026-11-21",
    });
  });

  it("下榜留痕：上一轮有、本轮无的条目进 dropped，不静默消失", () => {
    const prev: DramaCalendarSnapshot = {
      version: 1,
      source: "soduanju-yuyue",
      sourceUrl: YUYUE_URL,
      sourceName: "搜短剧预约榜",
      fetchedAt: NOW - 86_400_000,
      sourceDateModified: null,
      entries: [entry("少夫人来自东北3", "预计11月14日上线", "2026-11-14", 11, 14, "day")],
      changes: [],
      dropped: [],
      lastError: null,
      lastOkAt: NOW - 86_400_000,
    };
    const next = buildCalendarSnapshot(prev, [], NOW, null);
    expect(next.dropped).toHaveLength(1);
    expect(next.dropped[0]).toMatchObject({
      title: "少夫人来自东北3",
      lastDate: "2026-11-14",
    });
    expect(next.entries).toEqual([]);
  });

  it("日期不变不记改档", () => {
    const prev: DramaCalendarSnapshot = {
      version: 1,
      source: "soduanju-yuyue",
      sourceUrl: YUYUE_URL,
      sourceName: "搜短剧预约榜",
      fetchedAt: NOW - 86_400_000,
      sourceDateModified: null,
      entries: [entry("步步登阶2", "预计11月18日上线", "2026-11-18", 11, 18, "day")],
      changes: [],
      dropped: [],
      lastError: null,
      lastOkAt: NOW - 86_400_000,
    };
    const next = buildCalendarSnapshot(
      prev,
      [entry("步步登阶2", "预计11月18日上线", "2026-11-18", 11, 18, "day")],
      NOW,
      null,
    );
    expect(next.changes).toEqual([]);
  });
});

describe("buildDramaCalendarView", () => {
  const snapshot: DramaCalendarSnapshot = {
    version: 1,
    source: "soduanju-yuyue",
    sourceUrl: YUYUE_URL,
    sourceName: "搜短剧预约榜",
    fetchedAt: NOW,
    sourceDateModified: "2026-11-14T18:25:51+08:00",
    entries: [
      entry("步步登阶2", "预计11月18日上线", "2026-11-18", 11, 18, "day"),
      entry("他深情侵入2", "预计11月30日上线", "2026-11-30", 11, 30, "day"),
      entry("过期剧", "预计11月10日上线", "2026-11-10", 11, 10, "day"),
      { ...entry("雾锁情迷2", "预计12月上线", null, 12, null, "month"), year: 2026 },
      { ...entry("上月剧", "预计10月上线", null, 10, null, "month"), year: 2026 },
      entry("某新剧", "即将上线", null, 0, null, "unknown"),
    ],
    changes: [{ title: "绝地生还第三季", from: "2026-11-14", to: "2026-11-21", at: NOW }],
    dropped: [],
    lastError: null,
    lastOkAt: NOW,
  };

  it("未来 14 天按日分组；窗口外精确日期不进日历格；过期进 expired", () => {
    const view = buildDramaCalendarView(snapshot, NOW);
    expect(view.status).toBe("ok");
    expect(view.days).toHaveLength(14);
    const day18 = view.days.find((d) => d.date === "2026-11-18");
    expect(day18?.items.map((i) => i.title)).toEqual(["步步登阶2"]);
    expect(day18?.label).toContain("11月18日");
    // 11-30 在 14 天窗口外：不在任何一天里，也不算过期
    expect(view.days.flatMap((d) => d.items.map((i) => i.title))).not.toContain("他深情侵入2");
    expect(view.expired.map((i) => i.title)).toEqual(["过期剧"]);
  });

  it("仅到月的进月份待定区；已过月份标 overdue；无日期的不展示", () => {
    const view = buildDramaCalendarView(snapshot, NOW);
    expect(view.monthPending.map((g) => g.label)).toEqual(["12月", "10月"]);
    expect(view.monthPending.find((g) => g.month === 10)?.overdue).toBe(true);
    expect(view.monthPending.find((g) => g.month === 12)?.overdue).toBe(false);
    expect(view.monthPending.flatMap((g) => g.items.map((i) => i.title))).not.toContain("某新剧");
    expect(view.recentChanges).toHaveLength(1);
  });

  it("无快照时 status empty，各区为空", () => {
    const view = buildDramaCalendarView(null, NOW);
    expect(view.status).toBe("empty");
    expect(view.days).toEqual([]);
    expect(view.fetchedAt).toBeNull();
  });

  it("lastError 非空时 status stale", () => {
    const view = buildDramaCalendarView({ ...snapshot, lastError: "预约榜返回 HTTP 500" }, NOW);
    expect(view.status).toBe("stale");
    expect(view.days.find((d) => d.date === "2026-11-18")?.items).toHaveLength(1);
  });
});

describe("handleDramaCalendarRefresh", () => {
  let dir: string;
  let ctx: AppContext;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "navhub-drama-calendar-"));
    const config = loadConfig({
      mode: "lite",
      sqlitePath: join(dir, "drama-calendar.db"),
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

  function fakeFetch(body: string, status = 200) {
    return async (url: string) => {
      expect(url).toBe(YUYUE_URL);
      return { status, body };
    };
  }

  function manyCards(n: number): string[] {
    return Array.from({ length: n }, (_, i) =>
      card(`填充剧${i + 1}`, `预告 / ${10 + i}万人预约 / 预计12月上线`),
    );
  }

  it("成功抓取写快照、记事件", async () => {
    const html = yuyueHtml([
      card("步步登阶2", "预告 / 320.2万人预约 / 预计11月18日上线"),
      ...manyCards(30),
    ]);
    const summary = await handleDramaCalendarRefresh(ctx, {
      fetchImpl: fakeFetch(html),
      now: () => NOW,
    });
    expect(summary.ok).toBe(true);
    expect(summary.entries).toBe(31);
    expect(summary.dayPrecise).toBe(1);
    const snap = await loadDramaCalendarSnapshot(ctx);
    expect(snap?.fetchedAt).toBe(NOW);
    expect(snap?.sourceDateModified).toBe("2026-11-14T18:25:51+08:00");
    expect(snap?.lastError).toBeNull();
    const rows = await ctx.repo.raw(
      "SELECT meta FROM events WHERE kind =? ORDER BY id DESC LIMIT 1",
      ["drama_calendar_refresh"],
    );
    expect(rows.length).toBe(1);
    expect(JSON.parse(String(rows[0]?.meta)).ok).toBe(true);
  });

  it("抓取失败保留上一日快照、只记 lastError", async () => {
    const before = await loadDramaCalendarSnapshot(ctx);
    expect(before).not.toBeNull();
    const summary = await handleDramaCalendarRefresh(ctx, {
      fetchImpl: fakeFetch("", 500),
      now: () => NOW + 1000,
    });
    expect(summary.ok).toBe(false);
    expect(summary.keptEntries).toBe(before?.entries.length);
    const after = await loadDramaCalendarSnapshot(ctx);
    expect(after?.entries).toEqual(before?.entries);
    expect(after?.fetchedAt).toBe(before?.fetchedAt);
    expect(after?.lastError).toContain("HTTP 500");
  });

  it("解析条目过少视为疑似改版，不覆盖快照", async () => {
    const before = await loadDramaCalendarSnapshot(ctx);
    const html = yuyueHtml([card("孤剧", "预告 / 1万人预约 / 预计11月18日上线")]);
    const summary = await handleDramaCalendarRefresh(ctx, {
      fetchImpl: fakeFetch(html),
      now: () => NOW + 2000,
    });
    expect(summary.ok).toBe(false);
    expect(summary.error).toContain("条目过少");
    const after = await loadDramaCalendarSnapshot(ctx);
    expect(after?.entries).toEqual(before?.entries);
  });

  it("第二轮改档记进 changes", async () => {
    const html = yuyueHtml([
      card("步步登阶2", "预告 / 320.2万人预约 / 预计11月20日上线"),
      ...manyCards(30),
    ]);
    const summary = await handleDramaCalendarRefresh(ctx, {
      fetchImpl: fakeFetch(html),
      now: () => NOW + 86_400_000,
    });
    expect(summary.ok).toBe(true);
    const snap = await loadDramaCalendarSnapshot(ctx);
    const change = snap?.changes.find((c) => c.title === "步步登阶2");
    expect(change).toMatchObject({ from: "2026-11-18", to: "2026-11-20" });
    // 改档后快照仍可直接读出新日期
    const stored = await ctx.repo.getSystemState<DramaCalendarSnapshot>(DRAMA_CALENDAR_SNAPSHOT_KEY);
    expect(stored?.entries.find((e) => e.title === "步步登阶2")?.premiereDate).toBe("2026-11-20");
  });
});
