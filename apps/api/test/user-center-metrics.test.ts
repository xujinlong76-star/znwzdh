import { describe, expect, it } from "vitest";
import { getUserCenterMetrics, recordUserCenterMetric } from "../src/user-center-metrics.ts";

/**
 * 用户中心领域指标（N10）。
 *
 * 只锁两件事：
 *  1. 计数真的在涨（接口接上了，不是写完没人调用）；
 *  2. 未知事件名被静默忽略——指标收集绝不能把业务请求搞失败。
 */
describe("用户中心领域指标", () => {
  it("记录各类事件并可读回", () => {
    recordUserCenterMetric("favoritesSync.success", 2);
    recordUserCenterMetric("favoritesSync.failure");
    recordUserCenterMetric("favoritesSync.failureRetryable");
    recordUserCenterMetric("favoritesSync.opsSubmitted", 7);
    recordUserCenterMetric("identityMerge.success");
    recordUserCenterMetric("identityMerge.alreadyMerged");
    recordUserCenterMetric("dataSovereignty.exportJson");
    recordUserCenterMetric("dataSovereignty.exportBookmarks");
    recordUserCenterMetric("dataSovereignty.deleteAccount");
    recordUserCenterMetric("dataSovereignty.activityRead");

    const m = getUserCenterMetrics();
    expect(m.favoritesSync.success).toBe(2);
    expect(m.favoritesSync.failure).toBe(1);
    expect(m.favoritesSync.failureRetryable).toBe(1);
    expect(m.favoritesSync.opsSubmitted).toBe(7);
    expect(m.identityMerge.success).toBe(1);
    expect(m.identityMerge.alreadyMerged).toBe(1);
    expect(m.dataSovereignty).toEqual({
      exportJson: 1,
      exportBookmarks: 1,
      deleteAccount: 1,
      activityRead: 1,
    });
    expect(m.startedAt).toBeGreaterThan(0);
  });

  it("未知事件名被忽略，不抛错", () => {
    expect(() => recordUserCenterMetric("not.a.real.event")).not.toThrow();
    const before = JSON.stringify(getUserCenterMetrics());
    recordUserCenterMetric("not.a.real.event");
    expect(JSON.stringify(getUserCenterMetrics())).toBe(before);
  });

  it("返回值是副本：调用方改了不影响内部状态", () => {
    recordUserCenterMetric("favoritesSync.success");
    const m = getUserCenterMetrics();
    m.favoritesSync.success = 999;
    expect(getUserCenterMetrics().favoritesSync.success).toBeLessThan(999);
  });
});
