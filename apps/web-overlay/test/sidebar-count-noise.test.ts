import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 侧栏计数降噪守卫（2026-11-25 UI 评审 P0-2 ② 阶段 C）。
 *
 * 背景：侧栏几乎每个类目都挂站数徽章（341/287/265/319…），数字等权铺满
 * 形成均匀噪音，类目名反而不敢留白。口径：**非当前类目默认隐形**，
 * 悬停 / 键盘聚焦 / 触屏（无 hover 能力）时显示；当前类目恒显。
 *
 * 两条硬约束：
 *   1) 降噪只能用 opacity——不许 hidden / display:none / sr-only：
 *      计数要留在无障碍树里（读屏照读），宽度也不许塌缩（行不抖动）；
 *   2) 触屏没有 hover：pointer-coarse 必须恒显，否则手机上永远看不到站数。
 */

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(hit, "utf8");
}

const SIDEBAR = "src/components/sidebar.tsx";

describe("侧栏计数降噪（P0-2 ②）", () => {
  const src = overlayFile(SIDEBAR);

  it("非当前类目：计数 opacity-0，悬停/聚焦/触屏三路恢复", () => {
    expect(src).toContain("opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100");
  });

  it("当前类目恒显，且高亮档（primary 底 + 加粗）保留", () => {
    expect(src).toContain("bg-primary/15 font-semibold text-primary opacity-100");
  });

  it("降噪用 opacity 而非摘除：计数不带 hidden / sr-only / display-none", () => {
    // 计数徽章的基类（不含可见性分支）必须仍然完整保留
    expect(src).toContain(
      "ml-0.5 shrink-0 rounded-full px-1.5 py-0.2 font-mono text-[10px] tabular-nums",
    );
    // 同一段类名串里不得混入摘除类（读屏与布局都必须保留）
    expect(src).not.toMatch(/tabular-nums[^"`]*\bhidden\b/);
    expect(src).not.toMatch(/tabular-nums[^"`]*sr-only/);
    expect(src).not.toMatch(/tabular-nums[^"`]*display-none/);
  });

  it("折叠成图标轨时计数只在 tooltip 里（既有行为不回潮）", () => {
    expect(src).toContain("rounded-full bg-background/20 px-1.5 py-0.2 font-mono text-[10px] tabular-nums opacity-85");
  });
});
