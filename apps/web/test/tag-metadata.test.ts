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

  it("/tags/page.tsx 导出 metadata（标题从 layout 迁来，仍带品牌后缀）", () => {
    const src = overlayFile("src/app/tags/page.tsx");
    expect(src).toMatch(/export\s+const\s+metadata\b/);
    expect(src).toContain("title: '标签总览'");
  });

  it("/tags/[slug]/page.tsx 导出 generateMetadata（369 页不再共享同一标题）", () => {
    const src = overlayFile("src/app/tags/[slug]/page.tsx");
    expect(src).toMatch(/export\s+async\s+function\s+generateMetadata\b/);
  });

  it("/tags/[slug]/page.tsx 的标题与描述都来自运行时数据（resolve 通道）", () => {
    const src = overlayFile("src/app/tags/[slug]/page.tsx");
    // 标题是模板字符串表达式而非字面量
    expect(src).toMatch(/title:\s*`「\$\{name\}」相关站点`/);
    // description 优先用标签自身描述，缺失才兜底
    expect(src).toMatch(/description:\s*[\s\S]*?res\?\.tag\?\.description\s*\?\?/);
    expect(src).toContain("/api/tags/resolve?q=");
  });

  it("/tags/[slug]/layout.tsx 不导出 metadata（只挂面包屑）", () => {
    const src = overlayFile("src/app/tags/[slug]/layout.tsx");
    expect(src).not.toMatch(/export\s+const\s+metadata\b/);
    expect(src).not.toMatch(/export\s+(?:async\s+)?function\s+generateMetadata\b/);
    // 面包屑仍挂 layout（服务端组件，进 SSR HTML）
    expect(src).toContain("<Breadcrumbs");
  });

  it("hero 文案消费标签描述（消灭 369 页共用同一段通用正文）", () => {
    const src = overlayFile("src/components/tag-results-board.tsx");
    expect(src).toContain("tagDescription");
    expect(src).toMatch(/\{tagDescription\s*\?\?/);
  });
});
