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
const DOUYIN = "nav-e85ffe7e04f6";
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

function subjectDrama(title: string, subjectId: string, titleMatch: string, platformSiteId = KUAISHOU, platformTitle = "快手短剧"): DramaFeatured {
 const url = `https://www.zongyimi.com/drama/subject/${subjectId}/`;
 return {
 title,
 platformSiteId,
 platformTitle,
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

 it("总集数为“待补充”时不建基线、返回 null（资料更新日期仍记录）", () => {
 // 2026-11-15 实测：太奶奶 S5 作品页总集数就是“待补充”，非数字值绝不能
 // 解析成 0/NaN 后建出错误基线；该剧因此不接检查，待数值补上再复查。
 const html =
 "<dl class=\"facts\"><div><dt>总集数</dt><dd>待补充</dd></div>" +
 "<div><dt>总时长</dt><dd>待补充</dd></div>" +
 "<div><dt>资料更新</dt><dd>2026-11-02</dd></div></dl>";
 expect(parseZongyimiSubject(html, "太奶奶")).toEqual({ episode: null, sourceUpdatedAt: "2026-11-02"});
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

 it("zongyimi-subject：六部剧首轮各记基线 80/65/70/260/300/32、不通知，事件 checked=6 并记资料更新日期", async () => {
 const user = "drama-test-subject-first";
 const d1 = subjectDrama("我隐藏身份，找到一个好儿媳", "396695190416", "我隐藏身份");
 const d2 = subjectDrama("病弱千金往地一躺，全家慌了", "117244640035", "病弱千金");
 const d3 = subjectDrama("为白月光弃我，孟小姐离婚不回头", "438522362760", "为白月光弃我");
 // 第 2 批后 3 部（2026-11-15 实抓核实）：丑小鸭 S5 260 集（资料更新 2026-11-07）、
 // 聚宝仙盆 S15 300 集（2026-11-05）、漂亮的恶意 32 集（2026-11-13）。
 const d4 = subjectDrama("重生！丑小鸭逆袭成了万人迷 第五季", "253252418421", "丑小鸭", HONGUO, "红果短剧");
 const d5 = subjectDrama("聚宝仙盆之杂灵根才是真BOSS 第十五季", "173694925686", "聚宝仙盆", HONGUO, "红果短剧");
 const d6 = subjectDrama("漂亮的恶意", "282268810232", "漂亮的恶意", DOUYIN, "抖音短剧");
 await followDrama(user, d1);
 await followDrama(user, d2);
 await followDrama(user, d3);
 await followDrama(user, d4);
 await followDrama(user, d5);
 await followDrama(user, d6);
 const { impl} = fakeFetch(new Map([
 [d1.check.url!, { status: 200, body: subjectHtml(d1.title, 80)}],
 [d2.check.url!, { status: 200, body: subjectHtml(d2.title, 65)}],
 [d3.check.url!, { status: 200, body: subjectHtml(d3.title, 70, "2026-11-13")}],
 [d4.check.url!, { status: 200, body: subjectHtml(d4.title, 260, "2026-11-07")}],
 [d5.check.url!, { status: 200, body: subjectHtml(d5.title, 300, "2026-11-05")}],
 [d6.check.url!, { status: 200, body: subjectHtml(d6.title, 32, "2026-11-13")}],
 ]));
 await handleDramaUpdateCheck(ctx, { fetchImpl: impl, dramas: [d1, d2, d3, d4, d5, d6], now: () => NOW});
 expect((await ctx.repo.getDramaCheckState(user, dramaKeyFor(d1.platformSiteId, d1.title)))?.latestEpisode).toBe(80);
 expect((await ctx.repo.getDramaCheckState(user, dramaKeyFor(d2.platformSiteId, d2.title)))?.latestEpisode).toBe(65);
 expect((await ctx.repo.getDramaCheckState(user, dramaKeyFor(d3.platformSiteId, d3.title)))?.latestEpisode).toBe(70);
 expect((await ctx.repo.getDramaCheckState(user, dramaKeyFor(d4.platformSiteId, d4.title)))?.latestEpisode).toBe(260);
 expect((await ctx.repo.getDramaCheckState(user, dramaKeyFor(d5.platformSiteId, d5.title)))?.latestEpisode).toBe(300);
 expect((await ctx.repo.getDramaCheckState(user, dramaKeyFor(d6.platformSiteId, d6.title)))?.latestEpisode).toBe(32);
 expect(await outboxFor(user)).toHaveLength(0);
 const meta = await latestCheckEvent();
 expect(meta?.checked).toBe(6);
 expect(meta?.failed).toEqual([]);
 expect(meta?.guarded).toEqual([]);
 const updatedAt = meta?.sourceUpdatedAt as Record<string, string> | undefined;
 expect(updatedAt?.[dramaKeyFor(d1.platformSiteId, d1.title)]).toBe("2026-11-14");
 expect(updatedAt?.[dramaKeyFor(d2.platformSiteId, d2.title)]).toBe("2026-11-14");
 expect(updatedAt?.[dramaKeyFor(d3.platformSiteId, d3.title)]).toBe("2026-11-13");
 expect(updatedAt?.[dramaKeyFor(d4.platformSiteId, d4.title)]).toBe("2026-11-07");
 expect(updatedAt?.[dramaKeyFor(d5.platformSiteId, d5.title)]).toBe("2026-11-05");
 expect(updatedAt?.[dramaKeyFor(d6.platformSiteId, d6.title)]).toBe("2026-11-13");
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
 it("soduanju-subject：已完结剧首轮记基线、不通知；上映日不进 sourceUpdatedAt", async () => {
 const user = "drama-test-soduanju-first";
 const d: DramaFeatured = {
  title: "搜短剧测试剧",
  platformSiteId: HONGUO,
  platformTitle: "红果短剧",
  url: "https://www.soduanju.com/duanju/ceshiju.html",
  linkNote: "剧目页",
  episodesKnown: null,
  totalEpisodes: null,
  check: { kind: "soduanju-subject", url: "https://www.soduanju.com/duanju/ceshiju.html" },
 };
 await followDrama(user, d);
 // 夹具与真实详情页同结构：meta 行“全 86 集 · 2026-10-09”+ 已完结徽章。
 const body =
  `<div class="card mt-4 px-4 py-4 sm:px-5"><h2>搜短剧测试剧</h2>` +
  `<div class="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500">` +
  `<span>红果短剧</span><span class="text-slate-300">·</span><span>全 86 集</span>` +
  `<span class="text-slate-300">·</span><span>2026-10-09</span>` +
  `<span class="text-slate-300">·</span><span>总时长 2小时46分</span></div></div>` +
  `<div class="mt-2 flex items-center justify-between text-xs">` +
  `<span class="font-medium text-primary dark:text-accent-light">已完结</span></div>` +
  `<div>全 86 集</div>`;
 const { impl } = fakeFetch(new Map([[d.check.url!, { status: 200, body }]]));
 await handleDramaUpdateCheck(ctx, { fetchImpl: impl, dramas: [d], now: () => NOW });
 expect((await ctx.repo.getDramaCheckState(user, dramaKeyFor(d.platformSiteId, d.title)))?.latestEpisode).toBe(86);
 expect(await outboxFor(user)).toHaveLength(0);
 const meta = await latestCheckEvent();
 expect(meta?.checked).toBe(1);
 expect(meta?.failed).toEqual([]);
 // 上映日（2026-10-09）不是资料更新日，不进 sourceUpdatedAt。
 expect(meta?.sourceUpdatedAt).toEqual({});
});

 it("soduanju-subject：空壳详情页解析不出集数时记 last_error、保留旧值", async () => {
 const user = "drama-test-soduanju-noparse";
 const d: DramaFeatured = {
  title: "搜短剧空壳测试剧",
  platformSiteId: HONGUO,
  platformTitle: "红果短剧",
  url: "https://www.soduanju.com/duanju/kongke.html",
  linkNote: "剧目页",
  episodesKnown: null,
  totalEpisodes: null,
  check: { kind: "soduanju-subject", url: "https://www.soduanju.com/duanju/kongke.html" },
 };
 await followDrama(user, d);
 await ctx.repo.upsertDramaCheckState(user, dramaKeyFor(d.platformSiteId, d.title), { latestEpisode: 64, lastCheckedAt: NOW - 1000, lastError: null }, NOW - 1000);
 const { impl } = fakeFetch(new Map([[d.check.url!, { status: 200, body: "<html><head><title>搜短剧空壳测试剧</title></head><body><h2>搜短剧空壳测试剧</h2></body></html>" }]]));
 await handleDramaUpdateCheck(ctx, { fetchImpl: impl, dramas: [d], now: () => NOW });
 const state = await ctx.repo.getDramaCheckState(user, dramaKeyFor(d.platformSiteId, d.title));
 expect(state?.latestEpisode).toBe(64);
 expect(state?.lastError).toBe("搜短剧详情页未解析出集数");
 expect(await outboxFor(user)).toHaveLength(0);
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
 // 第 2 批后 3 部（丑小鸭 S5 260 集 / 聚宝仙盆 S15 300 集 / 漂亮的恶意 32 集，
 // 作品页实抓核实）同法接入；18 部精选剧可查 6 部，仍停查 12 部。
 // 仍停查的 12 部：少夫人来自东北 3（2026-11-18 #9 换剧：已完结全 96 集，check 仍 none）+ 本批 4 部新剧
 //（综艺迷暂无本季作品页）+ 太奶奶/和离/退役/悍妻/仿生迷踪 5 部固有停查 + 本轮新增 2 部
 //（和离 S2、满院 S6，已完结无新集可等）。计数仍为 12：新旧 #9 的 check.kind 均为 none，一换一，1+4+5+2 不变。
 for (const title of ["少夫人来自东北 3"]) {
 const drama = loaded.dramas.find((d) => d.title === title);
 expect(drama?.check.kind).toBe("none");
 expect(drama?.check.reason).toContain("已完结全 96 集");
}
 for (const [title, subjectId] of [
 ["病弱千金往地一躺，全家慌了", "117244640035"],
 ["我隐藏身份，找到一个好儿媳", "396695190416"],
 ["为白月光弃我，孟小姐离婚不回头", "438522362760"],
 ["重生！丑小鸭逆袭成了万人迷 第五季", "253252418421"],
 ["聚宝仙盆之杂灵根才是真BOSS 第十五季", "173694925686"],
 ["漂亮的恶意", "282268810232"],
 ] as const) {
 const drama = loaded.dramas.find((d) => d.title === title);
 expect(drama?.check.kind).toBe("zongyimi-subject");
 expect(drama?.check.url).toBe(`https://www.zongyimi.com/drama/subject/${subjectId}/`);
 expect(drama?.check.url).not.toMatch(/\/20\d\d-\d\d-\d\d\//);
}
});

 it("魔神人生 S2：三方证实总集数 586，episodesKnown 与 totalEpisodes 均锁 586、check 仍 none", () => {
 const loaded = loadDramaFeaturedForCheck({ repoRoot: REPO_ROOT});
 expect(loaded.error).toBeUndefined();
 const drama = loaded.dramas.find((d) => d.title === "魔神人生：弃子问天 第二季");
 expect(drama).toBeDefined();
 // 2026-11-15 三方证实：红果快照列至 586、Ignite Drama 标 586 集、366.me 写明共 586 集。
 // 2026-11-17 搜短剧详情页实抓核实：全 586 集、已完结（与三方证实一致），
 // 故 totalEpisodes 由 null 补为 586；已完结无新集可等，check 仍为 none
 //（soduanju-subject 解析器供连载新剧用，当前 0 部剧挂接）。
 expect(drama?.episodesKnown).toBe(586);
 expect(drama?.totalEpisodes).toBe(586);
 expect(drama?.check.kind).toBe("none");
});

 it("和离 S2 与满院 S6 补录：精选 18 部，两部新剧集数与链接锁定", () => {
 const loaded = loadDramaFeaturedForCheck({ repoRoot: REPO_ROOT});
 expect(loaded.error).toBeUndefined();
 expect(loaded.dramas.length).toBe(18);
 const heli = loaded.dramas.find((d) => d.title === "和离后我带女儿横扫魔域 第二季");
 expect(heli).toBeDefined();
 // 2026-11-15 三方证实：tahou 原文“足足 521 集”、YouTube“Complete 521 Episodes”、Ignite Drama 标 521 集；红果直链 curl 200。
 expect(heli?.episodesKnown).toBe(521);
 expect(heli?.totalEpisodes).toBe(521);
 expect(heli?.url).toBe("https://hongguoduanju.com/detail?series_id=7704261228037671998");
 expect(heli?.linkNote).toBe("剧目页");
 expect(heli?.check.kind).toBe("none");
 const manyuan = loaded.dramas.find((d) => d.title === "满院亲戚全是上古大妖 第六季");
 expect(manyuan).toBeDefined();
 // 2026-11-15 三方证实：aozhi“272 集”、366.me“共 272 集”、短剧工程榜单页上线 2026-10-30；红果直链未找回，暂用榜单页，reason 须写明。
 expect(manyuan?.episodesKnown).toBe(272);
 expect(manyuan?.totalEpisodes).toBe(272);
 expect(manyuan?.url).toBe("https://www.duanjugongcheng.com/cn/bangdan/ju/man-yuan-qin-qi-quan-shi-shang-gu-da-yao-di-liu-ji");
 expect(manyuan?.linkNote).toBe("榜单页");
 expect(manyuan?.check.kind).toBe("none");
 expect(manyuan?.check.reason).toContain("红果直链未找回");
});
});
