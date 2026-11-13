/**
 * 搜索建议 + 零结果救援（research #2）的接线守卫。
 *
 * 建议引擎本身是纯函数，见 search-suggestions.test.ts 的单测；这里锁住
 * 「组件真的接上了它」——本仓测试跑在 node 环境，没有 jsdom，组件挂载
 * 类测试不在这里做，改为读源码断言关键接线存在（与 search-keyboard.test.ts
 * 同一范式）。任何一项被删掉，都会让建议下拉 / 查询保留 / 零结果救援
 * 悄悄失效。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return readFileSync(hit, "utf8");
}

/** 截取函数体：从标记起到函数自己的收尾（`  }` 或 `  }, [`）为止 */
function sliceFunction(src: string, startMarker: string): string {
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error("未找到 " + startMarker);
  const plainClose = src.indexOf("\n  }\n", start);
  const callbackClose = src.indexOf("\n  }, [", start);
  const ends = [plainClose, callbackClose].filter((i) => i >= 0);
  if (ends.length === 0) throw new Error("无法截取 " + startMarker + " 的函数体");
  return src.slice(start, Math.min(...ends));
}

describe("分组建议下拉：SearchPalette 接上了建议层", () => {
  const src = overlaySource("src/components/search-palette.tsx");

  it("建议分组由 buildSearchSuggestions 产出（历史 / 专题 / 相关搜索）", () => {
    expect(src).toContain("buildSearchSuggestions({");
    expect(src).toContain("history: recent");
    expect(src).toContain("collections: allCollections");
    expect(src).toContain("relatedSearches: suggestions");
  });

  it("专题匹配走容错匹配，不再是纯 includes", () => {
    expect(src).toContain("matchSuggestionText(q, `${c.title} ${c.description ?? ''} ${c.slug}`)");
    expect(src).not.toContain("c.title.toLowerCase().includes(q)");
  });

  it("建议区渲染在结果分组之前，分组标题与行结构齐全", () => {
    expect(src).toContain("suggestionGroups.map((group) => (");
    expect(src).toContain("{group.title}");
    expect(src).toContain('data-nav-item="suggestion"');
    expect(src).toContain("navhub-search-opt-${idx}");
    // 建议在 DIY 操作分组之前渲染（DOM 顺序即键盘导航顺序）
    expect(src.indexOf("suggestionGroups.map((group) => (")).toBeLessThan(
      src.indexOf("DIY 排版操作（8c）：查询命中操作关键词时置顶展示"),
    );
  });

  it("匹配词加粗：建议行复用 Highlighted", () => {
    const section = src.slice(src.indexOf("suggestionGroups.map((group) => ("));
    expect(section).toContain("<Highlighted text={item.label} query={query} />");
  });

  it("防抖仍在 NN/g 区间：搜索请求 200ms 防抖，没有为建议另起计时器", () => {
    expect(src).toContain("防抖 200ms");
    expect(src).toContain("}, 200)");
  });
});

describe("分组建议下拉：键盘可达", () => {
  const src = overlaySource("src/components/search-palette.tsx");

  it("建议行进键盘导航列表，且排在 DIY/插件/站点之前", () => {
    // P1 #8：导航列表的组装从组件移进了 lib/palette-actions.ts 的
    // buildPaletteNavItems，组件只负责传各组 id；建议组仍排在最前。
    const actions = overlaySource("src/lib/palette-actions.ts");
    const fn = actions.slice(actions.indexOf("export function buildPaletteNavItems"));
    const suggestionPos = fn.indexOf("entries.push({ id, kind: 'suggestion' })");
    expect(suggestionPos, "buildPaletteNavItems 缺少 suggestion 组").toBeGreaterThan(-1);
    for (const kind of ["diy", "plugin", "site"] as const) {
      const pos = fn.indexOf(`entries.push({ id, kind: '${kind}' })`);
      expect(pos, `buildPaletteNavItems 缺少 ${kind} 组`).toBeGreaterThan(-1);
      expect(suggestionPos, `suggestion 必须排在 ${kind} 之前`).toBeLessThan(pos);
    }
    // 组件把建议组 id 传进 buildPaletteNavItems，导航列表才有建议行
    expect(src).toContain("return buildPaletteNavItems({");
    expect(src).toContain(
      "suggestionIds: suggestionGroups.flatMap((g) => g.items.map((s) => `suggestion-${s.key}`))",
    );
  });

  it("没有高亮时回车打开第一条结果，而不是第一条建议", () => {
    expect(src).toContain("navItems.findIndex((item) => item.kind !== 'suggestion')");
    expect(src).toContain("firstResultIndex >= 0 ? firstResultIndex : 0");
  });

  it("采纳建议只改查询词、不关闭面板（可继续改词）", () => {
    const fn = sliceFunction(src, "const applySuggestion = useCallback");
    expect(fn).toContain("setQuery(value)");
    expect(fn).toContain("inputRef.current?.focus()");
    expect(fn).not.toContain("setIsFocused(false)");
  });
});

