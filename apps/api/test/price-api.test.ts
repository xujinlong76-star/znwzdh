/**
 * 价格数值字段：路由端到端测试（Batch 4 Phase 2 P2-2）。
 *
 * 仿 verify-api.test.ts（临时 SQLite + createContext + buildServer + 双用户 seed
 * + app.inject）。真实出站由注入的假定价页代替（setPriceScrapePageForTests），
 * 锁的是调用链与守卫，不是真实网络：
 *  - 匿名 401；他人收藏 / 不存在 / pending / archived → 同一个 404 body；
 *  - body 校验（金额 0/负数/超大/非整数、货币不在枚举、周期非法、免费档超长、
 *    source_url 跨域/非法协议/非法 URL）各 400；
 *  - 成功 200：verified_at 一律服务端时间，客户端传来的值直接忽略；
 *  - upsert 覆盖写：第二次写替换第一条，表里只有一条；
 *  - DELETE 幂等：有记录删 → deleted:true，无记录再删 → 200 deleted:false；
 *  - 对照表回填：POST 后 GET /api/compare 的 price 格 fresh、值已格式化；
 *    直接改库 verified_at 到 100 天前 → stale:true 且 verified 仍 true，
 *    到 200 天前 → verified:false 但值仍保留；
 *  - 抓取：候选列出且不自动写库（调 scrape 后读库仍是旧记录）；无 source_url
 *    400；robots 禁抓 → robots_disallowed 且不发站点请求；预算耗尽 → 429；
 *    超时（kind unverified）→ 候选为空、不写库；
 *  - NIT 2 来源防伪造：手工 POST 传 sourceType official_scrape 被强制改写为
 *    manual；只有凭抓取当场签发的 confirmToken 才能写 official_scrape，
 *    伪造/改金额/改货币/改周期/跨站/重放/过期凭证各 400 且不写库；
 *  - NIT 3 裸 ¥ 不推断货币：¥500 / ¥19.9 候选 currency 与 amountMinor 均为
 *    null、只给原文金额 amount；凭凭证确认时用户选 JPY → minor 按 ×1、
 *    选 CNY → 按 ×100，缺货币 400；
 *  - 导出含价格记录；注销删净（counts.sitePrices）。
 *
 * 诚实缺口：默认抓取（guardedFetch 真实出站）未被本文件覆盖——沙箱无稳定
 * 公网定价页可断言；锁的是注入缝处的调用次数与写库口径。
 * 注销测试必须放最后：deleteUserData 会删掉 USER 的全部数据（含收藏）。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { setSiteProbeRobotsCheckForTests, type SiteProbeOutcomeKind } from "../src/site-probe.ts";
import {
  expireScrapeConfirmTokenForTests,
  extractPriceCandidates,
  priceScrapeOutboundBudget,
  setPriceScrapePageForTests,
} from "../src/routes/site-prices.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

let siteAId = "";
let siteBId = "";
let otherSiteId = "";
let neverFavoritedSiteId = "";
let pendingSiteId = "";
let archivedSiteId = "";

const USER = "user-1";
const OTHER = "user-2";
const userHeaders = { "x-navhub-user-id": USER };
const otherHeaders = { "x-navhub-user-id": OTHER };
const anonHeaders = { "x-navhub-anon-id": "anon-1" };

const DAY_MS = 24 * 60 * 60 * 1000;

let scrapeCalls: string[] = [];
let scrapePage: { kind: SiteProbeOutcomeKind; status: number | null; body: string; reason: string } = {
  kind: "ok",
  status: 200,
  body: `<html><body><h1>定价</h1><p>基础版 ¥19.9/月，专业版 ¥99/月，企业版 $199/yr。</p></body></html>`,
  reason: "内容检测通过",
};

async function seed() {
  const cat = await ctx.repo.createCategory({ title: "效率办公", slug: "office" });
  const a = await ctx.repo.createSite({
    url: "https://price-a.example.com",
    title: "比价站 A",
    description: "本人收藏的待比价站",
    categoryId: cat.id,
    tags: ["PPT"],
  });
  siteAId = a.id;
  const b = await ctx.repo.createSite({
    url: "https://price-b.example.com",
    title: "比价站 B",
    description: "本人收藏的第二站",
    categoryId: cat.id,
    tags: ["PPT"],
  });
  siteBId = b.id;
  const other = await ctx.repo.createSite({
    url: "https://price-other.example.com",
    title: "别人的收藏",
    description: "只在 user-2 的收藏里",
    categoryId: cat.id,
    tags: ["PPT"],
  });
  otherSiteId = other.id;
  const never = await ctx.repo.createSite({
    url: "https://price-never.example.com",
    title: "无人收藏站",
    description: "谁都没收藏",
    categoryId: cat.id,
    tags: ["PPT"],
  });
  neverFavoritedSiteId = never.id;
  const pending = await ctx.repo.createSite({
    url: "https://price-pending.example.com",
    title: "待审站",
    description: "还在审核",
    categoryId: cat.id,
    tags: ["PPT"],
    status: "pending",
  });
  pendingSiteId = pending.id;
  const archived = await ctx.repo.createSite({
    url: "https://price-archived.example.com",
    title: "归档站",
    description: "已归档",
    categoryId: cat.id,
    tags: ["PPT"],
    status: "archived",
  });
  archivedSiteId = archived.id;

  await ctx.repo.addFavorite({ userId: USER, siteId: siteAId });
  await ctx.repo.addFavorite({ userId: USER, siteId: siteBId });
  await ctx.repo.addFavorite({ userId: USER, siteId: pendingSiteId });
  await ctx.repo.addFavorite({ userId: USER, siteId: archivedSiteId });
  await ctx.repo.addFavorite({ userId: OTHER, siteId: otherSiteId });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-price-"));
  ctx = await createContext(loadConfig({ mode: "lite", sqlitePath: join(dir, "api.db"), corsOrigins: ["*"] }));
  (ctx as { embedding: unknown }).embedding = null;
  app = await buildServer(ctx);
  await app.ready();
  await seed();
  // 默认：robots 一律放行、定价页走可注入的假实现（不发真实出站）。
  setSiteProbeRobotsCheckForTests(async () => false);
  setPriceScrapePageForTests(async (url) => {
    scrapeCalls.push(url);
    return { ...scrapePage };
  });
});

afterAll(async () => {
  setPriceScrapePageForTests(null);
  setSiteProbeRobotsCheckForTests(null);
  if (app) await app.close();
  if (ctx) await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

afterEach(async () => {
  scrapeCalls = [];
  scrapePage = {
    kind: "ok",
    status: 200,
    body: `<html><body><h1>定价</h1><p>基础版 ¥19.9/月，专业版 ¥99/月，企业版 $199/yr。</p></body></html>`,
    reason: "内容检测通过",
  };
  setSiteProbeRobotsCheckForTests(async () => false);
  priceScrapeOutboundBudget.reset();
  // 各用例互不干扰：清掉本文件写过的价格记录
  await ctx.repo.deleteSitePrice(USER, siteAId);
  await ctx.repo.deleteSitePrice(USER, siteBId);
  await ctx.repo.deleteSitePrice(OTHER, otherSiteId);
});

const validBody = {
  amountMinor: 1990,
  currency: "CNY",
  period: "month",
  freeTierLimit: "100次/月",
  sourceUrl: "https://price-a.example.com/pricing",
};

async function postPrice(siteId: string, body: unknown, headers: Record<string, string> = userHeaders) {
  return app.inject({
    method: "POST",
    url: `/api/sites/${siteId}/price`,
    headers: { ...headers, "content-type": "application/json" },
    payload: JSON.stringify(body),
  });
}

async function deletePrice(siteId: string, headers: Record<string, string> = userHeaders) {
  return app.inject({ method: "DELETE", url: `/api/sites/${siteId}/price`, headers });
}

async function postScrape(siteId: string, headers: Record<string, string> = userHeaders) {
  return app.inject({ method: "POST", url: `/api/sites/${siteId}/price/scrape`, headers });
}

async function priceCellOf(siteId: string) {
  const other = siteId === siteAId ? siteBId : siteAId;
  const res = await app.inject({
    method: "GET",
    url: `/api/compare?siteIds=${siteId},${other}`,
    headers: userHeaders,
  });
  expect(res.statusCode).toBe(200);
  const items = (res.json() as { items: Array<{ siteId: string; price: unknown }> }).items;
  return items.find((i) => i.siteId === siteId)!.price as {
    value: unknown;
    source: string;
    verified: boolean;
    verifiedAt: number | null;
    stale?: boolean;
    sourceUrl?: string | null;
  };
}

describe("身份与归属：匿名 401，越权 404 不可区分", () => {
  it("POST 匿名 401；DELETE 匿名 401；scrape 匿名 401", async () => {
    for (const res of [
      await postPrice(siteAId, validBody, anonHeaders),
      await deletePrice(siteAId, anonHeaders),
      await postScrape(siteAId, anonHeaders),
    ]) {
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe("UNAUTHORIZED");
    }
  });

  it("他人收藏 / 不存在 / pending / archived / 无人收藏 → 同一个 404 body", async () => {
    const cases = [otherSiteId, "ghost-id-404", neverFavoritedSiteId, pendingSiteId, archivedSiteId];
    const bodies: unknown[] = [];
    for (const id of cases) {
      const res = await postPrice(id, validBody);
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.ok).toBe(false);
      expect(body.error).toBe("NOT_FOUND");
      expect(body.code).toBe("NOT_FOUND");
      expect(JSON.stringify(body)).not.toContain(id);
      bodies.push(body);
    }
    for (const b of bodies.slice(1)) expect(b).toEqual(bodies[0]);
    // 他人用自己的身份调自己的收藏仍可写入
    const own = await postPrice(otherSiteId, { ...validBody, sourceUrl: "https://price-other.example.com/pricing" }, otherHeaders);
    expect(own.statusCode).toBe(200);
  });
});

describe("body 校验：各 400", () => {
  it.each([
    ["金额 0", { ...validBody, amountMinor: 0 }],
    ["金额负数", { ...validBody, amountMinor: -100 }],
    ["金额超大", { ...validBody, amountMinor: 1_000_000_000 }],
    ["金额非整数", { ...validBody, amountMinor: 19.9 }],
    ["金额缺失", { currency: "CNY", period: "month" }],
    ["货币不在枚举", { ...validBody, currency: "BTC" }],
    ["周期非法", { ...validBody, period: "week" }],
    ["免费档超长（121 字符）", { ...validBody, freeTierLimit: "x".repeat(121) }],
    ["source_url 跨域", { ...validBody, sourceUrl: "https://evil.example.com/pricing" }],
    ["source_url 非法协议", { ...validBody, sourceUrl: "ftp://price-a.example.com/pricing" }],
    ["source_url 不是 URL", { ...validBody, sourceUrl: "not a url" }],
    ["source_type 非法", { ...validBody, sourceType: "llm_guess" }],
  ])("%s → 400", async (_label, body) => {
    const res = await postPrice(siteAId, body);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("BAD_REQUEST");
  });

  it("免费档 120 字符整通过；source_url 空串当未填", async () => {
    const res = await postPrice(siteAId, { ...validBody, freeTierLimit: "x".repeat(120), sourceUrl: "" });
    expect(res.statusCode).toBe(200);
    expect(res.json().price.freeTierLimit).toBe("x".repeat(120));
    expect(res.json().price.sourceUrl).toBeNull();
  });
});

describe("写入：服务端 verified_at、upsert 覆盖、DELETE 幂等", () => {
  it("成功 200；客户端传来的 verified_at 被忽略，回显为服务端时间", async () => {
    const before = Date.now();
    const res = await postPrice(siteAId, { ...validBody, verifiedAt: 1000 });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.price).toMatchObject({
      siteId: siteAId,
      amountMinor: 1990,
      currency: "CNY",
      period: "month",
      freeTierLimit: "100次/月",
      sourceType: "manual",
      sourceUrl: "https://price-a.example.com/pricing",
    });
    expect(body.price.verifiedAt).toBeGreaterThanOrEqual(before);
    expect(body.price.verifiedAt).toBeLessThanOrEqual(Date.now());
    expect(body.price.verifiedAt).not.toBe(1000);
    // 不含 owner 身份串与 stale（stale 是组装时现算的）
    expect(body.price).not.toHaveProperty("ownerIdentity");
    expect(body.price).not.toHaveProperty("stale");
  });

  it("upsert 覆盖写：第二次写替换第一条，表里只有一条；自称 official_scrape 被强制改写为 manual", async () => {
    const first = await postPrice(siteAId, validBody);
    expect(first.statusCode).toBe(200);
    // NIT 2：无确认凭证时客户端传什么 sourceType 都不作数，一律写 manual。
    const second = await postPrice(siteAId, {
      amountMinor: 9900,
      currency: "USD",
      period: "year",
      freeTierLimit: null,
      sourceType: "official_scrape",
      sourceUrl: "https://price-a.example.com/pricing",
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().price).toMatchObject({
      amountMinor: 9900,
      currency: "USD",
      period: "year",
      sourceType: "manual",
    });
    const all = await ctx.repo.getSitePricesBySiteIds(USER, [siteAId, siteBId]);
    expect(all.size).toBe(1);
    expect(all.get(siteAId)?.amountMinor).toBe(9900);
    expect(all.get(siteAId)?.sourceType).toBe("manual");
  });

  it("DELETE 幂等：有记录 → deleted:true；再删 → 200 deleted:false", async () => {
    await postPrice(siteAId, validBody);
    const first = await deletePrice(siteAId);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ ok: true, deleted: true });
    expect(await ctx.repo.getSitePrice(USER, siteAId)).toBeNull();
    const second = await deletePrice(siteAId);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ ok: true, deleted: false });
  });

  it("DELETE 他人站点 404（不泄露存在性），且不删别人的记录", async () => {
    await postPrice(otherSiteId, { ...validBody, sourceUrl: "https://price-other.example.com/pricing" }, otherHeaders);
    const res = await deletePrice(otherSiteId);
    expect(res.statusCode).toBe(404);
    expect(await ctx.repo.getSitePrice(OTHER, otherSiteId)).not.toBeNull();
  });
});

describe("对照表回填：fresh / stale / expired 三档", () => {
  it("POST 后 price 格 fresh：值已格式化、verified true、无 stale", async () => {
    await postPrice(siteAId, validBody);
    const cell = await priceCellOf(siteAId);
    expect(cell).toMatchObject({
      value: "¥19.9/月 · 免费档100次/月",
      source: "手工填写",
      verified: true,
    });
    expect(typeof cell.verifiedAt).toBe("number");
    expect(cell.stale).toBeUndefined();
    expect(cell.sourceUrl).toBe("https://price-a.example.com/pricing");
  });

  it("无记录的站 price 格未验证（与其它格同规则）", async () => {
    const cell = await priceCellOf(siteBId);
    expect(cell).toMatchObject({ value: null, verified: false, verifiedAt: null });
  });

  it("100 天前核实 → stale:true 且 verified 仍 true；200 天前 → verified:false 但值仍保留", async () => {
    await postPrice(siteAId, validBody);
    await ctx.repo.run("UPDATE site_prices SET verified_at = ? WHERE owner_identity = ? AND site_id = ?", [
      Date.now() - 100 * DAY_MS,
      USER,
      siteAId,
    ]);
    const staleCell = await priceCellOf(siteAId);
    expect(staleCell.verified).toBe(true);
    expect(staleCell.stale).toBe(true);
    expect(staleCell.value).toBe("¥19.9/月 · 免费档100次/月");

    await ctx.repo.run("UPDATE site_prices SET verified_at = ? WHERE owner_identity = ? AND site_id = ?", [
      Date.now() - 200 * DAY_MS,
      USER,
      siteAId,
    ]);
    const expiredCell = await priceCellOf(siteAId);
    expect(expiredCell.verified).toBe(false);
    expect(expiredCell.stale).toBeUndefined();
    expect(expiredCell.value).toBe("¥19.9/月 · 免费档100次/月");
    expect(typeof expiredCell.verifiedAt).toBe("number");
  });

  it("快照 POST 存下的 items 自带 price 格", async () => {
    await postPrice(siteAId, validBody);
    const res = await app.inject({
      method: "POST",
      url: "/api/compare/snapshots",
      headers: { ...userHeaders, "content-type": "application/json" },
      payload: JSON.stringify({ siteIds: [siteAId, siteBId] }),
    });
    expect(res.statusCode).toBe(201);
    const item = res.json().snapshot.items.find((i: { siteId: string }) => i.siteId === siteAId);
    expect(item.price).toMatchObject({ value: "¥19.9/月 · 免费档100次/月", verified: true });
  });
});

describe("抓取：候选不自动写库", () => {
  it("调 scrape 后读库仍是旧记录；候选含解析出的结构化字段", async () => {
    await postPrice(siteAId, validBody);
    const res = await postScrape(siteAId);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.robots_disallowed).toBe(false);
    expect(body.sourceUrl).toBe("https://price-a.example.com/pricing");
    expect(scrapeCalls).toEqual(["https://price-a.example.com/pricing"]);
    const first = body.candidates[0];
    expect(first.text).toContain("¥19.9/月");
    // NIT 3：裸 ¥ 不推断货币——currency 与 amountMinor 均为 null，只给原文金额。
    expect(first).toMatchObject({ amount: 19.9, amountMinor: null, currency: null, period: "month" });
    expect(typeof first.confirmToken).toBe("string");
    expect(first.confirmToken.length).toBeGreaterThan(0);
    const usd = body.candidates.find((c: { text: string }) => c.text.includes("$199"));
    expect(usd).toMatchObject({ amount: 199, amountMinor: 19900, currency: "USD", period: "year" });
    expect(typeof usd.confirmToken).toBe("string");
    // 抓取本身不写库：读库仍是手工填写的旧记录
    const stored = await ctx.repo.getSitePrice(USER, siteAId);
    expect(stored?.amountMinor).toBe(1990);
    expect(stored?.sourceType).toBe("manual");
  });

  it("用户点选候选后凭确认凭证调 POST 写库：source_type official_scrape，verified_at 为写库此刻", async () => {
    await postPrice(siteAId, validBody);
    const scraped = await postScrape(siteAId);
    const candidate = scraped.json().candidates.find((c: { text: string }) => c.text.includes("$199"));
    expect(candidate).toMatchObject({ amountMinor: 19900, currency: "USD", period: "year" });
    expect(typeof candidate.confirmToken).toBe("string");
    const before = Date.now();
    // 客户端 sourceType 照旧传 manual 也不影响：来源只由凭证决定。
    const res = await postPrice(siteAId, {
      amountMinor: candidate.amountMinor,
      currency: candidate.currency,
      period: candidate.period,
      sourceType: "manual",
      confirmToken: candidate.confirmToken,
      sourceUrl: "https://price-a.example.com/pricing",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().price).toMatchObject({ amountMinor: 19900, currency: "USD", sourceType: "official_scrape" });
    expect(res.json().price.verifiedAt).toBeGreaterThanOrEqual(before);
  });

  it("无 source_url 的记录不可抓取 → 400；绝不猜路径", async () => {
    await postPrice(siteBId, { amountMinor: 100, currency: "CNY", period: "month" });
    const res = await postScrape(siteBId);
    expect(res.statusCode).toBe(400);
    expect(scrapeCalls).toHaveLength(0);
  });

  it("无候选 → candidates 为空，不写任何值", async () => {
    await postPrice(siteAId, validBody);
    scrapePage = { kind: "ok", status: 200, body: "<html><body><p>欢迎来到我们的官网，没有任何价格。</p></body></html>", reason: "内容检测通过" };
    const res = await postScrape(siteAId);
    expect(res.statusCode).toBe(200);
    expect(res.json().candidates).toEqual([]);
    const stored = await ctx.repo.getSitePrice(USER, siteAId);
    expect(stored?.amountMinor).toBe(1990);
  });

  it("超时（unverified）→ 候选为空、不写库", async () => {
    await postPrice(siteAId, validBody);
    scrapePage = { kind: "unverified", status: null, body: "", reason: "抓取超时，未能确认可用性" };
    const res = await postScrape(siteAId);
    expect(res.statusCode).toBe(200);
    expect(res.json().candidates).toEqual([]);
    expect(await ctx.repo.getSitePrice(USER, siteAId)).not.toBeNull();
  });

  it("robots 禁抓 → robots_disallowed，不发站点请求", async () => {
    await postPrice(siteAId, validBody);
    setSiteProbeRobotsCheckForTests(async () => true);
    const res = await postScrape(siteAId);
    expect(res.statusCode).toBe(200);
    expect(res.json().robots_disallowed).toBe(true);
    expect(res.json().candidates).toEqual([]);
    expect(scrapeCalls).toHaveLength(0);
  });

  it("预算耗尽 → 429，抓取不启动", async () => {
    await postPrice(siteAId, validBody);
    expect(priceScrapeOutboundBudget.tryAcquire(1)).toBe(true);
    expect(priceScrapeOutboundBudget.tryAcquire(1)).toBe(true);
    const res = await postScrape(siteAId);
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe("RATE_LIMITED");
    expect(scrapeCalls).toHaveLength(0);
    priceScrapeOutboundBudget.release();
    priceScrapeOutboundBudget.release();
  });
});

describe("extractPriceCandidates：保守正则候选抽取", () => {
  it("去 HTML 标签、去重、符号/代码/“元”三种形态；裸 ¥ 不推断货币", () => {
    const candidates = extractPriceCandidates(
      `<div>¥19.9/月</div><p>¥19.9/月</p><span>$99/yr</span><span>29.9元/月</span><span>€5</span>`,
    );
    expect(candidates).toHaveLength(4);
    // NIT 3：裸 ¥ currency/amountMinor 留空，只给原文金额 amount。
    expect(candidates[0]).toMatchObject({ text: "¥19.9/月", amount: 19.9, amountMinor: null, currency: null, period: "month" });
    expect(candidates[0]?.confirmToken).toBeNull();
    expect(candidates[1]).toMatchObject({ text: "$99/yr", amount: 99, amountMinor: 9900, currency: "USD", period: "year" });
    expect(candidates[2]).toMatchObject({ text: "29.9元/月", amount: 29.9, amountMinor: 2990, currency: "CNY", period: "month" });
    expect(candidates[3]).toMatchObject({ text: "€5", amount: 5, amountMinor: 500, currency: "EUR", period: null });
  });

  it("裸 ¥500 不认作 CNY；写明 JPY 代码才认日元（零小数位）", () => {
    const [bare] = extractPriceCandidates("<p>基础版 ¥500/月</p>");
    expect(bare).toMatchObject({ text: "¥500/月", amount: 500, amountMinor: null, currency: null, period: "month" });
    const [jpy] = extractPriceCandidates("<p>Basic JPY 500/month</p>");
    // 注：正则里 mo 先于 month 匹配，原文串截为 "JPY 500/mo"，周期仍正确解析为 month（既有行为）。
    expect(jpy).toMatchObject({ text: "JPY 500/mo", amount: 500, amountMinor: 500, currency: "JPY", period: "month" });
    const [krw] = extractPriceCandidates("<p>₩9900/月</p>");
    expect(krw).toMatchObject({ text: "₩9900/月", amount: 9900, amountMinor: 9900, currency: "KRW", period: "month" });
  });

  it("无价格正文 → 空候选；超大金额的候选只留原文串", () => {
    expect(extractPriceCandidates("<p>没有价格</p>")).toEqual([]);
    const candidates = extractPriceCandidates("<p>¥99999999.99/月</p>");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.amountMinor).toBeNull();
    expect(candidates[0]?.currency).toBeNull();
    expect(candidates[0]?.amount).toBe(99999999.99);
  });
});

describe("NIT 2：sourceType 防伪造——来源只由服务端凭证决定", () => {
  it("手工 POST 自称 official_scrape：200 但强制写 manual，库里也是 manual", async () => {
    const res = await postPrice(siteAId, { ...validBody, sourceType: "official_scrape" });
    expect(res.statusCode).toBe(200);
    expect(res.json().price.sourceType).toBe("manual");
    expect((await ctx.repo.getSitePrice(USER, siteAId))?.sourceType).toBe("manual");
  });

  it("伪造凭证 → 400，什么都不写", async () => {
    const res = await postPrice(siteAId, {
      ...validBody,
      sourceType: "official_scrape",
      confirmToken: "forged-token-not-issued-by-server",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("BAD_REQUEST");
    expect(await ctx.repo.getSitePrice(USER, siteAId)).toBeNull();
  });

  it("凭证改金额 / 改货币 / 改周期 → 各 400；改对了仍能确认，确认成功后重放 → 400", async () => {
    await postPrice(siteAId, validBody);
    const scraped = await postScrape(siteAId);
    const candidate = scraped.json().candidates.find((c: { text: string }) => c.text.includes("$199"));
    const token = candidate.confirmToken as string;
    const base = {
      amountMinor: candidate.amountMinor,
      currency: candidate.currency,
      period: candidate.period,
      sourceUrl: "https://price-a.example.com/pricing",
    };
    // 改金额
    expect((await postPrice(siteAId, { ...base, amountMinor: 19901, confirmToken: token })).statusCode).toBe(400);
    // 改货币（金额照旧也不行：凭证绑死 USD）
    expect((await postPrice(siteAId, { ...base, currency: "CNY", confirmToken: token })).statusCode).toBe(400);
    // 改周期
    expect((await postPrice(siteAId, { ...base, period: "month", confirmToken: token })).statusCode).toBe(400);
    // 失败不焚凭证：按原样确认仍成功，且来源为 official_scrape
    const ok = await postPrice(siteAId, { ...base, confirmToken: token });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().price.sourceType).toBe("official_scrape");
    // 重放同一凭证 → 400（一次性的）
    expect((await postPrice(siteAId, { ...base, confirmToken: token })).statusCode).toBe(400);
  });

  it("凭证跨站 → 400，对方站不写库", async () => {
    await postPrice(siteAId, validBody);
    const scraped = await postScrape(siteAId);
    const candidate = scraped.json().candidates.find((c: { text: string }) => c.text.includes("$199"));
    const res = await postPrice(siteBId, {
      amountMinor: candidate.amountMinor,
      currency: candidate.currency,
      period: candidate.period,
      confirmToken: candidate.confirmToken,
      sourceUrl: "https://price-b.example.com/pricing",
    });
    expect(res.statusCode).toBe(400);
    expect(await ctx.repo.getSitePrice(USER, siteBId)).toBeNull();
  });

  it("凭证过期 → 400，不写库", async () => {
    await postPrice(siteAId, validBody);
    const scraped = await postScrape(siteAId);
    const candidate = scraped.json().candidates.find((c: { text: string }) => c.text.includes("$199"));
    expireScrapeConfirmTokenForTests(candidate.confirmToken as string);
    const res = await postPrice(siteAId, {
      amountMinor: candidate.amountMinor,
      currency: candidate.currency,
      period: candidate.period,
      confirmToken: candidate.confirmToken,
      sourceUrl: "https://price-a.example.com/pricing",
    });
    expect(res.statusCode).toBe(400);
    expect((await ctx.repo.getSitePrice(USER, siteAId))?.amountMinor).toBe(1990);
  });
});

describe("NIT 3：裸 ¥ 候选确认——货币由用户选，后端不猜", () => {
  it("抓取回的裸 ¥ 候选 currency/amountMinor 为空但带凭证；选 JPY 确认 → minor 按 ×1（¥99 写 99，不是 9900）", async () => {
    await postPrice(siteAId, validBody);
    const scraped = await postScrape(siteAId);
    const candidate = scraped.json().candidates.find((c: { text: string }) => c.text.includes("¥99"));
    expect(candidate).toMatchObject({ amount: 99, amountMinor: null, currency: null, period: "month" });
    expect(typeof candidate.confirmToken).toBe("string");
    const res = await postPrice(siteAId, {
      amountMinor: 99,
      currency: "JPY",
      period: "month",
      confirmToken: candidate.confirmToken,
      sourceUrl: "https://price-a.example.com/pricing",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().price).toMatchObject({ amountMinor: 99, currency: "JPY", sourceType: "official_scrape" });
    // 对照表里这格应显示 ¥99，而不是把日元价按 CNY 读成 ¥9900
    const cell = await priceCellOf(siteAId);
    expect(cell.value).toBe("¥99/月");
  });

  it("同一裸 ¥ 候选选 CNY 确认 → minor 按 ×100（¥19.9 写 1990）", async () => {
    await postPrice(siteAId, validBody);
    const scraped = await postScrape(siteAId);
    const candidate = scraped.json().candidates.find((c: { text: string }) => c.text.includes("¥19.9"));
    const res = await postPrice(siteAId, {
      amountMinor: 1990,
      currency: "CNY",
      period: "month",
      confirmToken: candidate.confirmToken,
      sourceUrl: "https://price-a.example.com/pricing",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().price).toMatchObject({ amountMinor: 1990, currency: "CNY", sourceType: "official_scrape" });
  });

  it("裸 ¥ 候选确认时不传货币 → 400（后端不默认补 CNY）；按 JPY 换算错金额 → 400", async () => {
    await postPrice(siteAId, validBody);
    const scraped = await postScrape(siteAId);
    const candidate = scraped.json().candidates.find((c: { text: string }) => c.text.includes("¥99"));
    const noCurrency = await postPrice(siteAId, {
      amountMinor: 99,
      period: "month",
      confirmToken: candidate.confirmToken,
      sourceUrl: "https://price-a.example.com/pricing",
    });
    expect(noCurrency.statusCode).toBe(400);
    // 选了 JPY 却按 CNY 的 ×100 提交（9900）→ 与凭证绑定的原文金额换算不符 → 400
    const wrongMinor = await postPrice(siteAId, {
      amountMinor: 9900,
      currency: "JPY",
      period: "month",
      confirmToken: candidate.confirmToken,
      sourceUrl: "https://price-a.example.com/pricing",
    });
    expect(wrongMinor.statusCode).toBe(400);
    expect((await ctx.repo.getSitePrice(USER, siteAId))?.amountMinor).toBe(1990);
  });
});

describe("注销随删 + 导出含价格记录（必须放最后）", () => {
  it("exportUserData 含 sitePrices；deleteUserData 删净，价格数计入回执", async () => {
    await postPrice(siteAId, validBody);
    await postPrice(siteBId, { amountMinor: 100, currency: "CNY", period: "month" });
    const exported = await ctx.repo.exportUserData(USER);
    expect(Array.isArray(exported.sitePrices)).toBe(true);
    expect(exported.sitePrices.length).toBeGreaterThan(0);
    expect(exported.sitePrices[0]).toHaveProperty("siteId");
    expect(exported.sitePrices[0]).toHaveProperty("amountMinor");

    const counts = await ctx.repo.deleteUserData(USER);
    expect(counts.sitePrices).toBeGreaterThan(0);
    expect(await ctx.repo.listSitePricesByOwner(USER)).toEqual([]);
  });
});
