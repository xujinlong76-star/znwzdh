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

describe("/api/me/activity（M10 用户可见操作记录）", () => {
  it("返回自己的审计事件，不含他人事件；未受信 401", async () => {
    await ctx.repo.audit({ actor: USER, actorKind: "user", action: "user.export", target: USER });
    await ctx.repo.audit({
      actor: "github:someone-else",
      actorKind: "user",
      action: "user.delete",
      target: "github:someone-else",
    });

    const res = await app.inject({ method: "GET", url: "/api/me/activity", headers: userHeaders() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { identity: string; items: Array<{ action: string; target: string | null }> };
    expect(body.identity).toBe(USER);
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(body.items)).not.toContain("someone-else");
    // 只暴露 action/target/at，不外传 ip 与 diff
    expect(Object.keys(body.items[0]).sort()).toEqual(["action", "at", "target"]);
  });
});

describe("/api/me/export/bookmarks.html（M9 互操作导出）", () => {
  it("按收藏夹分组输出 Netscape 格式，可直接导入浏览器", async () => {
    const cat = await ctx.repo.createCategory({ title: "导出测试" });
    const site = await ctx.repo.createSite({
      url: "https://netscape.example.com/",
      title: "Netscape 站点",
      categoryId: cat.id,
    });
    const folder = await ctx.repo.createFavoriteFolder(USER, "学习资料");
    await ctx.repo.addFavorite({ userId: USER, siteId: site.id, folderId: folder.id });

    const res = await app.inject({
      method: "GET",
      url: "/api/me/export/bookmarks.html",
      headers: userHeaders(),
    });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers["content-type"])).toContain("text/html");
    expect(String(res.headers["content-disposition"])).toContain("navhub-bookmarks.html");
    expect(res.payload).toContain("NETSCAPE-Bookmark-file-1");
    expect(res.payload).toContain("<H3>学习资料</H3>");
    expect(res.payload).toContain('HREF="https://netscape.example.com/"');
  });
});
