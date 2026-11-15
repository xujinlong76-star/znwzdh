/**
 * Batch 3 第 4 项「MCP 只读接口」的测试：
 *  - search_favorites：命中备注/标签、只返回本人收藏、实例级 token 被拒、
 *    空查询/超长查询处理、folder/tag 过滤、分页；
 *  - list_favorites：JOIN 后含站点标题/网址/描述；
 *  - list_favorite_folders：返回本人夹子与条数；
 *  - 与 /api/ask 的 retrieveAskCandidates 词法同义（两份实现不漂移的锁）。
 *
 * 注意：本文件测试夹具里 embedding 是禁用的（与 user-center-tools.test.ts
 * 同款 loadConfig），语义路恒降级——semanticAvailable 恒为 false，
 * 命中全部来自词法路；语义路本身由 retrieveAskCandidates 的既有测试覆盖，
 * 这里只锁「同款算法在词法路上的等价性」。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, loadConfig, type AppContext } from "@navhub/api";
import { retrieveAskCandidates } from "../../../apps/api/src/ask-retrieval.ts";
import { createHandlers } from "../src/handlers.ts";
import type { McpScope, ToolContext } from "../src/tools.ts";

let dir: string;
let ctx: AppContext;
let handlers: ReturnType<typeof createHandlers>;

function userToken(actor: string, ownerIdentity: string): ToolContext {
  const scopes: McpScope[] = ["read"];
  return { actor, scopes, ownerIdentity, has: (s) => s === "read" };
}

/** 实例级令牌：管理员签发、无 owner_identity */
function instanceToken(): ToolContext {
  const scopes: McpScope[] = ["read", "admin"];
  return { actor: "mcp:instance", scopes, ownerIdentity: null, has: () => true };
}

const ALICE = "user-alice";
const BOB = "user-bob";

let workFolder = "";
let lifeFolder = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-mcp-fav-search-"));
  const config = await loadConfig({
    sqlitePath: join(dir, "test.db"),
    dataDir: dir,
    // 语义路恒降级：本文件只锁词法路的等价性，模型是否下载成功不应影响结果
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "m"), dim: 512, enabled: false },
  });
  ctx = await createContext(config);
  handlers = createHandlers(ctx);

  const s1 = await ctx.repo.createSite({
    title: "免费短剧大全",
    url: "https://drama.example.com",
    description: "免费看短剧的聚合站",
    categoryId: "dev",
  });
  const s2 = await ctx.repo.createSite({
    title: "设计灵感库",
    url: "https://design.example.com",
    description: "UI 设计参考",
    categoryId: "dev",
  });
  const s3 = await ctx.repo.createSite({
    title: "效率工具箱",
    url: "https://tools.example.com",
    description: "在线小工具合集",
    categoryId: "dev",
  });
  workFolder = (await ctx.repo.createFavoriteFolder(ALICE, "工作")).id;
  lifeFolder = (await ctx.repo.createFavoriteFolder(ALICE, "生活")).id;

  await ctx.repo.addFavorite({ userId: ALICE, siteId: s1.id, folderId: lifeFolder, note: "下班追剧用", tags: ["短剧", "深夜档"] });
  await ctx.repo.addFavorite({ userId: ALICE, siteId: s2.id, folderId: workFolder, note: "做 PPT 找配色", tags: ["设计"] });
  await ctx.repo.addFavorite({ userId: ALICE, siteId: s3.id, note: "摸鱼神器", tags: ["效率"] });
  // Bob 收藏了同一个站：他的备注绝不能漏进 Alice 的结果里
  await ctx.repo.addFavorite({ userId: BOB, siteId: s1.id, note: "bob 的备注", tags: ["短剧"] });

  // 三条同词标题，供分页用
  for (const name of ["甲", "乙", "丙"]) {
    const site = await ctx.repo.createSite({
      title: "测试站" + name,
      url: "https://paging.example.com/" + name,
      description: "分页夹具",
      categoryId: "dev",
    });
    await ctx.repo.addFavorite({ userId: ALICE, siteId: site.id });
  }
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

function payload(res: any): any {
  const item = res?.content?.find((c: any) => c.type === "text");
  return item ? JSON.parse(item.text) : res;
}

const alice = () => userToken("mcp:alice-token", ALICE);

