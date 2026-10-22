import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 首页载荷守卫（2026-10-22）。
 *
 * 首页把全量分类与卡片一次性 SSR 进 HTML：1013 站时 dev HTML 实测 7.5MB。
 * 完整 RSC 拆分需要产品确认（改变首屏可见分类），先落两件低风险的事：
 *   1. 离屏分类 `content-visibility: auto`，降低首屏主线程布局/绘制成本；
 *   2. 部署后用 `scripts/html-budget.mjs` 量解压后 HTML，超预算即失败。
 *
 * 这里锁住这两条口径不被「顺手删掉」；预算阈值本身由命令行/环境变量给出，
 * 不在测试里写死（不同部署内容量不同）。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..");

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(hit, "utf8");
}

describe("首页载荷", () => {
  it("分类区块使用 content-visibility: auto（离屏不布局），并有 intrinsic size 占位", () => {
    const section = overlayFile("src/components/navigation-category-section.tsx");
    expect(section).toContain("cv-auto-section");
    const css = overlayFile("src/styles/globals.css");
    expect(css).toContain("content-visibility: auto");
    expect(css).toContain("contain-intrinsic-size: auto");
  });

  it("HTML 预算脚本存在且已挂 npm script（可对生产域名直接跑）", () => {
    const script = resolve(ROOT, "scripts/html-budget.mjs");
    expect(existsSync(script)).toBe(true);
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["seo:html-budget"]).toContain("scripts/html-budget.mjs");
  });

  it("预算脚本不会在缺少 URL 时静默通过", () => {
    const src = readFileSync(resolve(ROOT, "scripts/html-budget.mjs"), "utf8");
    expect(src).toContain("process.exit(1)");
    expect(src).toContain("--max-kb");
    expect(src).toContain("AbortSignal.timeout");
  });
});
