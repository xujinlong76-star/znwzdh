/**
 * 03 §3.3 连续失败计数（B 段）：recordCheck / getConsecutiveFailures。
 *
 * 锁三点：
 * 1. 转移规则：成功（ok 且 auditStatus 为空或 HEALTHY）→ 清零；
 *    bot-blocked（未测准）→ 打断链清零；其余失败 → +1。
 * 2. streak 状态只由计数定：0 → ok，1 → suspect，≥ 阈值（2）→ confirmed-dead。
 * 3. 阈值是已裁决的本站值 2（CONSECUTIVE_FAILURES_THRESHOLD），不随 Gatus 的 3 走。
 *
 * 注意：本文件只测进程内登记（§3.3 的 in-process API）；持久计数
 * （sites.consecutive_failures 列，同事务写）由 apps/api 的
 * health-threshold.test.ts 覆盖。登记是进程内 Map，测试间用不同 siteId 隔离。
 */
import { describe, expect, it } from "vitest";
import {
  CONSECUTIVE_FAILURES_THRESHOLD,
  computeConsecutiveFailures,
  getConsecutiveFailures,
  recordCheck,
  type ConsecutiveCheckResult,
} from "../src/health-sentinel.ts";

const NOW = 1794000000000;

function fail(over: Partial<ConsecutiveCheckResult> = {}): ConsecutiveCheckResult {
  return { ok: false, httpStatus: 500, checkedAt: NOW, ...over };
}

function succeed(over: Partial<ConsecutiveCheckResult> = {}): ConsecutiveCheckResult {
  return { ok: true, checkedAt: NOW, ...over };
}

describe("CONSECUTIVE_FAILURES_THRESHOLD", () => {
  it("阈值是已裁决的本站值 2（不取 Gatus 的 3）", () => {
    expect(CONSECUTIVE_FAILURES_THRESHOLD).toBe(2);
  });
});

describe("computeConsecutiveFailures 纯转移", () => {
  it("成功清零：之前连续失败 2 次也回到 0 / ok", () => {
    expect(computeConsecutiveFailures(2, succeed())).toEqual({ consecutiveFailures: 0, state: "ok" });
  });

  it("成功要求 auditStatus 为空或 HEALTHY：ok=true 但 SOFT_404 也算失败", () => {
    expect(computeConsecutiveFailures(0, succeed({ auditStatus: "HEALTHY" }))).toEqual({
      consecutiveFailures: 0,
      state: "ok",
    });
    expect(computeConsecutiveFailures(0, succeed({ auditStatus: "SOFT_404" }))).toEqual({
      consecutiveFailures: 1,
      state: "suspect",
    });
    expect(computeConsecutiveFailures(0, succeed({ auditStatus: "SUSPICIOUS_PARKED" }))).toEqual({
      consecutiveFailures: 1,
      state: "suspect",
    });
  });

  it("失败 +1：第 1 次 suspect，第 2 次 confirmed-dead，此后继续累加", () => {
    expect(computeConsecutiveFailures(0, fail())).toEqual({ consecutiveFailures: 1, state: "suspect" });
    expect(computeConsecutiveFailures(1, fail())).toEqual({ consecutiveFailures: 2, state: "confirmed-dead" });
    expect(computeConsecutiveFailures(2, fail())).toEqual({ consecutiveFailures: 3, state: "confirmed-dead" });
  });

  it("bot-blocked 打断链：之前连续失败 2 次也回到 0 / ok", () => {
    expect(computeConsecutiveFailures(2, fail({ botBlocked: true }))).toEqual({
      consecutiveFailures: 0,
      state: "ok",
    });
  });

  it("无状态码的失败（超时/断连）也计入：ok=false + httpStatus 为空", () => {
    expect(computeConsecutiveFailures(0, fail({ httpStatus: null }))).toEqual({
      consecutiveFailures: 1,
      state: "suspect",
    });
  });

  it("负数/非法旧值按 0 计，不产生负计数", () => {
    expect(computeConsecutiveFailures(-3, fail())).toEqual({ consecutiveFailures: 1, state: "suspect" });
    expect(computeConsecutiveFailures(Number.NaN, fail())).toEqual({
      consecutiveFailures: 1,
      state: "suspect",
    });
  });
});

describe("recordCheck / getConsecutiveFailures 进程内登记", () => {
  it("未记过的站返回 0", () => {
    expect(getConsecutiveFailures("w5-never-checked")).toBe(0);
  });

  it("失败两次升 confirmed-dead，成功一次清零", () => {
    const site = "w5-streak";
    expect(recordCheck(site, fail())).toEqual({ consecutiveFailures: 1, state: "suspect" });
    expect(getConsecutiveFailures(site)).toBe(1);
    expect(recordCheck(site, fail())).toEqual({ consecutiveFailures: 2, state: "confirmed-dead" });
    expect(getConsecutiveFailures(site)).toBe(2);
    expect(recordCheck(site, succeed())).toEqual({ consecutiveFailures: 0, state: "ok" });
    expect(getConsecutiveFailures(site)).toBe(0);
  });

  it("bot-blocked 打断链：两次失败后一次 bot-blocked 回到 0", () => {
    const site = "w5-bot-blocked";
    recordCheck(site, fail());
    recordCheck(site, fail());
    expect(getConsecutiveFailures(site)).toBe(2);
    expect(recordCheck(site, fail({ botBlocked: true }))).toEqual({ consecutiveFailures: 0, state: "ok" });
    expect(getConsecutiveFailures(site)).toBe(0);
  });

  it("ok=true 但 auditStatus 为 SOFT_404 时按失败记（内容层判死，连接层 ok 不兜底）", () => {
    const site = "w5-audit-fail";
    expect(recordCheck(site, succeed({ auditStatus: "SOFT_404" }))).toEqual({
      consecutiveFailures: 1,
      state: "suspect",
    });
  });

  it("各站计数互相独立", () => {
    recordCheck("w5-site-a", fail());
    recordCheck("w5-site-a", fail());
    expect(getConsecutiveFailures("w5-site-a")).toBe(2);
    expect(getConsecutiveFailures("w5-site-b")).toBe(0);
  });
});
