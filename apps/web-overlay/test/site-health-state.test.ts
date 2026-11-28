import { describe, expect, it } from "vitest";
import {
  isBotBlockStatus,
  isFailingHealthState,
  siteHealthBadge,
  siteHealthState,
  siteHealthTitle,
} from "../src/lib/site-health";

/**
 * 03-livelink-mapping §3 分级全表（§9 验收第 4 条）：§3.2 的 8 行各至少一个用例。
 *
 * 判定顺序写死（§3.1）：未巡检 → 已失效（硬条件）→ 疑似反爬 →
 * 疑似停放 / 疑似软 404 / 疑似内容过薄 → 检测异常 → 可访问。
 * 无计数时按单次失败计，永不直升已失效（B 段计数持久化未定前的保守口径）。
 */

const CHECKED = Date.UTC(2026, 10, 19, 8, 0, 0);

describe("siteHealthState 分级全表（§3.2 八行）", () => {
  it("第 1 行：未巡检返 null（不渲染、不占位）", () => {
    expect(siteHealthState(null)).toBeNull();
    expect(siteHealthState(undefined)).toBeNull();
    expect(siteHealthState({})).toBeNull();
    expect(siteHealthState({ lastCheckedAt: null })).toBeNull();
    expect(siteHealthState({ lastCheckedAt: 0 })).toBeNull();
    expect(siteHealthState({ ok: true, httpStatus: 200, lastCheckedAt: null })).toBeNull();
  });

  it("第 2 行：ok 返可访问", () => {
    expect(
      siteHealthState({ ok: true, httpStatus: 200, latencyMs: 123, lastCheckedAt: CHECKED }),
    ).toEqual({ state: "accessible", tone: "ok", label: "可访问", latencyMs: 123 });
    expect(
      siteHealthState({ ok: true, httpStatus: 200, lastCheckedAt: CHECKED, auditStatus: "HEALTHY" }),
    ).toMatchObject({ state: "accessible", label: "可访问" });
  });

  it("第 3 行：401/403/429 返疑似反爬，403 不返可访问（无论 ok 值）", () => {
    for (const code of [401, 403, 429]) {
      expect(
        siteHealthState({ ok: false, httpStatus: code, latencyMs: null, lastCheckedAt: CHECKED }),
      ).toEqual({
        state: "suspect-bot",
        tone: "warn",
        label: `疑似反爬 · HTTP ${code}`,
        latencyMs: null,
      });
    }
    // ok === true 也不算 UP：反爬判定优先于可访问
    expect(
      siteHealthState({ ok: true, httpStatus: 403, lastCheckedAt: CHECKED }),
    ).toMatchObject({ state: "suspect-bot", label: "疑似反爬 · HTTP 403" });
    expect(isBotBlockStatus(403)).toBe(true);
  });

  it("第 4 行：SUSPICIOUS_PARKED 单次命中只落疑似停放（置信度 0.95 也不直升）", () => {
    expect(
      siteHealthState({
        ok: true,
        httpStatus: 200,
        lastCheckedAt: CHECKED,
        auditStatus: "SUSPICIOUS_PARKED",
        auditConfidence: 0.95,
        consecutiveFailures: 1,
      }),
    ).toEqual({ state: "suspect-parked", tone: "warn", label: "疑似停放", latencyMs: null });
  });

  it("第 5 行：SOFT_404 置信度 0.95 单次返疑似失效，不返已失效", () => {
    expect(
      siteHealthState({
        ok: true,
        httpStatus: 200,
        lastCheckedAt: CHECKED,
        auditStatus: "SOFT_404",
        auditConfidence: 0.95,
        consecutiveFailures: 1,
      }),
    ).toEqual({ state: "suspect-soft404", tone: "warn", label: "疑似失效 · 看存档", latencyMs: null });
  });

  it("第 6 行：THIN_CONTENT 截断样本置信度 0.4 不升级", () => {
    expect(
      siteHealthState({
        ok: true,
        httpStatus: 200,
        lastCheckedAt: CHECKED,
        auditStatus: "THIN_CONTENT",
        auditConfidence: 0.4,
        consecutiveFailures: 1,
      }),
    ).toEqual({ state: "suspect-thin", tone: "warn", label: "疑似内容过薄", latencyMs: null });
    // 即使连续失败 >= 2，内容过薄也不升已失效（升级只认 SOFT_404 / SUSPICIOUS_PARKED）
    expect(
      siteHealthState({
        ok: false,
        httpStatus: 200,
        lastCheckedAt: CHECKED,
        auditStatus: "THIN_CONTENT",
        auditConfidence: 0.95,
        consecutiveFailures: 2,
      }),
    ).toMatchObject({ state: "suspect-thin" });
  });

  it("第 7 行：无状态码返待核验（不带毫秒数）", () => {
    expect(
      siteHealthState({ ok: false, httpStatus: null, latencyMs: null, lastCheckedAt: CHECKED }),
    ).toEqual({ state: "anomaly", tone: "warn", label: "待核验", latencyMs: null });
    expect(
      siteHealthState({ ok: false, lastCheckedAt: CHECKED }),
    ).toMatchObject({ state: "anomaly" });
    // DNS 误判快照形：无状态码 + 0ms（探测自身瞬间失败的耗时，不是站点延迟）——
    // 同样只说待核验，且毫秒数置空，卡片上不再出现自相矛盾的「待核验 (0ms)」。
    expect(
      siteHealthState({ ok: false, httpStatus: null, latencyMs: 0, lastCheckedAt: CHECKED }),
    ).toEqual({ state: "anomaly", tone: "warn", label: "待核验", latencyMs: null });
  });

  it("第 8 行：连续失败 1 次 + 404 返疑似，连续失败 2 次 + 404 返已失效", () => {
    expect(
      siteHealthState({ ok: false, httpStatus: 404, lastCheckedAt: CHECKED, consecutiveFailures: 1 }),
    ).toEqual({ state: "suspect-not-found", tone: "warn", label: "未找到 (404)", latencyMs: null });
    // 无计数时按单次失败计：同样只到疑似
    expect(
      siteHealthState({ ok: false, httpStatus: 404, lastCheckedAt: CHECKED }),
    ).toMatchObject({ state: "suspect-not-found", label: "未找到 (404)" });
    expect(
      siteHealthState({ ok: false, httpStatus: 404, lastCheckedAt: CHECKED, consecutiveFailures: 2 }),
    ).toEqual({ state: "dead", tone: "error", label: "已失效 · 看存档", latencyMs: null });
    expect(
      siteHealthState({ ok: false, httpStatus: 500, lastCheckedAt: CHECKED, consecutiveFailures: 1 }),
    ).toEqual({
      state: "suspect-server-error",
      tone: "warn",
      label: "服务端错误 (500)",
      latencyMs: null,
    });
    expect(
      siteHealthState({ ok: false, httpStatus: 503, lastCheckedAt: CHECKED, consecutiveFailures: 2 }),
    ).toMatchObject({ state: "dead", label: "已失效 · 看存档" });
  });

  it("第 8 行（审计分支）：SOFT_404 / SUSPICIOUS_PARKED 置信度 >= 0.9 且连续两次命中才升已失效", () => {
    expect(
      siteHealthState({
        ok: true,
        httpStatus: 200,
        lastCheckedAt: CHECKED,
        auditStatus: "SOFT_404",
        auditConfidence: 0.95,
        consecutiveFailures: 2,
      }),
    ).toMatchObject({ state: "dead", tone: "error" });
    expect(
      siteHealthState({
        ok: true,
        httpStatus: 200,
        lastCheckedAt: CHECKED,
        auditStatus: "SUSPICIOUS_PARKED",
        auditConfidence: 0.95,
        consecutiveFailures: 2,
      }),
    ).toMatchObject({ state: "dead", tone: "error" });
    // 置信度不足 0.9 时连续两次也不升
    expect(
      siteHealthState({
        ok: true,
        httpStatus: 200,
        lastCheckedAt: CHECKED,
        auditStatus: "SOFT_404",
        auditConfidence: 0.5,
        consecutiveFailures: 2,
      }),
    ).toMatchObject({ state: "suspect-soft404" });
  });

  it("补充：HEALTHY 与 ok === false 同时出现时以连通性为准，不报可访问", () => {
    expect(
      siteHealthState({
        ok: false,
        httpStatus: 403,
        lastCheckedAt: CHECKED,
        auditStatus: "HEALTHY",
      }),
    ).toMatchObject({ state: "suspect-bot" });
    expect(
      siteHealthState({ ok: false, httpStatus: null, lastCheckedAt: CHECKED, auditStatus: "HEALTHY" }),
    ).toMatchObject({ state: "anomaly" });
  });

  it("补充：401/403/429 与无状态码永远不进已失效档", () => {
    for (const code of [401, 403, 429]) {
      expect(
        siteHealthState({ ok: false, httpStatus: code, lastCheckedAt: CHECKED, consecutiveFailures: 5 }),
      ).toMatchObject({ state: "suspect-bot" });
    }
    expect(
      siteHealthState({ ok: false, httpStatus: null, lastCheckedAt: CHECKED, consecutiveFailures: 5 }),
    ).toMatchObject({ state: "anomaly" });
  });
});

