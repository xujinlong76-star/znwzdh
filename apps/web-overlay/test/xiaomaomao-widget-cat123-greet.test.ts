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
 *  U-161（2026-11-18 :123 续）：390px 首页招呼仍被拦——探针（HEAD d4bf700d，
 *  390×844 两轮一致）元凶是 ChatGPT 卡片容器 DIV.nav-card-deferred（98.39%）
 *  及其 A.absolute.inset-0 全幅链接（97.98%）。纯排除卡片容器会使 c3001
 *  回归（其元凶同为卡片容器，桌面 1686px），故分支条件：只在窄屏（≤640px，
 *  与 isNarrowViewport 同断点）排除“整卡背景式”元素（容器本身 + 其 inset-0
 *  链接）；桌面端卡片照常计入，c3001 不丢。非 deferred 的 .nav-card-glow
 *  卡片（如 hero deck）任何宽度下都照常计入。本文件 runGate 默认跑桌面宽
 *  （1280），窄屏用例显式传 390；mock 元素须带 classList/closest/tagName，
 *  无 class 信息的旧式 mock 默认被计入（fail-closed）。
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

/** mock 判定元素：须带 classList/closest/tagName（U-161 整卡背景式判定要查 class）。 */
type MockEl = { rect: Rect; tag?: string; classes?: string[]; inDeferredCard?: boolean };

function el(rectValue: Rect, extra: Omit<MockEl, "rect"> = {}): MockEl {
  return { rect: rectValue, ...extra };
}

function mockEl(m: MockEl) {
  const classes = m.classes ?? [];
  return {
    tagName: m.tag ?? "DIV",
    classList: { contains: (c: string) => classes.includes(c) },
    closest: (sel: string) => (sel === ".nav-card-deferred" && m.inDeferredCard ? {} : null),
    getBoundingClientRect: () => m.rect,
  };
}

/**
 * 在沙箱里跑一次判定。
 * 默认 390px 首页几何（真机探针值）：猫 x290 y688 88×88，气泡 248×56，
 * 显示后矩形 x134 y620 w248 h56（右缘=猫右缘+4，下缘=猫顶-12）。
 * innerWidth 默认 1280（桌面）；窄屏用例显式传 390。
 */
function runGate(els: MockEl[], bubbleW = 248, bubbleH = 56, innerWidth = 1280): boolean {
  const catRect = rect(290, 688, 88, 88);
  const sandbox: Record<string, unknown> = {
    bubbleEl: { offsetWidth: bubbleW, offsetHeight: bubbleH },
    root: { getBoundingClientRect: () => catRect },
    window: {
      innerWidth,
      matchMedia: (q: string) => ({ matches: q.includes("640") ? innerWidth <= 640 : false }),
    },
    document: {
      querySelector: (sel: string) =>
        sel === "main" ? { querySelectorAll: () => els.map((m) => mockEl(m)) } : null,
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(GATE_SRC + "\nthis.__gate = autoGreetWouldCoverContent();", sandbox);
  return sandbox.__gate as boolean;
}

/** 390px 首页右下角三个 44px 悬浮钮（真机探针值），每个与气泡重叠 44×39。 */
function fabButtons(): MockEl[] {
  return [
    el(rect(221, 637, 44, 44), { tag: "BUTTON" }),
    el(rect(274, 637, 44, 44), { tag: "BUTTON" }),
    el(rect(327, 637, 44, 44), { tag: "BUTTON" }),
  ];
}

/** U-161 探针值（390×844，HEAD d4bf700d）：ChatGPT 卡片容器 + 其全幅链接。 */
function deferredCard(): MockEl[] {
  return [
    // 容器 DIV.nav-card-deferred（兼 .nav-card-glow）：与气泡重叠 13,664（98.39%）
    el(rect(8, 604, 374, 160), { classes: ["nav-card-deferred", "nav-card-glow"] }),
    // 全幅链接 A.absolute.inset-0（卡片内）：与气泡重叠 13,608（97.98%）
    el(rect(8, 604, 374, 160), {
      tag: "A",
      classes: ["absolute", "inset-0"],
      inDeferredCard: true,
    }),
  ];
}

/** U-161 探针值：卡片标题链接（23.98%，不到线）。 */
function cardTitleLink(): MockEl {
  // x150 y630 w150 h22：与气泡交 150×22=3300，占 23.76%，贴近探针 23.98%。
  return el(rect(150, 630, 150, 22), { tag: "A", inDeferredCard: true });
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
    // 桌面宽下卡片容器照常计入：卡片 x8 y604 w374 h160：与气泡交 248×56 = 13888，占 100%
    // （窄屏 390px 下同一卡片被排除，见 U-161 用例）
    expect(runGate(deferredCard())).toBe(true);
  });

  it("搜索框式大元素重叠 >25% → 仍拦", () => {
    // 搜索框 x8 y620 w374 h44：与气泡交 248×44 = 10912，占 78.6%
    expect(runGate([el(rect(8, 620, 374, 44))])).toBe(true);
  });

  it("单个小按钮重叠 <25% 放行，但单个大按钮重叠 >25% 仍拦", () => {
    // 小按钮 60×36=2160（15.6%）放行；大按钮 200×40=8000（57.6%）拦
    expect(runGate([el(rect(300, 630, 60, 36), { tag: "BUTTON" })])).toBe(false);
    expect(runGate([el(rect(150, 630, 200, 40), { tag: "BUTTON" })])).toBe(true);
  });

  it("无重叠 → 放行", () => {
    expect(runGate([el(rect(8, 100, 374, 160))])).toBe(false);
  });

  it("气泡量不到尺寸（猫被藏/收起态，offsetWidth/Height 为 0）→ 跳过招呼，不放行（U-141）", () => {
    // 零尺寸 ≠ 不遮挡：hideCat() 后 root display:none、.xm-docked 下气泡
    // display:none 时气泡无布局尺寸；旧行为 return false 会放行招呼、把文案
    // 留在看不见的气泡里（:123 旧断言 toHaveText('') 的失败模式）。
    // 改判 true：判定不了就跳过本次自动招呼。正常可见的猫气泡有
    // min-height:55px，走不到这支。
    expect(WIDGET).toContain("if (!bw || !bh) return true;");
    expect(runGate([], 0, 0)).toBe(true);
    expect(runGate([], 0, 56)).toBe(true);
    expect(runGate([], 248, 0)).toBe(true);
    // :123 几何 + 猫被藏：即使三个悬浮钮本可放行，量不到尺寸也必须跳过
    expect(runGate(fabButtons(), 0, 0)).toBe(true);
  });
});

