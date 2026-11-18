/**
 * 首屏展板的水合骨架守卫。
 *
 * 真实缺陷（改动前）：`HomeHeroDeck` 以 `ssr: false` 懒加载且没有 loading 占位。
 * 展板默认展开（4 张 min-h-[160px] 卡片），首帧分类区贴在顶部，水合完成后
 * 整页向下跳约 200px——首屏点击会落到「刚被推下来」的另一张卡上。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replaceAll(String.fromCharCode(92), "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(hit, "utf8");
}

describe("首屏展板已小窗化：必须按需懒加载，零首屏水合跳动", () => {
  it("WidgetBoxDialog 与 PinnedCornerWidgets 均为 ssr: false 按需懒加载", () => {
    const src = overlaySource("src/components/navigation-content.tsx");
    expect(src).not.toContain("<HomeHeroDeck />");
    for (const sym of ["const WidgetBoxDialog = dynamic(", "const PinnedCornerWidgets = dynamic("]) {
      const start = src.indexOf(sym);
      expect(start, `缺少 ${sym}`).toBeGreaterThan(-1);
      const block = src.slice(start, src.indexOf("\n)", start) + 2);
      expect(block).toContain("ssr: false");
    }
  });

  it("桌面角落浮窗仅在用户主动固定后按需挂载（避免零缓存首屏堆叠与 CLS）", () => {
    const src = overlaySource("src/components/navigation-content.tsx");
    expect(src).toContain("pinnedMounted && pinnedCornerWidgets.length > 0");
    expect(src).toContain("<PinnedCornerWidgets />");
  });
});
