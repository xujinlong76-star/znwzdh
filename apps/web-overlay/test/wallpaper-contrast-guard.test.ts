import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateAndCleanDIYConfig } from "@/lib/modular/diy-presets";

/**
 * F4 自定义壁纸文字可读性兜底（2026-11-02）。
 *
 * 背景：DIY 卡片不透明度 cardOpacity 可以低到 0.2，自定义壁纸最亮/最暗时
 * 卡片标题/描述对底色的对比度会跌破 AA；旧配置与旧分享链接（co_op=0.2）
 * 还会把这个值读回来。锁四层：
 *   1. use-home-diy 写入端 clamp ≥0.85（源码锁）；
 *   2. 读取端（config 初始化 / URL-Hash 归一）同样 clamp（源码锁 + 函数单测）；
 *   3. .glass-surface 与卡片底色的 alpha ≥0.85（解析实际 alpha，非空断言）；
 *   4. 滑杆 UI 最小值刻度就是 0.85（可读性下限提示）。
 *
 * 非空性证据（2026-11-02）：写入 clamp 临时改回 0.2 → 第 1 项变红；
 * 复原 0.85 后全绿。
 */

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find(
    (p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p),
  );
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(hit, "utf8");
}

const MIN = 0.85;

describe("cardOpacity 可读性下限（读写双端 clamp ≥0.85）", () => {
  it("use-home-diy 写入端 clamp 下限 0.85", () => {
    const src = overlayFile("src/lib/modular/use-home-diy.ts");
    expect(src, "写入端应 clamp 到 ≥0.85").toContain("Math.min(1.0, Math.max(0.85, opacity))");
    expect(src, "不得残留 0.2 旧下限").not.toContain("Math.max(0.2, opacity)");
  });

  it("use-home-diy 读取端同样 clamp（旧配置 0.2 读到即抬升）", () => {
    const src = overlayFile("src/lib/modular/use-home-diy.ts");
    expect(
      src,
      "config.cardOpacity ?? 0.9 的裸读取路径必须 clamp（旧配置存过 0.2）",
    ).not.toMatch(/cardOpacity:\s*config\.cardOpacity\s*\?\?\s*0\.9/);
    expect(src).toMatch(/Math\.min\(1\.0, Math\.max\(0\.85, config\.cardOpacity \?\? 0\.9\)\)/);
  });
});

describe("旧值迁移（normalize 等价归一函数级单测）", () => {
  it("validateAndCleanDIYConfig({cardOpacity: 0.2}) 读出 ≥0.85", () => {
    // 带最小元数据（viewMode/version 是归一函数的入口要求）
    const r = validateAndCleanDIYConfig({ viewMode: "hybrid", cardOpacity: 0.2 });
    expect(r.valid, "旧预设应能通过校验").toBe(true);
    expect(r.config?.cardOpacity).toBeGreaterThanOrEqual(MIN);
  });

  it("URL-Hash 旧链接形状 {co_op: 0.2} 读出 ≥0.85（分享方/接收方无分叉）", () => {
    const r = validateAndCleanDIYConfig({ viewMode: "hybrid", co_op: 0.2 });
    expect(r.valid).toBe(true);
    expect(r.config?.cardOpacity).toBeGreaterThanOrEqual(MIN);
    // 存储层解析路径自身也带 clamp（双保险，防归一函数被绕过）
    const src = overlayFile("src/lib/modular/home-diy-storage.ts");
    expect(src).toMatch(/Math\.max\(0\.85/);
    expect(src, "hash 解析必须经归一函数").toContain("validateAndCleanDIYConfig");
  });
});

describe("玻璃面板与卡片底色 alpha ≥0.85（壁纸最亮/最暗兜底）", () => {
  const alphaOf = (css: string, selector: string): number => {
    const idx = css.indexOf(selector);
    expect(idx, `globals.css 缺少 ${selector} 规则`).toBeGreaterThanOrEqual(0);
    const block = css.slice(idx, idx + 500);
    const m = /hsl\(var\(--card\)\s*\/\s*([\d.]+)\)/.exec(block);
    expect(m, `${selector} 应使用 hsl(var(--card) / a) 底色`).toBeTruthy();
    return Number(m![1]);
  };

  it(".glass-surface 背景 alpha ≥0.85", () => {
    const css = overlayFile("src/styles/globals.css");
    const a = alphaOf(css, ".glass-surface");
    expect(a, `.glass-surface alpha=${a} 低于可读性下限`).toBeGreaterThanOrEqual(MIN);
  });

  it("卡片底色未分层兜底存在且 alpha ≥0.85（压过热区 bg-card/45）", () => {
    const css = overlayFile("src/styles/globals.css");
    // .nav-card-deferred 在 utilities 层还有一个 content-visibility 定义；
    // 兜底规则带 background-color，按属性精确定位
    const m = /\.nav-card-deferred\s*\{\s*background-color:\s*hsl\(var\(--card\)\s*\/\s*([\d.]+)\)/.exec(css);
    expect(m, "缺少 .nav-card-deferred 背景兜底规则").toBeTruthy();
    const a = Number(m![1]);
    expect(a, `卡片兜底 alpha=${a} 低于可读性下限`).toBeGreaterThanOrEqual(MIN);
    // 必须在任何块之外（含 @layer）：未分层声明才压得过 bg-card/45 分层工具类
    const idx = m!.index;
    let depth = 0;
    for (const ch of css.slice(0, idx)) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    expect(depth, "卡片底色兜底必须写在任何块之外（含 @layer）").toBe(0);
  });

  it("卡片内 text-muted-foreground/90 透明度变体被归一为不透明（黑壁纸浅色实测 3.81→4.8）", () => {
    const css = overlayFile("src/styles/globals.css");
    expect(css, "缺少卡片内 muted 透明度归一规则（热区释放前的兜底）").toContain(
      ".nav-card-deferred .text-muted-foreground\\/90",
    );
    expect(css).toMatch(/\.nav-card-deferred \.text-muted-foreground\\\/90\s*\{\s*color:\s*hsl\(var\(--muted-foreground\)\)/);
  });
});

describe("滑杆 UI 下限刻度", () => {
  it("透明度滑杆 min=0.85 且带「可读性下限」提示", () => {
    const src = overlayFile("src/components/home-diy-toolbar.tsx");
    expect(src).toContain("min={0.85}");
    expect(src).toContain("可读性下限");
    expect(src, "滑杆 aria-label 需注明下限").toContain("卡片不透明度（可读性下限 0.85）");
  });
});
