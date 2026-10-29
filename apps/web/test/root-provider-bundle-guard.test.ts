/**
 * 根布局首屏预算守卫。
 *
 * 事故形状：d1f2750f 把 VideoPlayerProvider + VideoMiniPlayer 静态装进根布局的 Providers，
 * 而 VideoMiniPlayer 在「没有活跃播放」时自己 return null —— 于是 74 条路由的首屏公共
 * chunk 里都背着迷你播放器（连带它静态引入的 B站高清播放器），一行 UI 都不渲染。
 * 前端门禁 step 10（check-bundle-budget）因此把 /collections/[slug]、/tags/[slug]、
 * /videos/player 三条收录页全部判红（run119 实测 923/915/906 KB 超 914/913/881 KB）。
 *
 * 这里锁三件事，防止后续重构把它静默改回去：
 *   1. providers.tsx 不得再静态 import 迷你播放器；
 *   2. 挂载必须走「闸门在外部、模块在异步 chunk」的 slot，且闸门判据与组件自身早退
 *      条件逐字一致（否则会出现两套口径：闸门开着但组件返回 null，白加载）；
 *   3. 该 deferral 是分支门控而非把常驻组件 dynamic() 化——闸门关闭时模块不进浏览器图。
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
  return readFileSync(hit, "utf8");
}

/** 两侧的同一句判据：闸门与组件必须一字不差，不留两套口径 */
const GATE = "!isMiniPlayerOpen || !activeVideo || !activeVideo.videoConfig";

describe("根布局：迷你播放器不得进公共首屏 chunk", () => {
  it("providers.tsx 不再静态 import video-mini-player", () => {
    const src = overlaySource("src/components/providers.tsx");
    expect(src).not.toMatch(/import\s*\{[^}]*VideoMiniPlayer[^}]*\}\s*from\s*['"]@\/components\/video-mini-player['"]/);
    expect(src).toContain("import { VideoMiniPlayerSlot } from '@/components/video-mini-player-slot'");
  });

  it("slot 挂在 VideoPlayerProvider 内部（状态在闸门之上）", () => {
    const src = overlaySource("src/components/providers.tsx");
    const provider = src.indexOf("<VideoPlayerProvider>");
    const slot = src.indexOf("<VideoMiniPlayerSlot />");
    const closing = src.indexOf("</VideoPlayerProvider>");
    expect(provider).toBeGreaterThan(-1);
    expect(slot).toBeGreaterThan(provider);
    expect(closing).toBeGreaterThan(slot);
  });

  it("slot 用 next/dynamic 取模块，且只在闸门打开后才挂载", () => {
    const src = overlaySource("src/components/video-mini-player-slot.tsx");
    expect(src).toMatch(/dynamic\(\s*\(\)\s*=>\s*import\(['"]@\/components\/video-mini-player['"]\)/);
    expect(src).toContain("{ ssr: false }");
    expect(src).toContain(`if (${GATE})`);
  });

  it("组件自身的早退条件仍在（两侧同口径，deferral 不改变可见行为）", () => {
    const src = overlaySource("src/components/video-mini-player.tsx");
    expect(src).toContain(`if (${GATE})`);
  });
});
