import { describe, expect, it } from "vitest";
import { normalizeCallbackUrl } from "@/lib/safe-callback";

const ORIGIN = "https://navhub.example";

describe("normalizeCallbackUrl：登录回跳只允许同源路径", () => {
  it("相对路径正常保留 path/search/hash", () => {
    expect(normalizeCallbackUrl("/admin/sites?tab=1#top", ORIGIN)).toBe("/admin/sites?tab=1#top");
    expect(normalizeCallbackUrl("/", ORIGIN)).toBe("/");
  });

  it("同源绝对 URL 收敛为路径", () => {
    expect(normalizeCallbackUrl("https://navhub.example/admin?x=1#y", ORIGIN)).toBe("/admin?x=1#y");
  });

  it("站外、协议相对、反斜杠与 javascript: 一律回退", () => {
    expect(normalizeCallbackUrl("https://evil.example/admin", ORIGIN)).toBe("/admin");
    expect(normalizeCallbackUrl("//evil.example/admin", ORIGIN)).toBe("/admin");
    expect(normalizeCallbackUrl("/\\evil.example/admin", ORIGIN)).toBe("/admin");
    expect(normalizeCallbackUrl("javascript:alert(1)", ORIGIN)).toBe("/admin");
    expect(normalizeCallbackUrl("data:text/html,<script>alert(1)</script>", ORIGIN)).toBe("/admin");
  });

  it("空值与畸形 URL 回退，且支持自定义 fallback", () => {
    expect(normalizeCallbackUrl(undefined, ORIGIN)).toBe("/admin");
    expect(normalizeCallbackUrl("", ORIGIN)).toBe("/admin");
    expect(normalizeCallbackUrl("http://[", ORIGIN)).toBe("/admin");
    expect(normalizeCallbackUrl("https://evil.example", ORIGIN, "/")).toBe("/");
  });
});
