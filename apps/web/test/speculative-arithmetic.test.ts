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

  it("极小非零结果不会显示成空串或只剩负号", () => {
    expect(value("1 / 100000")).toBe("0.00001");
    expect(value("-1 / 100000")).toBe("-0.00001");
    expect(value("1 / 3")).toBe("0.3333");
  });

  it("Cron 解释不能丢分钟位，也不能把步长小时说成每天", () => {
    expect(parseSpeculativeIntent("30 9 * * *")?.subtitle).toContain("每天 09:30");
    expect(parseSpeculativeIntent("0 */2 * * *")?.subtitle).toContain("每隔 2 小时");
    expect(parseSpeculativeIntent("0 0 * * *")?.subtitle).toContain("午夜 00:00");
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
