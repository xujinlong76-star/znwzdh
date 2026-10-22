/**
 * canonical 身份解析下沉（方案 v2 N2）。
 *
 * 身份合并（identity_aliases）之后，旧 id 仍是一枚合法且已签名的身份：
 * 扩展、MCP、没刷新的旧标签页都会继续用它发请求。若五个用户域路由直接用
 * 原始 id 读写，合并后的数据在旧身份视角下「消失」，写入又会另起孤儿行。
 *
 * 本文件锁两件事：
 *   1. 以旧 id 读收藏 / 历史 / 金库 / 工作区，拿到的都是 canonical 的数据；
 *   2. 以旧 id 写入，落库归属是 canonical（旧 id 不留任何行）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

const OLD = "anon-canon-old-0001";
const NEW = "github:canon-new-0001";

const base = {
  mode: "lite" as const,
  embedding: { model: "none", endpoint: "", dtype: "q8" as const, dim: 512, enabled: false },
  llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
  fetch: { timeoutMs: 1500, maxBytes: 65536, maxRedirects: 1, allowPrivateNetworks: false, userAgent: "NavHubCanonTest/0.1" },
  corsOrigins: ["*"],
};

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
let siteId: string;
let writableSiteId: string;

const H = { "x-navhub-anon-id": OLD };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-canon-"));
  ctx = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "canon.db") } as never));
  app = await buildServer(ctx);
  await app.ready();

  const cat = await ctx.repo.createCategory({ id: "cat-canon", title: "合并测试类目" });
  const site = await ctx.repo.createSite({ url: "https://canon.example.com/a", title: "合并前站点", categoryId: cat.id });
  siteId = site.id;
  const writable = await ctx.repo.createSite({ url: "https://canon.example.com/b", title: "旧身份写入", categoryId: cat.id });
  writableSiteId = writable.id;

  await ctx.repo.addFavorite({ userId: NEW, siteId });
  await ctx.repo.recordSearch(NEW, "合并后的查询", 3);
  await ctx.repo.saveUserVault(NEW, "cipher-v1");
  await ctx.repo.saveWorkspaceBlob(
    "workspaces:" + NEW,
    JSON.stringify([{ id: "ws-merged", name: "合并后的空间", slug: "merged", role: "owner" }]),
  );

  const merged = await ctx.repo.mergeIdentity(OLD, NEW);
  expect(merged.target).toBe(NEW);
});

afterAll(async () => {
  await app.close();
  await new Promise((r) => setTimeout(r, 30));
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows 上 SQLite 句柄释放有延迟：临时目录由系统回收，不让清理失败判红
  }
});

describe("旧身份读：五个用户域都落到 canonical", () => {
  it("GET /api/favorites?anonId=旧 → 看到 canonical 的收藏", async () => {
    const res = await app.inject({ method: "GET", url: `/api/favorites?anonId=${OLD}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ siteId: string }> };
    expect(body.items.map((i) => i.siteId)).toContain(siteId);
  });

  it("GET /api/search-history?anonId=旧 → 看到 canonical 的历史", async () => {
    const res = await app.inject({ method: "GET", url: `/api/search-history?anonId=${OLD}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ query: string }> };
    expect(body.items.map((i) => i.query)).toContain("合并后的查询");
  });

  it("GET /api/vault/sync?anonId=旧 → 看到 canonical 的金库", async () => {
    const res = await app.inject({ method: "GET", url: `/api/vault/sync?anonId=${OLD}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { vault: { payload: string } | null };
    expect(body.vault?.payload).toBe("cipher-v1");
  });

  it("GET /api/workspaces（旧身份头）→ 看到 canonical 的工作区名册", async () => {
    const res = await app.inject({ method: "GET", url: "/api/workspaces", headers: H });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ id: string }> };
    expect(body.items.map((w) => w.id)).toContain("ws-merged");
  });
});

describe("旧身份写：落库归属 canonical，不再产生孤儿行", () => {
  it("POST /api/favorites?anonId=旧 → 新收藏的 user_id 是 canonical", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/favorites?anonId=${OLD}`,
      payload: { siteId: writableSiteId },
    });
    expect([200, 201]).toContain(res.statusCode);

    const rows = await ctx.repo.raw("SELECT user_id FROM favorites WHERE site_id = ?", [writableSiteId]);
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!.user_id)).toBe(NEW);

    const orphan = await ctx.repo.raw("SELECT COUNT(*) AS c FROM favorites WHERE user_id = ?", [OLD]);
    expect(Number(orphan[0]!.c)).toBe(0);
  });
});
