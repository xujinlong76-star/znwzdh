import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";

/**
 * 个人令牌收藏写路径（B1）：
 *  - 创建令牌时 write:true 才发 write scope（默认仍只读）；
 *  - 持 write 令牌 POST /api/favorites = 收藏到 owner 名下（身份不可自称覆盖）；
 *  - 持只读令牌写 -> 403（自建凭据误贴的爆炸半径停在只读）。
 */
const SECRET = "test-secret-please-rotate";
const USER = "github:u-fav-write";
const IMPERSONATOR = "github:u-impersonator";

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

async function createToken(write: boolean): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/me/tokens",
    headers: headersFor(USER),
    payload: { name: write ? "ext-write" : "ext-read", write },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { token: string; record: { scopes: string[] } };
  expect(body.record.scopes).toEqual(write ? ["read", "write"] : ["read"]);
  return body.token;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-fav-write-"));
  ctx = await createContext(
    loadConfig({ ...base, sqlitePath: join(dir, "fw.db"), identitySecret: SECRET }),
  );
  app = await buildServer(ctx);
  await app.ready();
  const cat = await ctx.repo.createCategory({ title: "写路径测试" });
  siteId = (await ctx.repo.createSite({ url: "https://fw.example.com", title: "写路径站", categoryId: cat.id })).id;
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("个人令牌收藏写路径（B1）", () => {
  it("默认只读令牌：写收藏 -> 403，错误信息指向只读", async () => {
    const token = await createToken(false);
    const res = await app.inject({
      method: "POST",
      url: "/api/favorites",
      headers: { Authorization: `Bearer ${token}` },
      payload: { siteId },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain("只读");
  });

  it("write 令牌：收藏落到 owner 名下，自称别人的身份头不生效", async () => {
    const token = await createToken(true);
    const res = await app.inject({
      method: "POST",
      url: "/api/favorites",
      // 冒充别人的 userId 头：owner 令牌的身份以凭据为准
      headers: { Authorization: `Bearer ${token}`, "x-navhub-user-id": IMPERSONATOR },
      payload: { siteId },
    });
    expect(res.statusCode).toBe(201);
    const mine = await ctx.repo.listFavorites(USER);
    const others = await ctx.repo.listFavorites(IMPERSONATOR);
    expect(mine.map((f) => f.siteId)).toContain(siteId);
    expect(others).toHaveLength(0);

    // 重复收藏如实反馈 existed
    const again = await app.inject({
      method: "POST",
      url: "/api/favorites",
      headers: { Authorization: `Bearer ${token}` },
      payload: { siteId },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().existed).toBe(true);
  });

  it("write 令牌的水位可被 /api/favorites/version 探测", async () => {
    const token = await createToken(true);
    const res = await app.inject({
      method: "GET",
      url: "/api/favorites/version",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().identity).toBe(USER);
    expect(res.json().version).toBeGreaterThan(0);
  });
});
