import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { assertIdentitySecurity } from "../src/security-readiness.ts";
import { loadConfig } from "../src/config.ts";

const VALID_SECRET = "0123456789abcdef0123456789abcdef";

describe("生产身份签名启动校验", () => {
  it("生产 + 鉴权 + 缺少密钥：拒绝启动", () => {
    expect(() =>
      assertIdentitySecurity({ authRequired: true, identitySecret: null }, true)
    ).toThrow(/NAVHUB_IDENTITY_SECRET/);
  });

  it("生产 + 鉴权 + 密钥过短：拒绝启动", () => {
    expect(() =>
      assertIdentitySecurity({ authRequired: true, identitySecret: "short-secret" }, true)
    ).toThrow(/长度不足/);
  });

  it("生产 + 鉴权 + 纯空白密钥：拒绝启动", () => {
    expect(() =>
      assertIdentitySecurity({ authRequired: true, identitySecret: " ".repeat(32) }, true)
    ).toThrow(/长度不足/);
  });

  it("生产 + 鉴权 + 32 个非空白字符：放行", () => {
    expect(() =>
      assertIdentitySecurity({ authRequired: true, identitySecret: VALID_SECRET }, true)
    ).not.toThrow();
  });

  it("生产开放模式 + 无密钥 + 未显式承认：拒绝启动", () => {
    expect(() =>
      assertIdentitySecurity({ authRequired: false, identitySecret: null }, true)
    ).toThrow(/NAVHUB_ALLOW_UNSIGNED_IDENTITY/);
  });

  it("生产开放模式 + 无密钥 + 显式承认：放行并打印警告", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(() =>
        assertIdentitySecurity(
          { authRequired: false, identitySecret: null, allowUnsignedIdentity: true },
          true
        )
      ).not.toThrow();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("NAVHUB_ALLOW_UNSIGNED_IDENTITY"));
    } finally {
      warn.mockRestore();
    }
  });

  it("生产开放模式 + 合法密钥：放行（签名生效）", () => {
    expect(() =>
      assertIdentitySecurity({ authRequired: false, identitySecret: VALID_SECRET }, true)
    ).not.toThrow();
  });

  it("生产开放模式 + 弱密钥：拒绝启动", () => {
    expect(() =>
      assertIdentitySecurity({ authRequired: false, identitySecret: "short-secret" }, true)
    ).toThrow(/长度不足/);
  });

  it("显式承认无签名身份不能抵消鉴权对密钥的硬要求", () => {
    expect(() =>
      assertIdentitySecurity(
        { authRequired: true, identitySecret: null, allowUnsignedIdentity: true },
        true
      )
    ).toThrow(/开启鉴权/);
  });

  it("非生产环境：不阻断本地/测试启动", () => {
    expect(() =>
      assertIdentitySecurity({ authRequired: true, identitySecret: null }, false)
    ).not.toThrow();
    expect(() =>
      assertIdentitySecurity({ authRequired: false, identitySecret: null }, false)
    ).not.toThrow();
  });
});

describe("NAVHUB_ALLOW_UNSIGNED_IDENTITY 装配", () => {
  const KEYS = [
    "NODE_ENV",
    "NAVHUB_SESSION_SECRET",
    "NAVHUB_PUBLIC_URL",
    "NAVHUB_AUTH_REQUIRED",
    "NAVHUB_IDENTITY_SECRET",
    "NAVHUB_ALLOW_UNSIGNED_IDENTITY",
  ] as const;
  const original = new Map<string, string | undefined>(KEYS.map((key) => [key, process.env[key]]));
  const previous = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of KEYS) {
      previous.set(key, process.env[key]);
      delete process.env[key];
    }
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    for (const key of KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    previous.clear();
  });

  afterAll(() => {
    for (const key of KEYS) {
      const value = original.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    original.clear();
  });

  it("默认 false；1/true/yes 开启；0/false/空 保持关闭", () => {
    expect(loadConfig().allowUnsignedIdentity).toBe(false);
    for (const value of ["1", "true", "TRUE", "yes"]) {
      process.env.NAVHUB_ALLOW_UNSIGNED_IDENTITY = value;
      expect(loadConfig().allowUnsignedIdentity).toBe(true);
    }
    for (const value of ["0", "false", ""]) {
      process.env.NAVHUB_ALLOW_UNSIGNED_IDENTITY = value;
      expect(loadConfig().allowUnsignedIdentity).toBe(false);
    }
  });

  it("生产 + 显式内网 publicUrl + 无密钥：装配放行、启动闸门拒绝，opt-out 后放行", () => {
    process.env.NODE_ENV = "production";
    process.env.NAVHUB_SESSION_SECRET =
      "a-very-strong-production-secret-with-at-least-32-chars!";
    process.env.NAVHUB_PUBLIC_URL = "http://localhost:8787";
    delete process.env.NAVHUB_AUTH_REQUIRED;
    delete process.env.NAVHUB_IDENTITY_SECRET;
    delete process.env.NAVHUB_ALLOW_UNSIGNED_IDENTITY;

    const config = loadConfig();
    expect(config.allowUnsignedIdentity).toBe(false);
    expect(() => assertIdentitySecurity(config, true)).toThrow(/NAVHUB_ALLOW_UNSIGNED_IDENTITY/);

    process.env.NAVHUB_ALLOW_UNSIGNED_IDENTITY = "1";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(() => assertIdentitySecurity(loadConfig(), true)).not.toThrow();
    } finally {
      warn.mockRestore();
    }
  });

  it("config.ts 用同一环境键装配默认 false", () => {
    const source = readFileSync(new URL("../src/config.ts", import.meta.url), "utf8");
    expect(source).toContain('bool("NAVHUB_ALLOW_UNSIGNED_IDENTITY", false)');
  });
});

describe("接线与部署一致性", () => {
  it("buildServer 必须在装配路由前以 ctx.config 原样调用校验", () => {
    const source = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
    expect(source).toContain("assertIdentitySecurity(ctx.config)");
    expect(source.indexOf("assertIdentitySecurity(ctx.config)")).toBeLessThan(
      source.indexOf("const app = Fastify(")
    );
  });

  it("compose 的 api 与 api-standard 都透传 opt-out（默认 0）", () => {
    const source = readFileSync(
      new URL("../../../docker/docker-compose.yml", import.meta.url),
      "utf8"
    );
    const matches = source.match(
      /NAVHUB_ALLOW_UNSIGNED_IDENTITY: \$\{NAVHUB_ALLOW_UNSIGNED_IDENTITY:-0\}/g
    );
    expect(matches).toHaveLength(2);
  });
});
