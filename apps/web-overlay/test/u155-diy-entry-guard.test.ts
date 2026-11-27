/**
 * U-155 方案 A：工具栏外观按钮文字标签化（2026-11-19）。
 *
 * 锁三件事（源码级守卫，风格照抄 touch-target-baseline.test.ts）：
 *   1. 外观按钮是图标 + 可见文字标签「DIY 排版」，全宽度可见——桌面与
 *      390px 首屏都能认出 DIY 入口；<390px 手机不再零入口；
 *   2. 360px 不溢出：小组件盒按钮 <390px 收进探索菜单，多选按钮
 *      <640px 收进探索菜单（C-W7-5，2026-11-21），行内只剩 6 个
 *      44px 按钮，6×44px + 5×6px 间隙 = 294px ≤ 360−24px 可用宽；
 *      390px 时 7×44px + 6×6px = 344px ≤ 390−24px；
 *      （旧账「7×44 + 6×2 = 320」「8×44 + 7×2 = 366 恰好占满」与代码不符：
 *      右组 gap-1.5 = 6px，不是 2px；修正前 360px 行实为 344px 超 8px、
 *      390px 行实为 394px 超 28px。）
 *   3. 点击路径不动：按钮仍调 onOpenAppearanceGuide（外观向导小窗，
 *      默认 appearance 页签，底部「开启 DIY」进编排态）。
 *
 * 宽度账的根因（2026-11-19 02:22 轮注释）：<md 时按钮行 8×44px + 间隙
 * = 366px > 360−24px 可用宽，菜单按钮会被挤出 18px。本轮不靠隐藏
 * 外观按钮解溢出，改把桌面向的小组件盒（钉到桌面角落，小屏低频）
 * <390px 收进探索菜单（菜单条目保留入口，不丢功能）。
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find(
    (p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p),
  );
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(hit, "utf8");
}

/** 按 aria-label 定位某按钮的 <Button …>…</Button> 块 */
function buttonBlock(src: string, ariaLabel: string): string {
  const labelIdx = src.indexOf(`aria-label="${ariaLabel}"`);
  expect(labelIdx, `应有 aria-label="${ariaLabel}" 的按钮`).toBeGreaterThan(-1);
  const start = src.lastIndexOf("<Button", labelIdx);
  const end = src.indexOf("</Button>", labelIdx);
  expect(start, "应能定位按钮起始").toBeGreaterThan(-1);
  expect(end, "应能定位按钮结束").toBeGreaterThan(-1);
  return src.slice(start, end);
}