describe("查询保留：打开结果后不再丢查询", () => {
  it("SearchPalette 打开站点后只收起面板，不清空查询", () => {
    const src = overlaySource("src/components/search-palette.tsx");
    const fn = sliceFunction(src, "const openSite = useCallback");
    expect(fn).toContain("setIsFocused(false)");
    expect(fn).not.toContain("setQuery('')");
  });

  it("SearchBar（/videos）选中站点后只收起下拉，不清空查询", () => {
    const src = overlaySource("src/components/search-bar.tsx");
    const fn = sliceFunction(src, "const handleItemSelect = ");
    expect(fn).toContain("setIsFocused(false)");
    expect(fn).not.toContain("onSearch('')");
  });

  it("显式清空仍在：× 按钮与清空搜索保留原行为", () => {
    const palette = overlaySource("src/components/search-palette.tsx");
    expect(palette).toContain("setQuery(''); inputRef.current?.focus()");
    const bar = overlaySource("src/components/search-bar.tsx");
    const clearFn = sliceFunction(bar, "const clearSearch = ");
    expect(clearFn).toContain("onSearch('')");
  });

  it("/search 页输入框仍以 URL 的 q 作默认值（查询随链接保留）", () => {
    const src = overlaySource("src/app/search/search-results.tsx");
    expect(src).toContain("defaultValue={q}");
  });
});

describe("零结果救援：/search 页", () => {
  const page = overlaySource("src/app/search/page.tsx");
  const results = overlaySource("src/app/search/search-results.tsx");

  it("纠错仍在：didYouMean 渲染为「您是不是想搜」", () => {
    expect(results).toContain("您是不是想搜");
    expect(results).toContain("didYouMean");
  });

  it("相关分类：中枢推断出的分类给一个浏览入口（不带原查询词）", () => {
    expect(results).toContain("相关分类");
    expect(results).toContain("inferredCategory");
    expect(results).toContain("searchHref({ category: inferredCategory })");
    expect(results).toContain("浏览「{inferredCategory}」分类的全部站点");
  });

  it("为你推荐：热榜取数与渲染都在，失败时整块不渲染", () => {
    expect(page).toContain("'/api/rank/trending?limit=6'");
    expect(page).toContain("recommended={recommended}");
    expect(results).toContain("为你推荐");
    expect(results).toContain("recommended.length > 0");
    expect(results).toContain("今日热榜站点");
    expect(results).toContain('href="/hot"');
  });

  it("推荐行复用正常结果行（不另造一套卡片）", () => {
    expect(results).toContain("<ResultRow");
    expect(results).toContain("hit={{ siteId: site.id, score: 0, contributions: {}, site }}");
  });
});

describe("零结果救援：/videos 搜索框", () => {
  const src = overlaySource("src/components/search-bar.tsx");

  it("零结果时给出相关分类 chips，点一下拿分类名当查询词再搜", () => {
    expect(src).toContain("试试这些分类");
    expect(src).toContain("relatedCategories");
    expect(src).toContain("onClick={() => handleInputChange(cat.title)}");
  });

  it("相关分类按收录量取前 5 个一级分类", () => {
    expect(src).toContain(".slice(0, 5)");
    expect(src).toContain("(cat.items?.length ?? 0)");
  });

  it("清空搜索回全部列表的出口仍在", () => {
    expect(src).toContain("清空搜索，查看全部导航");
  });
});
