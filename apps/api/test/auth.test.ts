/**
 * REST API 鉴权测试。
 *
 * 两条主线：
 *  1. 开放模式（默认）——存量行为零变化：所有路由无需 token（回归保障）。
 *  2. 鉴权模式（NAVHUB_AUTH_REQUIRED=true）——
 *     public 路由匿名可用、read/write/admin 逐级拦截、scope 含义（admin ⊇ write ⊇ read）、
 *     bootstrap token 引导、过期 token 失效、审计记录真实身份。
 *
 * 与 api.test.ts 分开：鉴权是配置级开关，需要独立的服务实例。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { hashToken } from "../src/auth.ts";

const BOOTSTRAP = "boot-secret-please-rotate";
const ADMIN_STATIC = "admin-static-please-rotate";

const dir = mkdtempSync(join(tmpdir(), "navhub-auth-"));
const base = {
  mode: "lite" as const,
  embedding: { model: "m", endpoint: "https://hf-mirror.com", dtype: "q8" as const, cacheDir: join(dir, "models"), dim: 512, enabled: false },
  llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 3000 },
  fetch: { timeoutMs: 1000, maxBytes: 65536, maxRedirects: 1, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
  corsOrigins: ["*"],
};

let openCtx: AppContext;      // 开放模式
let openApp: Awaited<ReturnType<typeof buildServer>>;
let authCtx: AppContext;      // 鉴权模式
let authApp: Awaited<ReturnType<typeof buildServer>>;

/** 鉴权实例里的辅助：以指定 token（或不带）发请求 */
async function as(token: string | null, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) {
  return authApp.inject({
    method,
    url,
    payload: payload as never,
    headers: token ? { authorization: "Bearer " + token } : {},
  });
}

/** 用 bootstrap token 创建一个库内 token，返回明文 */
async function mintToken(name: string, scopes: string, expiresAt?: number): Promise<string> {
  const res = await as(BOOTSTRAP, "POST", "/api/tokens", { name, scopes, expiresAt });
  expect(res.statusCode).toBe(201);
  return res.json().token as string;
}

beforeAll(async () => {
  openCtx = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "open.db") }));
  openApp = await buildServer(openCtx);
  await openApp.ready();
  // 写入口现在校验「类目存在且是叶子」：开放模式的夹具也得有真叶子可用
  await openCtx.repo.createCategory({ id: "cat-ai", title: "AI 工具" });
  await openCtx.repo.createCategory({ id: "cat-ai-code", title: "AI 编程助手", parentId: "cat-ai" });

  authCtx = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "auth.db"), authRequired: true, bootstrapToken: BOOTSTRAP, adminToken: ADMIN_STATIC }));
  authApp = await buildServer(authCtx);
  await authApp.ready();

  await authCtx.repo.createCategory({ id: "cat-ai", title: "AI 工具" });
  // 写入口只接受叶子（G2）：夹具给根配一个子类目，POST /api/sites 用它做归属
  await authCtx.repo.createCategory({ id: "cat-ai-code", title: "AI 编程助手", parentId: "cat-ai" });
});

