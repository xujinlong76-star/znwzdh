import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  healthDotClass,
  healthPillClass,
  healthVisualTone,
  isBotBlockStatus,
  isFailingHealthState,
  siteHealthBadge,
  siteHealthState,
} from "../src/lib/site-health";

/**
 * 站点巡检徽标守卫（2026-10-22）。
 *
 * 真实缺陷：health 对象只要存在就渲染「SLA 正常 / 响应缓慢」，但库里
 * 86% 的站点从未巡检（lastCheckedAt 为空），会被误标成「响应缓慢」；
 * 「SLA」是内部术语，对访客没有意义。
 *
 * 口径：只有完成过巡检才展示；文案只陈述可验证事实（HTTP 状态码 /
 * 「近期不可达」），不臆测原因。
 */

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(hit, "utf8");
}

describe("站点巡检徽标", () => {
  it("没有 health 或从未巡检时不渲染", () => {
    expect(siteHealthBadge(null)).toBeNull();
    expect(siteHealthBadge(undefined)).toBeNull();
    expect(siteHealthBadge({ ok: true, httpStatus: null, latencyMs: null, lastCheckedAt: null })).toBeNull();
  });

  it("巡检成功显示「可访问」，并保留延迟", () => {
    expect(
      siteHealthBadge({ ok: true, httpStatus: 200, latencyMs: 87, lastCheckedAt: 1792581464978 }),
    ).toEqual({ tone: "ok", label: "可访问", latencyMs: 87 });
  });

  it("巡检失败按分级写种类词（03 §3.2）：单次 5xx 是疑似服务端错误，无状态码只说检测异常", () => {
    expect(
      siteHealthBadge({ ok: false, httpStatus: 503, latencyMs: null, lastCheckedAt: 1792581464978 }),
    ).toEqual({ tone: "warn", label: "服务端错误 (503)", latencyMs: null });
    expect(
      siteHealthBadge({ ok: false, httpStatus: null, latencyMs: 10004, lastCheckedAt: 1792581464978 }),
    ).toEqual({ tone: "warn", label: "近期检测异常", latencyMs: 10004 });
  });

  it("详情页与速览弹窗共用该口径（03 §3.1：直接调 siteHealthState），不再出现 SLA 文案", () => {
    for (const rel of [
      "src/components/site-detail-view.tsx",
      "src/components/site-peek-dialog.tsx",
    ]) {
      const src = overlayFile(rel);
      expect(src).toContain("siteHealthState(");
      expect(src).not.toContain("SLA 正常");
      expect(src).not.toContain("SLA:");
    }
  });

  it("401/403/429 是「拒绝自动访问」而不是下线：详情页要解释，别只甩状态码", () => {
    // 15 个 broken 站点全部是 401/403 反爬（ChatGPT / npm / Stack Overflow…）
    expect(isBotBlockStatus(401)).toBe(true);
    expect(isBotBlockStatus(403)).toBe(true);
    expect(isBotBlockStatus(429)).toBe(true);
    expect(isBotBlockStatus(500)).toBe(false);
    expect(isBotBlockStatus(404)).toBe(false);
    expect(isBotBlockStatus(null)).toBe(false);
    expect(isBotBlockStatus(undefined)).toBe(false);

    const src = overlayFile("src/components/site-detail-view.tsx");
    expect(src).toContain("isBotBlockStatus(site.health?.httpStatus)");
    expect(src).toContain("不代表站点无法打开");
  });
});

describe("徽标配色 Token 化（2026-11-25 UI 评审 P1-4）", () => {
  const CHECKED = 1792581464978;
  const fast = siteHealthState({ ok: true, httpStatus: 200, latencyMs: 87, lastCheckedAt: CHECKED });
  const slow = siteHealthState({ ok: true, httpStatus: 200, latencyMs: 7035, lastCheckedAt: CHECKED });
  const warn = siteHealthState({ ok: false, httpStatus: null, latencyMs: null, lastCheckedAt: CHECKED });
  const dead = siteHealthState({
    ok: false,
    httpStatus: 404,
    latencyMs: null,
    lastCheckedAt: CHECKED,
    consecutiveFailures: 2,
  });

  it("点色三档全走 Token：快站绿、慢站琥珀、失效红；慢站不亮绿灯", () => {
    expect(healthVisualTone(fast)).toBe("ok");
    expect(healthDotClass(fast)).toBe("bg-success");
    expect(healthVisualTone(slow)).toBe("warn");
    expect(healthDotClass(slow)).toBe("bg-pinned");
    expect(healthDotClass(warn)).toBe("bg-pinned");
    expect(healthVisualTone(dead)).toBe("error");
    expect(healthDotClass(dead)).toBe("bg-destructive");
    // 慢站转琥珀警示档，但语义 tone 保持 ok（慢 ≠ 失效）
    expect(slow?.tone).toBe("ok");
    expect(isFailingHealthState(slow)).toBe(false);
  });

  it("胶囊文字档走 Token，不再出现 raw palette 类", () => {
    expect(healthPillClass(fast)).toContain("text-success-foreground");
    expect(healthPillClass(slow)).toContain("text-pinned-foreground");
    expect(healthPillClass(dead)).toContain("text-destructive-text");
    // 危险文字配方钉死 text-destructive-text + bg-destructive/15（/10 对比度不足，见 a11y-token-contrast）
    expect(healthPillClass(dead)).toContain("bg-destructive/15");
    for (const s of [fast, slow, warn, dead]) {
      expect(healthPillClass(s)).not.toMatch(/emerald|amber|rose-/);
      expect(healthDotClass(s)).not.toMatch(/emerald|amber|rose-/);
    }
  });

  it("三处徽章渲染点共用 healthDotClass：不再有 raw 点色、无条件脉动与内联延迟", () => {
    for (const rel of [
      "src/components/navigation-card.tsx",
      "src/components/site-detail-view.tsx",
      "src/components/site-peek-dialog.tsx",
    ]) {
      const src = overlayFile(rel);
      expect(src).toContain("healthDotClass(");
      // 旧点色三连（raw palette + 静态数据脉动）必须清零
      expect(src).not.toContain("bg-emerald-500 animate-pulse");
      // 延迟数字不进徽标正文（完整事实留在 title）
      expect(src).not.toMatch(/latencyMs\}ms/);
    }
  });
});
