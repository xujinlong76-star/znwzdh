import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";

/**
 * 收藏夹越界（run112）的 API 层守卫：双账号差分。
 *
 * A 用自己的夹子 id 收藏 → 201；A 拿 B 的夹子 id 收藏 → 400 且两侧库里都没多行。
 * 这是 OWASP API1（BOLA）推荐的 CI 门禁形态。改造前 POST /api/favorites 不校验归属，
 * 而同一资源的 PATCH 校验——「一松一紧」正是这类缺陷的典型成因。
 *
 * 同步端点走另一套口径（外夹不整批失败，而是降级/跳过字段），断言的是客户端可观察行为。
 */
const SECRET = "test-secret-please-rotate";
const ALICE = "github:u-folder-own-alice";
const BOB = "github:u-folder-own-bob";

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
let siteOwn = "";
let siteForeignFolder = "";
let siteDanglingFolder = "";
let sitePatchParity = "";
let siteUnfiled = "";
let aliceFolder = "";
let bobFolder = "";

const headersFor = (identity: string) => ({
  "x-navhub-user-id": identity,
  "x-navhub-identity-signature": signIdentity(SECRET, identity),
});

async function createFolder(identity: string, name: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/favorites/folders",
    headers: headersFor(identity),
    payload: { name },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

async function addFavorite(identity: string, payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/api/favorites", headers: headersFor(identity), payload });
}

async function sync(identity: string, payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/api/me/favorites/sync", headers: headersFor(identity), payload });
}

async function listFavorites(identity: string) {
  const res = await app.inject({ method: "GET", url: "/api/favorites", headers: headersFor(identity) });
  expect(res.statusCode).toBe(200);
  return res.json() as {
    items: Array<{ siteId: string; folderId: string | null; note: string | null; tags: string[] | null }>;
  };
}

const favoriteOf = async (identity: string, site: string) =>
  (await listFavorites(identity)).items.find((i) => i.siteId === site);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-folder-own-"));
  ctx = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "folder-own.db"), identitySecret: SECRET }));
  app = await buildServer(ctx);
  await app.ready();
  const cat = await ctx.repo.createCategory({ title: "归属测试" });
  const mk = async (slug: string) =>
    (await ctx.repo.createSite({ url: `https://${slug}.example.com`, title: `归属测试 ${slug}`, categoryId: cat.id }))
      .id;
  siteOwn = await mk("own");
  siteForeignFolder = await mk("foreign");
  siteDanglingFolder = await mk("dangling");
  sitePatchParity = await mk("parity");
  siteUnfiled = await mk("unfiled");
  aliceFolder = await createFolder(ALICE, "爱丽丝的夹子");
  bobFolder = await createFolder(BOB, "鲍勃的夹子");
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/favorites：收藏夹归属", () => {
  it("自己的夹子：201 且挂上（新校验不改变合法写入）", async () => {
    const res = await addFavorite(ALICE, { siteId: siteOwn, folderId: aliceFolder });
    expect(res.statusCode).toBe(201);
    expect((await favoriteOf(ALICE, siteOwn))?.folderId).toBe(aliceFolder);
  });

  it("他人的夹子：400「收藏夹不存在」，两侧库里都没多行", async () => {
    const res = await addFavorite(ALICE, { siteId: siteForeignFolder, folderId: bobFolder });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe("收藏夹不存在");
    expect(await favoriteOf(ALICE, siteForeignFolder)).toBeUndefined();
    expect((await listFavorites(BOB)).items).toHaveLength(0);
  });

  it("悬空夹子 id（不存在）：同样 400，不是「未归档」的合法写法", async () => {
    const res = await addFavorite(ALICE, { siteId: siteDanglingFolder, folderId: "folder-missing" });
    expect(res.statusCode).toBe(400);
    expect(await favoriteOf(ALICE, siteDanglingFolder)).toBeUndefined();
  });

  it("folderId 为 null：新行照常允许（null 不是越界写法）", async () => {
    const res = await addFavorite(ALICE, { siteId: siteUnfiled, folderId: null });
    expect(res.statusCode).toBe(201);
    expect((await favoriteOf(ALICE, siteUnfiled))?.folderId).toBeNull();
  });

  it("缺省 folderId：照常收藏", async () => {
    const res = await addFavorite(ALICE, { siteId: sitePatchParity });
    expect(res.statusCode).toBe(201);
    expect((await favoriteOf(ALICE, sitePatchParity))?.folderId).toBeNull();
  });
});

describe("PATCH 与 POST 口径一致", () => {
  it("两条写路径对他人的夹子给出同一个 400 文案", async () => {
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/favorites/${siteOwn}`,
      headers: headersFor(ALICE),
      payload: { folderId: bobFolder },
    });
    expect(patch.statusCode).toBe(400);
    expect((patch.json() as { error: string }).error).toBe("收藏夹不存在");
    // 原归档位置不能被越界写入改掉
    expect((await favoriteOf(ALICE, siteOwn))?.folderId).toBe(aliceFolder);
  });
});

describe("POST /api/me/favorites/sync：外夹降级而非整批失败", () => {
  const syncUser = "github:u-folder-own-sync";

  it("add 带他人夹子：200、applied=1、落库但 folderId 为 null", async () => {
    const res = await sync(syncUser, { ops: [{ op: "add", siteId: siteOwn, folderId: bobFolder, at: 1000 }] });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { applied: number }).applied).toBe(1);
    expect((await favoriteOf(syncUser, siteOwn))?.folderId).toBeNull();
  });

  it("add 带自己的夹子：照常挂上", async () => {
    const ownFolder = await createFolder(syncUser, "同步自己的夹子");
    const res = await sync(syncUser, {
      ops: [{ op: "add", siteId: siteOwn, note: "同步加", tags: ["同步"], at: 2000 }],
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { items: Array<{ tags: string[] | null }> }).items[0]?.tags).toEqual(["同步"]);
    const patch = await sync(syncUser, { ops: [{ op: "update", siteId: siteOwn, folderId: ownFolder, at: 3000 }] });
    expect((patch.json() as { applied: number }).applied).toBe(1);
    expect((await favoriteOf(syncUser, siteOwn))?.folderId).toBe(ownFolder);
  });

  it("update 带他人夹子：保持原归档位置，note 照常生效", async () => {
    const res = await sync(syncUser, {
      ops: [{ op: "update", siteId: siteOwn, folderId: bobFolder, note: "越界备注", at: 4000 }],
    });
    expect((res.json() as { applied: number }).applied).toBe(1);
    const row = await favoriteOf(syncUser, siteOwn);
    expect(row?.note).toBe("越界备注");
    expect(row?.folderId).not.toBe(bobFolder);
  });

  it("复活保留标签：删除后重新收藏，tags 不被墓碑旧值吞掉", async () => {
    const reviveUser = "github:u-folder-own-revive";
    await sync(reviveUser, { ops: [{ op: "add", siteId: siteOwn, tags: ["旧"], at: 1_000 }] });
    await sync(reviveUser, { ops: [{ op: "remove", siteId: siteOwn, at: 2_000 }] });
    await sync(reviveUser, { ops: [{ op: "add", siteId: siteOwn, tags: ["新"], at: 3_000 }] });
    expect((await favoriteOf(reviveUser, siteOwn))?.tags).toEqual(["新"]);
  });
});
