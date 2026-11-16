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
const CONTROL_BAR = "src/components/video-player-control-bar.tsx";
const SIDE_PANEL = "src/components/video-player-side-panel.tsx";

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
    // 2026-11-16 第 82 轮 F-02：初次选片回落改走 handleSelectVideo（内含
    // setSelectedVideo + replaceState 同步 ?id=），旧断言按新行为改写，不断言删除。
    expect(src).toContain("handleSelectVideo(firstVideoItem)");
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

/**
 * 第 82 轮 E 线：F-01/F-02/F-03 三高严重度 UX 小修守卫。
 *
 * F-01：断点续播横幅只有“我知道了”关闭动作，resumePrompt.timestamp 从未
 *   被用于跳转。横幅必须有“从 x:xx 继续播放”主按钮，点后按既有章节跳转机制
 *   置 chapterSeekSec（B站走 seekSec、YouTube 走 &start=、mp4 走 currentTime）。
 * F-02：播放器内换片只 setSelectedVideo 不写 URL，刷新/分享回到第一部。
 *   全部换片入口必须走 handleSelectVideo，用 replaceState 同步 ?id=（不产生
 *   多余历史记录），换片时删掉旧视频的 ?t=。
 * F-03：移动端侧栏整个不渲染，但控制条 tab 按钮与顶栏历史按钮照常显示、
 *   点下无反应。只切侧栏 tab 的入口在移动端必须隐藏（max-md:hidden）。
 */
describe("视频页 UX 三高严重度小修（F-01/F-02/F-03）", () => {
  it("F-01：断点续播横幅有“继续播放”主按钮，点后按断点时间跳转并收起横幅", () => {
    const src = overlaySource(PAGE);
    expect(src).toContain("从 {resumePrompt.formatted} 继续播放");
    expect(src).toContain("setChapterSeekSec(resumePrompt.timestamp)");
    expect(src).toContain("dismissResumePrompt()");
  });

  it("F-01：mp4 直链也有 chapterSeekSec 消费方（currentTime / loadedmetadata）", () => {
    const src = overlaySource(PAGE);
    expect(src).toContain("mp4VideoRef.current");
    expect(src).toContain("el.currentTime = chapterSeekSec");
    expect(src).toContain("loadedmetadata");
  });

  it("F-02：换片经 handleSelectVideo 用 replaceState 同步 ?id=，换片删旧 ?t=", () => {
    const src = overlaySource(PAGE);
    expect(src).toContain("handleSelectVideo");
    expect(src).toContain("window.history.replaceState");
    expect(src).toContain("params.set('id', video.id)");
    expect(src).toContain("params.delete('t')");
  });

  it("F-02：上下部 / 相关推荐 / 播放列表 / AI 跳转 / 初次选片全部走 handleSelectVideo，不再直调 setSelectedVideo", () => {
    const src = overlaySource(PAGE);
    expect(src).toContain("handleSelectVideo(allVideos[currentIndex + 1])");
    expect(src).toContain("handleSelectVideo(allVideos[currentIndex - 1])");
    expect(src).toContain("handleSelectVideo(rel)");
    expect(src).toContain("onSelectVideo={handleSelectVideo}");
    expect(src).toContain("setSelectedVideo={handleSelectVideo}");
    expect(src).toContain("handleSelectVideo(target)");
    expect(src).toContain("handleSelectVideo(firstVideoItem)");
    expect(src).not.toContain("setSelectedVideo(allVideos[currentIndex");
    expect(src).not.toContain("onClick={() => setSelectedVideo(rel)}");
    expect(src).not.toContain("onSelectVideo={setSelectedVideo}");
    expect(src).not.toContain("setSelectedVideo={setSelectedVideo}");
  });

  it("F-03：控制条三个只切侧栏 tab 的按钮在移动端隐藏", () => {
    const src = overlaySource(CONTROL_BAR);
    // AI 章节 / 代码演进 / 知识脑图三处 onTabChange 入口各带一个 max-md:hidden
    expect(src.match(/max-md:hidden/g)?.length).toBe(3);
    expect(src).toContain("onTabChange('chapters')");
    expect(src).toContain("onTabChange('diff')");
    expect(src).toContain("onTabChange('mindmap')");
  });

  it("F-03：顶栏“观看历史”按钮在移动端隐藏，桌面端侧栏本身仍只在 md+ 渲染", () => {
    const page = overlaySource(PAGE);
    expect(page).toContain("max-md:hidden");
    const panel = overlaySource(SIDE_PANEL);
    expect(panel).toContain("hidden md:block");
  });
});

/**
 * 第 83 轮 C 线：换片清零 chapterSeekSec（第 82 轮 H 线复核非阻塞真问题）。
 *
 * 根因：selectedVideo 副作用里 `setChapterSeekSec(pendingSeekSecRef.current)`
 * 只在 effect 里把 ref（换片时为 null）写回去，首渲染仍带着旧秒数——YouTube
 * src 已拼上旧 &start=、B站已收旧 seekSec、mp4 effect 已跳旧 currentTime，
 * 笔记 / 弹幕的 `timeSec: currentTimeSec || chapterSeekSec || 0` 也会取到过期值。
 * 修法：在 handleSelectVideo 内、与 setSelectedVideo 同一批次清零，渲染时
 * 新视频即不再带旧秒数。清零语义：换片（id 变化）时清；id 不变时不清（早退
 * 在清零之前，保留 ?t= 直达）；初次选片带 ?t= 时走 id 不变早退，pendingSeekSecRef
 * 随后在 selectedVideo 副作用里一次性交接，不受影响。
 */
describe("换片清零 chapterSeekSec（第 83 轮 C 线）", () => {
  function handleSelectVideoBody(src: string): string {
    const start = src.indexOf("const handleSelectVideo = useCallback((video: NavigationSubItem | null) => {");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("}, [])", start);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
  }

  it("换片（id 变化）时 handleSelectVideo 清零 chapterSeekSec，且全文件仅此一处清零", () => {
    const src = overlaySource(PAGE);
    const body = handleSelectVideoBody(src);
    expect(body).toContain("setChapterSeekSec(null)");
    expect(src.match(/setChapterSeekSec\(null\)/g)?.length).toBe(1);
  });

  it("id 不变时不清零：同 id 早退在清零之前，?t= 直达交接不受影响", () => {
    const src = overlaySource(PAGE);
    const body = handleSelectVideoBody(src);
    const sameIdReturn = body.indexOf("if (params.get('id') === video.id) return");
    const clear = body.indexOf("setChapterSeekSec(null)");
    const writeId = body.indexOf("params.set('id', video.id)");
    expect(sameIdReturn).toBeGreaterThan(-1);
    // 顺序：同 id 早退 → 清零 → 写新 id；早退在前保证 id 不变时不清理
    expect(clear).toBeGreaterThan(sameIdReturn);
    expect(writeId).toBeGreaterThan(clear);
    // 初次选片带 ?t= 的一次性交接仍在：走 id 不变早退后由 selectedVideo 副作用交接
    expect(src).toContain("setChapterSeekSec(pendingSeekSecRef.current)");
    expect(src).toContain("pendingSeekSecRef.current = null");
  });
});
