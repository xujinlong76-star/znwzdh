import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";
import { hashToken } from "../src/auth.ts";

/**
 * 个人令牌的实例写面边界（P0-3）的**接线级**验证。
 *
 * 纯函数矩阵在 packages/core/test/authz.test.ts；这里证明 server.ts 的
 * onRequest 真的把判定接进了请求链：个人 write 令牌改全站站点必须 403，
 * 而同一枚令牌写自己的收藏仍然可用；实例令牌不受影响。
 */
const SECRET = "test-secret-personal-token-boundary";
const USER = "github:boundary-user";

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
let categoryId = "";
let siteId = "";
let personalWriteToken = "";
let instanceWriteToken = "";

const headersFor = (identity: string) => ({
  "x-navhub-user-id": identity,
  "x-navhub-identity-signature": signIdentity(SECRET, identity),
});
const bearer = (token: string) => ({ authorization: "Bearer " + token });

let seq = 0;
const inject = (opts: {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  payload?: unknown;
}) => app.inject({ ...opts, remoteAddress: `10.93.0.${(seq++ % 200) + 3}` } as never);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-token-boundary-"));
  ctx = await createContext(
    loadConfig({ ...base, sqlitePath: join(dir, "boundary.db"), identitySecret: SECRET }),
  );
  app = await buildServer(ctx);
  await app.ready();

  // 站点只能挂在叶子类目下：用内置的「未分类」叶子，避免为了测试造根类目
  categoryId = await ctx.repo.ensureUncategorized();
  const site = await ctx.repo.createSite({ url: "https://boundary.example.com", title: "boundary", categoryId });
  siteId = site.id;

  // 个人令牌：走真实签发端点（permission=write → read,write）
  const created = await inject({
    method: "POST",
    url: "/api/me/tokens",
    headers: headersFor(USER),
    payload: { name: "boundary-personal-write", permission: "write" },
  });
  expect(created.statusCode, JSON.stringify(created.json())).toBe(200);
  personalWriteToken = (created.json() as { token: string }).token;

  // 实例令牌：owner 为空，等价于运维/扩展用的实例级凭据
  instanceWriteToken = "nh_instance_boundary_write_token";
  await ctx.repo.createApiToken({
    name: "boundary-instance-write",
    tokenHash: hashToken(instanceWriteToken),
    scopes: "read,write",
    ownerIdentity: null,
  });
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("个人令牌不得越权到实例写面", () => {
  it("个人 write 令牌创建站点 → 403（不是 401/500）", async () => {
    const res = await inject({
      method: "POST",
      url: "/api/sites",
      headers: bearer(personalWriteToken),
      payload: { url: "https://blocked.example.com", title: "blocked", categoryId },
    });
    expect(res.statusCode).toBe(403);
    expect(String((res.json() as { error?: string }).error)).toContain("个人令牌");
    // 确认没有落库：403 之后不能出现「报错了但数据写进去了」
    expect(await ctx.repo.findSiteByUrl("https://blocked.example.com")).toBeNull();
  });

  it("同一枚令牌写自己的收藏 → 仍然可用（用户域不被误伤）", async () => {
    const res = await inject({
      method: "POST",
      url: "/api/favorites",
      headers: bearer(personalWriteToken),
      payload: { siteId },
    });
    expect([200, 201]).toContain(res.statusCode);
  });

  it("实例 write 令牌创建站点 → 放行（不误伤 MCP/扩展/运维凭据）", async () => {
    const res = await inject({
      method: "POST",
      url: "/api/sites",
      headers: bearer(instanceWriteToken),
      payload: { url: "https://allowed.example.com", title: "allowed", categoryId },
    });
    expect(res.statusCode, JSON.stringify(res.json())).toBe(201);
  });

  it("个人 write 令牌入队破坏性任务 → 403", async () => {
    const res = await inject({
      method: "POST",
      url: "/api/jobs",
      headers: bearer(personalWriteToken),
      payload: { kind: "purge_trash", payload: { olderThanDays: 1 } },
    });
    expect(res.statusCode).toBe(403);
  });
});
