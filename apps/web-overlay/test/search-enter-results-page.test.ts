/**
 * F-01：搜索框回车进搜索结果页（/search?q=<query>），三种时序都必须进。
 *
 * 复现口径（2026-11-26，main 731bdf82）：
 *  - 结果已加载时回车：旧实现 `el.click()` 打开首条非建议结果（考研落到
 *    插件市场包页），而不是 /search?q=考研（R2 live：3 个干净样本，URL  stays /）。
 *  - 结果未加载时回车：旧实现 `if (navItems.length === 0) return` 直接
 *    无反应；且 Enter 分支在 `if (!showResults) return` 门后，isFocused
 *    一旦为 false（与 DOM 焦点脱节的竞态）回车也被整段吞掉——A 线
 *    fix/ctfix-a-search-enter（b0d45397）只修了前两条路，没动这道门，
 *    复核 20 次里早期回车 2 次无反应、机制未定位。
 *
 * 本仓测试跑在 node 环境，没有 jsdom，组件挂载类测试不在这里做，改为
 * 读源码断言关键接线存在（与 search-keyboard.test.ts /
 * search-zero-result-rescue.test.ts 同一范式）。真机时序（早期回车
 * 20 次循环）见证据目录的 CDP 探针报告，不在这里伪造通过。
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

/** 截取 onSearchKeyDown 的 useCallback 体：从标记起到 `  )` 收尾为止（该回调
 *  内部缩进 ≥4 空格，2 空格的 `  )` 只在 useCallback 收尾出现；通用的
 *  `\n  }, [` 切法会一路切到组件末尾，不可用）。 */
function sliceFunction(src: string, startMarker: string): string {
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error("未找到 " + startMarker);
  const end = src.indexOf("\n  )\n", start);
  if (end < 0) throw new Error("无法截取 " + startMarker + " 的函数体");
  return src.slice(start, end);
}

/** 默认模式的 Enter 分支：精确的 `if (e.key === 'Enter') {`（不含 aiMode/similarMode 两条），
 *  到 showResults 门为止（F-01 后 Enter 在门前；门后的方向键 / Alt+数字分支不属于它）。 */
function defaultEnterBranch(handler: string): string {
  const marker = "if (e.key === 'Enter') {";
  const start = handler.lastIndexOf(marker);
  if (start < 0) throw new Error("未找到默认模式 Enter 分支");
  // 门用 6 空格缩进的 handler 内版本：注释里也写着这串字、navItems 里还有
  // 4 空格的 `if (!showResults) return []`，裸串 indexOf 会找错。
  const end = handler.indexOf("      if (!showResults) return", start);
  if (end < 0) throw new Error("无法截取默认模式 Enter 分支");
  return handler.slice(start, end);
}

describe("F-01 回车进搜索结果页：默认模式 Enter 分支", () => {
  const src = overlaySource("src/components/search-palette.tsx");
  const handler = sliceFunction(src, "const onSearchKeyDown = useCallback");
  const enter = defaultEnterBranch(handler);

  it("回车走 router.push(searchHref({ q }))，而不是点首条结果", () => {
    expect(enter).toContain("router.push(searchHref({ q }))");
    expect(enter).not.toContain("findOptionElement(");
    expect(enter).not.toContain("el.click()");
  });

  it("结果未到也不 return：Enter 分支里没有 navItems 长度门", () => {
    expect(enter).not.toContain("navItems.length === 0");
    expect(enter).not.toContain("firstResultIndex");
  });

  it("空查询仍是 no-op：trim 后空串直接 return，不 push", () => {
    expect(enter).toContain("if (!q) return");
    expect(enter.indexOf("if (!q) return")).toBeLessThan(enter.indexOf("router.push(searchHref({ q }))"));
  });

  it("回车用输入框的实时值（inputRef.current?.value），不只依赖 React state 的 query", () => {
    // liveQ 在 handler 顶部定义、Enter 分支复用它（分支内只写 liveQ 不重复写 DOM 读法）
    expect(handler).toContain("const liveQ = (inputRef.current?.value ?? query).trim()");
    expect(enter).toContain("liveQ");
    expect(enter).toContain("const q = liveQ");
  });

  it("快捷链接 / omni 命令的优先级仍在回车进结果页之前", () => {
    // 从实时值重算（不用可能滞后的 quicklinkMatch memo）
    expect(enter).toContain("matchQuicklinkCommand(liveQ, quicklinkEntries)");
    expect(enter).toContain("liveQuicklink.kind === 'hit'");
    expect(enter).toContain("parseOmniCommand(liveQ)");
    expect(enter.indexOf("liveQuicklink.kind === 'hit'")).toBeLessThan(
      enter.indexOf("router.push(searchHref({ q }))"),
    );
    expect(enter.indexOf("parseOmniCommand(liveQ)")).toBeLessThan(
      enter.indexOf("router.push(searchHref({ q }))"),
    );
  });
});

describe("F-01 回车进搜索结果页：Enter 不被 showResults 门吞掉", () => {
  const src = overlaySource("src/components/search-palette.tsx");
  const handler = sliceFunction(src, "const onSearchKeyDown = useCallback");

  it("默认 Enter 分支在 `if (!showResults) return` 之前处理（isFocused 脱节时回车仍进结果页）", () => {
    // 门用 6 空格缩进的 handler 内版本：注释里也写着这串字，裸串 indexOf 会找错。
    const gate = handler.indexOf("      if (!showResults) return");
    expect(gate, "onSearchKeyDown 缺少 showResults 门（结构已变，须重审本断言）").toBeGreaterThan(-1);
    const push = handler.indexOf("router.push(searchHref({ q }))");
    expect(push, "Enter 分支未走 router.push(searchHref({ q }))").toBeGreaterThan(-1);
    expect(push).toBeLessThan(gate);
  });

  it("showResults 门只拦方向键 / Alt+数字这类依赖结果列表的按键，不拦回车", () => {
    // 门用 6 空格缩进的 handler 内版本（同上，注释里的同串字会误导裸串查找）。
    const gate = handler.indexOf("      if (!showResults) return");
    const arrows = handler.indexOf("if (e.key === 'ArrowDown' || e.key === 'ArrowUp')", gate);
    expect(arrows, "方向键分支应在 showResults 门后").toBeGreaterThan(gate);
  });
});

describe("F-01 回车进搜索结果页：其余入口不变", () => {
  const src = overlaySource("src/components/search-palette.tsx");

  it("「查看全部结果」仍链到同一个 searchHref({ q })", () => {
    expect(src).toContain("href={searchHref({ q: query })}");
    expect(src).toContain("查看全部结果");
  });

  it("方向键导航与建议点击采纳仍在（回车改道不拆键盘导航）", () => {
    expect(src).toContain("e.key === 'ArrowDown'");
    expect(src).toContain("setActiveIndex((prev) => {");
    expect(src).toContain("applySuggestion");
  });
});
