/**
 * /videos/player 的 ?id=&t= 直达链路守卫（C 组第 1 簇）。
 *
 * 事故形状：分享海报（video-share-poster-dialog）与 /videos/v/[id] 生成的链接
 * 都是 /videos/player?id=…&t=…，但路由播放器（video-player-page）从不读参数，
 * 点开永远播第一个视频、永远从头播，海报链路实质是断的。
 * 弹窗版播放器删除后，/videos 网格点卡片与字幕命中行也走同一条路由入口，
 * 这条参数链路成了唯一的播片入口，必须钉住：
 *   1. 路由页从 window.location.search 读 id 与 t，按 id 选片、按 t 交给 chapterSeekSec；
 *   2. id 对不上库里任何视频时落回首条，不让分享链接打不开页；
 *   3. t 只在初次选片生效一次，换片后不清零的残留跳转不许出现；
 *   4. 卡片点击与字幕命中行都 router.push 到 /videos/player?id=…（命中行带 &t=）；
 *   5. 弹窗版 video-player-modal.tsx 已删除，任何文件不得再引用它。
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

function overlayExists(rel: string): boolean {
  return existsSync(resolve(HERE, "..", rel)) || existsSync(resolve(HERE, "..", "..", "web-overlay", rel));
}

const PAGE = "src/components/video-player-page.tsx";
const CARD = "src/components/video-card.tsx";
const CONTENT = "src/components/video-content.tsx";
const POSTER = "src/components/video-share-poster-dialog.tsx";

describe("/videos/player ?id=&t= 直达链路", () => {
  it("路由页从 window.location.search 读 id 与 t", () => {
    const src = overlaySource(PAGE);
    expect(src).toContain("new URLSearchParams(window.location.search)");
    expect(src).toContain("params.get('id')");
    expect(src).toContain("params.get('t')");
  });

  it("按 id 在全库中选片，t 经校验后交给 chapterSeekSec（B站 seekSec / YouTube &start= 的上游）", () => {
    const src = overlaySource(PAGE);
    expect(src).toContain("allVideos.find(v => v.id === requestedId)");
    expect(src).toContain("pendingSeekSecRef.current");
    expect(src).toContain("setChapterSeekSec(pendingSeekSecRef.current)");
    expect(src).toContain("Number.isFinite(t) && t > 0");
  });

  it("id 对不上任何视频时落回首条（分享链接不断页），t 只在初次选片生效一次", () => {
    const src = overlaySource(PAGE);
    expect(src).toContain("setSelectedVideo(firstVideoItem)");
    // 消费后清零：换片时 selectedVideo 副作用不再把旧 t 带过去
    expect(src).toContain("pendingSeekSecRef.current = null");
  });

  it("海报仍生成带 id 与 t 的播放器链接", () => {
    const src = overlaySource(POSTER);
    expect(src).toContain("/videos/player?id=");
    expect(src).toContain("&t=${currentSec}");
  });

  it("视频卡片点开即进路由版播放器，不再开弹窗", () => {
    const src = overlaySource(CARD);
    expect(src).toContain("router.push(`/videos/player?id=${encodeURIComponent(item.id)}`)");
    expect(src).not.toContain("video-player-modal");
    expect(src).not.toContain("VideoPlayerModal");
    expect(src).not.toContain("onPlay");
  });

  it("字幕命中行跳路由版播放器且带 t，网格页不再挂弹窗单例", () => {
    const src = overlaySource(CONTENT);
    expect(src).toContain("router.push(`/videos/player?id=${encodeURIComponent(videoId)}&t=${Math.max(0, Math.floor(startSec))}`)");
    expect(src).not.toContain("video-player-modal");
    expect(src).not.toContain("VideoPlayerModal");
    expect(src).not.toContain("playingVideo");
  });

  it("弹窗版文件已删除", () => {
    expect(overlayExists("src/components/video-player-modal.tsx")).toBe(false);
  });
});
