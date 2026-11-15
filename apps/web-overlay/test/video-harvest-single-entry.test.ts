/**
 * 视频采集双入口合并守卫（C 组第 2 簇）：只合 UI，不合后端。
 *
 * 原先控制条上有两个按钮（热点采集 / AI自主采集），对应两个独立弹窗；
 * 现在只有一个「视频采集」入口，打开视频采集中心弹窗，里面两个 tab：
 *   - 手动采集：原 video-auto-harvest-dialog 流程，走 /api/videos/harvest
 *   - AI自主巡航：原 console 的内容改成面板嵌进来，走 /api/videos/ai-autonomous-harvest
 * 后端接口、lib 与管理页统计一律不动。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.includes("web-overlay") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(hit, "utf8").replace(/\r\n/g, "\n");
}

const DIALOG = "src/components/video-auto-harvest-dialog.tsx";
const CONSOLE = "src/components/video-autonomous-harvest-console.tsx";
const CONTROL_BAR = "src/components/video-player-control-bar.tsx";
const PAGE = "src/components/video-player-page.tsx";

describe("视频采集：两个入口合并为一个", () => {
  it("控制条只有一个采集入口 opener，不再有 autoHarvest / autonomousHarvest 两个", () => {
    const src = overlaySource(CONTROL_BAR);
    expect(src).toContain("harvest: () => void");
    expect(src).not.toContain("autoHarvest");
    expect(src).not.toContain("autonomousHarvest");
    expect(src).toContain("onClick={openers.harvest}");
    expect(src).not.toContain("AI自主采集");
    expect(src).toContain("视频采集");
  });

  it("播放器页只传一个 harvest opener，只挂一个采集弹窗", () => {
    const src = overlaySource(PAGE);
    expect(src).toContain("harvest: () => setShowAutoHarvestDialog(true)");
    expect(src).not.toContain("VideoAutonomousHarvestConsole");
    expect(src).not.toContain("showAutonomousHarvestConsole");
    expect(src).not.toContain("autonomousHarvest");
  });

  it("采集中心弹窗内有两个 tab：手动采集 / AI自主巡航", () => {
    const src = overlaySource(DIALOG);
    expect(src).toContain('role="tablist"');
    expect(src).toContain("手动采集");
    expect(src).toContain("AI自主巡航");
    expect(src).toContain("VideoAutonomousHarvestPanel");
    expect(src).toContain("tab === 'manual'");
    expect(src).toContain("tab === 'autonomous'");
  });

  it("自主巡航已改成面板：无独立 Dialog 外壳，仍走自己的后端接口", () => {
    const src = overlaySource(CONSOLE);
    expect(src).toContain("export function VideoAutonomousHarvestPanel");
    expect(src).not.toContain("VideoAutonomousHarvestConsole");
    expect(src).not.toContain("<Dialog");
    expect(src).toContain("fetch('/api/videos/ai-autonomous-harvest'");
    expect(src).toContain("method: 'POST'");
  });

  it("手动采集流程仍在，后端接口未动", () => {
    const src = overlaySource(DIALOG);
    expect(src).toContain("handleStartHarvest");
    expect(src).toContain("立即采集并入库");
  });
});
