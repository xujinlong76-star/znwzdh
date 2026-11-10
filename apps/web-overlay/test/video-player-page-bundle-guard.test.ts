/**
 * /videos/player 首屏体积守卫（run124）。
 *
 * 事故形状：video-player-page.tsx 用一条静态 import 同时取走了 B站高清播放器和它的
 * 换源常量表（原 :111「常驻组件：随播放器一起在首屏渲染，保持静态导入」）。换源下拉框
 * 确实无条件渲染，但播放器只在 platform === 'bilibili' 分支挂载——常量把 800 行播放器
 * 连同其依赖图一起钉进了本页 first-load。前端门禁 step 10（check-bundle-budget）因此
 * 把 /videos/player 判红（run121/run122 隔离构建实测 924564 B > 预算 902144 B）。
 *
 * 这里锁四件事：
 *   1. 播放器和逐字字幕必须走 dynamic()：两者都是条件挂载，异步 chunk 才真挪走字节；
 *   2. 无条件用到的常量来自零依赖模块，常量不许再把播放器拖回来；
 *   3. 六块面板的加载策略逐块钉住（本条 2026-11-11 按现状重写：原断言「六块全部
 *      静态 import」在后续瘦身轮次把其中四块改成 dynamic 后已与实现脱节、长期红，
 *      继续断言不存在的形态只会训练大家无视门禁）：
 *      - video-network-sentinel 保持静态 import（哨兵需随播放器同帧就位）；
 *      - voice-indicator / telestrator-canvas / pip-window-renderer /
 *        gesture-hud-overlay 保持 dynamic（均为覆盖层/HUD，靠 props 内部开关显隐，
 *        异步 chunk 不影响首帧关键路径，预算实测亦在限内）——两种方向都不许偷偷翻转；
 *      - video-heatmap-timeline 已整体下线（2026-11-11 审计第二批：无真实观看热度
 *        数据管线，「无数据不给入口」），不得以任何形式 import 回播放器页；
 *   4. 播放器渲染点外层容器保留 aspect-video 定尺寸，异步挂载不引入 CLS。
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

const PAGE = "src/components/video-player-page.tsx";
const CONTROL_BAR = "src/components/video-player-control-bar.tsx";
const OPTIONS_LIB = "src/lib/bili-engine-options.ts";

/** 条件挂载、必须异步的两块 */
const DEFERRED = [
  { name: "VideoBilibiliHdPlayer", module: "@/components/video-bilibili-hd-player" },
  { name: "VideoKaraokeSubtitles", module: "@/components/video-karaoke-subtitles" },
];

/** 保持静态 import 的一块（哨兵需随播放器同帧就位） */
const STATIC_PANELS = ["video-network-sentinel"];

/** 保持 dynamic 的四块覆盖层/HUD（靠 props 内部开关显隐，异步 chunk 不伤首帧） */
const DYNAMIC_PANELS = [
  { name: "VideoVoiceIndicator", module: "@/components/video-voice-indicator" },
  { name: "VideoTelestratorCanvas", module: "@/components/video-telestrator-canvas" },
  { name: "VideoPipWindowRenderer", module: "@/components/video-pip-window-renderer" },
  { name: "VideoGestureHudOverlay", module: "@/components/video-gesture-hud-overlay" },
];

describe("/videos/player 首屏：条件挂载的播放器移出 first-load", () => {
  for (const { name, module } of DEFERRED) {
    it(`${name} 不得静态 import`, () => {
      const src = overlaySource(PAGE);
      expect(src).not.toMatch(
        new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*['"]${module.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]`),
      );
    });

    it(`${name} 用 dynamic + 具名导出 .then + ssr:false`, () => {
      const src = overlaySource(PAGE);
      const decl = new RegExp(
        `const ${name} = dynamic\\(\\(\\) => import\\('${module}'\\)\\.then\\(m => m\\.${name}\\), \\{ ssr: false \\}\\)`,
      );
      expect(src).toMatch(decl);
    });
  }

  it("换源常量从无 import 的独立模块静态取（否则常量把播放器拖回首屏）", () => {
    // 换源下拉框随控制条一并搬到 video-player-control-bar.tsx（2026-11-09 A-2 第二步），
    // 常量必须由控制条静态取，且控制条本身由页面静态 import——整条链仍不经过播放器。
    const src = overlaySource(CONTROL_BAR);
    expect(src).toMatch(/import \{ BILI_ENGINE_OPTIONS \} from '@\/lib\/bili-engine-options'/);
    expect(overlaySource(PAGE)).toContain(
      "import { VideoPlayerControlBar } from '@/components/video-player-control-bar'",
    );
    const lib = overlaySource(OPTIONS_LIB);
    expect(lib).toMatch(/^export interface BiliEngineOption \{/m);
    expect(lib).toMatch(/^export const BILI_ENGINE_OPTIONS: BiliEngineOption\[\] = \[/m);
    expect(lib).not.toMatch(/^\s*import\s/m);
  });

  it("播放器仍从新模块取同一份常量（不留两套引擎清单）", () => {
    const player = overlaySource("src/components/video-bilibili-hd-player.tsx");
    expect(player).toContain("import { BILI_ENGINE_OPTIONS } from '@/lib/bili-engine-options'");
    expect(player).not.toMatch(/^export const BILI_ENGINE_OPTIONS/m);
  });

  it("video-network-sentinel 保持静态 import（不许 dynamic 化）", () => {
    const src = overlaySource(PAGE);
    for (const mod of STATIC_PANELS) {
      expect(src).toMatch(new RegExp(`import \\{ \\w+ \\} from '@\/components\/${mod}'`));
      expect(src).not.toContain(`import('@/components/${mod}')`);
    }
  });

  it("四块覆盖层/HUD 保持 dynamic + 具名导出 .then + ssr:false（不许改回静态钉进首屏）", () => {
    const src = overlaySource(PAGE);
    for (const { name, module } of DYNAMIC_PANELS) {
      const decl = new RegExp(
        `const ${name} = dynamic\\(\\(\\) => import\\('${module.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'\\)\\.then\\(m => m\\.${name}\\), \\{ ssr: false \\}\\)`,
      );
      expect(src).toMatch(decl);
    }
  });

  it("video-heatmap-timeline 已整体下线，不得以任何形式 import 回播放器页", () => {
    const src = overlaySource(PAGE);
    expect(src).not.toContain("video-heatmap-timeline");
  });

  it("播放器渲染点外层容器定尺寸（异步挂载不引入 CLS）", () => {
    const src = overlaySource(PAGE);
    const at = src.indexOf("<VideoBilibiliHdPlayer");
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(Math.max(0, at - 200), at)).toContain("aspect-video");
  });
});
