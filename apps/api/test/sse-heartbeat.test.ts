import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startSseHeartbeat } from "../src/routes/shared.ts";

describe("SSE 心跳", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("按间隔发注释帧；停止后不再发，重复 stop 安全", () => {
    const calls: string[] = [];
    const hb = startSseHeartbeat((text) => calls.push(text), 10_000);

    vi.advanceTimersByTime(30_001);
    expect(calls).toEqual(["ping", "ping", "ping"]);

    hb.stop();
    hb.stop();
    vi.advanceTimersByTime(60_000);
    expect(calls).toHaveLength(3);
  });

  it("默认间隔 10 秒：9.9 秒不发，满 10 秒发一次", () => {
    const calls: string[] = [];
    const hb = startSseHeartbeat((text) => calls.push(text));

    vi.advanceTimersByTime(9_900);
    expect(calls).toEqual([]);

    vi.advanceTimersByTime(100);
    expect(calls).toEqual(["ping"]);

    hb.stop();
  });
});
