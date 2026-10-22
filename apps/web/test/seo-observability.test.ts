import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 度量接线守卫（2026-10-22）。
 *
 * 这些项目无法由代码「完成」——GSC/Bing/百度验证、sitemap 提交、IndexNow
 * 推送都需要生产账号与部署环境。但**代码侧的接线**必须已经就位，否则拿到
 * 凭据也无处安放。这里锁住：
 *   1. 首页按非空环境变量输出三家验证 meta，空值不输出空标签；
 *   2. RUM 由 NEXT_PUBLIC_RUM=1 显式开启，并挂在根布局；
 *   3. IndexNow 脚本校验 key 与 key 文件位置，且 npm script 可达；
 *   4. .env.example 记录了全部变量（防止文档漂移）。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..");

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(hit, "utf8");
}

describe("搜索引擎验证与度量接线", () => {
  it("首页读取三家验证变量，并映射到正确的 meta 名", () => {
    const src = overlayFile("src/app/page.tsx");
    expect(src).toContain("GOOGLE_SITE_VERIFICATION");
    expect(src).toContain("BING_SITE_VERIFICATION");
    expect(src).toContain("BAIDU_SITE_VERIFICATION");
    expect(src).toContain('other["msvalidate.01"]');
    expect(src).toContain('other["baidu-site-verification"]');
    // 空字符串必须走「不输出」分支
    expect(src).toContain("?.trim()");
  });

  it("RUM 默认关闭、仅在 NEXT_PUBLIC_RUM=1 时采集，且已挂载根布局", () => {
    const reporter = overlayFile("src/components/web-vitals-reporter.tsx");
    expect(reporter).toContain("process.env.NEXT_PUBLIC_RUM === '1'");
    const layout = overlayFile("src/app/layout.tsx");
    expect(layout).toContain("<WebVitalsReporter />");
  });

  it("IndexNow 脚本校验 key 格式与 key 文件位置，并有 npm script", () => {
    const script = resolve(ROOT, "scripts/indexnow.mjs");
    expect(existsSync(script)).toBe(true);
    const src = readFileSync(script, "utf8");
    expect(src).toContain("INDEXNOW_KEY");
    expect(src).toContain("/^[A-Za-z0-9-]{8,128}$/");
    expect(src).toContain("keyLocation");
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["seo:indexnow"]).toContain("scripts/indexnow.mjs");
  });

  it(".env.example 记录验证 / IndexNow / RUM / 站点地址变量", () => {
    const env = readFileSync(resolve(ROOT, ".env.example"), "utf8");
    for (const key of [
      "NAVHUB_SITE_URL",
      "GOOGLE_SITE_VERIFICATION",
      "BING_SITE_VERIFICATION",
      "BAIDU_SITE_VERIFICATION",
      "INDEXNOW_KEY",
      "NEXT_PUBLIC_RUM",
    ]) {
      expect(env, ".env.example 缺少 " + key).toContain(key);
    }
  });
});
