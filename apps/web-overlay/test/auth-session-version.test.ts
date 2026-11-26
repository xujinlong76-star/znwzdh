/**
 * 口令版本必须贯穿 authorize -> jwt -> session -> BFF 会话核对。
 * 这里直接执行真实回调，只替换 NextAuth 工厂与中枢会话探针。
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hubSessionRevoked: vi.fn(),
  session: null as null | Record<string, unknown>,
  governance: {} as Record<string, unknown>,
}));

vi.mock("next-auth", () => ({
  default: () => ({
    auth: async () => mocks.session,
    handlers: { GET: () => {}, POST: () => {} },
  }),
}));
vi.mock("next-auth/providers/github", () => ({
  default: (options: Record<string, unknown>) => ({ ...options, id: "github" }),
}));
vi.mock("next-auth/providers/credentials", () => ({
  default: (options: Record<string, unknown>) => ({ ...options, id: "credentials" }),
}));
vi.mock("../src/lib/server/hub", () => ({
  hubSessionRevoked: mocks.hubSessionRevoked,
}));
vi.mock("../src/lib/session-governance", () => ({
  readRequestSessionGovernance: async () => mocks.governance,
}));

type AuthModule = typeof import("../src/lib/auth");
type JwtCallback = (args: {
  token: Record<string, unknown>;
  user?: Record<string, unknown>;
  account?: { provider?: string; access_token?: string };
}) => Promise<Record<string, unknown> | null>;
type SessionCallback = (args: {
  session: Record<string, unknown>;
  token: Record<string, unknown>;
}) => Promise<Record<string, unknown> | null>;

const envKeys = [
  "NODE_ENV",
  "AUTH_SECRET",
  "NAVHUB_ADMIN_IDS",
  "NAVHUB_ADMIN_PASSWORD",
  "ADMIN_PASSWORD",
  "NAVHUB_ADMIN_TOKEN",
  "NAVHUB_STORAGE_TOKEN",
  "NAVHUB_BOOTSTRAP_TOKEN",
  "NAVHUB_MCP_TOKEN",
  "NAVHUB_STORAGE_BASE_URL",
  "NAVHUB_API_BASE_URL",
  "NAVHUB_AUTH_REQUIRED",
  "NAVHUB_ALLOW_DEFAULT_PASSWORD",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
] as const;
const savedEnv = new Map<string, string | undefined>();

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) delete (process.env as Record<string, string | undefined>)[key];
  else (process.env as Record<string, string | undefined>)[key] = value;
}

async function loadAuth(): Promise<AuthModule> {
  vi.resetModules();
  setEnv("NODE_ENV", "development");
  setEnv("AUTH_SECRET", "s".repeat(40));
  setEnv("NAVHUB_AUTH_REQUIRED", "true");
  setEnv("NAVHUB_STORAGE_BASE_URL", "http://hub.test");
  return import("../src/lib/auth");
}

function callbacks(mod: AuthModule) {
  const value = mod.authOptions.callbacks as unknown as { jwt: JwtCallback; session: SessionCallback };
  return { jwt: value.jwt, session: value.session };
}

beforeEach(() => {
  for (const key of envKeys) {
    if (!savedEnv.has(key)) savedEnv.set(key, process.env[key]);
    setEnv(key, undefined);
  }
  mocks.hubSessionRevoked.mockReset();
  mocks.hubSessionRevoked.mockResolvedValue(false);
  mocks.session = null;
  mocks.governance = {};
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

afterAll(() => {
  for (const [key, value] of savedEnv) setEnv(key, value);
});

describe("credentials 口令版本会话链", () => {
  it("authorize 保留 API 登录结果中的 passwordVersion", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      user: { id: "user-1", username: "alice", email: "alice@example.com", role: "user", passwordVersion: 7 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const mod = await loadAuth();
    const provider = mod.authOptions.providers[0] as unknown as {
      authorize: (credentials: Record<string, string>, request: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
    };

    const user = await provider.authorize(
      { username: "alice@example.com", password: "S3cret-Passw0rd!" },
      {},
    );
    expect(user).toMatchObject({ id: "user-1", passwordVersion: 7 });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://hub.test/api/account/login",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("jwt 写入版本并在登记会话时传给中枢复核", async () => {
    const mod = await loadAuth();
    const { jwt } = callbacks(mod);
    const token = await jwt({
      token: { sub: "old-sub" },
      user: { id: "user-1", role: "user", passwordVersion: 7 },
      account: { provider: "credentials" },
    });

    expect(token).toMatchObject({ sub: "user-1", provider: "credentials", passwordVersion: 7 });
    expect(typeof token?.sid).toBe("string");
    expect(typeof token?.issuedAt).toBe("number");
    expect(mocks.hubSessionRevoked).toHaveBeenCalledWith(
      token?.sid,
      "credentials:user-1",
      token?.issuedAt,
      7,
    );
  });

  it("旧版本在 jwt 登记时被中枢拒绝，不能签发会话", async () => {
    mocks.hubSessionRevoked.mockResolvedValue(true);
    const mod = await loadAuth();
    const { jwt } = callbacks(mod);
    await expect(jwt({
      token: {},
      user: { id: "user-1", passwordVersion: 6 },
      account: { provider: "credentials" },
    })).resolves.toBeNull();
  });

  it("凭证登录的版本核对不可用时 fail-closed", async () => {
    mocks.hubSessionRevoked.mockResolvedValue(null);
    const mod = await loadAuth();
    const { jwt } = callbacks(mod);
    await expect(jwt({
      token: {},
      user: { id: "user-1", passwordVersion: 7 },
      account: { provider: "credentials" },
    })).resolves.toBeNull();
  });

  it("OAuth 登录在会话登记不可用时同样 fail-closed", async () => {
    mocks.hubSessionRevoked.mockResolvedValue(null);
    const mod = await loadAuth();
    const { jwt } = callbacks(mod);
    await expect(jwt({
      token: {},
      user: { id: "github-user-1", role: "user" },
      account: { provider: "github" },
    })).resolves.toBeNull();
  });

  it("OAuth session 在枢纽不可达或缺少 sid 时同样 fail-closed", async () => {
    const mod = await loadAuth();
    const { session } = callbacks(mod);
    const args = {
      session: { user: { name: "alice" } },
      token: { sub: "github-user-1", provider: "github", sid: "oauth-sid", issuedAt: 123 },
    };
    mocks.hubSessionRevoked.mockResolvedValueOnce(null);
    await expect(session(args)).resolves.toBeNull();
    await expect(session({
      session: { user: { name: "alice" } },
      token: { sub: "github-user-1", provider: "github", issuedAt: 123 },
    })).resolves.toBeNull();
  });

  it("session 核对 JWT 治理字段，但不把 sid 暴露给浏览器 JSON", async () => {
    const mod = await loadAuth();
    const { session } = callbacks(mod);
    const result = await session({
      session: { user: { name: "alice" } },
      token: { sub: "user-1", provider: "credentials", sid: "sid-1", issuedAt: 123, passwordVersion: 7 },
    });
    expect(result).toMatchObject({ user: { id: "user-1" } });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("sessionSid");
    expect(serialized).not.toContain("sessionIssuedAt");
    expect(serialized).not.toContain("sessionPasswordVersion");
    expect(serialized).not.toContain("sid-1");
    expect(mocks.hubSessionRevoked).toHaveBeenCalledWith("sid-1", "credentials:user-1", 123, 7);
  });

  it("已吊销或核对不可用的旧版本 session 返回 null", async () => {
    const mod = await loadAuth();
    const { session } = callbacks(mod);
    const args = {
      session: { user: { name: "alice" } },
      token: { sub: "user-1", provider: "credentials", sid: "sid-1", issuedAt: 123, passwordVersion: 6 },
    };
    mocks.hubSessionRevoked.mockResolvedValueOnce(true);
    await expect(session(args)).resolves.toBeNull();
    mocks.hubSessionRevoked.mockResolvedValueOnce(null);
    await expect(session(args)).resolves.toBeNull();
  });

  it("带口令版本但缺少 sid 的 session 不能通过", async () => {
    const mod = await loadAuth();
    const { session } = callbacks(mod);
    await expect(session({
      session: { user: { name: "alice" } },
      token: { sub: "user-1", provider: "credentials", passwordVersion: 7 },
    })).resolves.toBeNull();
  });

  it("edge 分离配置的 session 回调同样复核版本并拒绝旧会话", async () => {
    await loadAuth();
    const configModule = await import("../src/lib/auth.config");
    const callback = configModule.authConfig.callbacks.session as unknown as SessionCallback;
    const args = {
      session: { user: { name: "alice" } },
      token: { sub: "user-1", provider: "credentials", sid: "sid-edge", issuedAt: 456, passwordVersion: 7 },
    };
    mocks.hubSessionRevoked.mockResolvedValueOnce(true);
    await expect(callback(args)).resolves.toBeNull();
    expect(mocks.hubSessionRevoked).toHaveBeenCalledWith("sid-edge", "credentials:user-1", 456, 7);

    mocks.hubSessionRevoked.mockResolvedValueOnce(false);
    const result = await callback(args);
    expect(JSON.stringify(result)).not.toContain("sid-edge");

    mocks.hubSessionRevoked.mockResolvedValueOnce(null);
    await expect(callback({
      session: { user: { name: "alice" } },
      token: { sub: "github-user-1", provider: "github", sid: "sid-edge", issuedAt: 456 },
    })).resolves.toBeNull();
  });

  it("verifyAdminSession 在会话核对不可用时拒绝", async () => {
    const mod = await loadAuth();
    const { session } = callbacks(mod);
    const result = await session({
      session: { user: { name: "admin" } },
      token: { sub: "admin", provider: "credentials", sid: "admin-sid", issuedAt: 123 },
    });
    mocks.session = result;
    mocks.governance = { sid: "admin-sid", issuedAt: 123 };
    mocks.hubSessionRevoked.mockResolvedValueOnce(null);
    await expect(mod.verifyAdminSession()).resolves.toMatchObject({ ok: false, status: 401 });
  });
});
