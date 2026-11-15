/**
 * FloatingQuickNav 与 DIY 子树解耦守卫。
 *
 * 事故形状：a2be92ee 把 FloatingQuickNav 全局挂进 providers（layout），而它
 * 静态 import use-home-diy；use-home-diy 的静态闭包是 10 个文件约 217 KB
 * 源码（diy-presets / home-diy-storage / layout-sync / diy-share-link /
 * diy-layout-schema / use-home-diy-grid / diy-drag / grid-layout /
 * layout-sync-events / use-home-diy 自身），整棵子树因此进了根布局的
 * layout 共享 chunk，/me 等 9 路超包预算。zod 不在其中（只经 await import）。
 *
 * 解法：FloatingQuickNav 只读 `isEditingLayout` 一个布尔值，改听事件桥
 *（lib/diy-editing-event，零依赖）：编排态初始恒 false，唯一写入入口
 * setHomeDiyEditingLayout 每次翻转都广播。按钮壳仍是同步渲染的 JSX，
 * 不经任何 dynamic()/await import，首屏立即可用；DIY 功能本身未动，
 * 首页 DIY 组件照常用 useHomeDIY。
 *
 * 这里锁四件事，防止后续重构把它静默改回去：
 *   1. floating-quick-nav.tsx 不得再静态 import use-home-diy；
 *   2. 事件桥两端都在：storage 翻转时广播、组件订阅且初始 false；
 *   3. 事件桥模块零依赖（否则桥本身又把子树拉回来）；
 *   4. 按钮壳仍是同步 JSX、无懒加载门（首屏立即可用）；
 *   5. 事件桥收发往返真实跑通（含 SSR 无 window 时不抛错、退订生效）。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import {
  DIY_EDITING_LAYOUT_EVENT,
  dispatchDiyEditingLayout,
  subscribeDiyEditingLayout,
} from "../src/lib/diy-editing-event";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.includes("web-overlay") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(hit, "utf8");
}

describe("FloatingQuickNav：不再静态拉入 DIY 子树", () => {
  it("floating-quick-nav.tsx 不再 import use-home-diy", () => {
    const src = overlaySource("src/components/floating-quick-nav.tsx");
    expect(src).not.toMatch(/from\s*['"]@\/lib\/modular\/use-home-diy['"]/);
    expect(src).not.toContain("useHomeDIY()");
    expect(src).toContain("subscribeDiyEditingLayout");
  });

  it("事件桥两端都在：storage 翻转时广播、组件订阅且初始 false", () => {
    const storage = overlaySource("src/lib/modular/home-diy-storage.ts");
    expect(storage).toContain("dispatchDiyEditingLayout(next)");
    expect(storage).toMatch(/export function setHomeDiyEditingLayout\(next: boolean\)/);
    const nav = overlaySource("src/components/floating-quick-nav.tsx");
    expect(nav).toContain("useState(false)");
    expect(nav).toContain("subscribeDiyEditingLayout(setIsEditingLayout)");
    expect(nav).toContain("isEditingLayout");
  });

  it("事件桥模块零依赖：没有任何 import 语句", () => {
    const bridge = overlaySource("src/lib/diy-editing-event.ts");
    expect(bridge).not.toMatch(/^\s*import\s/m);
    expect(bridge).toContain(`DIY_EDITING_LAYOUT_EVENT = 'navhub:diy-editing-layout'`);
  });

  it("按钮壳仍是同步 JSX、无懒加载门：搜索/回顶按钮首屏立即可用", () => {
    const src = overlaySource("src/components/floating-quick-nav.tsx");
    // 三个浮钮 + 唤起事件都在同步渲染路径上，不经 dynamic()/await import
    expect(src.match(/h-11 w-11/g)?.length).toBe(3);
    expect(src).toContain("aria-label=\"呼出超级搜索控制台\"");
    expect(src).toContain("aria-label=\"回到顶部\"");
    expect(src).toContain("new CustomEvent('open-spotlight')");
    expect(src).not.toContain("dynamic(");
    expect(src).not.toContain("await import(");
    expect(src).not.toContain("useHomeDIY");
  });
});

describe("事件桥 diy-editing-event：收发往返", () => {
  const g = globalThis as unknown as { window?: unknown };
  const savedWindow = g.window;

  afterAll(() => {
    if (savedWindow === undefined) delete g.window;
    else g.window = savedWindow;
  });

  it("订阅后 dispatch(true/false) 如实送达，退订后不再送达", () => {
    g.window = new EventTarget();
    const seen: boolean[] = [];
    const off = subscribeDiyEditingLayout((next) => seen.push(next));
    dispatchDiyEditingLayout(true);
    dispatchDiyEditingLayout(false);
    expect(seen).toEqual([true, false]);
    off();
    dispatchDiyEditingLayout(true);
    expect(seen).toEqual([true, false]);
  });

  it("事件名与常量一致：外部 dispatch 同名 CustomEvent 也能收到", () => {
    g.window = new EventTarget();
    const seen: boolean[] = [];
    const off = subscribeDiyEditingLayout((next) => seen.push(next));
    (g.window as EventTarget).dispatchEvent(
      new CustomEvent(DIY_EDITING_LAYOUT_EVENT, { detail: true }),
    );
    expect(seen).toEqual([true]);
    off();
  });

  it("SSR / 无 window 时 dispatch 与 subscribe 都不抛错", () => {
    delete g.window;
    expect(() => dispatchDiyEditingLayout(true)).not.toThrow();
    expect(() => subscribeDiyEditingLayout(() => {})()).not.toThrow();
  });
});