afterAll(async () => {
  await openApp.close(); await openCtx.close();
  await authApp.close(); await authCtx.close();
  rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ *
 * 1. 开放模式：存量行为零变化
 * ------------------------------------------------------------------ */

describe("开放模式（默认，authRequired=false）", () => {
  it("管理面写操作无需 token", async () => {
    const res = await openApp.inject({
      method: "POST", url: "/api/sites",
      payload: { url: "https://open-mode.example.com", title: "开放模式", categoryId: "cat-ai-code" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("token 管理端点也无需 token（因为鉴权未开启）", async () => {
    const res = await openApp.inject({ method: "GET", url: "/api/tokens" });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("审计里 actor 仍是历史语义 \"api\"", async () => {
    const site = (await openApp.inject({ method: "GET", url: "/api/sites" })).json()
      .find((s: any) => s.url === "https://open-mode.example.com");
    const rows = await openCtx.db.sqlite!.prepare("SELECT actor, actor_kind FROM audit_logs WHERE target = ?").all(site.id) as any[];
    expect(rows[0]?.actor).toBe("api");
    expect(rows[0]?.actor_kind).toBe("anonymous");
  });
});

/* ------------------------------------------------------------------ *
 * 2. 鉴权模式：逐级拦截
 * ------------------------------------------------------------------ */

describe("鉴权模式：拒绝未授权访问", () => {
  it("public 路由（搜索/健康）匿名可用", async () => {
    expect((await as(null, "GET", "/api/health")).statusCode).toBe(200);
    expect((await as(null, "GET", "/api/search?q=ai")).statusCode).toBe(200);
  });

  it("read 路由无 token 返回 401", async () => {
    const res = await as(null, "GET", "/api/sites");
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain("token");
  });

  it("write 路由无 token 返回 401", async () => {
    const res = await as(null, "POST", "/api/sites", { url: "https://x.com", categoryId: "cat-ai-code" });
    expect(res.statusCode).toBe(401);
  });

  it("无效 token 返回 401", async () => {
    const res = await as("nh_totally_bogus", "GET", "/api/sites");
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain("无效");
  });

  it("错误格式的 Authorization 头返回 401", async () => {
    const res = await authApp.inject({ method: "GET", url: "/api/sites", headers: { authorization: "Basic abc" } });
    expect(res.statusCode).toBe(401);
  });
});

describe("鉴权模式：scope 含义（admin ⊇ write ⊇ read）", () => {
  let readTok: string, writeTok: string, adminTok: string;

  beforeAll(async () => {
    readTok = await mintToken("只读客户端", "read");
    writeTok = await mintToken("写入客户端", "write");
    adminTok = await mintToken("管理员", "admin");
  });

  it("read token 能读站点列表", async () => {
    expect((await as(readTok, "GET", "/api/sites")).statusCode).toBe(200);
  });

  it("read token 不能写（403 且说明所需 scope）", async () => {
    const res = await as(readTok, "POST", "/api/sites", { url: "https://r.example.com", categoryId: "cat-ai-code" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain("write");
  });

  it("write token 能创建站点", async () => {
    const res = await as(writeTok, "POST", "/api/sites", { url: "https://w.example.com", title: "W", categoryId: "cat-ai-code" });
    expect(res.statusCode).toBe(201);
  });

  it("write token 不能删除站点（delete 要求 admin）", async () => {
    const site = (await as(readTok, "GET", "/api/sites")).json().find((s: any) => s.url === "https://w.example.com");
    const res = await as(writeTok, "DELETE", "/api/sites/" + site.id);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain("admin");
  });

  it("write token 不能创建 token（token 管理要求 admin）", async () => {
    const res = await as(writeTok, "POST", "/api/tokens", { name: "越权", scopes: "admin" });
    expect(res.statusCode).toBe(403);
  });

  it("admin token 能删除站点并创建 token", async () => {
    const site = (await as(readTok, "GET", "/api/sites")).json().find((s: any) => s.url === "https://w.example.com");
    expect((await as(adminTok, "DELETE", "/api/sites/" + site.id)).statusCode).toBe(204);
    const created = await as(adminTok, "POST", "/api/tokens", { name: "二级", scopes: "read" });
    expect(created.statusCode).toBe(201);
  });

  it("NAVHUB_ADMIN_TOKEN 作为独立的静态管理凭据（与 bootstrap/sessionSecret 分离）", async () => {
    expect((await as(ADMIN_STATIC, "GET", "/api/tokens")).statusCode).toBe(200);
    expect((await as(ADMIN_STATIC, "DELETE", "/api/sites/non-existent")).statusCode).not.toBe(401);
  });

  it("PUT /api/storage（写入导航快照）要求 admin：快照会删除缺失项", async () => {
    for (const tok of [readTok, writeTok]) {
      const res = await as(tok, "PUT", "/api/storage", { path: "src/navsphere/content/site.json", content: "{}" });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain("admin");
    }
  });

  it("GET /api/storage 受 read 保护", async () => {
    expect((await as(readTok, "GET", "/api/storage?path=" + encodeURIComponent("src/navsphere/content/site.json"))).statusCode).toBe(200);
  });
});

describe("鉴权模式：token 生命周期", () => {
  it("明文只返回一次；列表不含明文也不含 hash", async () => {
    const created = await as(BOOTSTRAP, "POST", "/api/tokens", { name: "一次性", scopes: "read" });
    const raw = created.json().token as string;
    expect(raw.startsWith("nh_")).toBe(true);
    expect(created.json().tokenHash).toBeUndefined();

    const list = (await as(BOOTSTRAP, "GET", "/api/tokens")).json();
    const item = list.find((t: any) => t.name === "一次性");
    expect(item).toBeTruthy();
    expect(item.token).toBeUndefined();
    expect(item.tokenHash).toBeUndefined();
    expect(item.scopes).toEqual(["read"]);

    // 明文仍可用于鉴权
    expect((await as(raw, "GET", "/api/sites")).statusCode).toBe(200);
  });

  it("过期 token 立即失效", async () => {
    // 直接通过 repo 写入一个已过期 token（绕过路由的"未来时间"校验），
    // 验证鉴权层的 findApiTokenByHash 会因 expires_at < now 而拒绝。
    const raw = "nh_test_expired_token";
    await authCtx.repo.createApiToken({ name: "已过期", tokenHash: hashToken(raw), scopes: "read", expiresAt: Date.now() - 1000 });
    expect((await as(raw, "GET", "/api/sites")).statusCode).toBe(401);
  });

  it("创建时拒绝过去时间（避免一签发就已失效）", async () => {
    const res = await as(BOOTSTRAP, "POST", "/api/tokens", { name: "过去时间", scopes: "read", expiresAt: Date.now() - 1000 });
    expect(res.statusCode).toBe(400);
  });

  it("scopes 里的非法值被丢弃（不放大权限）", async () => {
    const res = await as(BOOTSTRAP, "POST", "/api/tokens", { name: "脏scopes", scopes: "read,superuser,root" });
    expect(res.statusCode).toBe(201);
    expect(res.json().scopes).toEqual(["read"]);
    const raw = res.json().token as string;
    const denied = await as(raw, "POST", "/api/sites", { url: "https://z.com", categoryId: "cat-ai-code" });
    expect(denied.statusCode).toBe(403);
  });

  it("scopes 全非法时创建被拒", async () => {
    const res = await as(BOOTSTRAP, "POST", "/api/tokens", { name: "全脏", scopes: "superuser" });
    expect(res.statusCode).toBe(400);
  });

  it("审计与健康趋势属于 admin 作用域：read 令牌被拒", async () => {
    const read = await mintToken("只读审计", "read");
    // 此前这两条是 scope:"read"——任何只读令牌都能读走审计日志（操作者 / IP / 变更 diff）
    expect((await as(read, "GET", "/api/admin/audit")).statusCode).toBe(403);
    expect((await as(read, "GET", "/api/admin/health/trend")).statusCode).toBe(403);
    // admin 令牌照常可读
    const admin = await mintToken("管理员审计", "admin");
    expect((await as(admin, "GET", "/api/admin/audit")).statusCode).toBe(200);
  });

  it("删除 token 后立即失效", async () => {
    const raw = await mintToken("待删除", "read");
    expect((await as(raw, "GET", "/api/sites")).statusCode).toBe(200);
    const list = (await as(BOOTSTRAP, "GET", "/api/tokens")).json();
    const id = list.find((t: any) => t.name === "待删除").id;
    expect((await as(BOOTSTRAP, "DELETE", "/api/tokens/" + id)).statusCode).toBe(204);
    expect((await as(raw, "GET", "/api/sites")).statusCode).toBe(401);
  });

  it("bootstrap token 全通，且用于创建的记录不落库", async () => {
    expect((await as(BOOTSTRAP, "GET", "/api/tokens")).statusCode).toBe(200);
    const list = (await as(BOOTSTRAP, "GET", "/api/tokens")).json();
    expect(list.find((t: any) => t.name === "bootstrap")).toBeUndefined();
  });

  it("sessionSecret 会话特权密钥具备 admin 权限，支持管理端透明代理创建 Token", async () => {
    expect((await as(authCtx.config.sessionSecret, "GET", "/api/tokens")).statusCode).toBe(200);
    const postRes = await as(authCtx.config.sessionSecret, "POST", "/api/tokens", {
      name: "通过会话特权创建",
      scopes: "write",
    });
    expect(postRes.statusCode).toBe(201);
    expect(postRes.json().name).toBe("通过会话特权创建");
  });

  it("bootstrap token 用错（长度不同）同样 401", async () => {
    expect((await as(BOOTSTRAP + "x", "GET", "/api/sites")).statusCode).toBe(401);
  });

  it("软吊销 token：立即失效但记录保留，且落审计日志", async () => {
    const raw = await mintToken("待吊销", "read");
    expect((await as(raw, "GET", "/api/sites")).statusCode).toBe(200);
    const list = (await as(BOOTSTRAP, "GET", "/api/tokens")).json();
    const tokenObj = list.find((t: any) => t.name === "待吊销");
    expect(tokenObj.tokenPrefix).toMatch(/^nh_/);
    expect(tokenObj.revokedAt).toBeNull();

    const revokeRes = await as(BOOTSTRAP, "POST", "/api/tokens/" + tokenObj.id + "/revoke");
    expect(revokeRes.statusCode).toBe(200);
    expect(revokeRes.json().revokedAt).toBeTruthy();

    // 吊销后鉴权立即被拒
    expect((await as(raw, "GET", "/api/sites")).statusCode).toBe(401);

    // 记录仍然在列表里且标记为 revokedAt
    const afterList = (await as(BOOTSTRAP, "GET", "/api/tokens")).json();
    const retained = afterList.find((t: any) => t.id === tokenObj.id);
    expect(retained).toBeTruthy();
    expect(retained.revokedAt).toBeTruthy();
  });

  it("轮换 token：保留 created_at，更新 rotated_at，并使旧明文失效", async () => {
    const rawOld = await mintToken("待轮换", "read");
    const list1 = (await as(BOOTSTRAP, "GET", "/api/tokens")).json();
    const orig = list1.find((t: any) => t.name === "待轮换");

    const rotateRes = await as(BOOTSTRAP, "POST", "/api/tokens/" + orig.id + "/rotate");
    expect(rotateRes.statusCode).toBe(200);
    const rotJson = rotateRes.json();
    expect(rotJson.token).toBeTruthy();
    expect(rotJson.token).not.toBe(rawOld);
    expect(rotJson.createdAt).toBe(orig.createdAt);
    expect(rotJson.rotatedAt).toBeTruthy();
    expect(rotJson.tokenPrefix).toMatch(/^nh_/);

    // 旧 token 401，新 token 200
    expect((await as(rawOld, "GET", "/api/sites")).statusCode).toBe(401);
    expect((await as(rotJson.token, "GET", "/api/sites")).statusCode).toBe(200);
  });

  it("有效期超出 tokenPolicy.maxLifetimeDays 时被拒绝", async () => {
    const farFuture = Date.now() + 367 * 86_400_000;
    const res = await as(BOOTSTRAP, "POST", "/api/tokens", { name: "过长寿命", scopes: "read", expiresAt: farFuture });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("超出最长有效期");
  });

  it("省略 expiresAt 时落到策略上限，而不是永久有效", async () => {
    const res = await as(BOOTSTRAP, "POST", "/api/tokens", { name: "默认有效期", scopes: "read" });
    expect(res.statusCode).toBe(201);
    const expiresAt = res.json().expiresAt as number | null;
    expect(expiresAt).not.toBeNull();
    // 默认上限 365 天：落点应在 (now+364d, now+365d]
    const delta = expiresAt! - Date.now();
    expect(delta).toBeGreaterThan(364 * 86_400_000);
    expect(delta).toBeLessThanOrEqual(365 * 86_400_000);
  });

  it("显式 expiresAt=null 在默认策略下被拒绝（禁止长期凭据）", async () => {
    const res = await as(BOOTSTRAP, "POST", "/api/tokens", { name: "请求永久", scopes: "read", expiresAt: null });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("禁止签发长期");
  });

  it("PATCH 显式 expiresAt=null 同样被拒绝；省略则保留原有效期", async () => {
    await mintToken("待编辑", "read");
    const list = (await as(BOOTSTRAP, "GET", "/api/tokens")).json();
    const tok = list.find((t: any) => t.name === "待编辑");
    const originalExpiry = tok.expiresAt as number;

    const denied = await as(BOOTSTRAP, "PATCH", "/api/tokens/" + tok.id, { expiresAt: null });
    expect(denied.statusCode).toBe(400);
    expect(denied.json().error).toContain("禁止签发长期");

    // 只改名字：有效期原样保留（编辑名称不该顺带改期）
    const kept = await as(BOOTSTRAP, "PATCH", "/api/tokens/" + tok.id, { name: "改个名" });
    expect(kept.statusCode).toBe(200);
    expect(kept.json().expiresAt).toBe(originalExpiry);
  });
});

describe("token 创建：输入校验与冲突拦截", () => {
  it("同名凭据创建被拒（409）且错误信息点名冲突项", async () => {
    await mintToken("重名凭据", "read");
    const res = await as(BOOTSTRAP, "POST", "/api/tokens", { name: "重名凭据", scopes: "write" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("重名凭据");
    // 列表里仍然只有一条，没有重复落库
    const list = (await as(BOOTSTRAP, "GET", "/api/tokens")).json();
    expect(list.filter((t: any) => t.name === "重名凭据").length).toBe(1);
  });

  it("吊销后同名可以重新创建（软吊销不占用名称）", async () => {
    const raw = await mintToken("可复用名", "read");
    const list = (await as(BOOTSTRAP, "GET", "/api/tokens")).json();
    const id = list.find((t: any) => t.name === "可复用名").id;
    expect((await as(BOOTSTRAP, "POST", "/api/tokens/" + id + "/revoke")).statusCode).toBe(200);

    const again = await as(BOOTSTRAP, "POST", "/api/tokens", { name: "可复用名", scopes: "read" });
    expect(again.statusCode).toBe(201);
    // 旧明文仍失效（吊销记录在案，新凭据是另一条）
    expect((await as(raw, "GET", "/api/sites")).statusCode).toBe(401);
  });

  it("PATCH 改名撞名被拒（409）；改成不撞名的成功", async () => {
    await mintToken("占位名", "read");
    await mintToken("被改名", "read");
    const list = (await as(BOOTSTRAP, "GET", "/api/tokens")).json();
    const tok = list.find((t: any) => t.name === "被改名");

    const denied = await as(BOOTSTRAP, "PATCH", "/api/tokens/" + tok.id, { name: "占位名" });
    expect(denied.statusCode).toBe(409);
    expect(denied.json().error).toContain("占位名");

    const ok = await as(BOOTSTRAP, "PATCH", "/api/tokens/" + tok.id, { name: "全新名" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().name).toBe("全新名");
  });

  it("名称超长（>64 字符）被拒（400）", async () => {
    const res = await as(BOOTSTRAP, "POST", "/api/tokens", { name: "x".repeat(65), scopes: "read" });
    expect(res.statusCode).toBe(400);
  });

  it("审计写入失败不阻断创建：明文照常返回且立即可用", async () => {
    // 模拟 audit_logs 写库故障：主操作（INSERT api_tokens）已成功，
    // 若 audit 抛错把响应吞成 500，明文就随响应一起丢了——凭据变成孤儿。
    const original = authCtx.repo.audit.bind(authCtx.repo);
    authCtx.repo.audit = async () => { throw new Error("simulated audit failure"); };
    try {
      const res = await as(BOOTSTRAP, "POST", "/api/tokens", { name: "审计故障时", scopes: "read" });
      expect(res.statusCode).toBe(201);
      const raw = res.json().token as string;
      expect(raw.startsWith("nh_")).toBe(true);
      // 明文立即可用于鉴权（凭据没有变成孤儿）
      expect((await as(raw, "GET", "/api/sites")).statusCode).toBe(200);
    } finally {
      authCtx.repo.audit = original;
    }
  });
});

describe("tokenPolicy.allowPermanentTokens=true：显式放行长期凭据", () => {
  let permDir: string;
  let permCtx: AppContext;
  let permApp: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    permDir = mkdtempSync(join(tmpdir(), "navhub-perm-"));
    permCtx = await createContext(loadConfig({
      ...base,
      sqlitePath: join(permDir, "perm.db"),
      authRequired: true,
      bootstrapToken: BOOTSTRAP,
      tokenPolicy: { maxLifetimeDays: 365, maxActiveTokens: 50, allowPermanentTokens: true },
    }));
    permApp = await buildServer(permCtx);
    await permApp.ready();
  });

  afterAll(async () => {
    await permApp.close(); await permCtx.close();
    rmSync(permDir, { recursive: true, force: true });
  });

  it("显式 expiresAt=null 放行；省略仍落策略上限", async () => {
    const permanent = await permApp.inject({
      method: "POST", url: "/api/tokens",
      payload: { name: "机器凭据", scopes: "read", expiresAt: null } as never,
      headers: { authorization: "Bearer " + BOOTSTRAP },
    });
    expect(permanent.statusCode).toBe(201);
    expect(permanent.json().expiresAt).toBeNull();

    // 放行永久 ≠ 默认永久：省略仍拿有界默认
    const defaulted = await permApp.inject({
      method: "POST", url: "/api/tokens",
      payload: { name: "默认", scopes: "read" } as never,
      headers: { authorization: "Bearer " + BOOTSTRAP },
    });
    expect(defaulted.statusCode).toBe(201);
    expect(defaulted.json().expiresAt).not.toBeNull();
  });
});

describe("鉴权模式：审计记录真实身份", () => {
  it("token 写操作的 actor 是 token 名称，kind 为 token", async () => {
    const tok = await mintToken("审计验证员", "write");
    const res = await as(tok, "POST", "/api/sites", { url: "https://audit.example.com", title: "审计", categoryId: "cat-ai-code" });
    expect(res.statusCode).toBe(201);
    const siteId = res.json().id as string;
    const rows = await authCtx.db.sqlite!.prepare("SELECT actor, actor_kind FROM audit_logs WHERE target = ? ORDER BY id DESC").all(siteId) as any[];
    expect(rows[0]?.actor).toBe("审计验证员");
    expect(rows[0]?.actor_kind).toBe("token");
  });

  it("bootstrap 写操作的 actor 为 bootstrap / static", async () => {
    const res = await as(BOOTSTRAP, "POST", "/api/categories", { title: "Bootstrap 分类" });
    expect(res.statusCode).toBe(201);
    const rows = await authCtx.db.sqlite!.prepare("SELECT actor, actor_kind FROM audit_logs WHERE target = ?").all(res.json().id) as any[];
    expect(rows[0]?.actor).toBe("bootstrap");
    expect(rows[0]?.actor_kind).toBe("static");
  });

  it("token 创建/删除本身也落审计", async () => {
    const raw = await mintToken("审计对象", "read");
    const list = (await as(BOOTSTRAP, "GET", "/api/tokens")).json();
    const id = list.find((t: any) => t.name === "审计对象").id;
    await as(BOOTSTRAP, "DELETE", "/api/tokens/" + id);
    const rows = await authCtx.db.sqlite!.prepare("SELECT action, actor FROM audit_logs WHERE action IN ('token.create','token.delete') AND target = ?").all(id) as any[];
    expect(rows.map((r) => r.action).sort()).toEqual(["token.create", "token.delete"]);
    expect(rows[0]?.actor).toBe("bootstrap");
  });
});

describe("鉴权模式：last_used_at 更新", () => {
  it("成功鉴权后刷新 last_used_at", async () => {
    const raw = await mintToken("活跃度", "read");
    const before = (await as(BOOTSTRAP, "GET", "/api/tokens")).json().find((t: any) => t.name === "活跃度");
    expect(before.lastUsedAt).toBeNull();
    await as(raw, "GET", "/api/sites");
    await new Promise((r) => setTimeout(r, 30));
    const after = (await as(BOOTSTRAP, "GET", "/api/tokens")).json().find((t: any) => t.name === "活跃度");
    expect(typeof after.lastUsedAt).toBe("number");
  });
});

describe("生产配置硬校验与批量查询回归", () => {
  it("NODE_ENV=production 下缺失或默认 NAVHUB_SESSION_SECRET 拒绝启动", () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevSecret = process.env.NAVHUB_SESSION_SECRET;
    const prevUrl = process.env.NAVHUB_PUBLIC_URL;
    try {
      process.env.NODE_ENV = "production";
      delete process.env.NAVHUB_SESSION_SECRET;
      expect(() => loadConfig()).toThrow(/NAVHUB_SESSION_SECRET/);

      process.env.NAVHUB_SESSION_SECRET = "change-me-please-use-a-long-random-string";
      expect(() => loadConfig()).toThrow(/NAVHUB_SESSION_SECRET/);

      process.env.NAVHUB_SESSION_SECRET = "short-secret";
      expect(() => loadConfig()).toThrow(/NAVHUB_SESSION_SECRET/);

      process.env.NAVHUB_SESSION_SECRET = "a-very-strong-production-secret-with-at-least-32-chars!";
      // 生产未开鉴权时必须显式声明 publicUrl：localhost 默认值不能再当逃生阀
      delete process.env.NAVHUB_PUBLIC_URL;
      expect(() => loadConfig()).toThrow(/NAVHUB_PUBLIC_URL/);
      process.env.NAVHUB_PUBLIC_URL = "http://localhost:8787";
      expect(loadConfig().sessionSecret).toBe("a-very-strong-production-secret-with-at-least-32-chars!");
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevNodeEnv;
      if (prevSecret === undefined) delete process.env.NAVHUB_SESSION_SECRET; else process.env.NAVHUB_SESSION_SECRET = prevSecret;
      if (prevUrl === undefined) delete process.env.NAVHUB_PUBLIC_URL; else process.env.NAVHUB_PUBLIC_URL = prevUrl;
    }
  });

  it("生产 + 公网 publicUrl + 未开鉴权 拒绝启动；逃生阀与内网地址放行", () => {
    const prev = {
      NODE_ENV: process.env.NODE_ENV,
      SECRET: process.env.NAVHUB_SESSION_SECRET,
      URL: process.env.NAVHUB_PUBLIC_URL,
      AUTH: process.env.NAVHUB_AUTH_REQUIRED,
      ALLOW: process.env.NAVHUB_ALLOW_INSECURE_PUBLIC,
    };
    const restore = () => {
      for (const [k, v] of Object.entries({
        NODE_ENV: prev.NODE_ENV,
        NAVHUB_SESSION_SECRET: prev.SECRET,
        NAVHUB_PUBLIC_URL: prev.URL,
        NAVHUB_AUTH_REQUIRED: prev.AUTH,
        NAVHUB_ALLOW_INSECURE_PUBLIC: prev.ALLOW,
      })) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    };
    try {
      process.env.NODE_ENV = "production";
      process.env.NAVHUB_SESSION_SECRET = "a-very-strong-production-secret-with-at-least-32-chars!";
      process.env.NAVHUB_PUBLIC_URL = "https://nav.example.com";
      delete process.env.NAVHUB_AUTH_REQUIRED;
      delete process.env.NAVHUB_ALLOW_INSECURE_PUBLIC;
      expect(() => loadConfig()).toThrow(/NAVHUB_AUTH_REQUIRED/);

      // 显式逃生阀：退回警告，不阻断启动
      process.env.NAVHUB_ALLOW_INSECURE_PUBLIC = "1";
      expect(loadConfig().authRequired).toBe(false);
      delete process.env.NAVHUB_ALLOW_INSECURE_PUBLIC;

      // 回归：公网域名不能因为以 "10." 开头就被当成内网（旧正则的误判）
      process.env.NAVHUB_PUBLIC_URL = "http://10.example.com";
      expect(() => loadConfig()).toThrow(/NAVHUB_AUTH_REQUIRED/);

      // 内网地址原本就不拦截
      process.env.NAVHUB_PUBLIC_URL = "http://192.168.1.10:8787";
      expect(() => loadConfig()).not.toThrow();

      // 开启鉴权后公网部署放行
      process.env.NAVHUB_PUBLIC_URL = "https://nav.example.com";
      process.env.NAVHUB_AUTH_REQUIRED = "true";
      expect(loadConfig().authRequired).toBe(true);
    } finally {
      restore();
    }
  });

  it("NAVHUB_ALERT_WEBHOOK 缺省不投递，配置后去空格透传且超时可配", () => {
    const prevWebhook = process.env.NAVHUB_ALERT_WEBHOOK;
    const prevTimeout = process.env.NAVHUB_ALERT_TIMEOUT_MS;
    try {
      delete process.env.NAVHUB_ALERT_WEBHOOK;
      delete process.env.NAVHUB_ALERT_TIMEOUT_MS;
      expect(loadConfig().alertWebhook).toBeNull();
      expect(loadConfig().alertTimeoutMs).toBe(5000);

      process.env.NAVHUB_ALERT_WEBHOOK = "  https://hooks.example.com/abc  ";
      process.env.NAVHUB_ALERT_TIMEOUT_MS = "1500";
      const cfg = loadConfig();
      expect(cfg.alertWebhook).toBe("https://hooks.example.com/abc");
      expect(cfg.alertTimeoutMs).toBe(1500);
    } finally {
      if (prevWebhook === undefined) delete process.env.NAVHUB_ALERT_WEBHOOK; else process.env.NAVHUB_ALERT_WEBHOOK = prevWebhook;
      if (prevTimeout === undefined) delete process.env.NAVHUB_ALERT_TIMEOUT_MS; else process.env.NAVHUB_ALERT_TIMEOUT_MS = prevTimeout;
    }
  });

  it("Repository.getSitesByIds 批量查询返回完整站点与标签且忽略空数组", async () => {
    expect((await openCtx.repo.getSitesByIds([])).size).toBe(0);
    const s1 = await openCtx.repo.createSite({ url: "https://batch1.example.com", title: "Batch1", categoryId: "cat-ai", tags: ["t1"] });
    const s2 = await openCtx.repo.createSite({ url: "https://batch2.example.com", title: "Batch2", categoryId: "cat-ai", tags: ["t2"] });
    const map = await openCtx.repo.getSitesByIds([s1.id, s2.id, "non-existent"]);
    expect([...map.keys()].sort()).toEqual([s1.id, s2.id].sort());
    expect(map.get(s1.id)?.tags).toContain("t1");
  });
});

describe("identity 路由收紧（鉴权开启后拒绝纯匿名调用）", () => {
  const anon = { "x-navhub-anon-id": "auth-test-anon" };

  it("开放模式：identity 路由与公共写入面行为不变", async () => {
    const fav = await openApp.inject({ method: "GET", url: "/api/favorites", headers: anon });
    expect(fav.statusCode).toBe(200);
    const syn = await openApp.inject({
      method: "POST", url: "/api/tools/synthesize",
      payload: {
        kind: "site_search",
        siteSearchSpec: {
          siteId: "auth-open", siteName: "开放模式",
          searchUrlTemplate: "https://example.com/search?q={query}",
        },
      },
    });
    expect(syn.statusCode).toBe(200);
    expect(syn.json().registered).toBe(true);
    const sig = await openApp.inject({
      method: "POST", url: "/api/p2p/signal",
      payload: { nodeId: "n-open", message: { type: "HELLO", senderId: "client-peer-open", seq: 1, timestamp: Date.now(), payload: { clock: { "client-peer-open": 2 }, siteCount: 8 } } },
    });
    expect(sig.statusCode).toBe(200);
  });

  it("鉴权模式：identity 数据面匿名调用返回 401", async () => {
    for (const [method, url] of [
      ["GET", "/api/favorites"], ["GET", "/api/search-history"], ["GET", "/api/profile"],
      ["GET", "/api/vault/sync"], ["GET", "/api/crdt/sync"],
    ] as const) {
      const res = await authApp.inject({ method, url, headers: anon });
      expect(res.statusCode).toBe(401);
    }
    const del = await authApp.inject({ method: "DELETE", url: "/api/search-history", headers: anon });
    expect(del.statusCode).toBe(401);
  });

  it("鉴权模式：公共写入面（users/sync、synthesize、p2p/signal）匿名调用返回 401", async () => {
    const u = await authApp.inject({
      method: "POST", url: "/api/users/sync",
      payload: { provider: "github", providerId: "spoof-1", username: "spoof" },
    });
    expect(u.statusCode).toBe(401);
    const syn = await authApp.inject({
      method: "POST", url: "/api/tools/synthesize",
      payload: {
        kind: "site_search",
        siteSearchSpec: {
          siteId: "auth-spoof", siteName: "冒用",
          searchUrlTemplate: "https://example.com/search?q={query}",
        },
      },
    });
    expect(syn.statusCode).toBe(401);
    const sig = await authApp.inject({
      method: "POST", url: "/api/p2p/signal",
      payload: { nodeId: "n-auth", message: { type: "HELLO", senderId: "client-peer-auth", seq: 1, timestamp: Date.now(), payload: {} } },
    });
    expect(sig.statusCode).toBe(401);
  });

  it("鉴权模式：带有效 token 时 identity 路由与写入面可用", async () => {
    const raw = await mintToken("身份面", "read");
    const withToken = { ...anon, authorization: "Bearer " + raw };
    expect((await authApp.inject({ method: "GET", url: "/api/favorites", headers: withToken })).statusCode).toBe(200);
    expect((await authApp.inject({ method: "GET", url: "/api/vault/sync", headers: withToken })).statusCode).toBe(200);
    const u = await authApp.inject({
      method: "POST", url: "/api/users/sync", headers: { authorization: "Bearer " + raw },
      payload: { provider: "github", providerId: "real-1", username: "real" },
    });
    expect(u.statusCode).toBe(200);
    const syn = await authApp.inject({
      method: "POST", url: "/api/tools/synthesize", headers: { authorization: "Bearer " + raw },
      payload: {
        kind: "site_search",
        siteSearchSpec: {
          siteId: "auth-real", siteName: "持票",
          searchUrlTemplate: "https://example.com/search?q={query}",
        },
      },
    });
    expect(syn.statusCode).toBe(200);
    expect(syn.json().registered).toBe(true);
  });
});
