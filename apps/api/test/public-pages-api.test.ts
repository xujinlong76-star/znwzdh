import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";

/**
 * 公开导航页（Batch 3 第 6 项）的 API 层测试。
 *
 * 覆盖：发布 → 免登公开读；下线 → 404；重新发布 → 恢复；删除 → 404；
 * slug 碰撞 409；非法 slug 400；空文件夹拒发；别人的夹子拒发（BOLA）；
 * 跨 owner 改状态/删除一律 404（不泄露存在性）；broken 站不进公开页；
 * 公开响应里绝不出现 owner 身份；我的列表要身份。
 */
const SECRET = "test-secret-please-rotate";
const ALICE = "github:u-pub-alice";
const BOB = "github:u-pub-bob";

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
let siteActive = "";
let siteBroken = "";
let aliceFolder = "";
let bobFolder = "";
let emptyFolder = "";

const headersFor = (identity: string) => ({
  "x-navhub-user-id": identity,
  "x-navhub-identity-signature": signIdentity(SECRET, identity),
});

async function createFolder(identity: string, name: string) {
  const res = await app.inject({ method: "POST", url: "/api/favorites/folders", headers: headersFor(identity), payload: { name } });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

async function addFavorite(identity: string, siteId: string, folderId: string | null, note?: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/favorites",
    headers: headersFor(identity),
    payload: { siteId, folderId, ...(note ? { note } : {}) },
  });
  expect(res.statusCode).toBe(201);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-pub-"));
  ctx = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "pub.db"), identitySecret: SECRET }));
  app = await buildServer(ctx);
  await app.ready();
  const cat = await ctx.repo.createCategory({ title: "公开页测试" });
  siteActive = (
    await ctx.repo.createSite({ url: "https://active.example.com", title: "有效站", categoryId: cat.id })
  ).id;
  siteBroken = (
    await ctx.repo.createSite({ url: "https://broken.example.com", title: "失效站", categoryId: cat.id, status: "broken" })
  ).id;
  aliceFolder = await createFolder(ALICE, "Alice 的工具");
  bobFolder = await createFolder(BOB, "Bob 的工具");
  emptyFolder = await createFolder(ALICE, "空夹子");
  await addFavorite(ALICE, siteActive, aliceFolder, "私人备注：不要给别人看");
  await addFavorite(ALICE, siteBroken, aliceFolder);
  await addFavorite(BOB, siteActive, bobFolder);
});

afterAll(async () => {
  if (app) await app.close();
  if (ctx) await ctx.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
});

describe("POST /api/public-pages", () => {
  it("发布成功：201 + /pub/ 链接；免登公开读只含有效站，且不泄露 owner 身份", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/public-pages",
      headers: headersFor(ALICE),
      payload: { title: "Alice 的工具箱", folderId: aliceFolder },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { page: { slug: string; title: string }; url: string };
    expect(body.url).toBe(`/pub/${body.page.slug}`);
    expect(body.page.title).toBe("Alice 的工具箱");

    const pub = await app.inject({ method: "GET", url: `/api/public-pages/${body.page.slug}` });
    expect(pub.statusCode).toBe(200);
    expect(JSON.stringify(pub.json())).not.toContain(ALICE);
    const detail = pub.json() as { page: { slug: string }; items: Array<{ siteId: string; title: string }> };
    expect(detail.items.map((i) => i.siteId)).toEqual([siteActive]);
    expect(detail.items[0].title).toBe("有效站");
  });

  it("自定义 slug：合法可用；重复占用 409；非法格式 400", async () => {
    const ok = await app.inject({
      method: "POST",
      url: "/api/public-pages",
      headers: headersFor(BOB),
      payload: { title: "Bob 的工具", folderId: bobFolder, slug: "bob-tools" },
    });
    expect(ok.statusCode).toBe(201);
    expect((ok.json() as { page: { slug: string } }).page.slug).toBe("bob-tools");

    const clash = await app.inject({
      method: "POST",
      url: "/api/public-pages",
      headers: headersFor(ALICE),
      payload: { title: "撞名", folderId: aliceFolder, slug: "bob-tools" },
    });
    expect(clash.statusCode).toBe(409);

    const bad = await app.inject({
      method: "POST",
      url: "/api/public-pages",
      headers: headersFor(ALICE),
      payload: { title: "非法", folderId: aliceFolder, slug: "UPPER CASE!" },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("空文件夹拒发：400 且不产生公开页", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/public-pages",
      headers: headersFor(ALICE),
      payload: { title: "空的", folderId: emptyFolder },
    });
    expect(res.statusCode).toBe(400);
    const mine = await app.inject({ method: "GET", url: "/api/public-pages", headers: headersFor(ALICE) });
    const slugs = ((mine.json() as { pages: Array<{ title: string }> }).pages ?? []).map((p) => p.title);
    expect(slugs).not.toContain("空的");
  });

  it("别人的夹子拒发：400（BOLA）", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/public-pages",
      headers: headersFor(ALICE),
      payload: { title: "偷 Bob 的", folderId: bobFolder },
    });
    expect(res.statusCode).toBe(400);
  });

  it("无身份拒发：400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/public-pages",
      payload: { title: "匿名", folderId: aliceFolder },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("公开读绝不泄露私人备注（回归锁）", () => {
  it("收藏备注写给自己：公开读的条目里绝无 note 字段、绝无备注文本；私人读仍能看到备注", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/public-pages",
      headers: headersFor(ALICE),
      payload: { title: "备注不公开", folderId: aliceFolder, slug: "no-private-notes" },
    });
    expect(created.statusCode).toBe(201);

    const pub = await app.inject({ method: "GET", url: "/api/public-pages/no-private-notes" });
    expect(pub.statusCode).toBe(200);
    const raw = JSON.stringify(pub.json());
    expect(raw).not.toContain("私人备注：不要给别人看");
    const detail = pub.json() as { items: Array<Record<string, unknown>> };
    expect(detail.items).toHaveLength(1);
    expect(Object.keys(detail.items[0])).not.toContain("note");
    expect(detail.items[0]).not.toHaveProperty("note");

    // 私人侧不动：owner 自己读收藏，备注还在。
    const mine = await app.inject({ method: "GET", url: "/api/favorites", headers: headersFor(ALICE) });
    expect(mine.statusCode).toBe(200);
    const rows = (
      mine.json() as { items: Array<{ siteId: string; note: string | null }> }
    ).items.filter((r) => r.siteId === siteActive);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].note).toBe("私人备注：不要给别人看");
  });
});

