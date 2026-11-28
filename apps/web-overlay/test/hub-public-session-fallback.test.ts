import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  verifyAdminSession: vi.fn(),
  hubSessionRevoked: vi.fn(),
  fetch: vi.fn(),
  getToken: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mocks.auth,
  verifyAdminSession: mocks.verifyAdminSession,
}));
vi.mock("../src/lib/server/hub", () => ({
  hubSessionRevoked: mocks.hubSessionRevoked,
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: "authjs.session-token=test" }),
}));
vi.mock("next-auth/jwt", () => ({
  getToken: mocks.getToken,
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

type HubRoute = typeof import("../src/app/api/hub/[...path]/route");
let route: HubRoute;
let session: Session | null = null;
const savedEnv = new Map<string, string | undefined>();
const envKeys = ["NODE_ENV", "AUTH_SECRET", "NAVHUB_STORAGE_BASE_URL", "NAVHUB_IDENTITY_SECRET"] as const;

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) delete (process.env as Record<string, string | undefined>)[key];
  else (process.env as Record<string, string | undefined>)[key] = value;
}

function loggedInSession(): Session {
  return {
    user: { id: "oauth-user", name: "OAuth User", provider: "github" },
    sessionSid: "oauth-sid",
    sessionIssuedAt: 123,
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as Session;
}

function request(path: string, headers?: Record<string, string>) {
  return new NextRequest("http://web.test/api/hub/" + path, { method: "GET", headers });
}

function context(path: string[]) {
  return { params: Promise.resolve({ path }) };
}

beforeAll(async () => {
  for (const key of envKeys) {
    savedEnv.set(key, process.env[key]);
    setEnv(key, undefined);
  }
  setEnv("NODE_ENV", "test");
  setEnv("AUTH_SECRET", "s".repeat(40));
  // HUB_BASE 用 127.0.0.1 字面 IP 而不用 hub.test 这类假域名：guardedFetch 会对
  // hub 主机做真实 DNS 解析；hub.test 在本机解析器上返回 198.18.18.88（通配），
  // 在 CI（GitHub DNS）上 NXDOMAIN → SsrfBlockedError → 路由回 403，测试在
  // 本地过、CI 挂。127.0.0.1 是字面 IP，resolveAndCheckAddresses 直接返回、
  // 不走 DNS，所有环境行为一致。fetch 本就被 mock，不会真连 8787。
  setEnv("NAVHUB_STORAGE_BASE_URL", "http://127.0.0.1:8787");
  setEnv("NAVHUB_IDENTITY_SECRET", "i".repeat(40));
  route = await import("../src/app/api/hub/[...path]/route");
});

beforeEach(() => {
  session = null;
  mocks.auth.mockReset().mockImplementation(async () => session);
  mocks.verifyAdminSession.mockReset().mockResolvedValue({ ok: true });
  mocks.hubSessionRevoked.mockReset().mockResolvedValue(false);
  mocks.getToken.mockReset().mockResolvedValue({ sub: "oauth-user", sid: "oauth-sid", issuedAt: 123, passwordVersion: 1 });
  mocks.fetch.mockReset().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
  vi.stubGlobal("fetch", mocks.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  for (const [key, value] of savedEnv) setEnv(key, value);
  vi.resetModules();
});

describe("/api/hub public 路由会话降级", () => {
  it("会话缺少 sid 时仍返回公共合集，不带登录身份", async () => {
    session = loggedInSession();
    delete (session as Session & { sessionSid?: string }).sessionSid;
    mocks.getToken.mockResolvedValue({ sub: "oauth-user" });

    const response = await route.GET(request("collections"), context(["collections"]));

    expect(response.status).toBe(200);
    const headers = mocks.fetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["x-navhub-user-id"]).toBeUndefined();
  });

  it("会话被吊销时搜索历史降级为匿名身份", async () => {
    session = loggedInSession();
    mocks.hubSessionRevoked.mockResolvedValue(true);

    const response = await route.GET(
      request("search-history?limit=8", { "x-navhub-anon-id": "anon-public12" }),
      context(["search-history"]),
    );

    expect(response.status).toBe(200);
    const headers = mocks.fetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["x-navhub-anon-id"]).toBe("anon-public12");
    expect(headers["x-navhub-user-id"]).toBeUndefined();
  });

  it("管理面会话被吊销时仍然 401，不降级放行", async () => {
    session = loggedInSession();
    mocks.hubSessionRevoked.mockResolvedValue(true);

    const response = await route.GET(request("admin/audit"), context(["admin", "audit"]));

    expect(response.status).toBe(401);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
