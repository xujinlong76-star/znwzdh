import { describe, expect, it } from "vitest";
import { parseSpeculativeIntent } from "@/lib/speculative";

describe("投机算术：无 eval 的纯解析器", () => {
  const value = (input: string) => parseSpeculativeIntent(input)?.previewValue;

  it("遵守优先级、括号、一元符号与 ^ 右结合", () => {
    expect(value("2 + 3 * 4")).toBe("14");
    expect(value("(2 + 3) * 4")).toBe("20");
    expect(value("-2^2")).toBe("-4");
    expect(value("2^3^2")).toBe("512");
    expect(value("10 % 3")).toBe("1");
  });

  it("非法/非有限表达式返回 null", () => {
    expect(parseSpeculativeIntent("1 / 0")).toBeNull();
    expect(parseSpeculativeIntent("2..3")).toBeNull();
    expect(parseSpeculativeIntent("1 +")).toBeNull();
    expect(parseSpeculativeIntent("alert(1) + 2")).toBeNull();
  });

  it("超长表达式不进入解析器", () => {
    expect(parseSpeculativeIntent(`${"1+".repeat(200)}1`)).toBeNull();
  });
});
