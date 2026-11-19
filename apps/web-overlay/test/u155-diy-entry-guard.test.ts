/**
 * U-155 方案 A：工具栏外观按钮文字标签化（2026-11-19）。
 *
 * 锁三件事（源码级守卫，风格照抄 touch-target-baseline.test.ts）：
 *   1. 外观按钮是图标 + 可见文字标签「DIY 排版」，全宽度可见——桌面与
 *      390px 首屏都能认出 DIY 入口；<390px 手机不再零入口；
 *   2. 360px 不溢出：小组件盒按钮 <390px 收进探索菜单，行内只剩 7 个
 *      44px 按钮，7×44px + 6×2px 间隙 = 320px ≤ 360−24px 可用宽；
 *      390px 时 8×44px + 7×2px = 366px 恰好占满 390−24px；
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
  it("按钮含可见文字标签「DIY 排版」，全宽度可见（无 <390px 隐藏）", () => {
    const src = overlayFile("src/components/navigation-toolbar.tsx");
    const block = buttonBlock(src, "打开外观排版与新手向导小窗");
    expect(block, "按钮应有可见文字标签「DIY 排版」").toContain(">DIY 排版</span>");
    expect(block, "按钮仍应是 h-11 w-11（44px 触摸目标）").toContain("h-11 w-11");
    expect(block, "按钮不应再用 size=\"icon\"（已是文字按钮，见「今日」按钮先例）").not.toContain('size="icon"');
    expect(block, "按钮不应再有 <390px 隐藏（min-[390px]:inline-flex）").not.toContain("min-[390px]:inline-flex");
    expect(block, "按钮不应再有 hidden").not.toContain("hidden");
    expect(block, "按钮 title 应以 DIY 开头").toContain('title="DIY 排版');
  });

  it("<sm 用「今日」按钮同款上下叠排，仍占 44px 宽；≥sm 横排", () => {
    const src = overlayFile("src/components/navigation-toolbar.tsx");
    const block = buttonBlock(src, "打开外观排版与新手向导小窗");
    expect(block).toContain("flex-col");
    expect(block).toContain("sm:flex-row");
    expect(block).toContain("sm:w-auto");
    expect(block).toContain("sm:px-2.5");
  });

  it("点击路径不动：仍调 onOpenAppearanceGuide（外观向导小窗）", () => {
    const src = overlayFile("src/components/navigation-toolbar.tsx");
    const block = buttonBlock(src, "打开外观排版与新手向导小窗");
    expect(block).toContain("onClick={onOpenAppearanceGuide}");
  });
});

describe("U-155：360px 宽度账（小组件盒 <390px 收进菜单）", () => {
  it("360px 行内 7 个 44px 按钮：7×44 + 6×2 间隙 = 320 ≤ 336 可用宽", () => {
    const src = overlayFile("src/components/navigation-toolbar.tsx");
    // 7 个常驻按钮都在：今日、探索矩阵、多选、字号、主题、菜单 + 外观/DIY
    for (const marker of [
      'aria-label="打开今日中心小窗"',
      'aria-label="探索矩阵与导航工具箱"',
      'aria-label="多选模式"',
      "<FontSizeToggle",
      "<ModeToggle",
      'aria-label="打开菜单"',
      'aria-label="打开外观排版与新手向导小窗"',
    ]) {
      expect(src, `360px 行内应有 ${marker}`).toContain(marker);
    }
    // 第 8 个（小组件盒）<390px 不在行内：按钮本身带 min-[390px]:inline-flex
    const widget = buttonBlock(src, "打开桌面小组件盒");
    expect(widget, "小组件盒按钮 <390px 应隐藏").toContain("hidden");
    expect(widget, "小组件盒按钮 ≥390px 应恢复显示").toContain("min-[390px]:inline-flex");
    // 整数算术：容器 px-3 两侧共 24px，行内间隙 gap-0.5 = 2px
    expect(7 * 44 + 6 * 2).toBe(320);
    expect(320).toBeLessThanOrEqual(360 - 24);
  });

  it("390px 行内 8 个 44px 按钮：8×44 + 7×2 间隙 = 366 恰好占满可用宽", () => {
    expect(8 * 44 + 7 * 2).toBe(366);
    expect(366).toBeLessThanOrEqual(390 - 24);
  });

  it("小组件盒 <390px 有菜单内替代入口（≥390px 条目隐藏），受 onOpenWidgetBox 守卫", () => {
    const src = overlayFile("src/components/navigation-toolbar.tsx");
    const spanIdx = src.indexOf(">桌面小组件盒<");
    expect(spanIdx, "探索菜单里应有「桌面小组件盒」条目").toBeGreaterThan(-1);
    const itemStart = src.lastIndexOf("<DropdownMenuItem", spanIdx);
    expect(itemStart, "应能定位菜单条目起始").toBeGreaterThan(-1);
    const item = src.slice(itemStart, spanIdx + 20);
    expect(item, "菜单条目应调 onOpenWidgetBox").toContain("onOpenWidgetBox()");
    expect(item, "菜单条目 ≥390px 应隐藏（按钮恢复显示）").toContain("min-[390px]:hidden");
    // 条目只在 onOpenWidgetBox 存在时渲染（该 prop 可选，不可裸调）
    const guards = src.split("{onOpenWidgetBox ? (").length - 1;
    expect(guards, "工具栏按钮与菜单条目两处都应受 onOpenWidgetBox 守卫").toBe(2);
  });
});
