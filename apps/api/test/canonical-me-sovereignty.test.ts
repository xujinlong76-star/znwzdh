/**
 * canonical 解析的时序红线 + 用户中心四条主权流的端到端守卫（P2）。
 *
 * 背景：身份合并（identity_aliases）之后，旧 id 仍是一枚**合法且已签名**的身份，
 * 扩展、MCP、没刷新的旧标签页都会继续用它发请求。运行时已经在 `/api/me`、
 * 导出、书签导出、注销四处解析别名，但此前没有任何 HTTP 断言：
 *   - `canonical-route-identity.test.ts` 只测四个用户域，且未配密钥（签名 hook 跳过）；
 *   - `user-center-canonical.test.ts` 配了密钥，但只测收藏 / 历史 / 画像。
 * 本文件补上「旧 id → canonical」在概览 / JSON 导出 / Netscape 书签 / 注销上的行为，
 * 并把 `shared.ts` 里的时序红线钉成可执行契约：
 *
 *   签名对象是 `identityOf` 得到的**原始**身份（截断 64 字符），
 *   canonical 解析只能发生在 preValidation 签名校验**之后**。
 *
 * 若有人把解析提前到签名之前，旧 id 的签名会对 canonical 校验失败而 401：
 * 「合并后所有旧客户端掉线」。若有人删掉任一处的 resolveIdentity，对应断言直接红。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";

const SECRET = "canonical-sovereignty-secret-0123456789";
const ANON = "anon-canonical-sovereignty-0001";
/** 非 anon 旧 id：匿名身份被注销闸门 403 挡住，只有它才能证明注销也解析别名 */
const LEGACY = "github:legacy-sovereignty";
const USER = "github:canonical-sovereignty";

const URL_A = "https://sovereignty-a.example.com/";
const URL_B = "https://sovereignty-b.example.com/";
const TITLE_A = "主权站点 Alpha";
const TITLE_B = "主权站点 Beta";

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
let siteA = "";
let siteB = "";

const signed = (identity: string) => ({
  "x-navhub-user-id": identity,
  "x-navhub-identity-signature": signIdentity(SECRET, identity),
});

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-canon-me-"));
  ctx = await createContext(
    loadConfig({ ...base, sqlitePath: join(dir, "canon-me.db"), identitySecret: SECRET }),
  );
  app = await buildServer(ctx);
  await app.ready();

  const cat = await ctx.repo.createCategory({ title: "主权流测试" });
  siteA = (await ctx.repo.createSite({ url: URL_A, title: TITLE_A, categoryId: cat.id })).id;
  siteB = (await ctx.repo.createSite({ url: URL_B, title: TITLE_B, categoryId: cat.id })).id;

  // 合并前：匿名身份收藏 A；登录身份自己写一条搜索历史
  const pre = await app.inject({
    method: "POST",
    url: "/api/favorites",
    headers: signed(ANON),
    payload: { siteId: siteA },
  });
  expect(pre.statusCode).toBe(201);
  await ctx.repo.recordSearch(USER, "canonical 主权查询", 3);
  // 设置只写在 canonical 上：外层的 resolveIdentity 若被删掉，这里会读回旧 id 的默认值
  await ctx.repo.updateUserSettings(USER, { defaultSearchEngine: "bing" });

  expect((await ctx.repo.mergeIdentity(ANON, USER)).target).toBe(USER);
  // 第二跳：非 anon 旧 id 也指向同一 canonical
  expect((await ctx.repo.mergeIdentity(LEGACY, USER)).target).toBe(USER);
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows 上 SQLite 句柄释放有延迟：临时目录交给系统回收，不让清理失败判红
  }
});

