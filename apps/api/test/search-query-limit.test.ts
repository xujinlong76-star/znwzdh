/**
 * 查询词长度全链路同源（run55）。
 *
 * 缺陷：/api/search 允许 256 字、导出原样带出；/api/me/import 却把单条历史
 * 限在 200 字。于是一条 201~256 字的历史能让整份合法备份 400，收藏与设置连坐。
 * 这里从 HTTP 面钉住四件事：
 *   1. 检索入口 256 放行 / 257 拒绝（GET 与 POST 同口径）；
 *   2. 导入 256 字历史可恢复，且导出能原样带回；
 *   3. 导出的 searchHistory 原样导入另一个身份仍成功（真往返）；
 *   4. 导入 257 字整份拒绝，同批收藏夹不产生半份副作用。
 * 仓储最后一道守卫由 packages/store/test/store.test.ts 钉住；
 * MCP 契约由 packages/mcp/test/tool-contract.test.ts 钉住。
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
const USER = "github:u-query-limit";
const SECOND = "github:u-query-limit-restore";
const MAX = 256;

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

const search = (method: "GET" | "POST", q: string) =>
  method === "GET"
    ? app.inject({ method, url: `/api/search?q=${encodeURIComponent(q)}`, headers: signed(USER) })
    : app.inject({ method, url: "/api/search", headers: signed(USER), payload: { q } });

const importBackup = (payload: unknown, identity = USER) =>
  app.inject({ method: "POST", url: "/api/me/import", headers: signed(identity), payload: payload as never });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-query-limit-"));
  ctx = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "query-limit.db"), identitySecret: SECRET }));
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("查询词长度：/api/search 与 /api/me/import 同一口径", () => {
  it("检索入口：256 字放行，257 字 GET 与 POST 都 400", async () => {
    const ok = await search("GET", "长".repeat(MAX));
    expect(ok.statusCode).toBe(200);

    expect((await search("GET", "长".repeat(MAX + 1))).statusCode).toBe(400);
    expect((await search("POST", "长".repeat(MAX + 1))).statusCode).toBe(400);
  });

  it("导入 256 字历史：可以恢复，导出原样带回，并能在另一个身份上完成真往返", async () => {
    const max = "导".repeat(MAX);
    const res = await importBackup({ searchHistory: { items: [{ query: max, resultCount: 1 }] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().searchesImported).toBe(1);
    expect((await ctx.repo.listSearchHistory(USER, 10)).some((i) => i.query === max)).toBe(true);

    // 导出侧真的能产出它 —— 这正是旧导入上限 200 会拒绝的合法备份
    const exported = await app.inject({ method: "GET", url: "/api/me/export", headers: signed(USER) });
    expect(exported.statusCode).toBe(200);
    const history = exported.json().searchHistory as { items: Array<{ query: string }>; truncated: boolean };
    expect(history.items.some((i) => i.query === max)).toBe(true);

    // 真往返：把导出的 searchHistory 原样导入另一个身份，不得因长度被拒
    const restore = await importBackup({ searchHistory: history }, SECOND);
    expect(restore.statusCode).toBe(200);
    // 导出里有多少条（含上一条用例写入的检索历史）就恢复多少条，一条都不能再被长度拒掉
    expect(restore.json().searchesImported).toBe(history.items.length);
    expect((await ctx.repo.listSearchHistory(SECOND, 10)).map((i) => i.query)).toContain(max);
  });

  it("导入 257 字：整份 400，且同批收藏夹不产生半份副作用", async () => {
    const before = (await ctx.repo.listSearchHistory(USER, 10)).length;
    const res = await importBackup({
      favoriteFolders: [{ name: "不该被写入的夹子" }],
      searchHistory: { items: [{ query: "长".repeat(MAX + 1) }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("备份");
    expect((await ctx.repo.listSearchHistory(USER, 10)).length).toBe(before);
    const folders = await ctx.repo.listFavoriteFolders(USER);
    expect(folders.some((f) => f.name === "不该被写入的夹子")).toBe(false);
  });
});