describe("MCP search_favorites", () => {
  it("命中收藏备注（备注是检索文本的一部分）", async () => {
    const out = payload(await handlers.search_favorites({ query: "追剧" }, alice()));
    expect(out.count).toBe(1);
    expect(out.results[0].title).toBe("免费短剧大全");
    expect(out.results[0].note).toBe("下班追剧用");
    expect(out.results[0].matchedBy.lexical).toBe(1);
    expect(out.results[0].matchScore).toBeGreaterThan(0);
    expect(out.semanticAvailable).toBe(false);
  });

  it("命中标签（标签不在标题/描述/备注里也能召回）", async () => {
    const out = payload(await handlers.search_favorites({ query: "深夜档" }, alice()));
    expect(out.count).toBe(1);
    expect(out.results[0].title).toBe("免费短剧大全");
    expect(out.results[0].tags).toContain("深夜档");
  });

  it("只返回本人收藏：Bob 的同站备注不出现", async () => {
    const out = payload(await handlers.search_favorites({ query: "短剧" }, alice()));
    expect(out.results.length).toBeGreaterThan(0);
    expect(out.results.every((r: any) => r.note !== "bob 的备注")).toBe(true);
    expect(out.results[0].note).toBe("下班追剧用");
    const bob = payload(await handlers.search_favorites({ query: "短剧" }, userToken("mcp:bob-token", BOB)));
    expect(bob.results).toHaveLength(1);
    expect(bob.results[0].note).toBe("bob 的备注");
  });

  it("实例级令牌（无 ownerIdentity）被拒绝", async () => {
    await expect(handlers.search_favorites({ query: "短剧" }, instanceToken())).rejects.toThrow(/个人令牌/);
    await expect(handlers.list_favorite_folders({}, instanceToken())).rejects.toThrow(/个人令牌/);
  });

  it("空查询返回空结果不报错；超长查询被契约拒绝", async () => {
    const empty = payload(await handlers.search_favorites({ query: "   " }, alice()));
    expect(empty.count).toBe(0);
    expect(empty.results).toEqual([]);
    expect(empty.totalFavorites).toBe(6);
    await expect(handlers.search_favorites({ query: "长".repeat(257) }, alice())).rejects.toThrow(/256/);
  });

  it("词法 0 命中时纠错一次（收藏子集词典）", async () => {
    const out = payload(await handlers.search_favorites({ query: "短据" }, alice()));
    expect(out.correction).toEqual({ from: "短据", to: "短剧" });
    expect(out.results[0].title).toBe("免费短剧大全");
  });

  it("folder / tag 过滤只收窄本人语料", async () => {
    const byFolder = payload(await handlers.search_favorites({ query: "短剧", folder: lifeFolder }, alice()));
    expect(byFolder.results).toHaveLength(1);
    const wrongFolder = payload(await handlers.search_favorites({ query: "短剧", folder: workFolder }, alice()));
    expect(wrongFolder.results).toEqual([]);
    const byTag = payload(await handlers.search_favorites({ query: "设计", tag: "设计" }, alice()));
    expect(byTag.results).toHaveLength(1);
    expect(byTag.results[0].title).toBe("设计灵感库");
    const wrongTag = payload(await handlers.search_favorites({ query: "设计", tag: "短剧" }, alice()));
    expect(wrongTag.results).toEqual([]);
  });

  it("limit / offset 分页（hasMore 探针）", async () => {
    const first = payload(await handlers.search_favorites({ query: "测试站", limit: 2, offset: 0 }, alice()));
    expect(first.count).toBe(2);
    expect(first.hasMore).toBe(true);
    const rest = payload(await handlers.search_favorites({ query: "测试站", limit: 2, offset: 2 }, alice()));
    expect(rest.count).toBe(1);
    expect(rest.hasMore).toBe(false);
    expect(rest.results[0].siteId).not.toBe(first.results[0].siteId);
    expect(rest.results[0].siteId).not.toBe(first.results[1].siteId);
  });

  it("与 retrieveAskCandidates 词法同义（同一批夹具、同一查询，命中集合一致）", async () => {
    for (const query of ["追剧", "深夜档", "设计", "短剧", "摸鱼"]) {
      const mine = payload(await handlers.search_favorites({ query, limit: 50 }, alice()));
      const theirs = await retrieveAskCandidates(ctx, ALICE, query);
      const mineIds = mine.results.map((r: any) => r.siteId).sort();
      const theirsIds = theirs.candidates.map((c) => c.siteId).sort();
      expect(mineIds).toEqual(theirsIds);
    }
  });
});

describe("MCP list_favorites（JOIN 后字段）", () => {
  it("每条含站点标题/网址/描述，不改现有字段与参数名", async () => {
    const out = payload(await handlers.list_favorites({}, alice()));
    expect(out.total).toBe(6);
    const drama = out.items.find((i: any) => i.note === "下班追剧用");
    expect(drama.title).toBe("免费短剧大全");
    expect(drama.url).toBe("https://drama.example.com");
    expect(drama.description).toBe("免费看短剧的聚合站");
    // 现有字段原样保留
    expect(drama.siteId).toBeDefined();
    expect(drama.folderId).toBe(lifeFolder);
    expect(drama.tags).toContain("短剧");
  });

  it("folder 过滤仍可用", async () => {
    const out = payload(await handlers.list_favorites({ folder: workFolder }, alice()));
    expect(out.total).toBe(1);
    expect(out.items[0].title).toBe("设计灵感库");
  });
});

describe("MCP list_favorite_folders", () => {
  it("返回本人夹子（id/名称/条数）与未分夹条数", async () => {
    const out = payload(await handlers.list_favorite_folders({}, alice()));
    expect(out.count).toBe(2);
    const byName = new Map(out.folders.map((f: any) => [f.name, f]));
    expect(byName.get("生活").count).toBe(1);
    expect(byName.get("工作").count).toBe(1);
    expect(byName.get("生活").id).toBe(lifeFolder);
    expect(out.unfiledCount).toBe(4);
  });

  it("别人的夹子看不到", async () => {
    const out = payload(await handlers.list_favorite_folders({}, userToken("mcp:bob-token", BOB)));
    expect(out.count).toBe(0);
    expect(out.unfiledCount).toBe(1);
  });
});
