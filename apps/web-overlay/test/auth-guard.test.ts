/**
 * 后台管理员守卫行为锁定测试（升级改造方案 P0-1 / P0-3）。
 *
 * 背景：next-auth 5.0.0-beta.32 暴露于 2026-07 两个 CVSS 9.1 漏洞
 * （其一为 fail-open 认证绕过，仅影响 v5 beta 线）。在库级补丁缺位期间，
 * 本仓应用层第二道防线（auth.config.ts 的 authorized 回调 + isAdminIdentity
 * 白名单）必须被测试锁定，任何削弱都让 CI 红灯。
 *
 * 同时锁定 P0-1 的 secret 生产 fail-closed：
 *   - 生产运行期无显式 secret → 模块导入即抛错（拒绝带着公开密钥启动）；
 *   - next build 期（NEXT_PHASE）豁免，否则 Docker Web 镜像构建必挂；
 *   - 开发环境保留原回退值，本地行为零变化。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET_KEYS = ["AUTH_SECRET", "NEXTAUTH_SECRET", "NAVHUB_SESSION_SECRET"] as const;
const DEV_FALLBACK = "navhub-session-secret-dev-default-32-chars-long-auth-key";

type AuthConfigModule = typeof import("../src/lib/auth.config");

let savedNodeEnv: string | undefined;

/** process.env.NODE_ENV 在 @types/node 里是只读字面量类型，测试需要动态改写 */
function setEnv(key: string, value: string) {
  (process.env as Record<string, string | undefined>)[key] = value;
}

function clearSecrets() {
  for (const k of SECRET_KEYS) delete process.env[k];
}

/** 在受控环境下动态加载 auth.config（模块级读取 env，必须 import 前设好） */
async function loadConfig(
  overrides: Record<string, string | undefined> = {}
): Promise<AuthConfigModule> {
  vi.resetModules();
  clearSecrets();
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else setEnv(k, v);
  }
  return import("../src/lib/auth.config");
}

type AuthorizedArgs = {
  auth: { user?: { email?: string; name?: string; role?: string; id?: string } } | null;
  request: { nextUrl: { pathname: string } };
};

function authorizedOf(mod: AuthConfigModule) {
  return mod.authConfig.callbacks.authorized as unknown as (a: AuthorizedArgs) => boolean;
}

function asUser(user: { email?: string; name?: string; role?: string; id?: string }) {
  return { auth: { user }, request: { nextUrl: { pathname: "/admin/tokens" } } };
}

beforeEach(() => {
  savedNodeEnv = process.env.NODE_ENV;
});

afterEach(() => {
  if (savedNodeEnv !== undefined) setEnv("NODE_ENV", savedNodeEnv);
  clearSecrets();
  delete process.env.NAVHUB_ADMIN_IDS;
  vi.resetModules();
});

describe("authSecret 生产 fail-closed（P0-1）", () => {
  it("开发环境无显式 secret → 保留原回退值（本地行为不回归）", async () => {
    const mod = await loadConfig({ NODE_ENV: "development" });
    expect(mod.authSecret).toBe(DEV_FALLBACK);
  });

  it("开发环境设置 NAVHUB_SESSION_SECRET → 优先使用显式值", async () => {
    const mod = await loadConfig({ NODE_ENV: "development", NAVHUB_SESSION_SECRET: "x".repeat(40) });
    expect(mod.authSecret).toBe("x".repeat(40));
  });

  it("生产运行期无任何 secret → 导入即抛错（拒绝带着公开密钥裸奔）", async () => {
    await expect(loadConfig({ NODE_ENV: "production", NEXT_PHASE: undefined })).rejects.toThrow(
      /AUTH_SECRET/
    );
  });

  it("next build 期（NEXT_PHASE）豁免 → 镜像构建不因缺 secret 失败", async () => {
    const mod = await loadConfig({
      NODE_ENV: "production",
      NEXT_PHASE: "phase-production-build",
    });
    expect(mod.authSecret).toBe(DEV_FALLBACK);
  });

  it("生产运行期有显式 AUTH_SECRET → 正常使用", async () => {
    const mod = await loadConfig({ NODE_ENV: "production", AUTH_SECRET: "s".repeat(40) });
    expect(mod.authSecret).toBe("s".repeat(40));
  });
});

describe("authorized 回调：/admin 守卫矩阵", () => {
  it("未登录访问 /admin → 拒绝", async () => {
    const mod = await loadConfig({ NODE_ENV: "development" });
    expect(authorizedOf(mod)({ auth: null, request: { nextUrl: { pathname: "/admin" } } })).toBe(false);
  });

  it("本地管理员身份（admin@navhub.local）→ 放行", async () => {
    const mod = await loadConfig({ NODE_ENV: "development" });
    expect(
      authorizedOf(mod)(asUser({ email: "admin@navhub.local", id: "admin", role: "admin" }))
    ).toBe(true);
  });

  it("白名单命中（大小写不敏感）→ 放行", async () => {
    const mod = await loadConfig({ NODE_ENV: "production", NAVHUB_ADMIN_IDS: "KouDev,dev@example.com" });
    expect(authorizedOf(mod)(asUser({ email: "DEV@example.com" }))).toBe(true);
    expect(authorizedOf(mod)(asUser({ name: "koudev" }))).toBe(true);
  });

  it("白名单已配置但身份不命中 → 拒绝（横向越权防护）", async () => {
    const mod = await loadConfig({ NODE_ENV: "production", NAVHUB_ADMIN_IDS: "koudev" });
    expect(authorizedOf(mod)(asUser({ email: "stranger@example.com" }))).toBe(false);
  });

  it("白名单未配置 + 生产环境 → fail-closed 拒绝", async () => {
    const mod = await loadConfig({ NODE_ENV: "production", NAVHUB_ADMIN_IDS: "" });
    expect(authorizedOf(mod)(asUser({ email: "anyone@example.com" }))).toBe(false);
  });

  it("白名单未配置 + 开发环境 → 放行（本地调试不回归）", async () => {
    const mod = await loadConfig({ NODE_ENV: "development", NAVHUB_ADMIN_IDS: "" });
    expect(authorizedOf(mod)(asUser({ email: "anyone@example.com" }))).toBe(true);
  });

  it("非 /admin 路径 → 一律放行（公开页不受影响）", async () => {
    const mod = await loadConfig({ NODE_ENV: "production", NAVHUB_ADMIN_IDS: "" });
    expect(authorizedOf(mod)({ auth: null, request: { nextUrl: { pathname: "/" } } })).toBe(true);
  });
});

describe("isAdminIdentity", () => {
  it("空值与未命中 → false", async () => {
    const mod = await loadConfig({ NODE_ENV: "development", NAVHUB_ADMIN_IDS: "koudev" });
    expect(mod.isAdminIdentity(undefined)).toBe(false);
    expect(mod.isAdminIdentity(null)).toBe(false);
    expect(mod.isAdminIdentity("")).toBe(false);
    expect(mod.isAdminIdentity("other")).toBe(false);
  });

  it("命中忽略大小写", async () => {
    const mod = await loadConfig({ NODE_ENV: "development", NAVHUB_ADMIN_IDS: "KouDev" });
    expect(mod.isAdminIdentity("koudev")).toBe(true);
    expect(mod.isAdminIdentity("KOUDEV")).toBe(true);
  });
});