describe("siteHealthBadge 是 siteHealthState 的薄壳", () => {
  it("未巡检返 null，可访问与疑似档的 tone/label/latency 与 state 一致", () => {
    expect(siteHealthBadge(null)).toBeNull();
    expect(siteHealthBadge({ ok: true, httpStatus: 200, latencyMs: 87, lastCheckedAt: CHECKED })).toEqual({
      tone: "ok",
      label: "可访问",
      latencyMs: 87,
    });
    expect(
      siteHealthBadge({ ok: false, httpStatus: 503, latencyMs: null, lastCheckedAt: CHECKED }),
    ).toEqual({ tone: "warn", label: "服务端错误 (503)", latencyMs: null });
    expect(
      siteHealthBadge({ ok: false, httpStatus: 404, lastCheckedAt: CHECKED, consecutiveFailures: 2 }),
    ).toEqual({ tone: "error", label: "已失效 · 看存档", latencyMs: null });
  });
});

describe("isFailingHealthState（只看失效开关的过滤口径）", () => {
  it("可访问不算失效，未巡检不算失效，其余分级都算失效侧", () => {
    expect(isFailingHealthState(null)).toBe(false);
    expect(isFailingHealthState(undefined)).toBe(false);
    expect(
      isFailingHealthState(siteHealthState({ ok: true, httpStatus: 200, lastCheckedAt: CHECKED })),
    ).toBe(false);
    expect(
      isFailingHealthState(siteHealthState({ ok: false, httpStatus: 403, lastCheckedAt: CHECKED })),
    ).toBe(true);
    expect(
      isFailingHealthState(siteHealthState({ ok: false, httpStatus: null, lastCheckedAt: CHECKED })),
    ).toBe(true);
    expect(
      isFailingHealthState(
        siteHealthState({ ok: false, httpStatus: 404, lastCheckedAt: CHECKED, consecutiveFailures: 2 }),
      ),
    ).toBe(true);
  });
});

describe("siteHealthTitle（§7 悬停格式）", () => {
  it("HTTP <code> · <latency>ms · 巡检于 <YYYY-MM-DD>；延迟无值时不写延迟段", () => {
    expect(
      siteHealthTitle({ ok: true, httpStatus: 200, latencyMs: 123, lastCheckedAt: CHECKED }),
    ).toBe("HTTP 200 · 123ms · 巡检于 2026-11-19");
    expect(siteHealthTitle({ ok: true, httpStatus: 200, lastCheckedAt: CHECKED })).toBe(
      "HTTP 200 · 巡检于 2026-11-19",
    );
  });

  it("无状态码时写待核验 · 巡检于 <YYYY-MM-DD>；未巡检返 null", () => {
    expect(siteHealthTitle({ ok: false, httpStatus: null, lastCheckedAt: CHECKED })).toBe(
      "待核验 · 巡检于 2026-11-19",
    );
    expect(siteHealthTitle(null)).toBeNull();
    expect(siteHealthTitle({ lastCheckedAt: null })).toBeNull();
  });
});
