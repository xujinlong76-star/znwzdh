import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { siteHealthBadge } from "../src/lib/site-health";

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

  it("巡检失败优先显示真实 HTTP 状态码，没有状态码只说检测异常", () => {
    expect(
      siteHealthBadge({ ok: false, httpStatus: 503, latencyMs: null, lastCheckedAt: 1792581464978 }),
    ).toEqual({ tone: "warn", label: "HTTP 503", latencyMs: null });
    expect(
      siteHealthBadge({ ok: false, httpStatus: null, latencyMs: 10004, lastCheckedAt: 1792581464978 }),
    ).toEqual({ tone: "warn", label: "近期检测异常", latencyMs: 10004 });
  });

  it("详情页与速览弹窗共用该口径，不再出现 SLA 文案", () => {
    for (const rel of [
      "src/components/site-detail-view.tsx",
      "src/components/site-peek-dialog.tsx",
    ]) {
      const src = overlayFile(rel);
      expect(src).toContain("siteHealthBadge(");
      expect(src).not.toContain("SLA 正常");
      expect(src).not.toContain("SLA:");
    }
  });
});
