import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * #17 触屏不渲染「按不到的键」（2026-11-07）。
 *
 * 判据用指针类型 `pointer-coarse:` 而不是断点宽度：640px 以上的平板同样是触屏，
 * 按 `sm:` 筛会漏掉它们。纯 CSS 变体，不在渲染期读 navigator —— 那样会引入
 * SSR/水合闪烁。
 *
 * 锁三类东西：
 *   1. 已处理的提示位（⌘K / ESC / ↑↓↵ / E / Cmd/Ctrl+J / 引导第 2 步）的 class
 *      片段必须仍在，且带 `pointer-coarse:hidden`；删掉变体 → 对应案例变红。
 *   2. 有意豁免的三处：键盘指南本身、tooltip 内的提示（触屏不触发）、
 *      软键盘打得出的输入前缀（`>` `?`）。第 3 组断言把「tooltip 内」这个
 *      豁免前提也锁住——前提没了就该改代码，而不是改测试。
 *   3. 编译顺序：`sm:pointer-coarse:hidden` 必须排在 `sm:flex` 之后，
 *      这条只在产物 CSS 里看得见，所以单独跑一次 Tailwind 编译锁住。
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

const gated: Array<[string, string]> = [
  ["src/components/search-bar.tsx", "opacity-100 sm:flex sm:pointer-coarse:hidden"],
  ["src/components/search-palette.tsx", "opacity-100 sm:flex sm:pointer-coarse:hidden shadow-2xs"],
  ["src/components/search-palette.tsx", "hidden sm:flex sm:pointer-coarse:hidden items-center gap-3 border-t border-border/60 bg-muted/20"],
  ["src/components/search/spotlight-modal.tsx", "hidden sm:inline-flex sm:pointer-coarse:hidden h-5"],
  ["src/components/search/spotlight-modal.tsx", 'flex items-center gap-1 pointer-coarse:hidden'],
  ["src/components/home-diy-toolbar.tsx", "hidden sm:inline-block sm:pointer-coarse:hidden text-[10px]"],
  ["src/components/ai/ai-copilot-drawer.tsx", "hidden sm:flex sm:pointer-coarse:hidden items-center gap-1"],
  ["src/components/ai/ai-copilot-drawer.tsx", "hidden sm:inline sm:pointer-coarse:hidden"],
  ["src/components/onboarding-card.tsx", 'pointer-coarse:hidden">，或按'],
];

describe("键盘提示的触屏降噪", () => {
  it.each(gated)("%s 的提示位带 pointer-coarse:hidden", (file, fragment) => {
    expect(overlayFile(file), `${file} 丢了片段：${fragment}`).toContain(fragment);
  });

  it("引导第 2 步不再假定用户有键盘", () => {
    const src = overlayFile("src/components/onboarding-card.tsx");
    expect(src).not.toMatch(/2\.\s*用键盘搜索/);
    expect(src).toMatch(/2\.\s*搜索/);
  });
});

describe("豁免前提仍然成立", () => {
  it("卡片的 Space 提示只活在 tooltip 里（触屏不会触发）", () => {
    const src = overlayFile("src/components/navigation-card.tsx");
    const hits = [...src.matchAll(/Space 空格键/g)];
    expect(hits.length).toBeGreaterThan(0);
    for (const m of hits) {
      const before = src.slice(0, m.index);
      const open = before.lastIndexOf("<TooltipContent");
      const close = before.lastIndexOf("</TooltipContent>");
      expect(
        open > close,
        `「${src.slice(m.index! - 40, m.index! + 20).replace(/\s+/g, " ")}」不在 tooltip 内，触屏会看到它`,
      ).toBe(true);
    }
  });

  it("指南弹窗与图谱页照常讲键盘（它们就是键盘文档）", () => {
    expect(overlayFile("src/components/keyboard-shortcuts-dialog.tsx")).toContain("kbd");
    expect(overlayFile("src/app/graph/page.tsx")).toContain("键盘漫游");
  });
});

// ============================================================
// 产物口径：整套降噪靠的是「pointer-coarse 变体排在 sm:flex 之后」这一条
// 隐式规则。它不在源码里，只在编译顺序里 —— 所以必须在产物 CSS 上锁死，
// 否则哪天变体顺序变了，提示位会安静地回到触屏首屏（globals.css 记过同类事故）。
// ============================================================
describe("编译产物里触屏变体确实覆盖了宽度变体", () => {
  it("sm:pointer-coarse:hidden 进产物，且排在 sm:flex 之后", async () => {
    const app = resolve(HERE, "..");
    const base = join(app, "src", "styles");
    const globals = join(base, "globals.css");
    if (!existsSync(globals)) {
      console.warn("[touch-keyboard-hints] 未找到 apps/*/src/styles/globals.css，跳过产物检查");
      return;
    }
    const req = createRequire(import.meta.url);
    const pluginEntry = req.resolve("@tailwindcss/postcss");
    const fromPlugin = createRequire(pluginEntry);
    let postcss: (plugins: unknown[]) => {
      process: (css: string, opts: { from: string }) => Promise<{ css: string }>;
    };
    try {
      postcss = req("postcss");
    } catch {
      postcss = fromPlugin("postcss");
    }
    const tailwindPlugin = fromPlugin("@tailwindcss/postcss") as (opts: {
      base: string;
    }) => unknown;
    const { css } = await postcss([tailwindPlugin({ base })]).process(readFileSync(globals, "utf8"), {
      from: globals,
    });

    const idx = (re: RegExp) => css.search(re);
    const gated = idx(/\.sm\\:pointer-coarse\\:hidden\b/);
    const flex = idx(/\.sm\\:flex\b/);
    expect(css.length, "产物 CSS 不应为空").toBeGreaterThan(1000);
    expect(gated, "触屏变体没编进产物：要么 @source 扫描集丢了使用方，要么 Tailwind 不再内置 pointer-coarse").toBeGreaterThan(
      -1,
    );
    expect(
      gated,
      `排序不成立：.sm\\:pointer-coarse\\:hidden(${gated}) 必须出现在 .sm\\:flex(${flex}) 之后，` +
        `否则同断点下 display 会被 sm:flex 赢回去，提示位在平板上照样可见。`,
    ).toBeGreaterThan(flex);
  }, 60_000);
});
