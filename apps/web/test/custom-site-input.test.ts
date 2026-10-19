/**
 * 自定义站点录入：URL 规范化 + 伪协议拦截 + id 生成（P1-2 组件拆分的纯函数层）。
 *
 * 背景：`navigation-content.tsx` 的「手工添加 / 拖拽收录 / 批量收录」三条路径
 * 各自内联了同一段 URL 处理与 id 生成；其中伪协议拦截是防存储型 XSS 的
 * 纵深防御（javascript:/data:/vbscript:/file:/blob:），值得独立测试兜底。
 *
 * 这里锁两件事：
 *   1. `normalizeCustomSiteHref` 的判定顺序：trim → 伪协议拦截 → 协议补全 →
 *      `isSafeSiteHref` 白名单（与组件拆分前的行为逐字对齐）；
 *   2. `createCustomSiteId` 的格式与可注入性（时间戳 + 至多 4 位随机后缀）。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  createCustomSiteId,
  normalizeCustomSiteHref,
} from "../src/lib/modular/custom-site-input";

const HERE = dirname(fileURLToPath(import.meta.url));

/** 定位并读取 overlay 里的文件；镜像副本（apps/web/test）不会被误当成源 */
function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(hit, "utf8");
}

function countOccurrences(src: string, needle: string): number {
  return src.split(needle).length - 1;
}

describe("normalizeCustomSiteHref：录入入口的统一 URL 处理", () => {
  it("http/https 原样放行（含路径与查询串）", () => {
    expect(normalizeCustomSiteHref("http://example.com")).toEqual({ ok: true, href: "http://example.com" });
    expect(normalizeCustomSiteHref("https://example.com/a/b?q=1&x=2")).toEqual({
      ok: true,
      href: "https://example.com/a/b?q=1&x=2",
    });
  });

  it("无协议自动补 https://（先去首尾空白再判定）", () => {
    expect(normalizeCustomSiteHref("example.com")).toEqual({ ok: true, href: "https://example.com" });
    expect(normalizeCustomSiteHref("  example.com/path  ")).toEqual({
      ok: true,
      href: "https://example.com/path",
    });
  });

  it("站内相对路径放行（不补协议）", () => {
    expect(normalizeCustomSiteHref("/import")).toEqual({ ok: true, href: "/import" });
  });

  it("协议大小写不敏感：已带协议时原样保留", () => {
    expect(normalizeCustomSiteHref("HTTPS://Example.COM")).toEqual({
      ok: true,
      href: "HTTPS://Example.COM",
    });
  });

  it("伪协议一个都不放行（javascript/data/vbscript/file/blob，含大小写与前导空白）", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "  javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "blob:https://example.com/abc",
    ]) {
      expect(normalizeCustomSiteHref(bad), bad).toEqual({ ok: false, reason: "unsafe-protocol" });
    }
  });

  it("带引号 / 尖括号 / 空白的地址视为不合法（白名单拦截）", () => {
    expect(normalizeCustomSiteHref('https://example.com/"x"')).toEqual({ ok: false, reason: "invalid" });
    expect(normalizeCustomSiteHref("https://example.com/<x>")).toEqual({ ok: false, reason: "invalid" });
    expect(normalizeCustomSiteHref("exa mple.com")).toEqual({ ok: false, reason: "invalid" });
  });

  it("空输入与纯空白返回 empty（组件层静默忽略，不弹错）", () => {
    expect(normalizeCustomSiteHref("")).toEqual({ ok: false, reason: "empty" });
    expect(normalizeCustomSiteHref("   ")).toEqual({ ok: false, reason: "empty" });
  });
});

describe("createCustomSiteId：格式与可注入性", () => {
  it("格式：custom_site_<时间戳>_<≤4 位 base36 后缀>", () => {
    expect(createCustomSiteId()).toMatch(/^custom_site_\d+_[0-9a-z]{0,4}$/);
  });

  it("注入 now / random 后结果确定（便于测试与排查）", () => {
    expect(createCustomSiteId(1000, () => 0.5)).toBe("custom_site_1000_i");
    expect(createCustomSiteId(1000, () => 0.75)).toBe("custom_site_1000_r");
  });

  it("同一毫秒内不同随机数不碰撞", () => {
    expect(createCustomSiteId(1000, () => 0.5)).not.toBe(createCustomSiteId(1000, () => 0.75));
  });
});

describe("源码守卫：录入路径真的用上了纯函数", () => {
  it("组件通过 normalizeCustomSiteHref 处理手工录入地址", () => {
    const src = overlaySource("src/components/navigation-content.tsx");
    expect(src).toContain("normalizeCustomSiteHref(customSiteHref)");
  });

  it("四处 id 生成全部收敛到 createCustomSiteId（不再内联随机后缀）", () => {
    const src = overlaySource("src/components/navigation-content.tsx");
    // P1-2：一级/二级卡片的拖拽收录在 navigation-category-section.tsx
    const section = overlaySource("src/components/navigation-category-section.tsx");
    expect(countOccurrences(src + section, "createCustomSiteId()")).toBeGreaterThanOrEqual(4);
    expect(src + section).not.toContain("custom_site_${Date.now()}");
  });
});
