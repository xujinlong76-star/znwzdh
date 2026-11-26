/**
 * FloatingQuickNav 与 DIY 子树解耦守卫（已退役，首屏瘦身重写）。
 *
 * 原事故形状：a2be92ee 把 FloatingQuickNav 全局挂进 providers（layout），而它
 * 静态 import use-home-diy；use-home-diy 的静态闭包是 10 个文件约 217 KB
 * 源码，整棵子树因此进了根布局的 layout 共享 chunk，/me 等 9 路超包预算。
 * 当时解法是事件桥（lib/diy-editing-event，零依赖）替代静态 import。
 *
 * 订正（2026-11-20 首屏瘦身，evo/firstscreen-slim-1257）：FloatingQuickNav
 * 整体移除（底部悬浮工具栏退役，三键功能由顶栏与命令面板覆盖，见
 * command-palette-gaps.test.ts「缺口 ②（退役）」块）。事件桥随之失去唯一
 * 订阅方，一并删除；home-diy-storage 的 setHomeDiyEditingLayout 不再广播。
 * 本文件按新行为改写（不删除守卫）：锁「组件与事件桥均已删除、源码无引用、
 * DIY 编排态写入入口本身仍在」，防止后续重构把悬浮胶囊或事件桥静默加回来，
 * 也防止误删 DIY 编排态写入入口。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayRoot(): string {
  const candidates = [resolve(HERE, ".."), resolve(HERE, "..", "..", "web-overlay")];
  const isOverlayDir = (p: string) => {
    const s = p.replace(/\\/g, "/");
    return s.includes("/web-overlay/") || s.endsWith("/web-overlay");
  };
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p));
  if (!hit) throw new Error("无法定位 web-overlay 根目录");
  return hit;
}

const ROOT = overlayRoot();

function readSource(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 递归列出源码树内所有 .ts/.tsx 文件（跳过 node_modules）。 */
function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") listSourceFiles(p, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

describe("FloatingQuickNav（退役）：组件与事件桥均已删除，源码无引用", () => {
  it("组件文件与事件桥文件均不存在", () => {
    expect(existsSync(join(ROOT, "src/components/floating-quick-nav.tsx"))).toBe(false);
    expect(existsSync(join(ROOT, "src/lib/diy-editing-event.ts"))).toBe(false);
  });

  it("源码树内无任何文件引用 FloatingQuickNav 或 diy-editing-event", () => {
    const files = listSourceFiles(join(ROOT, "src"));
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (src.includes("FloatingQuickNav") || src.includes("diy-editing-event")) {
        offenders.push(f.replace(ROOT + "/", ""));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("home-diy-storage 不再广播事件桥，但编排态写入入口仍在", () => {
    const storage = readSource("src/lib/modular/home-diy-storage.ts");
    expect(storage).not.toContain("dispatchDiyEditingLayout");
    expect(storage).not.toContain("diy-editing-event");
    expect(storage).toMatch(/export function setHomeDiyEditingLayout\(next: boolean\)/);
    // 2026-11-26 wip 快照重构（U-442）：退出编排时除 isEditingLayout: false
    // 外一并复位拖拽层/大纲态/选中块（防残留态），进入时只写 isEditingLayout:
    // true；单行 commitSharedState({ isEditingLayout: next }) 已不存在。
    // 断言跟随新行为改写，并锁死退出复位四项——比旧断言更严，不是放宽。
    expect(storage).toContain("commitSharedState({ isEditingLayout: true })");
    expect(storage).toContain("isEditingLayout: false,");
    expect(storage).toContain("activeDragLayer: 'none',");
    expect(storage).toContain("outlineMode: false,");
    expect(storage).toContain("selectedBlockId: null,");
  });

  it("三键功能仍有替代入口：回顶在命令面板，搜索在顶栏，微工具在首页抽屉", () => {
    const modal = readSource("src/components/search/spotlight-modal.tsx");
    expect(modal).toContain("id: 'cmd-scroll-top'");
    const toolbar = readSource("src/components/navigation-toolbar.tsx");
    expect(toolbar).toContain("SearchPalette");
    const content = readSource("src/components/navigation-content.tsx");
    expect(content).toContain("QuickToolsDrawer");
  });
});
