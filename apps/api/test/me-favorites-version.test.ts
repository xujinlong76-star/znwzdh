import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";

/**
 * 收藏变更水位端点（B3 多端一致性轮询）：
 *  - 返回 MAX(updated_at)（与增量同步 version 同口径），不拉行；
 *  - 写路径（add / remove）必须推动水位前进；
 *  - 无签名身份 401、别名身份解析到 canonical。
 */
const SECRET = "test-secret-please-rotate";
const USER = "github:u-version-api";
const ALIAS = "anon-44444444-4444-4444-4444-444444444444";

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
let siteId = "";

const headersFor = (identity: string) => ({
  "x-navhub-user-id": identity,
  "x-navhub-identity-signature": signIdentity(SECRET, identity),
});

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-fav-ver-"));
  ctx = await createContext(
    loadConfig({ ...base, sqlitePath: join(dir, "ver.db"), identitySecret: SECRET }),
  );
  app = await buildServer(ctx);
  await app.ready();
  const cat = await ctx.repo.createCategory({ title: "水位测试" });
  siteId = (await ctx.repo.createSite({ url: "https://ver.example.com", title: "水位站", categoryId: cat.id })).id;
  // 别名合并：ALIAS -> USER（水位查询应解析到 canonical 用户）
  await ctx.repo.mergeIdentity(ALIAS, USER);
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/favorites/version", () => {
  it("无签名身份 -> 401", async () => {
    const res = await app.inject({ method: "GET", url: `/api/favorites/version?userId=${USER}` });
    expect(res.statusCode).toBe(401);
  });

  it("空收藏返回 version=0（新用户/匿名新身份）", async () => {
    const res = await app.inject({ method: "GET", url: `/api/favorites/version?userId=${USER}`, headers: headersFor(USER) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ identity: USER, version: 0 });
  });

  it("写路径推动水位前进；别名身份解析到 canonical", async () => {
    const v0 = (await app.inject({ method: "GET", url: `/api/favorites/version?userId=${USER}`, headers: headersFor(USER) })).json().version;
    await ctx.repo.addFavorite({ userId: USER, siteId });
    // 水位用毫秒时间戳：确保 add 刷新了 updated_at（同毫秒写入时允许 >=）
    const viaAlias = await app.inject({ method: "GET", url: `/api/favorites/version?userId=${ALIAS}`, headers: headersFor(ALIAS) });
    expect(viaAlias.statusCode).toBe(200);
    const body = viaAlias.json();
    expect(body.identity).toBe(USER);
    expect(body.version).toBeGreaterThanOrEqual(v0);
    expect(body.version).toBeGreaterThan(0);

    // 再删掉：removeFavorite 是写路径，同样要刷新水位
    await ctx.repo.removeFavorite(USER, siteId);
    const v2 = (await app.inject({ method: "GET", url: `/api/favorites/version?userId=${USER}`, headers: headersFor(USER) })).json().version;
    expect(v2).toBeGreaterThanOrEqual(body.version);
  });
});