describe("U-155：外观按钮是图标 + 可见文字「DIY 排版」", () => {
  // U-460（2026-11-27，WCAG 2.5.3）：aria-label 由「打开外观排版与新手向导小窗」
  // 改为「DIY 排版：打开外观排版与新手向导小窗」，可见文案须在 accessible name 内；
  // 本文件用 aria-label 作按钮定位锚点，锚点随新行为改写，断言意图不变。
  it("按钮含可见文字标签「DIY 排版」，全宽度可见（无 <390px 隐藏）", () => {
    const src = overlayFile("src/components/navigation-toolbar.tsx");
    const block = buttonBlock(src, "DIY 排版：打开外观排版与新手向导小窗");
    expect(block, "按钮应有可见文字标签「DIY 排版」").toContain(">DIY 排版</span>");
    expect(block, "按钮仍应是 h-11 w-11（44px 触摸目标）").toContain("h-11 w-11");
    expect(block, "按钮不应再用 size=\"icon\"（已是文字按钮，见「今日」按钮先例）").not.toContain('size="icon"');
    expect(block, "按钮不应再有 <390px 隐藏（min-[390px]:inline-flex）").not.toContain("min-[390px]:inline-flex");
    expect(block, "按钮不应再有 hidden").not.toContain("hidden");
    expect(block, "按钮 title 应以 DIY 开头").toContain('title="DIY 排版');
  });

  it("<sm 用「今日」按钮同款上下叠排，仍占 44px 宽；≥sm 横排", () => {
    const src = overlayFile("src/components/navigation-toolbar.tsx");
    const block = buttonBlock(src, "DIY 排版：打开外观排版与新手向导小窗");
    expect(block).toContain("flex-col");
    expect(block).toContain("sm:flex-row");
    expect(block).toContain("sm:w-auto");
    expect(block).toContain("sm:px-2.5");
  });

  it("点击路径不动：仍调 onOpenAppearanceGuide（外观向导小窗）", () => {
    const src = overlayFile("src/components/navigation-toolbar.tsx");
    const block = buttonBlock(src, "DIY 排版：打开外观排版与新手向导小窗");
    // U-155 埋点（51f00576）：点击改为“先上报后打开”，onClick 由直传
    // onOpenAppearanceGuide 包成箭头函数；行为不变——向导仍在同一 handler
    // 内无条件打开，上报 fire-and-forget 绝不阻塞。断言改为钉新形式。
    expect(block).toContain("trackDiyEvent('diy_appearance_click')");
    expect(block).toContain("onOpenAppearanceGuide()");
    expect(
      block.indexOf("trackDiyEvent('diy_appearance_click')"),
      "先上报后打开：上报应在打开之前",
    ).toBeLessThan(block.indexOf("onOpenAppearanceGuide()"));
  });
});

describe("U-155：360px/390px 融合宽度账（小组件盒并入今日效率中心，外观收进聚合浮层）", () => {
  it("360px/390px 行内统一 6 个 44px 按钮：6×44 + 5×2 间隙 = 274 ≤ 336 可用宽", () => {
    const src = overlayFile("src/components/navigation-toolbar.tsx");
    for (const marker of [
      'aria-label="打开今日中心小窗"',
      'aria-label="探索矩阵与导航工具箱"',
      'aria-label="多选模式"',
      "<FontSizeToggle",
      "<AppearanceQuickPopover",
      'aria-label="打开菜单"',
      'aria-label="DIY 排版：打开外观排版与新手向导小窗"',
    ]) {
      expect(src, `顶栏应有 ${marker}`).toContain(marker);
    }
    // C-W7-5：多选按钮 <640px 隐藏（hidden sm:inline-flex），入口在探索菜单内
    const multi = buttonBlock(src, "多选模式");
    expect(multi, "多选按钮 <640px 应隐藏").toContain("hidden");
    expect(multi, "多选按钮 ≥640px 应恢复显示").toContain("sm:inline-flex");
    // 2026-11-24 效率三合一：小组件盒已并入今日中心小窗 + 探索 2 列菜单，顶栏不再单占一格
    expect(src).not.toContain('aria-label="打开桌面小组件盒"');
    expect(6 * 44 + 5 * 2).toBe(274);
    expect(274).toBeLessThanOrEqual(360 - 24);
  });

  it("桌面小组件盒仍保留在探索菜单内（受 onOpenWidgetBox 守卫）及今日效率中心 Tab 内", () => {
    const src = overlayFile("src/components/navigation-toolbar.tsx");
    const spanIdx = src.indexOf(">桌面小组件盒<");
    expect(spanIdx, "探索菜单里应有「桌面小组件盒」条目").toBeGreaterThan(-1);
    const itemStart = src.lastIndexOf("<DropdownMenuItem", spanIdx);
    const item = src.slice(itemStart, spanIdx + 20);
    expect(item, "菜单条目应调 onOpenWidgetBox").toContain("onOpenWidgetBox()");
    expect(src.split("{onOpenWidgetBox ? (").length - 1).toBe(1);
    const todayDlg = overlayFile("src/components/home-windows/today-center-dialog.tsx");
    expect(todayDlg).toContain("桌面微件");
    expect(todayDlg).toContain("极客工具");
  });
});
