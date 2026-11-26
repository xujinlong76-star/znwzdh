/**
 * B2：搜索框点击建议 → 清空 → 重打时打字中途失焦（单样本，F-01 §5 未决观察）。
 *
 * 复现口径（2026-11-26，main c113ee59，CDP 探针，API :18311 / Web :18312）：
 *  - 对照组（不清建议点击、直接清空重打）：9 次完成试验 0 次失焦。
 *  - 点击建议行 → 点回输入框 → Ctrl+A + Backspace 清空 → 重打「考研」：
 *    完整明细的 run 5（probe-focus5.json）5 次完成试验里 2 次在打字中途
 *    失焦、值停在 ''、选项 0（trial 4：第二字「研」落点时输入框已不在
 *    DOM；trial 5：第一字「考」落点时已不在 DOM），另 2 次通过、1 次
 *    导航在打字刚结束时落地；run 4 的 2 次点击组试验也通过（仅一行日
 *    志，明细因运行时重启丢失）。
 *  - 根因不是输入框本身的焦点逻辑：点的建议行是专题 <Link>（「考公考研
 *    冲刺…」→ /collections/exam-sprint），点它即发起客户端导航；开发栈
 *    上 RSC 载荷要 2.5–2.8s 才落地（probe-nav-timing 3/3 在 2.1–2.8s 翻
 *    URL），落地时整棵首页（含顶栏搜索框）卸载，目标页挂一个全新空查询
 *    的输入框——重打的查询连同焦点一起被抹掉。导航不落地时试验全过，
 *    只是运气（导航落在试验结束后）。
 *
 * 修复：点专题行时记下这笔待定导航；用户重新聚焦输入框或继续打字即视
 * 为改主意，用一次同址 replace 把路由器的最新导航指回当前页，顶掉那笔
 * 过期导航。用户不回头则不触发取消，导航照常落地（probe-nav-timing
 * fix 后重跑 3/3 仍进专题页；late-URL 3/3 在点击 8.2s 后仍在 `/`、
 * 同一输入框、值「考研」、焦点保持）。
 *
 * 本仓测试跑在 node 环境，没有 jsdom，组件挂载类测试不在这里做，改为
 * 读源码断言关键接线存在（与 search-enter-results-page.test.ts /
 * search-keyboard.test.ts 同一范式）。真机时序见证据目录的 CDP 探针
 * 报告，不在这里伪造通过。
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

/** 截取一段源码：从标记起到结束标记为止（找不到即抛错，结构变了测试先红而不是悄悄放过）。 */
function slice(src: string, startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error("未找到 " + startMarker);
  const end = src.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error("无法截取 " + startMarker + " 到 " + endMarker);
  return src.slice(start, end);
}

describe("B2 搜索框失焦：过期导航守卫的接线", () => {
  const src = overlaySource("src/components/search-palette.tsx");

  it("SearchPalette 持有 router（取消导航要走 App Router，不是摸 history）", () => {
    expect(src).toContain("import { useRouter } from 'next/navigation'");
    expect(src).toContain("const router = useRouter()");
  });

  it("取消守卫：只有待定导航时才 replace，且 replace 指回当前地址（不跳走、不丢滚动）", () => {
    const guard = slice(
      src,
      "const cancelPendingSuggestionNav = useCallback",
      "}, [router])",
    );
    expect(guard).toContain("if (!pendingSuggestionNavRef.current) return");
    expect(guard).toContain("pendingSuggestionNavRef.current = null");
    expect(guard).toContain(
      "router.replace(window.location.pathname + window.location.search, { scroll: false })",
    );
  });

  it("点专题建议行时记下待定导航（而不是只关面板）", () => {
    const rows = slice(src, "return item.href ? (", "onClick={() => applySuggestion(item.label)}");
    expect(rows).toContain("handleSuggestionLinkClick(safeHref(item.href))");
    expect(rows).not.toContain("onClick={() => setIsFocused(false)}");
    const record = slice(src, "const handleSuggestionLinkClick = useCallback", "}, [])");
    expect(record).toContain("pendingSuggestionNavRef.current = href");
    expect(record).toContain("setIsFocused(false)");
  });

  it("重新聚焦输入框即取消待定导航（点回输入框是改主意的信号）", () => {
    expect(src).toContain("onFocus={handleInputFocus}");
    const focus = slice(src, "const handleInputFocus = useCallback", "}, [cancelPendingSuggestionNav])");
    expect(focus).toContain("setIsFocused(true)");
    expect(focus).toContain("cancelPendingSuggestionNav()");
  });

  it("键盘点行后直接打字同样取消（el.click() 不移走焦点，onFocus 不会再触发）", () => {
    const change = slice(src, "onChange={(e) => {", "onCompositionStart");
    expect(change).toContain("cancelPendingSuggestionNav()");
  });

  it("采纳型建议行（无 href 的 div）不经过导航守卫：applySuggestion 只填词 + 聚焦", () => {
    const adopt = slice(src, "const applySuggestion = useCallback", "}, [])");
    expect(adopt).toContain("setQuery(value)");
    expect(adopt).toContain("inputRef.current?.focus()");
    expect(adopt).not.toContain("pendingSuggestionNavRef");
    expect(adopt).not.toContain("router.replace");
  });
});
