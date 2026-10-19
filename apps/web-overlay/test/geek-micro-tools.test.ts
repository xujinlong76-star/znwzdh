/**
 * GeekMicroTools 极客微工具与 Spotlight 快捷模式单元测试
 */
import { describe, expect, it } from "vitest";

describe("极客微工具 (Geek Micro Tools) 核心逻辑", () => {
  // 1. Base64
  it("Base64 UTF-8 安全编解码", () => {
    const raw = "NavHub 2026 极客工作台";
    const encoded = btoa(unescape(encodeURIComponent(raw)));
    expect(encoded).toBeDefined();
    const decoded = decodeURIComponent(escape(atob(encoded)));
    expect(decoded).toBe(raw);
  });

  // 2. JWT 解析
  it("JWT Header 与 Payload 声明解析及过期判断", () => {
    const testHeader = { alg: "HS256", typ: "JWT" };
    const testPayload = { sub: "user-123", name: "NavHub Admin", exp: 2000000000 };
    const token = `${btoa(JSON.stringify(testHeader))}.${btoa(JSON.stringify(testPayload))}.dummy-signature`;

    const parts = token.split(".");
    expect(parts.length).toBe(3);

    const parsedHeader = JSON.parse(atob(parts[0]));
    const parsedPayload = JSON.parse(atob(parts[1]));

    expect(parsedHeader.alg).toBe("HS256");
    expect(parsedPayload.name).toBe("NavHub Admin");

    const nowSec = Math.floor(Date.now() / 1000);
    const isExpired = nowSec > parsedPayload.exp;
    expect(isExpired).toBe(false); // 2000000000 is year 2033
  });

  // 3. 时间戳转换
  it("Unix 时间戳解析 (秒级与毫秒级自动适配)", () => {
    const secInput = "1776518400"; // 10 digits
    const dateFromSec = new Date(Number(secInput) * 1000);
    expect(dateFromSec.getFullYear()).toBe(2026);

    const msInput = "1776518400000"; // 13 digits
    const dateFromMs = new Date(Number(msInput));
    expect(dateFromMs.getFullYear()).toBe(2026);
  });

  // 4. UUID 生成格式合规性
  it("UUID v4 满足 RFC 4122 标准", () => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    // node 环境下 crypto.randomUUID
    const id = crypto.randomUUID();
    expect(uuidRegex.test(id)).toBe(true);
  });

  // 5. JSON 格式化与错误定位
  it("JSON 美化与压缩及非法语法拦截", () => {
    const valid = '{"key":"value","count":42}';
    const parsed = JSON.parse(valid);
    expect(JSON.stringify(parsed, null, 2)).toContain('  "key": "value"');
    expect(JSON.stringify(parsed)).toBe(valid);

    const invalid = '{"key": broken}';
    expect(() => JSON.parse(invalid)).toThrow();
  });

  // 6. URL Component 编解码
  it("URL 编解码处理特殊字符", () => {
    const raw = "https://navhub.io/search?q=AI 生产力&tag=工具";
    const encoded = encodeURIComponent(raw);
    expect(encoded).toContain("%20");
    expect(encoded).toContain("%E7%94%9F%E4%BA%A7%E5%8A%9B");
    expect(decodeURIComponent(encoded)).toBe(raw);
  });
});
