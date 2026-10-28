import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";

/**
 * 「审批人 ≠ 投稿人」能不能被落实？——**在当前权限模型下做不到，也不需要做**。
 *
 * 审计 §21.3 曾建议：在 PATCH 里比较 `submission_owners.identity` 与 `req.auth.actor`，
 * 相同则 403。核过运行期事实后这条建议不成立：
 *
 *   · `req.auth.actor` 是**令牌名**（`server.ts:575` 赋的是 `record.name`），
 *     不是身份；拿它和 `github:xxx` 比永远不相等 —— 这条检查会静默 fail-open，
 *     比不写更糟（它看起来像在做双人原则）。
 *   · 能通过 `scope:"admin"` 的只有两类凭据：实例令牌（`ownerIdentity = null`）
 *     与管理员会话（无 owner），都**没有可比的身份**；
 *   · 而**能代表某个身份**的个人令牌，`POST /api/me/tokens` 只签发
 *     `read | favorites | write` 三种权限，拿不到 admin —— 它连这道门都进不来。
 *
 * 于是「自审自批」在今天的模型里是**不可达**的：能审批的人没有身份，有身份的人
 * 不能审批。真正该守的不是「比较两个字符串」，而是这个前提本身：
 * 一旦有人给个人令牌加上 admin 权限，双人原则立刻失效。这组用例就钉住那两条边。
 */
// 32 字符以上：鉴权模式对 identitySecret 有长度要求
const SECRET = "test-secret-review-separation-0123456789";
const USER = "github:submitter";

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
let created: { token?: string } = {};

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
}) => app.inject({ ...opts, remoteAddress: `10.94.0.${(seq++ % 200) + 3}` } as never);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-review-separation-"));
  // 必须开鉴权模式：开放模式没有 scope 门槛（`required !== "write"` 直接放行），
  // 用它测「个人令牌进不了 admin 端点」只会测到开放模式本身
  ctx = await createContext(
    loadConfig({ ...base, sqlitePath: join(dir, "sep.db"), identitySecret: SECRET, authRequired: true }),
  );
  app = await buildServer(ctx);
  await app.ready();
  await ctx.repo.ensureUncategorized();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("自审自批的可行路径", () => {
  it("个人令牌拿不到 admin 权限（签发端只允许 read/favorites/write）", async () => {
    const res = await inject({
      method: "POST",
      url: "/api/me/tokens",
      headers: headersFor(USER),
      payload: { name: "想自审自批的令牌", permission: "admin" },
    });
    // 关键：不是「悄悄降级成 write」，而是明确拒绝 —— 静默降级会给用户一个
    // 与他理解不符的凭据，等他发现审批 403 时已经不知道原因了
    expect(res.statusCode, JSON.stringify(res.json())).toBe(400);
    const body = res.json() as { message?: string; error?: string };
    expect(JSON.stringify(body)).toContain("permission");
  });

  it("拿到 write 个人令牌后，仍进不了审批端点（scope:admin 门槛）", async () => {
    const res = await inject({
      method: "POST",
      url: "/api/me/tokens",
      headers: headersFor(USER),
      payload: { name: "投稿人的写令牌", permission: "write" },
    });
    expect(res.statusCode, JSON.stringify(res.json())).toBe(200);
    created = res.json() as { token?: string };
    const token = String(created.token ?? "");
    expect(token.length).toBeGreaterThan(0);

    const patch = await inject({
      method: "PATCH",
      url: "/api/submissions/1",
      headers: bearer(token),
      payload: { action: "approve" },
    });
    // 403 的来源是 scope 判定（缺 admin），不是「投稿不存在」（404）——
    // 后者说明权限已经过了，那是更糟的错
    expect(patch.statusCode, JSON.stringify(patch.json())).not.toBe(200);
    expect([401, 403]).toContain(patch.statusCode);
  });

  it("管理员会话没有 owner 身份可比 —— 所以「比较 actor」那条建议是空转", async () => {
    // 直接固定在代码事实层面：actor 来自令牌名，ownerIdentity 才代表身份
    const here = new URL(".", import.meta.url);
    const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../src/server.ts", here), "utf8"));
    expect(src).toContain("auth.actor = record.name");
    // 一旦有人把 admin 加进个人令牌的权限枚举，上面两条用例的前提就变了：
    // 这条断言会在有人改动时提醒「双人原则需要真正实现」
    const me = await import("node:fs").then((fs) => fs.readFileSync(new URL("../src/routes/me.ts", here), "utf8"));
    expect(me).toContain('z.enum(["read", "favorites", "write"])');
  });
});
