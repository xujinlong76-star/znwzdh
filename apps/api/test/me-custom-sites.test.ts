import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";

/**
 * 用户自定义站点：账号级持久化、跨用户隔离、URL 校验、排序全集约束；
 * 附带验证设置新增字段（themePreference / hiddenHomeModules）的读写闭环。
 */
const SECRET = "test-secret-please-rotate";
const USER = "github:u-custom";
const OTHER = "github:u-other";

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

const headersFor = (identity: string) => ({
  "x-navhub-user-id": identity,
  "x-navhub-identity-signature": signIdentity(SECRET, identity),
});

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-custom-sites-"));
  ctx = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "test.db"), identitySecret: SECRET }));
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("/api/me/custom-sites", () => {
  it("无签名身份 -> 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me/custom-sites" });
    expect(res.statusCode).toBe(401);
  });

  it("增删改查 + 排序全流程", async () => {
    const h = headersFor(USER);
    const a = await app.inject({
      method: "POST",
      url: "/api/me/custom-sites",
      headers: h,
      payload: { title: "公司内网", url: "https://intra.example.com", note: "VPN 后打开" },
    });
    expect(a.statusCode).toBe(201);
    const itemA = a.json().item;

    const b = await app.inject({
      method: "POST",
      url: "/api/me/custom-sites",
      headers: h,
      payload: { title: "文档站", url: "https://docs.example.com" },
    });
    expect(b.statusCode).toBe(201);
    const itemB = b.json().item;

    const list = await app.inject({ method: "GET", url: "/api/me/custom-sites", headers: h });
    expect(list.json().items.map((i: { id: string }) => i.id)).toEqual([itemA.id, itemB.id]);

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/me/custom-sites/${itemA.id}`,
      headers: h,
      payload: { title: "内网门户" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().item.title).toBe("内网门户");

    const reordered = await app.inject({
      method: "POST",
      url: "/api/me/custom-sites/reorder",
      headers: h,
      payload: { ids: [itemB.id, itemA.id] },
    });
    expect(reordered.statusCode).toBe(200);
    expect(reordered.json().items.map((i: { id: string }) => i.id)).toEqual([itemB.id, itemA.id]);

    const removed = await app.inject({ method: "DELETE", url: `/api/me/custom-sites/${itemB.id}`, headers: h });
    expect(removed.json()).toMatchObject({ ok: true, removed: true });
    const after = await app.inject({ method: "GET", url: "/api/me/custom-sites", headers: h });
    expect(after.json().items).toHaveLength(1);
  });

  it("排序 ids 不是全集 -> 400", async () => {
    const h = headersFor(USER);
    const res = await app.inject({
      method: "POST",
      url: "/api/me/custom-sites/reorder",
      headers: h,
      payload: { ids: ["nonexistent-id"] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("拒绝伪协议 URL", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/me/custom-sites",
      headers: headersFor(USER),
      payload: { title: "坏地址", url: "javascript:alert(1)" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("跨用户隔离：别人看不到、改不到", async () => {
    const list = await app.inject({ method: "GET", url: "/api/me/custom-sites", headers: headersFor(OTHER) });
    expect(list.json().items).toEqual([]);
    const mine = await app.inject({ method: "GET", url: "/api/me/custom-sites", headers: headersFor(USER) });
    const myId = mine.json().items[0].id;
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/me/custom-sites/${myId}`,
      headers: headersFor(OTHER),
      payload: { title: "篡改" },
    });
    expect(patch.statusCode).toBe(404);
  });
});

describe("/api/me/settings 新字段", () => {
  it("themePreference 与 hiddenHomeModules 写入后可读回，清除主题回 null", async () => {
    const h = headersFor(USER);
    const patch = await app.inject({
      method: "PATCH",
      url: "/api/me/settings",
      headers: h,
      payload: { themePreference: "dark", hiddenHomeModules: ["dramaCinema", "heroDeck"] },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().settings.themePreference).toBe("dark");
    expect(patch.json().settings.hiddenHomeModules).toEqual(["dramaCinema", "heroDeck"]);

    const cleared = await app.inject({
      method: "PATCH",
      url: "/api/me/settings",
      headers: h,
      payload: { themePreference: null },
    });
    expect(cleared.json().settings.themePreference).toBeNull();
    // 未动的字段不被清除
    expect(cleared.json().settings.hiddenHomeModules).toEqual(["dramaCinema", "heroDeck"]);
  });

  it("非法模块键被拒绝", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/me/settings",
      headers: headersFor(USER),
      payload: { hiddenHomeModules: ["bogus-module"] },
    });
    expect(res.statusCode).toBe(400);
  });
});
