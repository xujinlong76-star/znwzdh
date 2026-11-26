import { beforeEach, describe, expect, it, vi, afterAll } from "vitest";
import type { Session } from "next-auth";
import { encode } from "next-auth/jwt";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: mocks.headers,
}));

import { authSecret } from "../src/lib/auth.config";
import { readRequestSessionGovernance } from "../src/lib/session-governance";

const secret = authSecret;
const session = {
  user: { id: "admin", name: "管理员" },
  expires: new Date(Date.now() + 60_000).toISOString(),
} as Session;

async function cookie(name: string, token: Record<string, unknown>, tokenSecret = secret) {
  const value = await encode({ token, secret: tokenSecret, salt: name, maxAge: 60 });
  mocks.headers.mockResolvedValue(new Headers({ cookie: `${name}=${value}` }));
}

beforeEach(() => {
  mocks.headers.mockReset();
});

// mock 卫生兜底：isolate:false 下同 worker 的后续文件会看到本文件留下的
// 跨模块 mock 与 process.env 改写，这里统一清掉。
afterAll(() => {
  vi.resetModules();
});

describe("从已验签会话 Cookie 读取治理元数据", () => {
  it("普通 Cookie 返回 sid、签发时间和口令版本", async () => {
    await cookie("authjs.session-token", {
      sub: "admin",
      sid: "sid-1",
      issuedAt: 123,
      passwordVersion: 7,
    });

    await expect(readRequestSessionGovernance(session)).resolves.toEqual({
      sid: "sid-1",
      issuedAt: 123,
      passwordVersion: 7,
    });
  });

  it("HTTPS 的 __Secure- Cookie 使用对应 salt", async () => {
    await cookie("__Secure-authjs.session-token", { sub: "admin", sid: "secure-sid", issuedAt: 456 });

    await expect(readRequestSessionGovernance(session)).resolves.toEqual({
      sid: "secure-sid",
      issuedAt: 456,
    });
  });

  it("Cookie 验签失败时 fail-closed", async () => {
    await cookie("authjs.session-token", { sub: "admin", sid: "forged-sid" }, "x".repeat(40));

    await expect(readRequestSessionGovernance(session)).resolves.toEqual({});
  });

  it("JWT sub 与 auth() 用户不一致时 fail-closed", async () => {
    await cookie("authjs.session-token", { sub: "someone-else", sid: "sid-1" });

    await expect(readRequestSessionGovernance(session)).resolves.toEqual({});
  });

  it("auth() 的 JSON 响应边界不会携带治理字段", async () => {
    const responseBoundarySession = JSON.parse(JSON.stringify(session)) as Session;

    expect(JSON.stringify(responseBoundarySession)).not.toContain("sid-1");
    mocks.headers.mockResolvedValue(new Headers({ cookie: "authjs.session-token=invalid" }));
    await expect(readRequestSessionGovernance(responseBoundarySession)).resolves.toEqual({});
  });
});
