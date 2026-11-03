/**
 * 巡检判定接入统一 probe-policy（2026-11-03 修复的真实缺陷）。
 *
 * 事故背景（来自真实库 data/navhub.db 的普查）：
 *   - 最近 30 天 243 次失败巡检里有 133 次（55%）error 是空的 —— 运维看到「失败」
 *     却不知原因，无法诊断；
 *   - 16 个 broken 站点里有 13 个 health_error 为空；其中 Claude、ChatGPT 都是 403。
 *     它们活着，只是拒绝爬虫（WAF/风控），却被打成「已失效」推给用户。
 *
 * 根因：巡检自己写了 `healthy = status >= 200 && status < 400`，没接上本仓早已收敛好的
 * packages/core/src/probe-policy.ts，且 `reason` 在纯 4xx 分支恒为 null。
 *
 * 本文件锁住三件事：
 *   1. 拒绝爬虫的状态码必须判为 blocked（不是 dead）；
 *   2. 确认失效的状态码必须判为 dead；
 *   3. 任何失败结论都必须带非空的可读原因（不允许再出现「失败但无原因」）。
 */
import { describe, expect, it } from "vitest";
import {
  BOT_BLOCKED_STATUSES,
  CONFIRMED_GONE_STATUSES,
  classifyProbeError,
  classifyProbeStatus,
  isBotBlockedStatus,
} from "@navhub/core";

describe("classifyProbeStatus：拒绝爬虫 ≠ 死链", () => {
  it.each(BOT_BLOCKED_STATUSES)("HTTP %i 判为 blocked（站点活着，只是不让爬虫看）", (status) => {
    const out = classifyProbeStatus(status);
    expect(out).not.toBeNull();
    expect(out!.kind).toBe("blocked");
    expect(out!.reason.length).toBeGreaterThan(0);
  });

  it.each(CONFIRMED_GONE_STATUSES)("HTTP %i 判为 dead（页面确实不存在）", (status) => {
    const out = classifyProbeStatus(status);
    expect(out).not.toBeNull();
    expect(out!.kind).toBe("dead");
    expect(out!.reason.length).toBeGreaterThan(0);
  });

  it("5xx 判为 server-error，且原因写明「不等于站点已死」", () => {
    const out = classifyProbeStatus(503);
    expect(out!.kind).toBe("server-error");
    expect(out!.reason).toContain("不等于站点已死");
  });

  it("2xx/3xx 返回 null（不是失败，交回内容层继续判）", () => {
    expect(classifyProbeStatus(200)).toBeNull();
    expect(classifyProbeStatus(301)).toBeNull();
  });

  it("每个被判定为失败的 4xx 都带非空原因（堵住「失败但无原因」）", () => {
    for (const status of [400, 401, 403, 404, 405, 408, 410, 418, 429, 451]) {
      const out = classifyProbeStatus(status);
      expect(out, `status ${status} 应当有结论`).not.toBeNull();
      expect(out!.reason.trim().length, `status ${status} 的原因不应为空`).toBeGreaterThan(0);
    }
  });

  it("isBotBlockedStatus 与 BOT_BLOCKED_STATUSES 一致", () => {
    for (const s of BOT_BLOCKED_STATUSES) expect(isBotBlockedStatus(s)).toBe(true);
    expect(isBotBlockedStatus(404)).toBe(false);
    expect(isBotBlockedStatus(200)).toBe(false);
  });
});

describe("classifyProbeError：异常也要给出可读原因", () => {
  const ctx = { elapsedMs: 100, timeoutMs: 10000 };

  it("DNS 解析失败判为 dead", () => {
    expect(classifyProbeError(new Error("DNS 解析失败"), ctx).kind).toBe("dead");
  });

  it("连接被拒绝判为 dead", () => {
    expect(classifyProbeError(new Error("connect ECONNREFUSED"), ctx).kind).toBe("dead");
  });

  it("超时判为 unverified（慢不等于死）", () => {
    const out = classifyProbeError(new Error("timeout"), { elapsedMs: 9900, timeoutMs: 10000 });
    expect(out.kind).toBe("unverified");
    expect(out.reason).toContain("慢不等于死");
  });

  it("连接中断判为 unverified，且不外泄原始英文堆栈", () => {
    const out = classifyProbeError(new Error("socket hang up at 10.0.0.1:8080"), ctx);
    expect(out.kind).toBe("unverified");
    expect(out.reason).not.toMatch(/10\.0\.0\.1|socket hang up/i);
  });

  it("任何异常分支的原因都非空", () => {
    const cases = [
      new Error("DNS 解析失败"),
      new Error("certificate has expired"),
      new Error("ECONNREFUSED"),
      new Error("timeout"),
      new Error("socket hang up"),
      new Error(""),
    ];
    for (const err of cases) {
      expect(classifyProbeError(err, ctx).reason.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("shouldMarkBroken：拒绝爬虫不应把活站点打进冷宫", () => {
  it("连续失败达到阈值才判 broken", async () => {
    const { shouldMarkBroken } = await import("../src/jobs.ts");
    expect(shouldMarkBroken(false, 0, 3)).toBe(false);
    expect(shouldMarkBroken(false, 1, 3)).toBe(false);
    expect(shouldMarkBroken(false, 2, 3)).toBe(true);
    expect(shouldMarkBroken(true, 5, 3)).toBe(false);
  });
});
