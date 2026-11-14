/**
 * 短剧新集检查（drama_update_check）任务测试。
 *
 * 用临时库 + 注入的夹具榜单 HTML，不走真实网络。
 */
import { afterAll, beforeAll, describe, expect, it} from "vitest";
import { randomUUID} from "node:crypto";
import { mkdtempSync, rmSync} from "node:fs";
import { tmpdir} from "node:os";
import { dirname, join} from "node:path";
import { fileURLToPath} from "node:url";
import { loadConfig} from "../src/config.ts";
import { createContext, type AppContext} from "../src/context.ts";
import { handleDramaUpdateCheck} from "../src/jobs/tasks/drama-check.task.ts";
import { dramaKeyFor, loadDramaFeaturedForCheck, type DramaFeatured} from "../src/drama/featured.ts";
import { parseRankingEpisode} from "../src/drama/ranking.ts";
import { parseZongyimiSubject} from "../src/drama/zongyimi.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const NOW = 1792000000000;
const KUAISHOU = "nav-536bfaba406";
const HONGUO = "nav-557388e01d50";
const RANK_URL = "https://www.zongyimi.com/drama/rankings/kuaishou/2026-11-10/";

/** 夹具榜单页：标题在 JSON-LD 出现 1 次（1500 字符内无集数）、表格行出现 2 次（带集数）。 */
function rankHtml(title: string, ep: number): string {
 const filler = "<!-- " + "x".repeat(1600) + " -->";
 return `<html><head><script type="application/ld+json">{"name": "${title}", "position": 1}</script>${filler}</head><body><table><tr><td>${title}</td><td>更新至 ${ep} 集</td></tr><tr><td>${title}</td><td>共 ${ep} 集</td></tr></table></body></html>`;
}

/** 夹具综艺迷作品页：与真实页同结构（h1 + dl.facts：总集数 / 资料更新）。 */
function subjectHtml(title: string, ep: number, updatedAt = "2026-11-14"): string {
 return `<html><head><title>${title} - 综艺迷</title></head><body><h1>${title}</h1><dl class="facts"><div><dt>总集数</dt><dd>${ep} 集</dd></div><div><dt>总时长</dt><dd>6010 秒</dd></div><div><dt>首次投放</dt><dd>2026-11-08</dd></div><div><dt>资料更新</dt><dd>${updatedAt}</dd></div></dl></body></html>`;
}

