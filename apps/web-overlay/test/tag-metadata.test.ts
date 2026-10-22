import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 标签段的 metadata 归属守卫（2026-10-21 修复的回归锁）。
 *
 * 背景：369 个 `/tags/[slug]` 页曾共享写死的 `title: '标签详情'`
 * （方案验收表「重复 title 页面 2100 → 0」的目标对象）。修的过程中
 * 实测到 Next 16 的一个隐性语义：**根 layout 的 title.template 向孙级
 * 传递时，会被中间层的字符串 title 截断**——`/tags/layout.tsx` 的
 * `title: '标签总览'` 让全部孙级页面拿不到品牌后缀
 * （`/collections/[slug]`、`/marketplace/[slug]` 同病，实测佐证）。
 *
 * 因此锁定三条结构不变量：
 *   1. `/tags/layout.tsx` 不导出任何 metadata（模板必须贯通）；
 *   2. `/tags/page.tsx` 自己导出 metadata（标题不放中间层）；
 *   3. `/tags/[slug]/page.tsx` 导出 generateMetadata（每页独立
 *      title/description，数据源是 /api/tags/resolve 的 description）。
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** 与 list-degrade.test.ts 同款双候选解析：overlay 原位跑与 apps/web 镜像跑都能命中 */
function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return readFileSync(hit, "utf8");
}

describe("标签段 metadata 归属（Next title.template 截断修复的结构锁）", () => {
  it("/tags/layout.tsx 不导出 metadata——中间层不留 title，模板才能贯通到孙级", () => {
    const src = overlayFile("src/app/tags/layout.tsx");
    expect(src).not.toMatch(/export\s+const\s+metadata\b/);
    expect(src).not.toMatch(/export\s+(?:async\s+)?function\s+generateMetadata\b/);
  });

  it("/tags/page.tsx 在页面级导出 metadata（标题从 layout 迁来，仍带品牌后缀）", () => {
    const src = overlayFile("src/app/tags/page.tsx");
    // 静态 metadata 或 generateMetadata 都算页面级持有；关键是**不能**留在 layout
    expect(src).toMatch(/export\s+(?:const\s+metadata|async\s+function\s+generateMetadata)\b/);
    expect(src).toContain("title: '标签总览'");
  });

  it("/tags/[slug]/page.tsx 导出 generateMetadata（369 页不再共享同一标题）", () => {
    const src = overlayFile("src/app/tags/[slug]/page.tsx");
    expect(src).toMatch(/export\s+async\s+function\s+generateMetadata\b/);
  });

  it("/tags/[slug]/page.tsx 的标题与描述都来自运行时数据（resolve 通道）", () => {
    const src = overlayFile("src/app/tags/[slug]/page.tsx");
    // 标题是模板字符串表达式而非字面量（重构后先赋给 title 常量再返回）
    expect(src).toMatch(/title:\s*`「\$\{name\}」相关站点`|const\s+title\s*=\s*`「\$\{name\}」相关站点`/);
    // description 优先用标签自身描述，缺失才兜底
    expect(src).toMatch(/description:\s*[\s\S]*?tagRes\?\.tag\?\.description\s*\?\?/);
    expect(src).toContain("/api/tags/resolve?q=");
  });

  it("/tags/[slug]/layout.tsx 已删除：page 本身就是服务端组件，面包屑直接在 page 渲染", () => {
    const layout = resolve(HERE, "..", "src/app/tags/[slug]/layout.tsx");
    expect(existsSync(layout)).toBe(false);
    const src = overlayFile("src/app/tags/[slug]/page.tsx");
    expect(src).toContain("<Breadcrumbs");
    // 薄标签不输出 BreadcrumbList：JSON-LD 与 noindex 口径一致
    expect(src).toMatch(/jsonLd=\{indexable\}/);
    // 面包屑用标签规范名，而不是 slug
    expect(src).toContain("tagRes?.tag?.name ?? safeSlug");
  });

  it("hero 文案消费标签描述（消灭 369 页共用同一段通用正文）", () => {
    const src = overlayFile("src/components/tag-results-board.tsx");
    expect(src).toContain("tagDescription");
    expect(src).toMatch(/\{tagDescription\s*\?\?/);
  });

  it("B-8 薄标签：存活站点数 < MIN_SITES_FOR_TAG_INDEX 时 robots noindex,follow", () => {
    const src = overlayFile("src/app/tags/[slug]/page.tsx");
    // 阈值从 thresholds 导入（与 sitemap 的 ≥5 同源，不写死数字）
    expect(src).toContain("import { MIN_SITES_FOR_TAG_INDEX } from '@/lib/seo/thresholds'");
    // noindex,follow：页面保留、内链传权重，只是不进索引（方案 §4.1 定稿）
    expect(src).toContain("robots: { index: false, follow: true }");
    // 分层依据必须是存活站点数（search hits），不是标签的名义计数
    expect(src).toMatch(/sites\.length\s*>=\s*MIN_SITES_FOR_TAG_INDEX/);
  });

  it("0 命中的标签页走真 404（软 404 消灭），search 失败不误伤", () => {
    const src = overlayFile("src/app/tags/[slug]/page.tsx");
    expect(src).toContain("notFound()");
    // 双条件：search 成功（res !== null）且 0 命中才 404——中枢挂了要降级渲染
    expect(src).toMatch(/if\s*\(res\s*!==\s*null\s*&&\s*sites\.length\s*===\s*0\)\s*notFound\(\)/);
    // 共享 loader 供 metadata 与页面复用（fetch memoization 去重）
    expect(src).toContain("async function loadTagPage");
  });
});
