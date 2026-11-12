/**
 * 凭据注销真删（P0-3）：DELETE /api/me 对 credentials:<uuid> 用户的端到端守卫。
 *
 * 回归锚点：凭据用户在 users 表的主键是裸 UUID（source='local'），注销前
 * deleteUserData 只删 canonical 形态行（id LIKE '%:%'），导致邮箱与密码哈希
 * 全留、账号仍可登录。本文件断言注销后裸 UUID 行与邮箱行均已删除，
 * revoked_users 墓碑留存、audit_logs 保留 user.delete、内置 admin 永远删不掉。
 *
 * 注意：DELETE /api/me 每分钟限流 3 次，本文件最多只能发 3 次 DELETE。
 * 凭据身份用 HMAC 签名（SECRET 与脚手架同源），裸 UUID 身份由路由层
 * 规范化为 credentials:<uuid> 后再删除。beforeAll 保留参照文件的
 * 建库与 canonical 播种脚手架（与本文件断言无关，仅供服务启动）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";

const SECRET = "canonical-sovereignty-secret-0123456789";
const ANON = "anon-canonical-sovereignty-0001";
/** 非 anon 旧 id：匿名身份被注销闸门 403 挡住，只有它才能证明注销也解析别名 */
const LEGACY = "github:legacy-sovereignty";
const USER = "github:canonical-sovereignty";
const CRED_UUID_A = "33333333-4444-5555-6666-777777777777";
const CRED_A = "credentials:" + CRED_UUID_A;
const CRED_EMAIL_A = "cred-a@delete.example";
const CRED_UUID_BARE = "44444444-5555-6666-7777-888888888888";
const CRED_BARE = "credentials:" + CRED_UUID_BARE;
const CRED_EMAIL_BARE = "cred-bare@delete.example";

const URL_A = "https://sovereignty-a.example.com/";
const URL_B = "https://sovereignty-b.example.com/";
const TITLE_A = "主权站点 Alpha";
const TITLE_B = "主权站点 Beta";

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
let siteA = "";
let siteB = "";

const signed = (identity: string) => ({
  "x-navhub-user-id": identity,
  "x-navhub-identity-signature": signIdentity(SECRET, identity),
});

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-canon-me-"));
  ctx = await createContext(
    loadConfig({ ...base, sqlitePath: join(dir, "canon-me.db"), identitySecret: SECRET }),
  );
  app = await buildServer(ctx);
  await app.ready();

  const cat = await ctx.repo.createCategory({ title: "主权流测试" });
  siteA = (await ctx.repo.createSite({ url: URL_A, title: TITLE_A, categoryId: cat.id })).id;
  siteB = (await ctx.repo.createSite({ url: URL_B, title: TITLE_B, categoryId: cat.id })).id;

  // 合并前：匿名身份收藏 A；登录身份自己写一条搜索历史
  const pre = await app.inject({
    method: "POST",
    url: "/api/favorites",
    headers: signed(ANON),
    payload: { siteId: siteA },
  });
  expect(pre.statusCode).toBe(201);
  await ctx.repo.recordSearch(USER, "canonical 主权查询", 3);
  // 设置只写在 canonical 上：外层的 resolveIdentity 若被删掉，这里会读回旧 id 的默认值
  await ctx.repo.updateUserSettings(USER, { defaultSearchEngine: "bing" });

  expect((await ctx.repo.mergeIdentity(ANON, USER)).target).toBe(USER);
  // 第二跳：非 anon 旧 id 也指向同一 canonical
  expect((await ctx.repo.mergeIdentity(LEGACY, USER)).target).toBe(USER);
});

describe("凭据注销真删：裸 UUID 行、墓碑与管理员守卫", () => {
  it("签凭据身份 DELETE /api/me → 200，userRow=1，邮箱与密码哈希一并删除，墓碑留存", async () => {
    const now = Date.now();
    await ctx.repo.run(
      "INSERT INTO users (id, username, password_hash, role, email, source, created_at) VALUES (?,?,?,?,?,?,?)",
      [CRED_UUID_A, "cred-a", "scrypt-hash-a", "user", CRED_EMAIL_A, "local", now],
    );
    await ctx.repo.addFavorite({ userId: CRED_A, siteId: siteA });
    await ctx.repo.run("INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?,?,?,?)", [
      "tk-cred-a",
      CRED_A,
      now + 86400000,
      now,
    ]);

    const res = await app.inject({
      method: "DELETE",
      url: "/api/me",
      headers: signed(CRED_A),
      payload: { confirm: "DELETE" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      ok: boolean;
      deleted: { userRow: number; sessions: number; favorites: number };
    };
    expect(body.ok).toBe(true);
    expect(body.deleted.userRow).toBe(1);
    expect(body.deleted.sessions).toBe(1);
    expect(body.deleted.favorites).toBe(1);

    expect(await ctx.repo.raw("SELECT 1 AS ok FROM users WHERE id = ?", [CRED_UUID_A])).toHaveLength(0);
    expect(await ctx.repo.raw("SELECT 1 AS ok FROM users WHERE email = ?", [CRED_EMAIL_A])).toHaveLength(0);
    expect(await ctx.repo.raw("SELECT 1 AS ok FROM sessions WHERE user_id = ?", [CRED_A])).toHaveLength(0);
    expect(await ctx.repo.raw("SELECT 1 AS ok FROM favorites WHERE user_id = ?", [CRED_A])).toHaveLength(0);
    expect(await ctx.repo.raw("SELECT 1 AS ok FROM revoked_users WHERE user_id = ?", [CRED_A])).toHaveLength(1);
    expect(
      await ctx.repo.raw("SELECT 1 AS ok FROM audit_logs WHERE actor = ? AND action = ?", [CRED_A, "user.delete"]),
    ).toHaveLength(1);
  });

  it("签凭据形态 admin DELETE /api/me → 403，内置管理员行仍在", async () => {
    await ctx.repo.run(
      "INSERT INTO users (id, username, password_hash, role, source, created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
      ["admin", "admin", "x", "admin", "local", Date.now()],
    );

    const res = await app.inject({
      method: "DELETE",
      url: "/api/me",
      headers: signed("credentials:admin"),
      payload: { confirm: "DELETE" },
    });
    expect(res.statusCode).toBe(403);
    expect(await ctx.repo.raw("SELECT 1 AS ok FROM users WHERE id = ?", ["admin"])).toHaveLength(1);
  });

  it("签裸 UUID 身份 DELETE /api/me → 200，userRow=1", async () => {
    const now = Date.now();
    await ctx.repo.run(
      "INSERT INTO users (id, username, password_hash, role, email, source, created_at) VALUES (?,?,?,?,?,?,?)",
      [CRED_UUID_BARE, "cred-bare", "scrypt-hash-bare", "user", CRED_EMAIL_BARE, "local", now],
    );

    const res = await app.inject({
      method: "DELETE",
      url: "/api/me",
      headers: signed(CRED_UUID_BARE),
      payload: { confirm: "DELETE" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; deleted: { userRow: number } };
    expect(body.ok).toBe(true);
    expect(body.deleted.userRow).toBe(1);
    expect(await ctx.repo.raw("SELECT 1 AS ok FROM users WHERE id = ?", [CRED_UUID_BARE])).toHaveLength(0);
  });
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows 上 SQLite 句柄释放有延迟：临时目录交给系统回收，不让清理失败判红
  }
});

