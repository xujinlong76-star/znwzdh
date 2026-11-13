/**
 * 短剧新集检查（drama_update_check）任务测试。
 *
 * 用临时库 + 注入的夹具榜单 HTML，不走真实网络。
 */
import { afterAll, beforeAll, describe, expect, it} from "vitest";
import { randomUUID} from "node:crypto";
import { mkdtempSync, rmSync} from "node:fs";
import { tmpdir} from "node:os";
import { join} from "node:path";
import { loadConfig} from "../src/config.ts";
import { createContext, type AppContext} from "../src/context.ts";
import { handleDramaUpdateCheck} from "../src/jobs/tasks/drama-check.task.ts";
import { dramaKeyFor, type DramaFeatured} from "../src/drama/featured.ts";
import { parseRankingEpisode} from "../src/drama/ranking.ts";

const NOW = 1792000000000;
const KUAISHOU = "nav-536bfaba406";
const HONGUO = "nav-557388e01d50";
const RANK_URL = "https://www.zongyimi.com/drama/rankings/kuaishou/2026-11-10/";

/** 夹具榜单页：标题在 JSON-LD 出现 1 次（1500 字符内无集数）、表格行出现 2 次（带集数）。 */
function rankHtml(title: string, ep: number): string {
 const filler = "<!-- " + "x".repeat(1600) + " -->";
 return `<html><head><script type="application/ld+json">{"name": "${title}", "position": 1}</script>${filler}</head><body><table><tr><td>${title}</td><td>更新至 ${ep} 集</td></tr><tr><td>${title}</td><td>共 ${ep} 集</td></tr></table></body></html>`;
}

function rankingDrama(title: string, siteId: string, platform: string): DramaFeatured {
 return {
 title,
 platformSiteId: siteId,
 platformTitle: platform,
 url: RANK_URL,
 linkNote: "榜单页",
 episodesKnown: null,
 totalEpisodes: null,
 check: { kind: "ranking", url: RANK_URL, titleMatch: title},
};
}

let dir: string;
let ctx: AppContext;

beforeAll(async () => {
 dir = mkdtempSync(join(tmpdir(), "navhub-drama-check-"));
 const config = loadConfig({
 mode: "lite",
 sqlitePath: join(dir, "drama-check.db"),
 embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false},
 llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000},
 fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1"},
 corsOrigins: ["*"],
});
 ctx = await createContext(config);
});

afterAll(async () => {
 await ctx.close();
 rmSync(dir, { recursive: true, force: true});
});

/** 给用户加一条追剧清单（drama_key 与关注按钮的算法一致）。 */
async function followDrama(userId: string, drama: DramaFeatured): Promise<void> {
 await ctx.repo.run(
 "INSERT INTO watch_entries (id, user_id, drama_key, title, platform_site_id, platform_title, play_url, episode, priority, cadence, remind, dismissed_on, last_progress_at, created_at, updated_at, deleted_at) " +
 "VALUES (?,?,?,?,?,?,?,?,?,'{\"kind\":\"unknown\"}',1,NULL,0,?,?,NULL)",
 [randomUUID(), userId, dramaKeyFor(drama.platformSiteId, drama.title), drama.title, drama.platformSiteId, drama.platformTitle, drama.url, 0, "normal", NOW, NOW],
);
}

async function outboxFor(userId: string): Promise<Record<string, unknown>[]> {
 return ctx.repo.raw("SELECT * FROM notification_outbox WHERE identity =? AND kind =? ORDER BY created_at ASC", [userId, "drama_update"]);
}

async function latestCheckEvent(): Promise<Record<string, unknown> | null> {
 const rows = await ctx.repo.raw("SELECT meta FROM events WHERE kind =? ORDER BY id DESC LIMIT 1", ["drama_update_check"]);
 const row = rows[0];
 return row? (JSON.parse(String(row.meta)) as Record<string, unknown>): null;
}

