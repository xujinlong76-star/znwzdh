import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";

/**
 * 用户中心 API：身份必须来自签名头；匿名合并必须同时证明对 anonId 的所有权。
 */
const SECRET = "test-secret-please-rotate";
const USER = "github:u-me";
const ANON = "anon-22222222-2222-2222-2222-222222222222";

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

const userHeaders = () => ({
  "x-navhub-user-id": USER,
  "x-navhub-identity-signature": signIdentity(SECRET, USER),
});

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-me-"));
  ctx = await createContext(
    loadConfig({ ...base, sqlitePath: join(dir, "me.db"), identitySecret: SECRET }),
  );
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("/api/me", () => {
  it("没有签名身份 -> 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me" });
    expect(res.statusCode).toBe(401);
  });

  it("签名身份 -> 返回概览", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me", headers: userHeaders() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.identity).toBe(USER);
    expect(body.counts.favorites).toBe(0);
    expect(body.aliases).toEqual([]);
  });
});

describe("/api/me/merge", () => {
  it("缺少匿名签名 -> 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/me/merge",
      headers: userHeaders(),
      payload: { anonId: ANON },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain("匿名身份签名");
  });

  it("签名齐全 -> 合并匿名数据并返回统计", async () => {
    const cat = await ctx.repo.createCategory({ title: "用户中心测试" });
    const site = await ctx.repo.createSite({
      url: "https://me-merge.example.com",
      title: "Merge Site",
      categoryId: cat.id,
    });
    await ctx.repo.addFavorite({ userId: ANON, siteId: site.id });
    await ctx.repo.recordSearch(ANON, "匿名搜索", 1);

    const res = await app.inject({
      method: "POST",
      url: "/api/me/merge",
      headers: {
        ...userHeaders(),
        "x-navhub-anon-signature": signIdentity(SECRET, ANON),
      },
      payload: { anonId: ANON },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.favoritesMoved).toBe(1);
    expect(body.alreadyMerged).toBe(false);

    const overview = await app.inject({ method: "GET", url: "/api/me", headers: userHeaders() });
    expect(overview.statusCode).toBe(200);
    expect(overview.json().counts.favorites).toBe(1);
    expect(overview.json().aliases).toContain(ANON);
  });

  it("重复合并幂等", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/me/merge",
      headers: {
        ...userHeaders(),
        "x-navhub-anon-signature": signIdentity(SECRET, ANON),
      },
      payload: { anonId: ANON },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().alreadyMerged).toBe(true);
  });

  it("非法 anonId -> 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/me/merge",
      headers: userHeaders(),
      payload: { anonId: "../../etc/passwd" },
    });
    expect(res.statusCode).toBe(400);
  });
});
