import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { FilterBar } from "../src/components/filter-bar";

/**
 * 筛选条原语守卫（2026-11-25 UI 评审 P0-1 阶段 B）。
 *
 * /sites、/hot、/category 三处此前各写一套「壳 + 搜索框 + 清空钮 + 计数」，
 * 圆角/内边距/输入高度/触控目标各不相同。本守卫钉住：
 *   1) 三处都走 FilterBar，不再自带筛选条壳与清空钮（配方单源）；
 *   2) 壳/输入/清空钮配方只在 filter-bar.tsx 定义一次；
 *   3) 调用点保留 placeholder / aria-label 的 JSX 字面量
 *      （local-search-record-bundle-guard 按字面量扫源码，FilterBar 刻意用扁平 props）；
 *   4) 渲染契约：属性透传、有值才出清空钮、meta→actions→chips 读序。
 */

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(hit, "utf8");
}

const CONSUMERS = [
  "src/components/sites-directory-filterable-grid.tsx",
  "src/components/category-index-filterable-list.tsx",
  "src/app/hot/hot-view.tsx",
];

describe("FilterBar 结构收编", () => {
  it.each(CONSUMERS)("%s 走 FilterBar，不再自带筛选条壳/清空钮", (rel) => {
    const src = overlayFile(rel);
    expect(src).toContain("from '@/components/filter-bar'");
    expect(src).toContain("<FilterBar");
    // 壳配方不再散落
    expect(src, `${rel} 不应再自带筛选条壳`).not.toContain("bg-card/60 backdrop-blur-xs shadow-2xs");
    // 清空钮收进原语
    expect(src, `${rel} 不应再自绘清空钮`).not.toContain("清空筛选输入");
  });

  it("壳/输入/清空钮配方只在 filter-bar.tsx 定义一次", () => {
    const bar = overlayFile("src/components/filter-bar.tsx");
    expect(bar).toContain("rounded-xl border border-border/70 bg-card/60 backdrop-blur-xs shadow-2xs");
    // 44px 触控档（touch）+ 桌面 h-9；移动端人因属性与全站搜索框同口径
    expect(bar).toContain("pointer-coarse:min-h-11");
    expect(bar).toContain('type="search"');
    expect(bar).toContain('enterKeyHint="search"');
    expect(bar).toContain('aria-label="清空筛选输入"');
    expect(bar).toContain('title="清空筛选"');
    // 清空钮点击区无形扩到 ~46px；隐藏原生 search 清空（自绘）
    expect(bar).toContain("after:-inset-3.5");
    expect(bar).toContain("[&::-webkit-search-cancel-button]:hidden");
  });

  it("调用点保留 placeholder/aria-label JSX 字面量（bundle-guard 按字面量扫）", () => {
    const sites = overlayFile("src/components/sites-directory-filterable-grid.tsx");
    expect(sites).toContain('placeholder="在全部站点中筛选（标题 / 链接 / 描述）..."');
    expect(sites).toContain('aria-label="在全部站点中筛选"');
    const category = overlayFile("src/components/category-index-filterable-list.tsx");
    expect(category).toContain('placeholder="快速查找分类或子类目（例如: AI, 数据库, 博客, 官方文档）..."');
    expect(category).toContain('aria-label="快速查找分类或子类目"');
  });

  it("hot 的全站检索出口文案仍在 hot-view 源码（search-entrypoint / command-palette 钉子）", () => {
    expect(overlayFile("src/app/hot/hot-view.tsx")).toContain("搜不到？按 / 全站检索");
  });
});

describe("FilterBar 渲染契约", () => {
  const base = { value: "", onChange: () => {}, placeholder: "筛选…", "aria-label": "筛选测试" };

  it("透传 placeholder/aria-label；有值才出清空钮（aria-label + title 双标注）", () => {
    const empty = renderToString(createElement(FilterBar, base));
    expect(empty).toContain('placeholder="筛选…"');
    expect(empty).toContain('aria-label="筛选测试"');
    expect(empty).not.toContain("清空筛选输入");

    const filled = renderToString(createElement(FilterBar, { ...base, value: "abc" }));
    expect(filled).toContain('aria-label="清空筛选输入"');
    expect(filled).toContain('title="清空筛选"');
  });

  it("meta → actions → chips 读序渲染，槽位内容原样出现", () => {
    const html = renderToString(
      createElement(FilterBar, {
        ...base,
        meta: createElement("span", null, "计数占位"),
        actions: createElement("button", null, "重置占位"),
        chips: createElement("i", null, "chip占位"),
      }),
    );
    expect(html).toContain("计数占位");
    expect(html).toContain("重置占位");
    expect(html).toContain("chip占位");
    expect(html.indexOf("计数占位")).toBeLessThan(html.indexOf("重置占位"));
    expect(html.indexOf("chip占位")).toBeGreaterThan(html.indexOf("重置占位"));
  });
});
