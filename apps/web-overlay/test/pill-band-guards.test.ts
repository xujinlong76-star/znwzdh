import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { HomeQuickDock } from "../src/components/home-quick-dock";
import { WORKSPACES } from "../src/lib/workspaces";

/**
 * 胶囊带收敛守卫（2026-11-25 UI 评审 P0-2 / 方案 A′，Step 1–3 合并版）。
 *
 * 钉住四件事：
 *   1) L2/L3 语法：模式＝虚线触发器（可点开的模式），内容＝幽灵项（无可见边框）；
 *      坞模式不再内联平铺（无 tablist/tab），只留一个下拉触发器；
 *   2) 单行预算：坞内可点元素 ≤9（触发器 1 + 站点 7 + 展开 1），工作区胶囊 ≤6，
 *      首行合计 ≤14——超出即触发设计复审，不许静默加胶囊；
 *   3) 导航层：工作区与坞之间的语义竖线只在 ≥1400 并排时出现；
 *   4) Step 2 移动端：<md 坞整行隐藏（CSS 隐藏、DOM 锚点保留），顶行「快捷坞」
 *      入口与带尾「展开全部」共用同一个受控弹窗（navigation-content 管开关）。
 */

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(hit, "utf8");
}

const DOCK = overlayFile("src/components/home-quick-dock.tsx");
const ROW = overlayFile("src/components/home-capsule-row.tsx");
const NAV = overlayFile("src/components/navigation-content.tsx");

describe("A′ 语法守门（L2 模式 / L3 内容）", () => {
  it("坞模式不再内联平铺：无 tablist / tab，只有 1 个下拉触发器", () => {
    expect(DOCK).not.toContain('role="tablist"');
    expect(DOCK).not.toContain('role="tab"');
    // aria-haspopup 由 Radix 运行时注入，源码侧数触发器与菜单根（各恰好 1 个）
    expect(DOCK.match(/<DropdownMenuTrigger/g)?.length).toBe(1);
    expect(DOCK.match(/<DropdownMenu>/g)?.length).toBe(1);
  });

  it("L2 触发器＝虚线边界；L3 站点＝幽灵项（无可见边框，悬停才出底）", () => {
    expect(DOCK).toContain("border border-dashed border-border-strong");
    expect(DOCK).toContain("border-transparent");
    expect(DOCK).toContain("hover:bg-muted/70");
    // 站点项不得回潮成白底描边胶囊（与工作区非选中款同款＝旧问题）
    expect(DOCK).not.toContain("border-border/50 bg-background px-2");
  });

  it("滚动器合并：整个首屏横带只有坞内站点条 1 个横滚区（工作区条不再自建）", () => {
    // 2026-11-25 滚动器合并：工作区胶囊 md+ 恒放得下，去掉它自己的 HorizontalScrollFade，
    // 消除相邻双滚动器的手势归属冲突；坞内站点条是带内唯一横滚区。
    expect(ROW).not.toContain("<HorizontalScrollFade");
    expect(ROW).not.toContain("overflow-x-auto");
    expect(DOCK.match(/<HorizontalScrollFade/g)?.length).toBe(1);
    expect(DOCK).not.toContain("overflow-x-auto");
  });

  it("导航层：工作区与坞之间的竖线只在 ≥1400 并排时出现", () => {
    expect(NAV).toContain("hidden min-[1400px]:block h-5 w-px shrink-0 bg-border");
  });
});

describe("Step 2：移动端顶行收纳", () => {
  it("坞 <md 隐藏但 DOM 锚点保留（DIY / 直达规范的锚点不许摘）", () => {
    expect(DOCK).toContain("hidden md:flex");
    expect(DOCK).toContain('id="quick-access-tray"');
    expect(DOCK).toContain('data-speed-dial="true"');
  });

  it("顶行「快捷坞」入口与坞内「展开全部」共用同一个受控弹窗", () => {
    expect(ROW).toContain("onOpenQuickDock");
    expect(ROW).toContain("快捷坞");
    expect(NAV).toContain("onOpenQuickDock={() => setQuickDockOpen(true)}");
    expect(NAV).toContain("allDialogOpen={quickDockOpen}");
    expect(DOCK).toContain("onAllDialogOpenChange");
  });
});

describe("单行预算：可点元素 ≤14（工作区 ≤6 + 坞 ≤9）", () => {
  it("坞内 SSR：触发器 1 + 站点 7（maxInlineItems）+ 展开 1，菜单关闭态不渲染菜单项", () => {
    const sites = Array.from({ length: 9 }, (_, i) => ({
      id: `s${i}`,
      title: `站${i}`,
      href: `https://s${i}.example.com/`,
      icon: null,
    }));
    const html = renderToString(createElement(HomeQuickDock, { speedSites: sites }));
    expect(html.match(/aria-haspopup="menu"/g)?.length).toBe(1);
    expect(html.match(/href="https:\/\/s\d\.example\.com\//g)?.length).toBe(7);
    expect(html).toContain("展开全部");
    expect(html).not.toContain('role="menuitemradio"');
  });

  it("工作区胶囊数 ≤6（数据驱动；新增工作区必须同时复审单行预算）", () => {
    expect(WORKSPACES.length).toBeGreaterThan(0);
    expect(WORKSPACES.length).toBeLessThanOrEqual(6);
  });
});
