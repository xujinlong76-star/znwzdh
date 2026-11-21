/**
 * isAllowedHost / isAbsoluteHttpUrl / parseSiteUrl 单测（脚本层 .mjs 实现）。
 *
 * 与 `packages/core/test/url-host.test.ts`、
 * `apps/web-overlay/test/url-host.test.ts` 共用同一套用例（同名用例、同一期望值）；
 * 实现在 `./url-host.mjs`，与 `packages/core/src/url-host.ts`、
 * `apps/web-overlay/src/lib/safe-url.ts` 行为必须一致。
 */
import { describe, expect, it } from "vitest";
import { isAbsoluteHttpUrl, isAllowedHost, parseSiteUrl } from "./url-host.mjs";

const HOSTS = ["github.com"];

describe("isAllowedHost：主机归属严格比对", () => {
  it("精确主机与合法子域放行", () => {
    expect(isAllowedHost("https://github.com/foo", HOSTS)).toBe(true);
    expect(isAllowedHost("https://sub.github.com/x", HOSTS)).toBe(true);
    expect(isAllowedHost("https://deep.sub.github.com/x", HOSTS)).toBe(true);
  });

  it("查询串里含白名单 host 不算：https://evil.com/?github.com", () => {
    expect(isAllowedHost("https://evil.com/?github.com", HOSTS)).toBe(false);
    expect(isAllowedHost("https://evil.com/?q=https://github.com", HOSTS)).toBe(false);
    expect(isAllowedHost("https://evil.com/#github.com", HOSTS)).toBe(false);
  });

  it("后缀伪装成子域不算：github.com.evil.com", () => {
    expect(isAllowedHost("https://github.com.evil.com/x", HOSTS)).toBe(false);
    expect(isAllowedHost("https://notgithub.com/x", HOSTS)).toBe(false);
  });

  it("前缀拼接不算：evilgithub.com", () => {
    expect(isAllowedHost("https://evilgithub.com", HOSTS)).toBe(false);
    expect(isAllowedHost("https://github.com.evil.com.evil.com", HOSTS)).toBe(false);
  });

  it("主机名大小写不敏感、端口不影响判定", () => {
    expect(isAllowedHost("https://GITHUB.COM/x", HOSTS)).toBe(true);
    expect(isAllowedHost("https://GitHub.com:8443/x", HOSTS)).toBe(true);
    expect(isAllowedHost("https://github.com./x", HOSTS)).toBe(true);
  });

  it("非 http(s) 协议一律拒绝", () => {
    expect(isAllowedHost("ftp://github.com/x", HOSTS)).toBe(false);
    expect(isAllowedHost("javascript:alert(1)", HOSTS)).toBe(false);
    expect(isAllowedHost("data:text/html,github.com", HOSTS)).toBe(false);
  });

  it("非法 URL 与无方案裸串拒绝", () => {
    expect(isAllowedHost("not a url", HOSTS)).toBe(false);
    expect(isAllowedHost("", HOSTS)).toBe(false);
    expect(isAllowedHost("github.com/foo", HOSTS)).toBe(false);
  });

  it("多主机白名单任一命中即放行", () => {
    expect(isAllowedHost("https://gitee.com/x", ["github.com", "gitee.com"])).toBe(true);
    expect(isAllowedHost("https://evil.com/x", ["github.com", "gitee.com"])).toBe(false);
  });

  it("userinfo 只按主机名判定", () => {
    expect(isAllowedHost("https://user@github.com/", HOSTS)).toBe(true);
    expect(isAllowedHost("https://github.com@evil.com/", HOSTS)).toBe(false);
  });
});

describe("isAbsoluteHttpUrl：替代 startsWith('http') 嗅探", () => {
  it("http(s) 绝对 URL 放行", () => {
    expect(isAbsoluteHttpUrl("https://x.com/a.png")).toBe(true);
    expect(isAbsoluteHttpUrl("http://x.com/a.png")).toBe(true);
  });

  it("httpx:// 等非 http(s) 方案拒绝", () => {
    expect(isAbsoluteHttpUrl("httpx://evil.com/x.png")).toBe(false);
    expect(isAbsoluteHttpUrl("ftp://x.com/a.png")).toBe(false);
    expect(isAbsoluteHttpUrl("javascript:alert(1)")).toBe(false);
  });

  it("裸文件名与空串拒绝", () => {
    expect(isAbsoluteHttpUrl("chatgpt.webp")).toBe(false);
    expect(isAbsoluteHttpUrl("")).toBe(false);
  });
});

describe("parseSiteUrl：替代 startsWith('http') 三元嗅探", () => {
  it("http(s) 绝对 URL 原样解析", () => {
    expect(parseSiteUrl("https://github.com/x")?.hostname).toBe("github.com");
    expect(parseSiteUrl("http://example.com:8080/p")?.hostname).toBe("example.com");
  });

  it("裸主机名补 https:// 后解析", () => {
    expect(parseSiteUrl("github.com/x")?.hostname).toBe("github.com");
    expect(parseSiteUrl("example.com:8080/path")?.hostname).toBe("example.com");
  });

  it("httpx:// 补方案后仍非法 -> null", () => {
    expect(parseSiteUrl("httpx://evil.com")).toBeNull();
  });

  it("http:evil.com 与旧行为一致：协议 http、主机名 evil.com（WHATWG 特殊方案宽容解析）", () => {
    const u = parseSiteUrl("http:evil.com");
    expect(u?.protocol).toBe("http:");
    expect(u?.hostname).toBe("evil.com");
  });

  it("空串与非法串 -> null", () => {
    expect(parseSiteUrl("")).toBeNull();
    expect(parseSiteUrl("   ")).toBeNull();
    expect(parseSiteUrl("not a url with spaces")).toBeNull();
  });
});
