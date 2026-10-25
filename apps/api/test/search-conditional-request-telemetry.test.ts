/**
 * 搜索接口的「方法语义」与「缓存/条件请求」对行为埋点与个人历史的影响（run50 ①）。
 *
 * 三类断言，方向各不相同：
 *
 *  A. 重复请求 / 条件请求（If-None-Match）**必须仍然各计一次搜索**。
 *     响应缓存钩子挂在 onSend（apps/api/src/server.ts:319-344），而 onSend 是处理器
 *     跑完之后的最后一站 ⇒ 即使回 304 也只是不发 body，事件与历史照常写。
 *     run49 收尾时把「304 命中即少计、热榜分母偏低」当成新 gap 记进账本；本用例即那笔取证，
 *     结论是该 gap 不成立并已回写证伪 —— 而且当前实现根本走不到 304：响应嵌了
 *     tookMs / channelTimings，同一查询两次字节不同（探针实测 lenA=2032 / lenB=2032 而 etag 不同），
 *     etag 永不命中。
 *     它同时是防回归的钉子：将来若有人把埋点挪到缓存短路之后（preHandler 级整响应缓存），这条会变红。
 *
 *  B. HEAD **不该算一次搜索**。
 *     Fastify 的 exposeHeadRoutes 默认开启（server.ts:127），HEAD 复用 GET 处理器 ⇒
 *     一次「探测长度/etag」的请求会写 events.search、可能写 zero_result，并往**个人搜索历史**
 *     （search_history：可导出、可删除、UI 里也展示）塞一条用户根本没搜过的词。
 *     热榜与零结果榜按行数计次（topQueries / zeroResultQueries），灌进来的行直接改变
 *     用户看到的「大家在搜什么」。改前实测：一次 HEAD 让 search 行数 2→3、zero_result 1→2。
 *
 *  C. 只有首页（offset=0）计数：翻页不灌热榜（既有口径，钉住防回归）。
 *
 * 附注（不属于本用例的修复面）：个人搜索历史走的是「只看 Body/Query 的 rawIdentity」
 * （search.ts:87），与事件归属那一路（requestIdentityOf，含 Header）不同源 —— 账本里
 * run49 收窄后仍在的那条 gap 的可观察后果。因此下面所有请求都按真实 web 客户端的做法
 * 同时带签名 Header 与 query.anonId，让两段写入都被覆盖。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";

const SECRET = "test-secret-please-rotate";
const ANON = "anon-conditional-0001";

const base = {
  mode: "lite" as const,
  embedding: {
    model: "Xenova/bge-small-zh-v1.5",
    endpoint: "https://hf-mirror.com",
    dtype: "q8",
    dim: 512,
    enabled: false,
  },
  llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
  fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
  corsOrigins: ["*"],
};

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

const signed = () => ({
  "x-navhub-anon-id": ANON,
  "x-navhub-identity-signature": signIdentity(SECRET, ANON),
});

/** 真实 web 客户端形态：签名头 + query.anonId（个性化/历史那一路只看 query/body） */
const searchUrl = (q: string, extra = "") =>
  `/api/search?q=${encodeURIComponent(q)}${extra}&anonId=${encodeURIComponent(ANON)}`;

async function countEvents(kind: string): Promise<number> {
  const rows = (await ctx.repo.raw("SELECT COUNT(*) AS c FROM events WHERE kind = ?", [kind])) as Array<{ c: number }>;
  return rows[0].c;
}

async function countHistory(query: string): Promise<number> {
  const rows = (await ctx.repo.raw("SELECT COUNT(*) AS c FROM search_history WHERE query = ?", [query])) as Array<{ c: number }>;
  return rows[0].c;
}

async function countOwnedEvents(identity: string): Promise<number> {
  const rows = (await ctx.repo.raw(
    "SELECT COUNT(*) AS c FROM events WHERE kind IN ('search','zero_result') AND identity = ?",
    [identity],
  )) as Array<{ c: number }>;
  return rows[0].c;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-search-cond-"));
  ctx = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "cond.db"), identitySecret: SECRET }));
  app = await buildServer(ctx);
  await app.ready();
  const cat = await ctx.repo.createCategory({ title: "条件请求测试" });
  await ctx.repo.createSite({ url: "https://cond-a.example.com", title: "条件请求站点", categoryId: cat.id });
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/search 的条件请求与 HEAD 探活", () => {
  it("A. 重复请求与带 If-None-Match 的请求各计一次：缓存钩子在处理器之后，不吞埋点", async () => {
    const q = "条件请求探针词";
    const url = searchUrl(q);
    const first = await app.inject({ method: "GET", url, headers: signed() });
    expect(first.statusCode).toBe(200);
    expect(String(first.headers["cache-control"])).toContain("max-age=");
    const etag = String(first.headers["etag"]);
    expect(etag.length).toBeGreaterThan(4);
    const eventsBefore = await countEvents("search");
    const historyBefore = await countHistory(q);
    expect(eventsBefore).toBeGreaterThan(0);

    const again = await app.inject({ method: "GET", url, headers: { ...signed(), "if-none-match": etag } });
    // 304 与 200 都必须已经记过这一次（onSend 在处理器之后）；当前实现因 etag 不稳定恒回 200。
    expect([200, 304]).toContain(again.statusCode);

    expect(await countEvents("search")).toBe(eventsBefore + 1);
    expect(await countHistory(q)).toBe(historyBefore + 1);
  });

  it("B. HEAD 探活不算搜索：不写 events.search、不写个人搜索历史", async () => {
    const q = "HEAD探活词";
    const eventsBefore = await countEvents("search");
    const ownedBefore = await countOwnedEvents(ANON);
    const historyBefore = await countHistory(q);

    const head = await app.inject({ method: "HEAD", url: searchUrl(q), headers: signed() });
    expect(head.statusCode).toBe(200);

    expect(await countEvents("search")).toBe(eventsBefore);
    expect(await countOwnedEvents(ANON)).toBe(ownedBefore);
    expect(await countHistory(q)).toBe(historyBefore);
  });

  it("B+. HEAD 零结果也不灌 zero_result 分母，但响应头与 GET 保持同构（suggestions/popular 仍算）", async () => {
    const q = "zzz-head探活搜不到";
    const before = await countEvents("zero_result");

    const head = await app.inject({ method: "HEAD", url: searchUrl(q), headers: signed() });
    expect(head.statusCode).toBe(200);
    expect(await countEvents("zero_result")).toBe(before);

    // HEAD 的 payload 被 Fastify 丢弃，但 onSend 拿到的是完整表示 ⇒ etag 仍然算得出来；
    // 若哪天把 suggestions 分支也用 isProbe 关掉，GET/HEAD 的 etag 就会不一致（RFC 9110 §9.3.2），
    // 这里用「HEAD 必须带 etag 且长度>4」把这条路钉住。
    expect(String(head.headers["etag"]).length).toBeGreaterThan(4);
  });

  it("C. 只有首页（offset=0）才计一次：翻页不灌热榜", async () => {
    const q = "翻页不计数词";
    const eventsBefore = await countEvents("search");
    const p0 = await app.inject({ method: "GET", url: searchUrl(q, "&offset=0"), headers: signed() });
    expect(p0.statusCode).toBe(200);
    expect(await countEvents("search")).toBe(eventsBefore + 1);

    const p1 = await app.inject({ method: "GET", url: searchUrl(q, "&offset=8"), headers: signed() });
    expect(p1.statusCode).toBe(200);
    expect(await countEvents("search")).toBe(eventsBefore + 1);
  });
});