describe("U-161：窄屏排除整卡背景式元素（:123 续），桌面 c3001 不丢", () => {
  it("390px：卡片容器 98.39% + 全幅链接 97.98% 被排除 → 放行（:123 场景）", () => {
    expect(runGate(deferredCard(), 248, 56, 390)).toBe(false);
  });

  it("390px 全量复算：卡片 + 全幅链接 + 标题链接 + 三悬浮钮，最大单元素 23.98% < 25% → 放行", () => {
    // 排除后剩余：标题链接 23.76%、悬浮钮各 12.36%、操作钮各 4.12%，均不到 25% 线
    const els = [...deferredCard(), cardTitleLink(), ...fabButtons()];
    expect(runGate(els, 248, 56, 390)).toBe(false);
  });

  it("桌面 1686px：同一卡片容器 + 全幅链接照常计入 → 仍拦（c3001 不回归）", () => {
    expect(runGate(deferredCard(), 248, 56, 1686)).toBe(true);
  });

  it("断点 640px：≤640 排除，641 计入（与 isNarrowViewport 同断点）", () => {
    expect(runGate(deferredCard(), 248, 56, 640)).toBe(false);
    expect(runGate(deferredCard(), 248, 56, 641)).toBe(true);
  });

  it("390px：非 deferred 的 .nav-card-glow 卡片（hero deck）重叠 100% → 仍拦", () => {
    expect(
      runGate([el(rect(8, 600, 374, 160), { classes: ["nav-card-glow"] })], 248, 56, 390),
    ).toBe(true);
  });

  it("390px：搜索框式大元素重叠 78.6% → 仍拦", () => {
    expect(runGate([el(rect(8, 620, 374, 44))], 248, 56, 390)).toBe(true);
  });

  it("390px：卡片内普通标题链接 23.98% 不到线放行，但 >25% 的标题链接仍拦", () => {
    expect(runGate([cardTitleLink()], 248, 56, 390)).toBe(false);
    // x150 y630 w248 h40：与气泡交 232×40=9280，占 66.8%
    expect(
      runGate([el(rect(150, 630, 248, 40), { tag: "A", inDeferredCard: true })], 248, 56, 390),
    ).toBe(true);
  });

  it("无 class 信息的旧式元素默认被计入（fail-closed）：重叠 100% → 仍拦", () => {
    // mock 只有 getBoundingClientRect（无 classList）：isFullCardBackground 返回 false
    const bare = { getBoundingClientRect: () => rect(8, 600, 374, 160) };
    const catRect = rect(290, 688, 88, 88);
    const sandbox: Record<string, unknown> = {
      bubbleEl: { offsetWidth: 248, offsetHeight: 56 },
      root: { getBoundingClientRect: () => catRect },
      window: { innerWidth: 390, matchMedia: () => ({ matches: true }) },
      document: {
        querySelector: (sel: string) =>
          sel === "main" ? { querySelectorAll: () => [bare] } : null,
      },
    };
    vm.createContext(sandbox);
    vm.runInContext(GATE_SRC + "\nthis.__gate = autoGreetWouldCoverContent();", sandbox);
    expect(sandbox.__gate as boolean).toBe(true);
  });
});
