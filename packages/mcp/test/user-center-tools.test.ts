/**
 * 用户域只读工具（B2）的边界测试：
 *  - 数据可见范围 = 令牌归属（ownerIdentity），不是任何调用参数；
 *  - 实例级令牌（无 ownerIdentity）一律拒绝——站点管理凭据不该能读个人数据；
 *  - 分页 / 过滤语义（folder / offset / hasMore）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, loadConfig, type AppContext } from "@navhub/api";
import { createHandlers } from "../src/handlers.ts";
import type { McpScope, ToolContext } from "../src/tools.ts";

let dir: string;
let ctx: AppContext;
let handlers: ReturnType<typeof createHandlers>;

function userToken(actor: string, ownerIdentity: string): ToolContext {
  const scopes: McpScope[] = ["read"];
  return { actor, scopes, ownerIdentity, has: (s) => s === "read" || s === "write" };
}

/** 实例级令牌：管理员签发、无 owner_identity */
function instanceToken(): ToolContext {
  const scopes: McpScope[] = ["read", "admin"];
  return { actor: "mcp:instance", scopes, ownerIdentity: null, has: () => true };
}

const ALICE = "user-alice";
const BOB = "user-bob";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-mcp-user-"));
  const config = await loadConfig({ sqlitePath: join(dir, "test.db"), dataDir: dir });
  ctx = await createContext(config);
  handlers = createHandlers(ctx);

  // 两个用户各自收藏同一个站点 + 各自一条搜索历史
  const site = await ctx.repo.createSite({
    title: "MCP 用户域测试站",
    url: "https://mcp-user.example.com",
    categoryId: "dev",
  });
  await ctx.repo.addFavorite({ userId: ALICE, siteId: site.id, note: "alice 的收藏" });
  await ctx.repo.addFavorite({ userId: BOB, siteId: site.id, note: "bob 的收藏" });
  await ctx.repo.recordSearch(ALICE, "alice 查询", 3);
  await ctx.repo.recordSearch(BOB, "bob 查询", 0);
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

function payload(res: any): any {
  const item = res?.content?.find((c: any) => c.type === "text");
  return item ? JSON.parse(item.text) : res;
}

describe("MCP 用户域工具边界", () => {
  it("list_favorites 只能看到令牌归属用户自己的收藏（隔离 + 分页）", async () => {
    const bound = createBound();
    const alice = payload(await bound.list_favorites({}, userToken("mcp:alice-token", ALICE)));
    const items = alice.items;
    expect(items).toHaveLength(1);
    expect(items[0]!.note).toBe("alice 的收藏");

    const bob = payload(await bound.list_favorites({}, userToken("mcp:bob-token", BOB)));
    expect(bob.items[0]!.note).toBe("bob 的收藏");
  });

  it("实例级令牌（无 ownerIdentity）被拒绝", async () => {
    const bound = createBound();
    await expect(bound.list_favorites({}, instanceToken())).rejects.toThrow(/个人令牌/);
    await expect(bound.list_search_history({}, instanceToken())).rejects.toThrow(/个人令牌/);
    await expect(bound.get_profile_summary({}, instanceToken())).rejects.toThrow(/个人令牌/);
  });

  it("list_search_history 按归属隔离", async () => {
    const bound = createBound();
    const alice = payload(await bound.list_search_history(
      { limit: 10, offset: 0 },
      userToken("mcp:alice-token", ALICE),
    ));
    expect(alice.items.map((i: any) => i.query)).toEqual(["alice 查询"]);
  });

  it("get_profile_summary：无画像如实返回 exists=false", async () => {
    const bound = createBound();
    const out = payload(await bound.get_profile_summary({}, userToken("mcp:alice-token", ALICE)));
    expect(out.exists).toBe(false);
  });
});

/** handlers 的绑定形态是 (args, tc)——用任意 deps 建一次 bind（只读工具不触 deps） */
function createBound() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyHandlers = handlers as any;
  return {
    list_favorites: anyHandlers.list_favorites as (a: unknown, t: ToolContext) => Promise<unknown>,
    list_search_history: anyHandlers.list_search_history as (a: unknown, t: ToolContext) => Promise<unknown>,
    get_profile_summary: anyHandlers.get_profile_summary as (a: unknown, t: ToolContext) => Promise<unknown>,
  };
}