function subjectDrama(title: string, subjectId: string, titleMatch: string): DramaFeatured {
 const url = `https://www.zongyimi.com/drama/subject/${subjectId}/`;
 return {
 title,
 platformSiteId: KUAISHOU,
 platformTitle: "快手短剧",
 url,
 linkNote: "剧目页",
 episodesKnown: null,
 totalEpisodes: null,
 check: { kind: "zongyimi-subject", url, titleMatch},
};
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
async function followDrama(userId: string, drama: DramaFeatured, remind = true): Promise<void> {
 await ctx.repo.run(
 "INSERT INTO watch_entries (id, user_id, drama_key, title, platform_site_id, platform_title, play_url, episode, priority, cadence, remind, dismissed_on, last_progress_at, created_at, updated_at, deleted_at) " +
 "VALUES (?,?,?,?,?,?,?,?,?,'{\"kind\":\"unknown\"}',?,NULL,0,?,?,NULL)",
 [randomUUID(), userId, dramaKeyFor(drama.platformSiteId, drama.title), drama.title, drama.platformSiteId, drama.platformTitle, drama.url, 0, "normal", remind? 1: 0, NOW, NOW],
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

describe("parseZongyimiSubject", () => {
 it("精确提取总集数与资料更新日期", () => {
 const parsed = parseZongyimiSubject(subjectHtml("我隐藏身份，找到一个好儿媳", 80), "我隐藏身份");
 expect(parsed.episode).toBe(80);
 expect(parsed.sourceUpdatedAt).toBe("2026-11-14");
});

 it("无总集数字段时回退旧榜单解析", () => {
 const html = "<html><body><h1>病弱千金往地一躺，全家慌了</h1><p>更新至 65 集</p></body></html>";
 const parsed = parseZongyimiSubject(html, "病弱千金");
 expect(parsed.episode).toBe(65);
 expect(parsed.sourceUpdatedAt).toBeNull();
});

 it("多个总集数值不一致时返回 null", () => {
 const html =
 "<dl><div><dt>总集数</dt><dd>80 集</dd></div>" +
 "<div><dt>总集数</dt><dd>81 集</dd></div></dl>";
 expect(parseZongyimiSubject(html, "我隐藏身份").episode).toBeNull();
});

 it("空页面返回 null，资料更新日期仍可单独提取", () => {
 expect(parseZongyimiSubject("", "我隐藏身份")).toEqual({ episode: null, sourceUpdatedAt: null});
 const html = "<dl><div><dt>资料更新</dt><dd>2026-11-14</dd></div></dl>";
 expect(parseZongyimiSubject(html, "我隐藏身份")).toEqual({ episode: null, sourceUpdatedAt: "2026-11-14"});
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

 it("zongyimi-subject：三部剧首轮各记基线 80/65/70、不通知，事件 checked=3 并记资料更新日期", async () => {
 const user = "drama-test-subject-first";
 const d1 = subjectDrama("我隐藏身份，找到一个好儿媳", "396695190416", "我隐藏身份");
 const d2 = subjectDrama("病弱千金往地一躺，全家慌了", "117244640035", "病弱千金");
 const d3 = subjectDrama("为白月光弃我，孟小姐离婚不回头", "438522362760", "为白月光弃我");
 await followDrama(user, d1);
 await followDrama(user, d2);
 await followDrama(user, d3);
 const { impl} = fakeFetch(new Map([
 [d1.check.url!, { status: 200, body: subjectHtml(d1.title, 80)}],
 [d2.check.url!, { status: 200, body: subjectHtml(d2.title, 65)}],
 [d3.check.url!, { status: 200, body: subjectHtml(d3.title, 70, "2026-11-13")}],
 ]));
 await handleDramaUpdateCheck(ctx, { fetchImpl: impl, dramas: [d1, d2, d3], now: () => NOW});
 expect((await ctx.repo.getDramaCheckState(user, dramaKeyFor(d1.platformSiteId, d1.title)))?.latestEpisode).toBe(80);
 expect((await ctx.repo.getDramaCheckState(user, dramaKeyFor(d2.platformSiteId, d2.title)))?.latestEpisode).toBe(65);
 expect((await ctx.repo.getDramaCheckState(user, dramaKeyFor(d3.platformSiteId, d3.title)))?.latestEpisode).toBe(70);
 expect(await outboxFor(user)).toHaveLength(0);
 const meta = await latestCheckEvent();
 expect(meta?.checked).toBe(3);
 expect(meta?.failed).toEqual([]);
 expect(meta?.guarded).toEqual([]);
 const updatedAt = meta?.sourceUpdatedAt as Record<string, string> | undefined;
 expect(updatedAt?.[dramaKeyFor(d1.platformSiteId, d1.title)]).toBe("2026-11-14");
 expect(updatedAt?.[dramaKeyFor(d2.platformSiteId, d2.title)]).toBe("2026-11-14");
 expect(updatedAt?.[dramaKeyFor(d3.platformSiteId, d3.title)]).toBe("2026-11-13");
});

 it("zongyimi-subject：解析不出集数时记 last_error、不通知", async () => {
 const user = "drama-test-subject-noparse";
 const d = subjectDrama("解析失败测试剧", "100000000004", "解析失败");
 await followDrama(user, d);
 await ctx.repo.upsertDramaCheckState(user, dramaKeyFor(d.platformSiteId, d.title), { latestEpisode: 64, lastCheckedAt: NOW - 1000, lastError: null}, NOW - 1000);
 const { impl} = fakeFetch(new Map([[d.check.url!, { status: 200, body: "<html><body>病弱千金 资料页</body></html>"}]]));
 await handleDramaUpdateCheck(ctx, { fetchImpl: impl, dramas: [d], now: () => NOW});
 const state = await ctx.repo.getDramaCheckState(user, dramaKeyFor(d.platformSiteId, d.title));
 expect(state?.latestEpisode).toBe(64);
 expect(state?.lastError).toBe("综艺迷作品页未解析出集数");
 expect(await outboxFor(user)).toHaveLength(0);
});

 it("关掉提醒的用户不收通知、基线仍更新；开着提醒的用户收到通知", async () => {
 const onUser = "drama-test-remind-on";
 const offUser = "drama-test-remind-off";
 // 用独立剧名：同一临时库里其他测试的用户也关注了“病弱千金”，
 // 共用 drama_key 会让他们的旧基线也参与本轮通知计数。
 const d = subjectDrama("提醒开关测试剧", "100000000001", "提醒开关");
 await followDrama(onUser, d, true);
 await followDrama(offUser, d, false);
 for (const user of [onUser, offUser]) {
 await ctx.repo.upsertDramaCheckState(user, dramaKeyFor(d.platformSiteId, d.title), { latestEpisode: 64, lastCheckedAt: NOW - 1000, lastError: null}, NOW - 1000);
}
 const { impl} = fakeFetch(new Map([[d.check.url!, { status: 200, body: subjectHtml(d.title, 65)}]]));
 await handleDramaUpdateCheck(ctx, { fetchImpl: impl, dramas: [d], now: () => NOW});
 expect(await outboxFor(onUser)).toHaveLength(1);
 expect(await outboxFor(offUser)).toHaveLength(0);
 // 关提醒用户的基线仍更新到 65：以后重开提醒不会把这次增长当新集补发。
 expect((await ctx.repo.getDramaCheckState(offUser, dramaKeyFor(d.platformSiteId, d.title)))?.latestEpisode).toBe(65);
 expect((await ctx.repo.getDramaCheckState(offUser, dramaKeyFor(d.platformSiteId, d.title)))?.lastError).toBeNull();
 const meta = await latestCheckEvent();
 expect(meta?.notified).toBe(1);
 expect(meta?.updated).toBe(1);
});

 it("单日跳涨 >20 集只记基线、不通知，last_error 与事件 guarded 记一笔待复核", async () => {
 const user = "drama-test-jump";
 const d = subjectDrama("跳涨护栏测试剧", "100000000002", "跳涨护栏");
 await followDrama(user, d, true);
 await ctx.repo.upsertDramaCheckState(user, dramaKeyFor(d.platformSiteId, d.title), { latestEpisode: 40, lastCheckedAt: NOW - 1000, lastError: null}, NOW - 1000);
 const { impl} = fakeFetch(new Map([[d.check.url!, { status: 200, body: subjectHtml(d.title, 65)}]]));
 await handleDramaUpdateCheck(ctx, { fetchImpl: impl, dramas: [d], now: () => NOW});
 const state = await ctx.repo.getDramaCheckState(user, dramaKeyFor(d.platformSiteId, d.title));
 expect(state?.latestEpisode).toBe(65);
 expect(state?.lastError).toContain("跳涨");
 expect(await outboxFor(user)).toHaveLength(0);
 const meta = await latestCheckEvent();
 expect(meta?.notified).toBe(0);
 const guarded = meta?.guarded as Array<Record<string, unknown>> | undefined;
 expect(guarded).toHaveLength(1);
 expect(guarded?.[0]?.from).toBe(40);
 expect(guarded?.[0]?.to).toBe(65);
});

 it("单日跳涨恰好 20 集不触发护栏、正常通知", async () => {
 const user = "drama-test-jump-edge";
 const d = subjectDrama("跳涨边界测试剧", "100000000003", "跳涨边界");
 await followDrama(user, d, true);
 await ctx.repo.upsertDramaCheckState(user, dramaKeyFor(d.platformSiteId, d.title), { latestEpisode: 45, lastCheckedAt: NOW - 1000, lastError: null}, NOW - 1000);
 const { impl} = fakeFetch(new Map([[d.check.url!, { status: 200, body: subjectHtml(d.title, 65)}]]));
 await handleDramaUpdateCheck(ctx, { fetchImpl: impl, dramas: [d], now: () => NOW});
 expect(await outboxFor(user)).toHaveLength(1);
 const meta = await latestCheckEvent();
 expect(meta?.guarded).toEqual([]);
});
});

describe("drama-featured.json 检查配置", () => {
 it("ranking 检查不许用写死日期的榜单页 URL（日期一冻结就报旧集数）", () => {
 const loaded = loadDramaFeaturedForCheck({ repoRoot: REPO_ROOT});
 expect(loaded.error).toBeUndefined();
 expect(loaded.dramas.length).toBeGreaterThan(0);
 for (const drama of loaded.dramas) {
 if (drama.check.kind !== "ranking") continue;
 expect(drama.check.url).toBeDefined();
 expect(drama.check.url).not.toMatch(/\/20\d\d-\d\d-\d\d\//);
}
 // 2026-11-14 实测：3 部快手剧已跌出 2026-11-13 榜前 100，
 // 冻结的 2026-11-10 页仍解析出旧集数 70/65/57，检查已失效，须停查。
 // 2026-11-15：其中 2 部改走综艺迷作品页（zongyimi-subject）恢复检查；
 // 第 2 批白月光（作品页已实抓核实：总集数 70 集、资料更新 2026-11-13）同法接入，
 // 仍停查的只剩考上清北（资料更新停在 2026-11-06，暂缓）。
 for (const title of ["考上清北，却交不起五千学费"]) {
 const drama = loaded.dramas.find((d) => d.title === title);
 expect(drama?.check.kind).toBe("none");
 expect(drama?.check.reason).toContain("2026-11-06");
}
 for (const [title, subjectId] of [
 ["病弱千金往地一躺，全家慌了", "117244640035"],
 ["我隐藏身份，找到一个好儿媳", "396695190416"],
 ["为白月光弃我，孟小姐离婚不回头", "438522362760"],
 ] as const) {
 const drama = loaded.dramas.find((d) => d.title === title);
 expect(drama?.check.kind).toBe("zongyimi-subject");
 expect(drama?.check.url).toBe(`https://www.zongyimi.com/drama/subject/${subjectId}/`);
 expect(drama?.check.url).not.toMatch(/\/20\d\d-\d\d-\d\d\//);
}
});
});