describe("旧 id 的概览与写入都落在 canonical", () => {
  it("签旧 id GET /api/me：identity、别名与计数都是 canonical 视角", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me", headers: signed(ANON) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      identity: string;
      aliases: string[];
      counts: { favorites: number };
      settings: { identity: string; defaultSearchEngine: string };
    };
    expect(body.identity).toBe(USER);
    expect(body.aliases).toEqual(expect.arrayContaining([ANON, LEGACY]));
    expect(body.counts.favorites).toBe(1);
    expect(body.settings.identity).toBe(USER);
    expect(body.settings.defaultSearchEngine).toBe("bing");
  });

  it("合并后签旧 id 写收藏：落库归属 canonical，旧 id 不留孤儿行", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/favorites",
      headers: signed(ANON),
      payload: { siteId: siteB },
    });
    expect([200, 201]).toContain(res.statusCode);

    const rows = await ctx.repo.raw("SELECT user_id FROM favorites WHERE site_id = ?", [siteB]);
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!.user_id)).toBe(USER);

    const orphan = await ctx.repo.raw("SELECT COUNT(*) AS c FROM favorites WHERE user_id = ?", [ANON]);
    expect(Number(orphan[0]!.c)).toBe(0);
  });
});

describe("旧 id 的导出覆盖 canonical 全量", () => {
  it("签旧 id GET /api/me/export：JSON 附件含两条收藏与 canonical 历史", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me/export", headers: signed(ANON) });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers["content-disposition"])).toContain("navhub-export-");

    const body = res.json() as {
      identity: string;
      favorites: Array<{ siteId: string; userId: string }>;
      searchHistory: { items: Array<{ query: string }> };
    };
    expect(body.identity).toBe(USER);
    expect(new Set(body.favorites.map((f) => f.siteId))).toEqual(new Set([siteA, siteB]));
    expect(body.favorites.every((f) => f.userId === USER)).toBe(true);
    expect(body.searchHistory.items.map((i) => i.query)).toContain("canonical 主权查询");
  });

  it("签旧 id GET /api/me/export/bookmarks.html：Netscape 书签含两条 canonical 收藏", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/me/export/bookmarks.html",
      headers: signed(ANON),
    });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers["content-type"])).toContain("text/html");
    expect(String(res.headers["content-disposition"])).toContain("navhub-bookmarks.html");

    expect(res.body).toContain(TITLE_A);
    expect(res.body).toContain(TITLE_B);
    expect(res.body).toContain(URL_A);
    expect(res.body).toContain(URL_B);
  });
});

describe("时序红线：签名校验先于 canonical 解析", () => {
  it("旧 id 的头配 canonical 的签名 → 401（签名对象是原始身份）", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: {
        "x-navhub-anon-id": ANON,
        "x-navhub-identity-signature": signIdentity(SECRET, USER),
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("只带旧 id 不带签名 → 401（配置密钥后未签名身份不可用）", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { "x-navhub-anon-id": ANON },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("注销覆盖 canonical，且不放过匿名身份", () => {
  it("签匿名旧 id DELETE /api/me → 403（先拦 anon 前缀，再谈解析）", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/me",
      headers: signed(ANON),
      payload: { confirm: "DELETE" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("签非匿名旧 id DELETE /api/me → 200，删除回执覆盖 canonical 数据与别名", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/me",
      headers: signed(LEGACY),
      payload: { confirm: "DELETE" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      ok: boolean;
      deleted: { favorites: number; identityAliases: number; identityMerges: number };
    };
    expect(body.ok).toBe(true);
    expect(body.deleted.favorites).toBe(2);
    expect(body.deleted.identityAliases).toBe(2);
    expect(body.deleted.identityMerges).toBe(2);
  });

  it("注销后旧 id 回到自身且数据为空，别名表不留残行", async () => {
    const me = await app.inject({ method: "GET", url: "/api/me", headers: signed(ANON) });
    expect(me.statusCode).toBe(200);
    const body = me.json() as {
      identity: string;
      aliases: string[];
      counts: { favorites: number };
    };
    expect(body.identity).toBe(ANON);
    expect(body.counts.favorites).toBe(0);
    expect(body.aliases).toEqual([]);

    const aliasRows = await ctx.repo.raw("SELECT COUNT(*) AS c FROM identity_aliases");
    expect(Number(aliasRows[0]!.c)).toBe(0);

    const canonicalMe = await app.inject({ method: "GET", url: "/api/me", headers: signed(USER) });
    expect((canonicalMe.json() as { counts: { favorites: number } }).counts.favorites).toBe(0);
  });
});
