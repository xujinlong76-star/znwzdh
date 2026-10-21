import { describe, expect, it } from "vitest";
import { containsLike, escapeLike, prefixLike } from "../src/sql-like.ts";

describe("SQL LIKE 转义", () => {
  it("转义 ! / % / _ 三个元字符", () => {
    expect(escapeLike("100%_ok!")).toBe("100!%!_ok!!");
  });

  it("普通文本原样保留", () => {
    expect(escapeLike("开源 设计")).toBe("开源 设计");
    expect(escapeLike("github.com")).toBe("github.com");
  });

  it("包含/前缀模式只在两侧添加通配符", () => {
    expect(containsLike("a%b")).toBe("%a!%b%");
    expect(prefixLike("a_b")).toBe("a!_b%");
  });
});
