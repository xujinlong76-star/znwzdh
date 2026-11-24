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

  it("今日热榜：热榜取数与渲染都在，失败时整块不渲染；标题不写「为你推荐」", () => {
    expect(page).toContain("'/api/rank/trending?limit=6'");
    expect(page).toContain("recommended={recommended}");
    expect(results).toContain("今日热榜站点");
    // 这份榜单与查询词无关，不能冒充个性化推荐（断言只锁可见标题；
    // 源码注释里解释改名原因时可以提到旧名，不算在内）
    expect(results).not.toContain("为你推荐：今日热榜站点");
    expect(results).toContain("recommended.length > 0");
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

describe("纠正后零结果态：只给明确出口，不叠泛推荐（协调人决定 1）", () => {
  const results = overlaySource("src/app/search/search-results.tsx");

  it("EmptyResults 挂两出口岛（存为待找 / 新建收藏）", () => {
    expect(results).toContain("<WantedActions query={q} correctedQuery={correction?.corrected ?? null} />");
    expect(results).toContain("hideGenericRecommendations={correctedZero}");
  });

  it("纠正后零结果隐藏「换个词试试 / 大家在搜 / 今日热榜」三块", () => {
    expect(results).toContain("!hideGenericRecommendations && suggestions.length > 0");
    expect(results).toContain("!hideGenericRecommendations && popular.length > 0");
    expect(results).toContain("!hideGenericRecommendations && recommended.length > 0");
  });

  it("未纠正的零结果态保持现有 P0 行为：三块仍在（只在纠正态隐藏）", () => {
    // 隐藏是条件式的：hideGenericRecommendations=false 时三块照常渲染
    expect(results).toContain("hideGenericRecommendations = false");
    expect(results).toContain("const correctedZero = Boolean(correction) && hits.length === 0");
  });

  it("AI 找站与投稿收录是真出口，纠正态也保留", () => {
    expect(results).toContain("<ZeroResultActions query={q} />");
  });

  it("spotlight 零结果区同样挂两出口岛（N7：存为待找 / 新建收藏）", () => {
    const spotlight = overlaySource("src/components/search/spotlight-modal.tsx");
    expect(spotlight).toContain("<WantedActions query={query} correctedQuery={correction?.corrected ?? null} />");
  });

  it("spotlight / palette 有 correction 时隐藏建议 chips（N7）", () => {
    const spotlight = overlaySource("src/components/search/spotlight-modal.tsx");
    expect(spotlight).toContain("!correction && suggestions.length > 0");
    const palette = overlaySource("src/components/search-palette.tsx");
    expect(palette).toContain("!correction && suggestions.length > 0");
    expect(palette).toContain("!correction && popular.length > 0");
  });
});

describe("U-28 零结果定性：标题说清「站内未收录」，三态不混淆", () => {
  const results = overlaySource("src/app/search/search-results.tsx");

  it("A 态（成功 0 命中）：标题明说「站内暂时没有收录」，不再含糊说「没有找到」", () => {
    expect(results).toContain("站内暂时没有收录与“${q}”匹配的站点。");
    expect(results).toContain("站内暂时没有收录与“${q}”匹配、且带标签「${tag}」的站点。");
    expect(results).not.toContain("没有找到与“${q}”匹配");
    // 主语永远是「站内」，不写成对全网的断言
    expect(results).not.toContain("网上没有这个站");
  });

  it("B 态（纠正后仍 0 命中）：标题点明「换了纠正后的词还是没有」", () => {
    expect(results).toContain("换了“${correction.corrected}”还是没有——站内暂时没有收录匹配的站点。");
    // B 分支只在 correction 存在时出现：标题段里 correction 条件在 B 文案之前
    const titleStart = results.indexOf('<p className="text-sm font-medium text-foreground">');
    const titleBlock = results.slice(titleStart, results.indexOf("</p>", titleStart));
    expect(titleBlock.indexOf(": correction")).toBeGreaterThan(-1);
    expect(titleBlock.indexOf("换了“${correction.corrected}”还是没有")).toBeGreaterThan(
      titleBlock.indexOf(": correction"),
    );
  });

  it("标签-only 与翻页标题不动：本身已诚实，不硬套「未收录」", () => {
    expect(results).toContain("标签「${tag}」下暂时没有站点。");
    expect(results).toContain("第 ${page} 页没有更多结果。");
  });

  it("状态行与标题同一口径：翻页说「这一页没有更多结果」，其余说「站内未收录」", () => {
    expect(results).toContain("站内暂时没有收录匹配的站点");
    expect(results).toContain("这一页没有更多结果");
    expect(results).not.toContain("'没有找到匹配结果'");
  });

  it("C 态（取数失败）：EmptyResults 根本不渲染，改由 FailedNotice 明示失败", () => {
    expect(results).toContain("!failed && hits.length === 0 && unavailable.length === 0");
    expect(results).toContain("<FailedNotice q={q} page={page} tag={tag} category={category} facets={facets} />");
    expect(results).toContain("不是「没有收录这个站点」");
    const server = overlaySource("src/lib/server/search.ts");
    // C 必须有真实失败信号：只有中枢取数返回 null 才算失败，0 命中永远走 A
    expect(server).toContain("const failed = result === null");
  });
});

describe("U-143：零结果「回到第 1 页」不丢分类/分面", () => {
  const results = overlaySource("src/app/search/search-results.tsx");

  it("EmptyResults 调用处传入当前分类与分面", () => {
    const start = results.indexOf("<EmptyResults");
    expect(start, "search-results.tsx 缺少 <EmptyResults 调用").toBeGreaterThan(-1);
    const call = results.slice(start, results.indexOf("/>", start));
    expect(call).toContain("category={category}");
    expect(call).toContain("facets={facets}");
  });

  it("「回到第 1 页」链接的 searchHref 带分类与分面（第 1 页省略 page）", () => {
    // 「回到第 1 页」也在实现注释里出现一次（U-143 标注），必须定位到
    // 链接文本那一行（行尾换行），而不是注释里的提及。
    const label = results.indexOf("回到第 1 页\n");
    expect(label, "search-results.tsx 缺少「回到第 1 页」链接").toBeGreaterThan(-1);
    const link = results.slice(Math.max(0, label - 300), label);
    expect(link).toContain("searchHref({ q, tag, category, facets })");
  });
});

describe("2222 W9：零结果回车去完整结果页（首页搜索死路修法）", () => {
  const src = overlaySource("src/components/search-palette.tsx");

  /** 截取 onSearchKeyDown 里的 Enter 分支：从 Enter 判断起到 Escape 分支为止 */
  function enterBranch(): string {
    const start = src.indexOf("if (e.key === 'Enter') {");
    expect(start, "search-palette.tsx 缺少 Enter 分支").toBeGreaterThan(-1);
    const end = src.indexOf("if (e.key === 'Escape') {", start);
    expect(end, "search-palette.tsx 缺少 Escape 分支").toBeGreaterThan(start);
    return src.slice(start, end);
  }

  it("真空态（无建议、无结果）回车跳 /search，不静默 return", () => {
    const enter = enterBranch();
    // navItems 为空时直接跳完整结果页，而不是 `if (navItems.length === 0) return`
    const emptyPos = enter.indexOf("if (navItems.length === 0) {");
    expect(emptyPos, "Enter 分支缺少零结果真空态分支").toBeGreaterThan(-1);
    const assignPos = enter.indexOf("window.location.assign(searchHref({ q: query }))", emptyPos);
    expect(assignPos, "真空态回车必须跳 searchHref({ q: query })").toBeGreaterThan(emptyPos);
    expect(enter).not.toContain("if (navItems.length === 0) return");
  });

  it("只有建议、无可开结果时，无高亮回车跳 /search，不改写查询词", () => {
    const enter = enterBranch();
    // 无高亮（activeIndex < 0）且无非建议项（firstResultIndex === -1）时跳 /search，
    // 而不是退到索引 0 点第一条建议行（applySuggestion 只会 setQuery 换词）。
    const guardPos = enter.indexOf("if (activeIndex < 0 && firstResultIndex === -1) {");
    expect(guardPos, "Enter 分支缺少「只有建议」回车守卫").toBeGreaterThan(-1);
    const assignPos = enter.indexOf("window.location.assign(searchHref({ q: query }))", guardPos);
    expect(assignPos, "只有建议时回车必须跳 searchHref({ q: query })").toBeGreaterThan(guardPos);
    // 守卫在 firstResultIndex 算出之后、旧 target 回退之前
    expect(enter.indexOf("const firstResultIndex = navItems.findIndex")).toBeLessThan(guardPos);
    expect(guardPos).toBeLessThan(enter.indexOf("const target = activeIndex >= 0"));
  });

  it("回车 fallback 不抢在 quicklink / omni 之前", () => {
    const enter = enterBranch();
    const quicklinkPos = enter.indexOf("quicklinkMatch.kind === 'hit'");
    const omniPos = enter.indexOf("const omni = parseOmniCommand(query)");
    const firstAssign = enter.indexOf("window.location.assign(searchHref({ q: query }))");
    expect(quicklinkPos, "Enter 分支缺少 quicklink 判断").toBeGreaterThan(-1);
    expect(omniPos, "Enter 分支缺少 omni 判断").toBeGreaterThan(-1);
    expect(quicklinkPos).toBeLessThan(firstAssign);
    expect(omniPos).toBeLessThan(firstAssign);
  });

  it("有高亮时回车仍采纳/打开高亮项，不落入零结果分支", () => {
    const enter = enterBranch();
    // 高亮项（activeIndex >= 0）走旧逻辑：target 取 activeIndex，点真实元素。
    expect(enter).toContain("const target = activeIndex >= 0 ? activeIndex : firstResultIndex >= 0 ? firstResultIndex : 0");
    // 两个零结果分支都要求无高亮：真空态在 navItems 为空时才进；
    // 「只有建议」分支显式要求 activeIndex < 0。
    expect(enter).toContain("if (activeIndex < 0 && firstResultIndex === -1) {");
  });

  it("IME 组词中回车不触发：守卫在 Enter 分支之前", () => {
    const handlerStart = src.indexOf("const onSearchKeyDown = useCallback");
    expect(handlerStart, "缺少 onSearchKeyDown").toBeGreaterThan(-1);
    const imePos = src.indexOf("if (e.nativeEvent.isComposing || e.keyCode === 229) return", handlerStart);
    const enterPos = src.indexOf("if (e.key === 'Enter') {", handlerStart);
    expect(imePos, "缺少 IME 组词守卫").toBeGreaterThan(-1);
    expect(imePos).toBeLessThan(enterPos);
  });

  it("零结果面板底部同样有「查看全部结果」：门控不再绑 displayHits.length", () => {
    // 门控从 `showResults && query.trim() && displayHits.length > 0` 改为
    // `showResults && query.trim()`，文案与样式不动。
    expect(src).not.toContain("showResults && query.trim() && displayHits.length > 0");
    expect(src).toContain("{showResults && query.trim() && (");
    expect(src).toContain("查看全部结果");
    expect(src).toContain("href={searchHref({ q: query })}");
  });
});
