import { describe, expect, it, vi } from "vitest";
import {
  isBotBlockStatus,
  isFailingHealthState,
  siteHealthBadge,
  siteHealthState,
  siteHealthTitle,
} from "../src/lib/site-health";
import { getSiteNotice } from "../src/lib/site-notices";

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

  it("第 7 行：无状态码返检测异常", () => {
    expect(
      siteHealthState({ ok: false, httpStatus: null, latencyMs: null, lastCheckedAt: CHECKED }),
    ).toEqual({ state: "anomaly", tone: "warn", label: "近期检测异常", latencyMs: null });
    expect(
      siteHealthState({ ok: false, lastCheckedAt: CHECKED }),
    ).toMatchObject({ state: "anomaly" });
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

describe("可访问档延迟分档（2026-11-25 UI 评审 P1-4）", () => {
  it("≤1s 可访问 / 1–3s 响应较慢 / >3s 响应缓慢；state/tone 不变，慢站不进失效侧", () => {
    const base = { ok: true, httpStatus: 200, lastCheckedAt: CHECKED };
    expect(siteHealthState({ ...base, latencyMs: 1000 })).toMatchObject({
      state: "accessible",
      tone: "ok",
      label: "可访问",
    });
    expect(siteHealthState({ ...base, latencyMs: 1001 })).toMatchObject({
      state: "accessible",
      tone: "ok",
      label: "响应较慢",
    });
    expect(siteHealthState({ ...base, latencyMs: 3000 })).toMatchObject({
      state: "accessible",
      tone: "ok",
      label: "响应较慢",
    });
    const sluggish = siteHealthState({ ...base, latencyMs: 7035 });
    expect(sluggish).toMatchObject({ state: "accessible", tone: "ok", label: "响应缓慢", latencyMs: 7035 });
    // 慢 ≠ 失效：「只看失效」过滤口径不受延迟分档影响（tone 仍是 ok）
    expect(isFailingHealthState(sluggish)).toBe(false);
    expect(isFailingHealthState(siteHealthState({ ...base, latencyMs: 1500 }))).toBe(false);
  });

  it("延迟无值仍报可访问（不臆测快慢）", () => {
    expect(
      siteHealthState({ ok: true, httpStatus: 200, latencyMs: null, lastCheckedAt: CHECKED }),
    ).toMatchObject({ label: "可访问" });
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

  it("无状态码时写近期检测异常 · 巡检于 <YYYY-MM-DD>；未巡检返 null", () => {
    expect(siteHealthTitle({ ok: false, httpStatus: null, lastCheckedAt: CHECKED })).toBe(
      "近期检测异常 · 巡检于 2026-11-19",
    );
    expect(siteHealthTitle(null)).toBeNull();
    expect(siteHealthTitle({ lastCheckedAt: null })).toBeNull();
  });

  it("维护档写维护中 · 巡检于 <YYYY-MM-DD>；未巡检只写维护中", () => {
    const notice = { label: "维护中" as const, untilISO: "2999-01-01T00:00:00+08:00" };
    const health = { ok: false, httpStatus: null, lastCheckedAt: CHECKED };
    const state = siteHealthState(health, notice);
    expect(siteHealthTitle(health, state)).toBe("维护中 · 巡检于 2026-11-19");
    // 未巡检仍显示维护中（notice 独立生效），title 无巡检日期可写
    expect(siteHealthTitle(null, siteHealthState(null, notice))).toBe("维护中");
    expect(siteHealthTitle({ lastCheckedAt: null }, siteHealthState({ lastCheckedAt: null }, notice))).toBe(
      "维护中",
    );
    // 非维护 state 不影响原有 title 口径
    expect(
      siteHealthTitle(health, siteHealthState(health)),
    ).toBe("近期检测异常 · 巡检于 2026-11-19");
  });
});

describe("维护中人工标注（2026-11-27 Gutenberg 临时标注，见 site-notices.ts）", () => {
  const NOTICE = { label: "维护中" as const, untilISO: "2999-01-01T00:00:00+08:00" };
  // Gutenberg live 健康对象形态：巡检被 SSRF guard 拦在站外，无状态码
  const GUTENBERG_HEALTH = { ok: false, httpStatus: null, latencyMs: 1, lastCheckedAt: CHECKED };

  it("维护档优先于检测异常 / 已失效 / 疑似反爬", () => {
    expect(siteHealthState(GUTENBERG_HEALTH, NOTICE)).toMatchObject({
      state: "maintenance",
      tone: "warn",
      label: "维护中",
    });
    expect(
      siteHealthState(
        { ok: false, httpStatus: 404, lastCheckedAt: CHECKED, consecutiveFailures: 2 },
        NOTICE,
      ),
    ).toMatchObject({ state: "maintenance", label: "维护中" });
    expect(
      siteHealthState({ ok: false, httpStatus: 403, lastCheckedAt: CHECKED }, NOTICE),
    ).toMatchObject({ state: "maintenance", label: "维护中" });
    expect(
      siteHealthState({ ok: true, httpStatus: 200, lastCheckedAt: CHECKED }, NOTICE),
    ).toMatchObject({ state: "maintenance", label: "维护中" });
  });

  it("notice 有效但 health 为空 / 未巡检时仍显示维护中", () => {
    expect(siteHealthState(null, NOTICE)).toMatchObject({ state: "maintenance", label: "维护中" });
    expect(siteHealthState(undefined, NOTICE)).toMatchObject({ state: "maintenance", label: "维护中" });
    expect(siteHealthState({ lastCheckedAt: null }, NOTICE)).toMatchObject({
      state: "maintenance",
      label: "维护中",
    });
  });

  it("无 notice 时回落到原分级：Gutenberg 对象仍是近期检测异常", () => {
    expect(siteHealthState(GUTENBERG_HEALTH)).toMatchObject({
      state: "anomaly",
      tone: "warn",
      label: "近期检测异常",
    });
    expect(siteHealthState(GUTENBERG_HEALTH, undefined)).toMatchObject({ state: "anomaly" });
  });

  it("维护中进「只看失效」侧；薄壳透传 notice", () => {
    expect(isFailingHealthState(siteHealthState(GUTENBERG_HEALTH, NOTICE))).toBe(true);
    expect(siteHealthBadge(GUTENBERG_HEALTH, NOTICE)).toEqual({
      tone: "warn",
      label: "维护中",
      latencyMs: 1,
    });
    expect(siteHealthBadge(GUTENBERG_HEALTH)).toEqual({
      tone: "warn",
      label: "近期检测异常",
      latencyMs: 1,
    });
  });

  it("getSiteNotice：Gutenberg 条目有效期内可取，未知 hubId 取不到", () => {
    const notice = getSiteNotice("nav-508848075e00");
    expect(notice).toMatchObject({ label: "维护中", untilISO: "2026-11-29T02:26:00+08:00" });
    expect(getSiteNotice("nav-000000000000")).toBeUndefined();
    expect(getSiteNotice(undefined)).toBeUndefined();
  });

  it("getSiteNotice：过期后返回 undefined（自动回落，无需二次上线摘除）", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-29T02:26:01+08:00"));
      expect(getSiteNotice("nav-508848075e00")).toBeUndefined();
      vi.setSystemTime(new Date("2026-11-27T02:26:00+08:00"));
      expect(getSiteNotice("nav-508848075e00")).toMatchObject({ label: "维护中" });
    } finally {
      vi.useRealTimers();
    }
  });
});
