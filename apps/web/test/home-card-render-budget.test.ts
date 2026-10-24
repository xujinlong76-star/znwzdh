/**
 * 首页卡片渲染预算守卫。
 *
 * 真实规模：当前库 1000+ 站点，首页默认视图一次性挂载全部卡片（约 12 万 DOM 节点）。
 * DOM 与内链必须保留（首页是全站权重最高的内链入口，删链接等于砍 SEO），
 * 但视口外的卡片不应参与首帧的样式计算与布局。
 *
 * 实测（Chromium，1280×900，dev server）：加 content-visibility 后
 * Layout 497→454ms、407ms 两次对照均下降，Style recalc 约减半。
 * 这里锁住样式与三类卡片的接线，避免后续重构把这条优化静默丢掉。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.includes("web-overlay") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(hit, "utf8");
}

describe("首页卡片：视口外延迟渲染", () => {
  it("样式声明了 content-visibility 与 intrinsic size", () => {
    const css = overlaySource("src/styles/globals.css");
    expect(css).toContain(".nav-card-deferred");
    expect(css).toContain("content-visibility: auto");
    expect(css).toContain("contain-intrinsic-size");
  });

  it("三类卡片变体（紧凑 / 富卡片 / 标准）都挂了延迟渲染类", () => {
    const src = overlaySource("src/components/navigation-card.tsx");
    const hits = src.match(/nav-card-deferred/g) ?? [];
    expect(hits.length).toBe(3);
  });
});
