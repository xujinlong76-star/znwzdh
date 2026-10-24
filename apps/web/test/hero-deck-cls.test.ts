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

describe("首屏展板必须有同高骨架", () => {
  it("HomeHeroDeck 的 dynamic 配置带 loading 占位", () => {
    const src = overlaySource("src/components/navigation-content.tsx");
    const start = src.indexOf("const HomeHeroDeck = dynamic(");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf("\n)", start) + 2);
    expect(block).toContain("loading: () =>");
    // 骨架高度要与真实卡片对齐，否则「有骨架也照样跳」
    expect(block).toContain("min-h-[160px]");
  });
});
