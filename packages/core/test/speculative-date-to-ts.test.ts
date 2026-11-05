import { describe, expect, it } from "vitest";
import { parseSpeculativeIntent } from "../src/speculative-intent/parse.ts";

describe("0-RTT 自然日期时间转时间戳 (date_to_ts)", () => {
  it("识别标准 YYYY-MM-DD 并转为时间戳", () => {
    const res = parseSpeculativeIntent("2026-10-31");
    expect(res).not.toBeNull();
    expect(res?.type).toBe("date_to_ts");
    expect(res?.details?.["秒级戳 (10位)"]).toBeDefined();
    expect(res?.details?.["毫秒级戳 (13位)"]).toBeDefined();
  });

  it("识别完整 YYYY-MM-DD HH:mm:ss", () => {
    const res = parseSpeculativeIntent("2026-10-31 18:30:00");
    expect(res).not.toBeNull();
    expect(res?.type).toBe("date_to_ts");
    expect(res?.details?.["标准时间"]).toContain("2026");
  });

  it("支持 explicit date: 或 dt: 前缀", () => {
    const res = parseSpeculativeIntent("dt: 2026/12/25");
    expect(res).not.toBeNull();
    expect(res?.type).toBe("date_to_ts");
  });

  it("非法日期如 2月30日 静默跳过不误触发", () => {
    const res = parseSpeculativeIntent("2026-02-30");
    expect(res).toBeNull();
  });
});
