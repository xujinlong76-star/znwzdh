import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { assertIdentitySecurity } from "../src/security-readiness.ts";

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

  it("生产开放模式：不强制身份签名（保持历史行为）", () => {
    expect(() =>
      assertIdentitySecurity({ authRequired: false, identitySecret: null }, true)
    ).not.toThrow();
  });

  it("非生产环境：不阻断本地/测试启动", () => {
    expect(() =>
      assertIdentitySecurity({ authRequired: true, identitySecret: null }, false)
    ).not.toThrow();
  });

  it("接线守卫：buildServer 必须在装配路由前调用校验", () => {
    const source = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
    expect(source).toContain("assertIdentitySecurity(ctx.config)");
    expect(source.indexOf("assertIdentitySecurity(ctx.config)")).toBeLessThan(
      source.indexOf("const app = Fastify(")
    );
  });
});
