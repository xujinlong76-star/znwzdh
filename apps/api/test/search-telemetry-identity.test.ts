/**
 * 搜索行为埋点的身份归属与可删除性（run49）。
 *
 * 钉的三层，缺一不可：
 *  ① 接线：`search` / `zero_result` 两类事件必须带上 `events.identity`。
 *     此前实测本机库 141 行 search、4 行 zero_result **全部 identity=NULL**
 *     （查询日 2026-10-25 13:1x），而注销与导出都按这一列圈定范围
 *     （packages/store/src/repository/user-data.ts:148 导出聚合 / :248 计数 / :285 删除），
 *     于是用户点「删除全部个人数据」删不掉自己的搜索行为，导出里也看不见它。
 *  ② 通道：归属的身份必须是**验签链路实际背书过的那个**——用 requestIdentityOf
 *     （与 server.ts:491 preValidation 同一个 identityOf，优先级 Header→Query→Body），
 *     而不是路由里只看 Body/Query 的 `input.userId ?? input.anonId`。
 *     两者不一致时若用后者，第三方就能往他人名下写「可被删除」的行为行。
 *  ③ 闸门：关掉遥测（telemetryEnabled=false）的用户不留身份，与 /api/events 同口径
 *     （apps/api/src/routes/telemetry.ts:78-86）——否则「关掉遥测」只关了一半。
 *
 * 断言全部落在「可观察行为」上：发请求 → 查库看行的 identity → 再走注销接口 → 复查残留。
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
const USER = "github:u-search-attr";
const OTHER = "github:u-search-other";

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

const signed = (identity: string) => ({
  "x-navhub-user-id": identity,
  "x-navhub-identity-signature": signIdentity(SECRET, identity),
});

/** 最近一条某 kind 的事件行的归属身份（无行返回 "MISSING"，区分「没写」与「写了但匿名」） */
async function latestIdentity(kind: string): Promise<string | null | "MISSING"> {
  const rows = (await ctx.repo.raw(
    "SELECT identity FROM events WHERE kind = ? ORDER BY created_at DESC, id DESC LIMIT 1",
    [kind],
  )) as Array<{ identity: string | null }>;
  if (!rows.length) return "MISSING";
  return rows[0].identity;
}

async function countEvents(identity: string | null, kinds: string[]): Promise<number> {
  const rows = (await ctx.repo.raw(
    `SELECT COUNT(*) AS c FROM events WHERE kind IN (${kinds.map(() => "?").join(",")}) AND ` +
      (identity === null ? "identity IS NULL" : "identity = ?"),
    identity === null ? kinds : [...kinds, identity],
  )) as Array<{ c: number }>;
  return rows[0].c;
}

async function search(q: string, headers?: Record<string, string>, extraQuery = "") {
  return app.inject({ method: "GET", url: `/api/search?q=${encodeURIComponent(q)}${extraQuery}`, headers });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-search-attr-"));
  ctx = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "attr.db"), identitySecret: SECRET }));
  app = await buildServer(ctx);
  await app.ready();
  const cat = await ctx.repo.createCategory({ title: "归属测试" });
  await ctx.repo.createSite({ url: "https://attr-a.example.com", title: "归属 A", categoryId: cat.id });
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("search / zero_result 事件的身份归属", () => {
  it("带签名身份搜到结果：search 行归属该身份（此前恒为 NULL）", async () => {
    const res = await search("归属 A 测试词", signed(USER));
    expect(res.statusCode).toBe(200);
    expect((res.json() as { hits: unknown[] }).hits.length).toBeGreaterThan(0);
    expect(await latestIdentity("search")).toBe(USER);
  });

  it("零结果：zero_result 行同样归属该身份（零结果榜要能按人排重）", async () => {
    const res = await search("zzz-一定搜不到的词", signed(USER));
    expect(res.statusCode).toBe(200);
    expect((res.json() as { hits: unknown[] }).hits).toHaveLength(0);
    expect(await latestIdentity("zero_result")).toBe(USER);
  });

  it("不带身份：行为照记，但归属留 NULL（匿名面不假装可归人）", async () => {
    expect((await search("匿名搜索词")).statusCode).toBe(200);
    expect(await latestIdentity("search")).toBe(null);
  });

  it("Header 与 Body 自称不一致 → 归属 Header 那个（验签背书过的），不被 Body 冒充", async () => {
    // identityOf 的优先级是 Header→Query→Body；路由里那个只看 Body/Query 的 rawIdentity
    // 若被直接写进可删除列，就等于允许第三方往 OTHER 名下塞行为行。
    const before = await countEvents(OTHER, ["search", "zero_result"]);
    const res = await app.inject({
      method: "POST",
      url: "/api/search",
      headers: signed(USER),
      payload: { q: "冒充测试词", anonId: OTHER },
    });
    expect(res.statusCode).toBe(200);
    expect(await latestIdentity("search")).toBe(USER);
    expect(await countEvents(OTHER, ["search", "zero_result"])).toBe(before);
  });

  it("未签名的自称身份：preValidation 直接 401，不产生带身份的行为行", async () => {
    const before = await countEvents(OTHER, ["search", "zero_result"]);
    const res = await app.inject({
      method: "POST",
      url: "/api/search",
      headers: { "x-navhub-user-id": OTHER },
      payload: { q: "无签名冒充词" },
    });
    expect(res.statusCode).toBe(401);
    expect(await countEvents(OTHER, ["search", "zero_result"])).toBe(before);
  });

  it("关掉遥测的用户：行仍写（保持既有统计口径），但归属留 NULL", async () => {
    await ctx.repo.updateUserSettings(USER, { telemetryEnabled: false });
    try {
      expect((await search("关闭遥测后搜索词", signed(USER))).statusCode).toBe(200);
      expect(await latestIdentity("search")).toBe(null);
    } finally {
      await ctx.repo.updateUserSettings(USER, { telemetryEnabled: true });
    }
  });
});

describe("注销必须覆盖搜索行为（承诺与实现一致）", () => {
  it("DELETE /api/me 后该身份的 search/zero_result 行零残留", async () => {
    // 前置：先造出带归属的行为行
    expect((await search("待注销搜索词", signed(USER))).statusCode).toBe(200);
    expect((await search("zzz-一定搜不到的词-注销", signed(USER))).statusCode).toBe(200);
    expect(await countEvents(USER, ["search", "zero_result"])).toBeGreaterThan(0);

    const res = await app.inject({
      method: "DELETE",
      url: "/api/me",
      headers: signed(USER),
      payload: { confirm: "DELETE" },
    });
    expect(res.statusCode).toBe(200);
    // 关键断言：残留即失败（GDPR 验收的标准形态是「用 SQL 查残留」而不是相信接口返回 ok）
    expect(await countEvents(USER, ["search", "zero_result"])).toBe(0);
  });

  it("导出载荷把该身份的搜索行为计入 eventsSummary（此前不可见）", async () => {
    expect((await search("待导出搜索词", signed(USER))).statusCode).toBe(200);
    const res = await app.inject({ method: "GET", url: "/api/me/export", headers: signed(USER) });
    expect(res.statusCode).toBe(200);
    const summary = (res.json() as { eventsSummary?: Array<{ kind: string; count: number }> }).eventsSummary ?? [];
    const searchRow = summary.find((row) => row.kind === "search");
    expect(searchRow?.count ?? 0).toBeGreaterThan(0);
  });
});
