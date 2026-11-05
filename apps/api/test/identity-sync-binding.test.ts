/**
 * `/api/users/sync` 的身份绑定（P0-2）。
 *
 * 修复前的口径是「任何有效 token 都可以同步任意 provider:providerId」——持票
 * 被当成了「可代表任意终端用户」，签名校验又只对匿名请求生效。这里把三档
 * 收口逐条钉住：
 *
 *   1. 个人令牌（owner 非空）只能同步解析后仍等于 owner 的身份；
 *   2. 实例令牌同步用户身份需要 write/admin，配了签名密钥还必须验签；
 *   3. 匿名（开放模式）行为不变，配了密钥仍走原有匿名验签。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { generateToken, hashToken } from "../src/auth.ts";
import { signIdentity } from "../src/identity-signature.ts";

const BOOTSTRAP = "identity-binding-bootstrap-secret";
const SECRET = "identity-binding-test-secret-0123456789abcdef";

let dir: string;
/** 配了身份签名密钥的鉴权实例 */
let secureCtx: AppContext;
let secureApp: Awaited<ReturnType<typeof buildServer>>;
/** 鉴权但未配签名密钥的实例（沿用只靠 token 的部署形态） */
let plainCtx: AppContext;
let plainApp: Awaited<ReturnType<typeof buildServer>>;

const baseConfig = () => ({
  mode: "lite" as const,
  embedding: {
    model: "m",
    endpoint: "https://hf-mirror.com",
    dtype: "q8" as const,
    cacheDir: join(dir, "models"),
    dim: 512,
    enabled: false,
  },
  corsOrigins: ["*"],
});

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-identity-binding-"));

  secureCtx = await createContext(
    loadConfig({
      ...baseConfig(),
      sqlitePath: join(dir, "secure.db"),
      authRequired: true,
      bootstrapToken: BOOTSTRAP,
      identitySecret: SECRET,
    }),
  );
  secureApp = await buildServer(secureCtx);
  await secureApp.ready();

  plainCtx = await createContext(
    loadConfig({
      ...baseConfig(),
      sqlitePath: join(dir, "plain.db"),
      authRequired: true,
      bootstrapToken: BOOTSTRAP,
    }),
  );
  plainApp = await buildServer(plainCtx);
  await plainApp.ready();
});

afterAll(async () => {
  await secureApp.close();
  await secureCtx.close();
  await plainApp.close();
  await plainCtx.close();
  rmSync(dir, { recursive: true, force: true });
});

async function mintInstanceToken(app: Awaited<ReturnType<typeof buildServer>>, name: string, scopes: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/tokens",
    headers: { authorization: `Bearer ${BOOTSTRAP}` },
    payload: { name, scopes },
  });
  expect(res.statusCode).toBe(201);
  return res.json().token as string;
}

/** 直接落库造个人令牌：owner 非空才是 T20 的个人令牌形态 */
async function mintPersonalToken(ctx: AppContext, ownerIdentity: string, scopes = "read,write"): Promise<string> {
  const raw = generateToken();
  await ctx.repo.createApiToken({
    name: "personal-" + ownerIdentity,
    tokenHash: hashToken(raw),
    scopes,
    ownerIdentity,
  });
  return raw;
}

function sync(
  app: Awaited<ReturnType<typeof buildServer>>,
  payload: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return app.inject({ method: "POST", url: "/api/users/sync", payload, headers });
}

describe("个人令牌：只能同步 owner 身份", () => {
  const owner = "github:alice";
  let token: string;

  beforeAll(async () => {
    token = await mintPersonalToken(secureCtx, owner);
  });

  it("同步自己的身份 → 200", async () => {
    const res = await sync(secureApp, { provider: "github", providerId: "alice", username: "Alice" }, {
      authorization: "Bearer " + token,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().id).toBe(owner);
  });

  it("同步他人身份 → 403，并写 identity.sync_forbidden 审计", async () => {
    const res = await sync(secureApp, { provider: "github", providerId: "mallory", username: "Mallory" }, {
      authorization: "Bearer " + token,
    });
    expect(res.statusCode).toBe(403);

    const rows = (await secureCtx.repo.raw(
      "SELECT action, diff FROM audit_logs WHERE action = 'identity.sync_forbidden' AND target = ?",
      ["github:mallory"],
    )) as Array<{ action: string; diff: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(String(rows[0]!.diff)).toContain("owner_mismatch");
    // 审计里只允许出现 tokenId，不允许出现明文令牌
    expect(String(rows[0]!.diff)).not.toContain(token);
  });

  it("别名解析后与 owner 等价 → 200，行落在 canonical 身份", async () => {
    await secureCtx.repo.run(
      `INSERT INTO identity_aliases (alias, canonical, created_at) VALUES (?,?,?)
       ON CONFLICT (alias) DO UPDATE SET canonical = excluded.canonical`,
      ["github:alice-old", owner, Date.now()],
    );
    const res = await sync(secureApp, { provider: "github", providerId: "alice-old", username: "Alice Old" }, {
      authorization: "Bearer " + token,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().id).toBe(owner);
  });
});

describe("实例令牌：写用户身份需要 write 与签名", () => {
  it("read 令牌在无签名密钥的鉴权实例上 → 403（scope 不足）", async () => {
    const read = await mintInstanceToken(plainApp, "sync-reader", "read");
    const res = await sync(plainApp, { provider: "github", providerId: "reader-target" }, {
      authorization: "Bearer " + read,
    });
    expect(res.statusCode).toBe(403);
  });

  it("write 令牌在无签名密钥的鉴权实例上 → 200", async () => {
    const write = await mintInstanceToken(plainApp, "sync-writer", "write");
    const res = await sync(plainApp, { provider: "github", providerId: "writer-target" }, {
      authorization: "Bearer " + write,
    });
    expect(res.statusCode, res.body).toBe(200);
  });

  it("配了签名密钥：write 令牌无签名 → 401", async () => {
    const write = await mintInstanceToken(secureApp, "secure-writer", "write");
    const res = await sync(secureApp, { provider: "github", providerId: "secure-target" }, {
      authorization: "Bearer " + write,
    });
    expect(res.statusCode).toBe(401);
  });

  it("配了签名密钥：write 令牌 + 有效签名 → 200", async () => {
    const write = await mintInstanceToken(secureApp, "secure-writer-signed", "write");
    const target = "github:secure-signed";
    const res = await sync(secureApp, { provider: "github", providerId: "secure-signed" }, {
      authorization: "Bearer " + write,
      "x-navhub-identity-signature": signIdentity(SECRET, target),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().id).toBe(target);
  });

  it("配了签名密钥：签名对不上目标身份 → 401（不能借 write 令牌冒名）", async () => {
    const write = await mintInstanceToken(secureApp, "secure-writer-wrongsig", "write");
    const res = await sync(secureApp, { provider: "github", providerId: "victim" }, {
      authorization: "Bearer " + write,
      "x-navhub-identity-signature": signIdentity(SECRET, "github:someone-else"),
    });
    expect(res.statusCode).toBe(401);
  });
});