describe("公开读 / 下线 / 重新发布 / 删除", () => {
  it("下线 → 公开读 404；重新发布 → 恢复 200；删除 → 404", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/public-pages",
      headers: headersFor(ALICE),
      payload: { title: "生命周期", folderId: aliceFolder, slug: "lifecycle-page" },
    });
    expect(created.statusCode).toBe(201);

    const off = await app.inject({
      method: "PATCH",
      url: "/api/public-pages/lifecycle-page",
      headers: headersFor(ALICE),
      payload: { status: "unpublished" },
    });
    expect(off.statusCode).toBe(200);
    expect((off.json() as { page: { status: string } }).page.status).toBe("unpublished");
    expect((await app.inject({ method: "GET", url: "/api/public-pages/lifecycle-page" })).statusCode).toBe(404);

    const on = await app.inject({
      method: "PATCH",
      url: "/api/public-pages/lifecycle-page",
      headers: headersFor(ALICE),
      payload: { status: "published" },
    });
    expect(on.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/public-pages/lifecycle-page" })).statusCode).toBe(200);

    const del = await app.inject({
      method: "DELETE",
      url: "/api/public-pages/lifecycle-page",
      headers: headersFor(ALICE),
    });
    expect(del.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/public-pages/lifecycle-page" })).statusCode).toBe(404);
  });

  it("跨 owner 改状态/删除一律 404，且原页仍可公开读", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/public-pages",
      headers: headersFor(ALICE),
      payload: { title: "不归 Bob 管", folderId: aliceFolder, slug: "not-bobs-page" },
    });
    expect(created.statusCode).toBe(201);

    const patch = await app.inject({
      method: "PATCH",
      url: "/api/public-pages/not-bobs-page",
      headers: headersFor(BOB),
      payload: { status: "unpublished" },
    });
    expect(patch.statusCode).toBe(404);
    const del = await app.inject({
      method: "DELETE",
      url: "/api/public-pages/not-bobs-page",
      headers: headersFor(BOB),
    });
    expect(del.statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/public-pages/not-bobs-page" })).statusCode).toBe(200);
  });

  it("不存在的 slug 公开读 404；我的列表无身份 400", async () => {
    expect((await app.inject({ method: "GET", url: "/api/public-pages/no-such-page" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/public-pages" })).statusCode).toBe(400);
    const mine = await app.inject({ method: "GET", url: "/api/public-pages", headers: headersFor(ALICE) });
    expect(mine.statusCode).toBe(200);
    const pages = (mine.json() as { pages: Array<{ slug: string }> }).pages;
    expect(pages.some((p) => p.slug === "not-bobs-page")).toBe(true);
  });
});
