/**
 * 小猫猫挂件 :123 守卫（2026-11-18，390px 首页入场招呼气泡 15 秒内未出现）：
 *
 *  根因（本地真机几何探针，390×844 首页，scrollY=0，未修复代码）：
 *  气泡显示后矩形 x134 y620 248×56（面积 13888），猫 x290 y688 88×88；
 *  与气泡相交的没有卡片（article/.nav-card-glow 零命中），只有右下角三个 44px
 *  悬浮钮——「回到顶部」「呼出超级搜索控制台」「开发者极速微工具箱」
 *  （各 x221/274/327 y637 44×44），每个与气泡重叠 44×39=1716，占气泡面积 12.4%。
 *  旧阈值“任一方向重叠 >4px 即拦”把招呼拦死，气泡永不出现，:123 在 15 秒超时失败。
 *
 *  修法（只改 autoGreetWouldCoverContent，不动选择器与 850ms 招呼流程）：
 *  单个元素重叠面积占气泡面积 >25% 才拦。三个悬浮钮各占 12.4% → 放行；
 *  整宽卡片/搜索框等大面积遮挡（重叠 >25%）仍拦，c3001 的遮挡保护不丢。
 *
 *  本测试不用 jsdom（沿 v4–v7 惯例，仓内不引 jsdom 依赖）：从 widget 源码抠出
 *  判定函数，在 node:vm 沙箱里用 mock 矩形跑行为断言。mock 矩形取自上述真机探针。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayRoot(): string {
  const candidates = [resolve(HERE, ".."), resolve(HERE, "..", "..", "web-overlay")];
  const isOverlayDir = (p: string) => {
    const s = p.replace(/\\/g, "/");
    return s.includes("/web-overlay/") || s.endsWith("/web-overlay");
  };
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p));
  if (!hit) throw new Error("无法定位 web-overlay 根目录（候选：" + candidates.join(" | ") + "）");
  return hit;
}

const ROOT = overlayRoot();
const WIDGET = readFileSync(join(ROOT, "public/xiaomaomao/xiaomaomao.js"), "utf8");

/** 从源码抠出 autoGreetWouldCoverContent() 函数体。 */
function gateSource(): string {
  const start = WIDGET.indexOf("function autoGreetWouldCoverContent()");
  expect(start, "找不到 autoGreetWouldCoverContent").toBeGreaterThan(-1);
  const end = WIDGET.indexOf("/* ---------- 时间与作息 ---------- */", start);
  expect(end, "找不到判定函数结束标记").toBeGreaterThan(start);
  return WIDGET.slice(start, end);
}

const GATE_SRC = gateSource();

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };

function rect(x: number, y: number, w: number, h: number): Rect {
  return { left: x, top: y, right: x + w, bottom: y + h, width: w, height: h };
}

/**
 * 在沙箱里跑一次判定。
 * 默认 390px 首页几何（真机探针值）：猫 x290 y688 88×88，气泡 248×56，
 * 显示后矩形 x134 y620 w248 h56（右缘=猫右缘+4，下缘=猫顶-12）。
 */
function runGate(els: Rect[], bubbleW = 248, bubbleH = 56): boolean {
  const catRect = rect(290, 688, 88, 88);
  const sandbox: Record<string, unknown> = {
    bubbleEl: { offsetWidth: bubbleW, offsetHeight: bubbleH },
    root: { getBoundingClientRect: () => catRect },
    document: {
      querySelector: (sel: string) =>
        sel === "main" ? { querySelectorAll: () => els.map((r) => ({ getBoundingClientRect: () => r })) } : null,
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(GATE_SRC + "\nthis.__gate = autoGreetWouldCoverContent();", sandbox);
  return sandbox.__gate as boolean;
}

/** 390px 首页右下角三个 44px 悬浮钮（真机探针值），每个与气泡重叠 44×39。 */
function fabButtons(): Rect[] {
  return [rect(221, 637, 44, 44), rect(274, 637, 44, 44), rect(327, 637, 44, 44)];
}

describe("c3001 判定阈值：:123 390px 首页招呼", () => {
  it("阈值是单个元素重叠面积占气泡面积 >25%，不再是任一方向 >4px", () => {
    expect(WIDGET).toContain("if (ix * iy > bubbleArea * 0.25) return true;");
    expect(WIDGET).not.toContain("if (ix > 4 && iy > 4) return true;");
  });

  it("选择器未缩水：链接/按钮/文章/卡片仍在守门范围内", () => {
    expect(WIDGET).toContain(
      "main.querySelectorAll('a, button, [role=\"button\"], article, .nav-card-glow')",
    );
  });

  it("三个 44px 悬浮钮各占气泡 12.4% → 放行，招呼正常出现（:123 场景）", () => {
    // 1716 / 13888 = 12.36% < 25%，三个合计 37% 也不拦：按单个元素判定
    expect(runGate(fabButtons())).toBe(false);
  });

  it("整宽卡片（inset-0 链接覆盖层）重叠约 100% → 仍拦", () => {
    // 卡片 x8 y600 w374 h160：与气泡交 248×56 = 13888，占 100%
    expect(runGate([rect(8, 600, 374, 160)])).toBe(true);
  });

  it("搜索框式大元素重叠 >25% → 仍拦", () => {
    // 搜索框 x8 y620 w374 h44：与气泡交 248×44 = 10912，占 78.6%
    expect(runGate([rect(8, 620, 374, 44)])).toBe(true);
  });

  it("单个小按钮重叠 <25% 放行，但单个大按钮重叠 >25% 仍拦", () => {
    // 小按钮 60×36=2160（15.6%）放行；大按钮 200×40=8000（57.6%）拦
    expect(runGate([rect(300, 630, 60, 36)])).toBe(false);
    expect(runGate([rect(150, 630, 200, 40)])).toBe(true);
  });

  it("无重叠 → 放行", () => {
    expect(runGate([rect(8, 100, 374, 160)])).toBe(false);
  });
});
