import { describe, expect, it } from "vitest";
import {
  generateNumericCode,
  generateToken,
  hashPassword,
  hashToken,
  validatePassword,
  verifyPassword,
} from "../src/password.ts";

/**
 * 口令哈希与会话令牌原语。
 *
 * 覆盖 OWASP 口径的关键不变量：
 *  - 同一口令两次哈希结果不同（独立盐）；
 *  - 正确口令校验通过、错误口令拒绝；
 *  - 损坏/旧格式哈希不抛错，表现为「密码错误」；
 *  - 令牌生成是密码学安全且可哈希比对。
 */
describe("password 原语", () => {
  it("同一口令两次哈希结果不同（独立盐）", async () => {
    const a = await hashPassword("correct horse battery staple");
    const b = await hashPassword("correct horse battery staple");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$")).toBe(true);
  });

  it("正确口令校验通过", async () => {
    const hash = await hashPassword("S3cret-Passw0rd!");
    await expect(verifyPassword("S3cret-Passw0rd!", hash)).resolves.toBe(true);
  });

  it("错误口令被拒绝", async () => {
    const hash = await hashPassword("S3cret-Passw0rd!");
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("损坏/旧格式哈希不抛错，表现为密码错误", async () => {
    await expect(verifyPassword("anything", "not-a-hash")).resolves.toBe(false);
    await expect(verifyPassword("anything", "md5$deadbeef")).resolves.toBe(false);
    await expect(verifyPassword("anything", "scrypt$abc$def$ghi$jkl$mno")).resolves.toBe(false);
    await expect(verifyPassword("", "")).resolves.toBe(false);
  });

  it("validatePassword 按长度与字节数判定", () => {
    expect(validatePassword("short")).not.toBeNull();
    expect(validatePassword("")).not.toBeNull();
    expect(validatePassword("a".repeat(129))).not.toBeNull();
    expect(validatePassword("a".repeat(128))).toBeNull();
    // 中文按字节计：8 个中文字符 = 24 字节，未超上限
    expect(validatePassword("中".repeat(8))).toBeNull();
  });

  it("generateToken 生成 URL 安全且每次不同", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(generateToken(16).length).toBeGreaterThan(16);
  });

  it("generateNumericCode 生成指定位数纯数字", () => {
    const code = generateNumericCode(6);
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^[0-9]{6}$/);
    expect(generateNumericCode(4)).toMatch(/^[0-9]{4}$/);
  });

  it("hashToken 对同一输入稳定、不同输入不同", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });
});
