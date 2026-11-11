/**
 * 速览预览失败兜底守卫（DEV_BACKLOG A6）：
 *
 * 大量站点（GitHub、知乎等）用 X-Frame-Options / CSP 禁止被 iframe 内嵌，
 * 失败时 iframe 不报错、只留一块白屏。此前 site-peek-dialog 的 iframe
 * 没有任何加载态与失败判定，用户点开「沙箱快速预览」看到白屏，
 * 只会以为是本站坏了。
 *
 * 这里守三件事：
 *   1. 预览有明确加载态（loading 覆盖层）；
 *   2. 以 load 为成功信号、5 秒未 load 判定受限并切到 blocked 兜底态；
 *   3. blocked 态给出人话解释 + 「打开原站」按钮（走 safeWindowOpen 安全打开）。
 */
import { existsSync, readFileSync } from "node:fs";
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
  if (!hit) throw new Error("无法定位 web-overlay 根目录（候选：" + candidates.join(" | ") + "）");
  return hit;
}

const SRC = readFileSync(join(overlayRoot(), "src/components/site-peek-dialog.tsx"), "utf8");

describe("速览预览：加载态与禁嵌兜底", () => {
  it("预览有四态状态机（idle/loading/loaded/blocked）", () => {
    expect(SRC).toContain("'idle' | 'loading' | 'loaded' | 'blocked'");
  });

  it("iframe 的 load 事件是成功信号（loading → loaded）", () => {
    expect(SRC).toMatch(/onLoad=\{\(\) => setPreviewState\(\(s\) => \(s === 'loading' \? 'loaded' : s\)\)\}/);
  });

  it("5 秒未 load 判定为被禁嵌（loading → blocked），且定时器有清理", () => {
    expect(SRC).toContain("}, 5000)");
    expect(SRC).toMatch(/s === 'loading' \? 'blocked' : s/);
    expect(SRC).toContain("window.clearTimeout(timer)");
  });

  it("loading 态有可见的加载提示，不再是无声白屏", () => {
    expect(SRC).toContain("正在加载 {item.title} 的预览…");
    expect(SRC).toContain("animate-spin");
  });

  it("blocked 态给出人话解释并明确「不是本站故障」", () => {
    expect(SRC).toContain("这个站点没能在预览窗里打开");
    expect(SRC).toContain("这不是本站故障");
  });

  it("blocked 态有「打开原站」按钮且走安全打开（noopener）", () => {
    expect(SRC).toContain("打开原站");
    expect(SRC).toContain("safeWindowOpen(previewSrc)");
  });

  it("关闭预览/切换站点时状态会重置，不会把上一个站的 blocked 态带给下一个站", () => {
    expect(SRC).toMatch(/setPreviewState\('idle'\)/);
    // 超时判定 effect 依赖当前站点身份，换站会重新进入 loading 计时
    expect(SRC).toContain("}, [open, showIframe, item?.id, item?.href])");
  });
});
