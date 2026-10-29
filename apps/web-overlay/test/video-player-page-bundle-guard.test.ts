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
 *   3. 那 6 个无条件挂载的面板仍是静态 import——把它们 dynamic() 化是假省字节
 *      （官方文档：dynamic 的组件即便无条件挂载也「立即加载，只是在独立 chunk 里」），
 *      这里反向钉住，防止有人拿它们凑数；
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
const OPTIONS_LIB = "src/lib/bili-engine-options.ts";

/** 条件挂载、必须异步的两块 */
const DEFERRED = [
  { name: "VideoBilibiliHdPlayer", module: "@/components/video-bilibili-hd-player" },
  { name: "VideoKaraokeSubtitles", module: "@/components/video-karaoke-subtitles" },
];

/** 无条件挂载、必须保持静态的六块 */
const ALWAYS_MOUNTED = [
  "video-heatmap-timeline",
  "video-network-sentinel",
  "video-voice-indicator",
  "video-telestrator-canvas",
  "video-pip-window-renderer",
  "video-gesture-hud-overlay",
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
    const src = overlaySource(PAGE);
    expect(src).toMatch(/import \{ BILI_ENGINE_OPTIONS \} from '@\/lib\/bili-engine-options'/);
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

  it("六块无条件挂载的面板保持静态 import（dynamic 化它们属于假省字节）", () => {
    const src = overlaySource(PAGE);
    for (const mod of ALWAYS_MOUNTED) {
      expect(src).toMatch(new RegExp(`import \\{ \\w+ \\} from '@\/components\/${mod}'`));
      expect(src).not.toContain(`import('@/components/${mod}')`);
    }
  });

  it("播放器渲染点外层容器定尺寸（异步挂载不引入 CLS）", () => {
    const src = overlaySource(PAGE);
    const at = src.indexOf("<VideoBilibiliHdPlayer");
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(Math.max(0, at - 200), at)).toContain("aspect-video");
  });
});