describe("parseRankingEpisode", () => {
 it("榜单行集数一致时采信", () => {
 expect(parseRankingEpisode(rankHtml("为白月光弃我，孟小姐离婚不回头", 70), "为白月光弃我")).toBe(70);
});

 it("榜单页没有集数时返回 null", () => {
 expect(parseRankingEpisode("<html><body>为白月光弃我 上榜</body></html>", "为白月光弃我")).toBeNull();
});

 it("各出现位置的集数不一致时返回 null", () => {
 const html = "<table><tr><td>为白月光弃我</td><td>70 集</td></tr><tr><td>为白月光弃我</td><td>71 集</td></tr></table>";
 expect(parseRankingEpisode(html, "为白月光弃我")).toBeNull();
});

 it("空页面或空标题返回 null", () => {
 expect(parseRankingEpisode("", "为白月光弃我")).toBeNull();
 expect(parseRankingEpisode(rankHtml("为白月光弃我，孟小姐离婚不回头", 70), "")).toBeNull();
});
});

function noneDrama(title: string): DramaFeatured {
 return {
 title,
 platformSiteId: HONGUO,
 platformTitle: "红果短剧",
 url: "https://www.zongyimi.com/drama/rankings/native/2026-11-10/",
 linkNote: "榜单页",
 episodesKnown: 177,
 totalEpisodes: 177,
 check: { kind: "none", reason: "已完结共 177 集，无新集可等"},
};
}

function fakeFetch(pages: Map<string, { status: number; body: string}>): { calls: string[]; impl: (url: string) => Promise<{ status: number; body: string}>} {
 const calls: string[] = [];
 return {
 calls,
 impl: async (url: string) => {
 calls.push(url);
 return pages.get(url)?? { status: 404, body: ""};
},
};
}

