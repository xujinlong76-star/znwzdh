import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";

/**
 * 个人令牌（T20）的身份隔离回归。
 *
 * 背景：用户级令牌在 `server.ts` 的签名 hook 里被整段放行（owner 本身就是凭据，
 * 不需要再签自称身份）。如果路由层继续用 `identityOf`（裸读 x-navhub-user-id），
 * 持令牌者只要加一个头就能把身份切成任意受害者——导出、注销、改 LLM 密钥全部沦陷。
 *
 * 正确口径是 `requestIdentityOf`：有 owner 就只认 owner，没有 owner 才回退自称头。
 * 本文件锁死这条不变量，防止后续新增用户域路由时再次踩坑。
 */
const SECRET = "test-secret-token-isolation";
const OWNER = "github:u-token-isolation-owner";
const VICTIM = "github:u-token-isolation-victim";

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
let token = "";

const headersFor = (identity: string) => ({
  "x-navhub-user-id": identity,
  "x-navhub-identity-signature": signIdentity(SECRET, identity),
});

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-token-iso-"));
  ctx = await createContext(
    loadConfig({ ...base, sqlitePath: join(dir, "iso.db"), identitySecret: SECRET }),
  );
  app = await buildServer(ctx);
  await app.ready();

  await ctx.repo.addFavorite({ userId: OWNER, siteId: "iso-site-owner" });
  await ctx.repo.addFavorite({ userId: VICTIM, siteId: "iso-site-victim" });

  const created = await app.inject({
    method: "POST",
    url: "/api/me/tokens",
    headers: { ...headersFor(OWNER), "content-type": "application/json" },
    payload: { name: "隔离回归令牌" },
  });
  expect(created.statusCode).toBe(200);
  token = created.json().token as string;
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("个人令牌不能被自称头改写成他人", () => {
  it("导出：Bearer + 伪造 x-navhub-user-id 仍只导出 owner 的数据", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/me/export",
      headers: { authorization: "Bearer " + token, "x-navhub-user-id": VICTIM },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { identity: string; favorites: Array<{ siteId: string }> };
    expect(body.identity).toBe(OWNER);
    const ids = body.favorites.map((f) => f.siteId);
    expect(ids).toContain("iso-site-owner");
    expect(ids).not.toContain("iso-site-victim");
  });

  it("注销：Bearer + 伪造头只清 owner，受害者数据仍在", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/me",
      headers: {
        authorization: "Bearer " + token,
        "x-navhub-user-id": VICTIM,
        "content-type": "application/json",
      },
      payload: { confirm: "DELETE" },
    });
    expect(res.statusCode).toBe(200);

    // 受害者用自己签名导出，收藏应原样保留
    const victimExport = await app.inject({
      method: "GET",
      url: "/api/me/export",
      headers: headersFor(VICTIM),
    });
    expect(victimExport.statusCode).toBe(200);
    const ids = (victimExport.json().favorites as Array<{ siteId: string }>).map((f) => f.siteId);
    expect(ids).toContain("iso-site-victim");
  });
});
