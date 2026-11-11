/**
 * 字号切换移动端入口守卫（DEV_BACKLOG A13）：
 *
 * 三档字号（标准/大字/特大）早已实现，入口却只有工具栏一处且被
 * `hidden lg:` 包裹——手机上根本没有入口，而目标人群（年长/视力弱）
 * 的主力设备正是手机。本测试守两处移动端可达入口：
 *   1. 工具栏字号按钮全尺寸可见（与主题切换同排，不遮挡内容）；
 *   2. 用户中心「全局设置」里有带文字标签的「字号大小」选择，
 *      与工具栏共用 lib/font-size 同一份 localStorage（不另立真相）。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("A13 移动端字号入口", () => {
  it("工具栏字号按钮不再被 hidden lg: 藏起来", () => {
    const toolbar = read("src/components/navigation-toolbar.tsx");
    expect(toolbar).not.toContain('<div className="hidden lg:inline-flex"><FontSizeToggle /></div>');
    expect(toolbar).toContain('<div className="inline-flex"><FontSizeToggle /></div>');
  });

  it("设置页有带标签的「字号大小」入口且共用同一份本机存储", () => {
    const panel = read("src/components/user-center/settings-panel.tsx");
    expect(panel).toContain("字号大小");
    expect(panel).toContain("from '@/lib/font-size'");
    expect(panel).toContain("FONT_SIZE_STORAGE_KEY");
    expect(panel).toContain("applyFontSizeLevel");
    expect(panel).toContain("loadFontSizeLevel");
    // 三档都可选
    expect(panel).toContain("'standard', 'large', 'xlarge'");
  });

  it("桌面端原有入口不回归：FontSizeToggle 组件与水合前脚本仍在", () => {
    const toggle = read("src/components/font-size-toggle.tsx");
    expect(toggle).toContain("FONT_SIZE_STORAGE_KEY");
    expect(read("src/lib/font-size.ts")).toContain("FONT_SIZE_PREPAINT_SCRIPT");
  });

  it("字号档位行为：解析与应用口径不变（16/18/20）", async () => {
    const fs = await import(pathToFileURL(join(ROOT, "src/lib/font-size.ts")).href);
    expect(fs.FONT_SIZE_PX).toEqual({ standard: 16, large: 18, xlarge: 20 });
    expect(fs.parseFontSizeLevel("large")).toBe("large");
    expect(fs.parseFontSizeLevel("xlarge")).toBe("xlarge");
    expect(fs.parseFontSizeLevel("bogus")).toBe("standard");
    expect(fs.parseFontSizeLevel(null)).toBe("standard");
    const root = { style: {} as Record<string, string>, dataset: {} as Record<string, string> };
    fs.applyFontSizeLevel("xlarge", root);
    expect(root.style.fontSize).toBe("20px");
    expect(root.dataset.fontSize).toBe("xlarge");
  });
});
