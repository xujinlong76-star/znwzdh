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
 *   2. 部署后用 `scripts/html-budget.mjs` 量解压后 HTML，超预算即失败；
 *   3. 每组首屏渐进披露（默认 6 张 + 客户端展开），把首屏 HTML 压回预算内。
 *
 * 这里锁住这三条口径不被「顺手删掉」；预算阈值本身由命令行/环境变量给出，
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

  /**
   * 2026-10-26：预算脚本此前只能手动跑（`pnpm seo:html-budget`），
   * 没人记得跑就等于没有——体积会随「顺手加个字段」慢慢爬回 6MB+。
   * 现在挂进 `seo-audit-prod`（真实站点库 + workflow_dispatch 手动触发）。
   * 刻意**不挂 PR 门禁**：PR 里种子库只有几十个站点，量出来永远远低于阈值，
   * 那样的门禁只会制造「已覆盖」的错觉。这条测试守的是「挂上去了、且能真红」。
   */
  it("HTML 预算已挂到线上检查作业，且失败会让作业红（无 continue-on-error）", () => {
    const ci = readFileSync(resolve(ROOT, ".github/workflows/ci.yml"), "utf8");
    const jobStart = ci.indexOf("\n  seo-audit-prod:");
    expect(jobStart).toBeGreaterThan(-1);
    const passedAt = ci.indexOf("\n  ci-passed:", jobStart);
    const job = ci.slice(jobStart, passedAt > 0 ? passedAt : ci.length);

    const at = job.indexOf("scripts/html-budget.mjs");
    expect(at).toBeGreaterThan(-1);
    // 阈值必须显式写在 CI 里：脚本默认值变化不该悄悄改变门禁语义
    expect(job).toContain("--max-kb=");
    // 取这一步的完整 YAML 片段（上一个 "- " 到下一个 "- " 之间）
    const stepStart = job.lastIndexOf("\n      - ", at);
    const nextStep = job.indexOf("\n      - ", at);
    const step = job.slice(stepStart, nextStep > 0 ? nextStep : job.length);
    expect(step).not.toContain("continue-on-error");
  });
});
