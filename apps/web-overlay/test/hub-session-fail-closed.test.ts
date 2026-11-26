import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  verifyAdminSession: vi.fn(),
  hubSessionRevoked: vi.fn(),
  fetch: vi.fn(),
  governance: {} as { sid?: string; issuedAt?: number },
}));

vi.mock("@/lib/auth", () => ({
  auth: mocks.auth,
  verifyAdminSession: mocks.verifyAdminSession,
}));
vi.mock("../src/lib/server/hub", () => ({
  hubSessionRevoked: mocks.hubSessionRevoked,
}));
vi.mock("../src/lib/session-governance", () => ({
  readRequestSessionGovernance: async () => mocks.governance,
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

type HubRoute = typeof import("../src/app/api/hub/[...path]/route");
type MeRoute = typeof import("../src/app/api/me/[[...path]]/route");
let route: HubRoute;
let meRoute: MeRoute;
let session: Session | null = null;
const savedEnv = new Map<string, string | undefined>();
const envKeys = ["NODE_ENV", "AUTH_SECRET", "NAVHUB_STORAGE_BASE_URL", "NAVHUB_IDENTITY_SECRET"] as const;

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) delete (process.env as Record<string, string | undefined>)[key];
  else (process.env as Record<string, string | undefined>)[key] = value;
}

function loggedInSession(provider = "github"): Session {
  return {
    user: { id: "oauth-user", name: "OAuth User", provider },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as Session;
}

function request() {
  return new NextRequest("http://web.test/api/hub/account/email-status?email=user@example.com", {
    method: "GET",
  });
}

const ctx = { params: Promise.resolve({ path: ["account", "email-status"] }) };

beforeAll(async () => {
  for (const key of envKeys) {
    savedEnv.set(key, process.env[key]);
    setEnv(key, undefined);
  }
  setEnv("NODE_ENV", "test");
  setEnv("AUTH_SECRET", "s".repeat(40));
  setEnv("NAVHUB_STORAGE_BASE_URL", "http://hub.test");
  setEnv("NAVHUB_IDENTITY_SECRET", "i".repeat(40));
  route = await import("../src/app/api/hub/[...path]/route");
  meRoute = await import("../src/app/api/me/[[...path]]/route");
});

beforeEach(() => {
  session = null;
  mocks.governance = { sid: "oauth-sid", issuedAt: 123 };
  mocks.auth.mockReset().mockImplementation(async () => session);
  mocks.verifyAdminSession.mockReset().mockResolvedValue({ ok: false, status: 401 });
  mocks.hubSessionRevoked.mockReset().mockResolvedValue(false);
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
});

// mock 卫生兜底：isolate:false 下同 worker 的后续文件会看到本文件留下的
// 跨模块 mock 与 process.env 改写，这里统一清掉。
afterAll(() => {
  vi.resetModules();
});

describe("/api/hub 已登录会话 fail-closed", () => {
  it("OAuth 会话在 sessions/check 不可达时返回 401，不转发上游", async () => {
    session = loggedInSession();
    mocks.hubSessionRevoked.mockResolvedValue(null);

    const response = await route.GET(request(), ctx);

    expect(response.status).toBe(401);
    expect(mocks.hubSessionRevoked).toHaveBeenCalledWith("oauth-sid", "github:oauth-user", 123, undefined);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("已明确吊销的会话返回 401", async () => {
    session = loggedInSession();
    mocks.hubSessionRevoked.mockResolvedValue(true);

    const response = await route.GET(request(), ctx);

    expect(response.status).toBe(401);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("已登录但缺少服务端 sid 时拒绝，不降级成匿名", async () => {
    session = loggedInSession("github");
    mocks.governance = {};

    const response = await route.GET(request(), ctx);

    expect(response.status).toBe(401);
    expect(mocks.hubSessionRevoked).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("核对明确通过后才以会话身份转发", async () => {
    session = loggedInSession();

    const response = await route.GET(request(), ctx);

    expect(response.status).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledWith(
      "http://hub.test/api/account/email-status?email=user@example.com",
      expect.objectContaining({
        headers: expect.objectContaining({ "x-navhub-user-id": "github:oauth-user" }),
      }),
    );
  });

  it("真正未登录的匿名/public 请求仍可转发", async () => {
    session = null;

    const response = await route.GET(request(), ctx);

    expect(response.status).toBe(200);
    expect(mocks.hubSessionRevoked).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
});

describe("/api/me 匿名合并绑定", () => {
  const mergeRequest = (cookie?: string) => new NextRequest("http://web.test/api/me/merge", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie: `navhub_anon=${cookie}` } : {}),
    },
    body: JSON.stringify({ anonId: "anon-9f8e7d6c-5b4a-3210-fedc-ba9876543210" }),
  });

  it("没有匿名绑定 cookie 时拒绝代签任意 anonId", async () => {
    session = loggedInSession();

    const response = await meRoute.POST(mergeRequest(), { params: Promise.resolve({ path: ["merge"] }) });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "缺少匿名身份绑定，请先在当前浏览器生成匿名数据后再合并" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("绑定 cookie 与 body anonId 不一致时拒绝", async () => {
    session = loggedInSession();
    const cookie = "anon-11111111-1111-1111-1111-111111111111." + "a".repeat(64);

    const response = await meRoute.POST(mergeRequest(cookie), { params: Promise.resolve({ path: ["merge"] }) });

    expect(response.status).toBe(401);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe("/api/me 读请求会话核对 fail-closed", () => {
  it("已登录读请求在 sessions/check 不可达时返回 502，不继续读取用户数据", async () => {
    session = loggedInSession();
    mocks.fetch.mockRejectedValueOnce(new Error("hub unavailable"));

    const response = await meRoute.GET(
      new NextRequest("http://web.test/api/me", { method: "GET" }),
      { params: Promise.resolve({ path: [] }) },
    );

    expect(response.status).toBe(502);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.fetch.mock.calls[0][0]).toBe("http://hub.test/api/me/sessions/check");
  });

  it("未登录用户仍返回 401，不调用中枢", async () => {
    session = null;

    const response = await meRoute.GET(
      new NextRequest("http://web.test/api/me", { method: "GET" }),
      { params: Promise.resolve({ path: [] }) },
    );

    expect(response.status).toBe(401);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