describe("handleDramaUpdateCheck", () => {
 const drama = () => rankingDrama("为白月光弃我，孟小姐离婚不回头", KUAISHOU, "快手短剧");

 it("首次运行记基线、不通知", async () => {
 const user = "drama-test-first";
 const d = drama();
 await followDrama(user, d);
 const { impl} = fakeFetch(new Map([[RANK_URL, { status: 200, body: rankHtml("为白月光弃我，孟小姐离婚不回头", 70)}]]));
 await handleDramaUpdateCheck(ctx, { fetchImpl: impl, dramas: [d], now: () => NOW});
 const state = await ctx.repo.getDramaCheckState(user, dramaKeyFor(d.platformSiteId, d.title));
 expect(state?.latestEpisode).toBe(70);
 expect(state?.lastError).toBeNull();
 expect(await outboxFor(user)).toHaveLength(0);
});

 it("变大通知一次，重复跑不重复通知", async () => {
 const user = "drama-test-grow";
 const d = drama();
 await followDrama(user, d);
 await ctx.repo.upsertDramaCheckState(user, dramaKeyFor(d.platformSiteId, d.title), { latestEpisode: 69, lastCheckedAt: NOW - 1000, lastError: null}, NOW - 1000);
 const { impl} = fakeFetch(new Map([[RANK_URL, { status: 200, body: rankHtml("为白月光弃我，孟小姐离婚不回头", 70)}]]));
 await handleDramaUpdateCheck(ctx, { fetchImpl: impl, dramas: [d], now: () => NOW});
 const rows = await outboxFor(user);
 expect(rows).toHaveLength(1);
 expect(String(rows[0]?.title)).toContain("第 70 集");
 await handleDramaUpdateCheck(ctx, { fetchImpl: impl, dramas: [d], now: () => NOW});
 expect(await outboxFor(user)).toHaveLength(1);
 const state = await ctx.repo.getDramaCheckState(user, dramaKeyFor(d.platformSiteId, d.title));
 expect(state?.latestEpisode).toBe(70);
});

 it("无变化不通知", async () => {
 const user = "drama-test-same";
 const d = drama();
 await followDrama(user, d);
 await ctx.repo.upsertDramaCheckState(user, dramaKeyFor(d.platformSiteId, d.title), { latestEpisode: 70, lastCheckedAt: NOW - 1000, lastError: null}, NOW - 1000);
 const { impl} = fakeFetch(new Map([[RANK_URL, { status: 200, body: rankHtml("为白月光弃我，孟小姐离婚不回头", 70)}]]));
 await handleDramaUpdateCheck(ctx, { fetchImpl: impl, dramas: [d], now: () => NOW});
 expect(await outboxFor(user)).toHaveLength(0);
 const state = await ctx.repo.getDramaCheckState(user, dramaKeyFor(d.platformSiteId, d.title));
 expect(state?.latestEpisode).toBe(70);
 expect(state?.lastError).toBeNull();
});

 it("抓取失败保旧值、记 last_error、不通知、整轮继续", async () => {
 const user = "drama-test-fail";
 const d = drama();
 const other = rankingDrama("病弱千金往地一躺，全家慌了", KUAISHOU, "快手短剧");
 const FAIL_URL = RANK_URL + "?fail=1";
 const failing: DramaFeatured = {...d, check: { kind: "ranking", url: FAIL_URL, titleMatch: d.title}};
 await followDrama(user, d);
 await followDrama(user, other);
 await ctx.repo.upsertDramaCheckState(user, dramaKeyFor(d.platformSiteId, d.title), { latestEpisode: 69, lastCheckedAt: NOW - 1000, lastError: null}, NOW - 1000);
 const { calls, impl} = fakeFetch(new Map([[RANK_URL, { status: 200, body: rankHtml("病弱千金往地一躺，全家慌了", 65)}]]));
 const throwing = async (url: string) => {
 if (url === FAIL_URL) throw new Error("fixture fetch failed");
 return impl(url);
};
 await handleDramaUpdateCheck(ctx, { fetchImpl: throwing, dramas: [failing, other], now: () => NOW});
 const state = await ctx.repo.getDramaCheckState(user, dramaKeyFor(d.platformSiteId, d.title));
 expect(state?.latestEpisode).toBe(69);
 expect(state?.lastError).toContain("fixture fetch failed");
 expect(await outboxFor(user)).toHaveLength(0);
 const otherState = await ctx.repo.getDramaCheckState(user, dramaKeyFor(other.platformSiteId, other.title));
 expect(otherState?.latestEpisode).toBe(65);
 expect(calls).toContain(RANK_URL);
});

 it("榜单页解析不出集数时记 last_error、不通知", async () => {
 const user = "drama-test-noparse";
 const d = drama();
 await followDrama(user, d);
 await ctx.repo.upsertDramaCheckState(user, dramaKeyFor(d.platformSiteId, d.title), { latestEpisode: 69, lastCheckedAt: NOW - 1000, lastError: null}, NOW - 1000);
 const { impl} = fakeFetch(new Map([[RANK_URL, { status: 200, body: "<html><body>为白月光弃我，孟小姐离婚不回头 上榜</body></html>"}]]));
 await handleDramaUpdateCheck(ctx, { fetchImpl: impl, dramas: [d], now: () => NOW});
 const state = await ctx.repo.getDramaCheckState(user, dramaKeyFor(d.platformSiteId, d.title));
 expect(state?.latestEpisode).toBe(69);
 expect(state?.lastError).toBe("榜单页未解析出集数");
 expect(await outboxFor(user)).toHaveLength(0);
});

 it("none 剧目不触发抓取", async () => {
 const user = "drama-test-none";
 const d = drama();
 const nd = noneDrama("悍妻当家，靠美食扶起一家软骨头");
 await followDrama(user, d);
 await followDrama(user, nd);
 const { calls, impl} = fakeFetch(new Map([[RANK_URL, { status: 200, body: rankHtml("为白月光弃我，孟小姐离婚不回头", 70)}]]));
 await handleDramaUpdateCheck(ctx, { fetchImpl: impl, dramas: [nd, d], now: () => NOW});
 expect(calls).toEqual([RANK_URL]);
});

 it("整轮结果记进事件流", async () => {
 const user = "drama-test-event";
 const d = drama();
 const nd = noneDrama("悍妻当家，靠美食扶起一家软骨头");
 await followDrama(user, d);
 const { impl} = fakeFetch(new Map([[RANK_URL, { status: 200, body: rankHtml("为白月光弃我，孟小姐离婚不回头", 70)}]]));
 await handleDramaUpdateCheck(ctx, { fetchImpl: impl, dramas: [d, nd], now: () => NOW});
 const meta = await latestCheckEvent();
 expect(meta).not.toBeNull();
 expect(meta?.checked).toBe(1);
 expect(meta?.skipped).toBe(1);
 expect(meta?.failed).toEqual([]);
 expect(meta?.updated).toBe(0);
 expect(meta?.notified).toBe(0);
 expect(meta?.loadSkipped).toBe(0);
});
});
