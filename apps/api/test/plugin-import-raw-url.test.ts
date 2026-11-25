/**
 * toRawGithubUrl（p4 插件导入）：blob 链接转 raw 只认 github.com 主机名。
 * 与 overlay 的 safe-url.test.ts 同逻辑（两处各一份实现，各自测）。
 */
import { describe, expect, it } from "vitest";
import { toRawGithubUrl } from "../src/routes/plugins/p4-publish-and-engage.ts";

describe("toRawGithubUrl（API 侧）", () => {
  it("标准 blob 链接正确转 raw", () => {
    expect(toRawGithubUrl("https://github.com/o/r/blob/main/x.json")).toBe(
      "https://raw.githubusercontent.com/o/r/main/x.json",
    );
  });

  it("子串绕过不生效", () => {
    expect(toRawGithubUrl("https://github.com.evil.com/o/r/blob/main/x.json")).toBeNull();
    expect(toRawGithubUrl("https://evil.com/?u=https://github.com/o/r/blob/main/x.json")).toBeNull();
  });

  it("非 blob 链接返回 null", () => {
    expect(toRawGithubUrl("https://github.com/o/r")).toBeNull();
    expect(toRawGithubUrl("")).toBeNull();
  });
});
