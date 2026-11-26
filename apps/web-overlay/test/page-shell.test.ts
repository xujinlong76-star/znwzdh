import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { PROMO_MUTE_DAYS, PromoBanner, promoHiddenUntil } from "../src/components/promo-banner";

/**
 * 页面框架守卫（2026-11-25 UI 评审 P0-1 阶段 B）。
 *
 * 背景：home / sites / hot / category 四页此前各配一套「Container + py + space-y + max-w」
 * 组合，纵向节奏与页面头写了三份。本守卫钉住框架化的三件事：
 *   1) /sites、/hot、/category 必须走 PageShell（结构单源，不许回到随手组合）；
 *   2) 纵向节奏只在 page-shell.tsx 出现一次，页面里不许再自带 py 与 space-y 帧；
 *   3) 推广横幅走 PromoBanner 原语：可关闭 + 7 天记忆，不再写死。
 * 另钉 main-landmark 兼容：id="main-content" 字面量必须留在页面/主体源码里
 * （main-landmark.test.ts 按字面量扫描，省掉 id 会被判「没有地标」）。
 */

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(hit, "utf8");
}

const SHELL_PAGES = [
  "src/app/category/page.tsx",
  "src/app/hot/page.tsx",
  "src/app/sites/sites-directory.tsx",
];

describe("PageShell 页面框架", () => {
  it.each(SHELL_PAGES)("%s 走 PageShell 且保留 main 地标字面量", (rel) => {
    const src = overlayFile(rel);
    expect(src).toContain("from '@/components/page-shell'");
    expect(src).toContain("<PageShell");
    // main-landmark.test.ts 的扫描口径：字面量必须在调用方源码里
    expect(src).toContain('id="main-content"');
    expect(src).toContain('as="main"');
  });

  it("纵向节奏单源：页面不再自带 py-*/space-y-* 帧（只在 page-shell.tsx 定义）", () => {
    for (const rel of SHELL_PAGES) {
      const src = overlayFile(rel);
      expect(src, `${rel} 不应再写页面级纵向节奏`).not.toMatch(/py-4 sm:py-8|py-6 sm:py-10/);
      expect(src, `${rel} 不应再自带内容帧 space-y`).not.toContain("max-w-5xl mx-auto");
    }
    const shell = overlayFile("src/components/page-shell.tsx");
    expect(shell).toContain("py-6 sm:py-10 space-y-6");
    expect(shell).toContain("max-w-5xl mx-auto");
  });

  it("页面头单源：/sites 与 /category 用 PageHeader，不再自写 h1 帧", () => {
    for (const rel of ["src/app/category/page.tsx", "src/app/sites/sites-directory.tsx"]) {
      const src = overlayFile(rel);
      expect(src).toContain("<PageHeader");
      expect(src, `${rel} 的 h1 帧已收进 PageHeader`).not.toContain("text-2xl sm:text-3xl font-extrabold");
    }
    const shell = overlayFile("src/components/page-shell.tsx");
    expect(shell).toContain("text-2xl sm:text-3xl font-extrabold");
    expect(shell).toContain("aria-label=\"站内目录\"");
  });

  it("宽度语义在框架里集中定义（doc=窄栏 / list=全宽）", () => {
    const shell = overlayFile("src/components/page-shell.tsx");
    expect(shell).toContain("export type PageShellWidth = 'doc' | 'list'");
    expect(shell).toContain("doc: 'max-w-5xl mx-auto'");
  });
});

describe("PromoBanner 推广横幅原语", () => {
  it("关闭记忆 7 天：promoHiddenUntil 口径钉死", () => {
    expect(PROMO_MUTE_DAYS).toBe(7);
    const now = 1_800_000_000_000;
    expect(promoHiddenUntil(now) - now).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("壳渲染标题/描述/CTA/关闭钮（关闭钮带 7 天说明的 aria-label）", () => {
    const html = renderToString(
      createElement(PromoBanner, {
        storageKey: "test.promo",
        title: "示例推广标题",
        description: "示例描述",
        actionHref: "/videos",
        actionLabel: "去看看",
      }),
    );
    expect(html).toContain("示例推广标题");
    expect(html).toContain("示例描述");
    expect(html).toContain("去看看");
    expect(html).toContain('href="/videos"');
    expect(html).toContain(`关闭此提示，${PROMO_MUTE_DAYS} 天内不再显示`);
  });

  it("/sites 推广位已迁移到 PromoBanner（带独立 storageKey），原语带 localStorage 记忆", () => {
    const dir = overlayFile("src/app/sites/sites-directory.tsx");
    expect(dir).toContain("<PromoBanner");
    expect(dir).toContain("navhub.promo.video-hub.v1");
    expect(dir).toContain("MonitorPlay");
    expect(dir).toContain('actionHref="/videos"');

    const banner = overlayFile("src/components/promo-banner.tsx");
    expect(banner).toContain("localStorage");
    expect(banner).toContain("PROMO_MUTE_DAYS");
    // 服务端/水合首帧一致：初始不隐藏，挂载后再按记忆隐藏
    expect(banner).toContain("useState(false)");
    expect(banner).toContain("setHidden(muted)");
    expect(banner).toContain("[storageKey]");
  });
});
