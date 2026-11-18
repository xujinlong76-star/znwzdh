/**
 * 小猫猫挂件默认显示走透明视频守卫（2026-11-18，William 点选「先把透明视频装上挂件」）：
 *
 *  默认待机播透明 idle 视频循环，行走/散步沿用游乐场 walk 循环；视频在播时舞台透明、
 *  自改形象层藏进视频后面；视频文件缺失、加载失败、解码出错或浏览器不支持 VP9 透明时，
 *  走动画 WebP 兜底（再不行 GIF，最后藏猫），不再回静态图。游乐场追/扑/睡与原有互动全部保留。
 *
 * 与 v7/互动玩法守卫同款写法：源码断言（不引 jsdom），读 overlay 侧的挂件源码。
 * Safari 真机未覆盖：VP9 透明检测用 canPlayType（见 supportsVp9Alpha 注释），
 * Safari 对 VP9 返回空串即走 WebP 兜底；逐像素 alpha 探针与真机 Safari 留给浏览器实测。
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

const WIDGET = readFileSync(join(overlayRoot(), "public/xiaomaomao/xiaomaomao.js"), "utf8");

/** 取某个 CSS 规则体（选择器第一次出现处的大括号内容） */
function cssRule(selector: string): string {
  const at = WIDGET.indexOf(selector + "{");
  expect(at, "找不到 CSS 规则 " + selector).toBeGreaterThan(-1);
  const end = WIDGET.indexOf("}", at);
  return WIDGET.slice(at, end);
}

/** 取某个函数体（从 `function name(` 起到下一个顶层 `function ` 之前的一段，够断言用） */
function fnBody(name: string): string {
  const at = WIDGET.indexOf("function " + name + "(");
  expect(at, "找不到函数 " + name).toBeGreaterThan(-1);
  return WIDGET.slice(at, at + 1600);
}

describe("默认显示走透明视频：待机播 idle 循环", () => {
  it("三段视频约定不变（待机/走路/扑，VP9 WebM，部署时另放）", () => {
    expect(WIDGET).toContain("var PLAY_CLIPS = { idle: 'play-idle.webm', walk: 'play-walk.webm', pounce: 'play-pounce.webm' };");
  });

  it("VP9 透明检测在位：canPlayType 认 VP9 才播视频", () => {
    expect(WIDGET).toContain("function supportsVp9Alpha()");
    expect(WIDGET).toContain("canPlayType('video/webm; codecs=\"vp9\"')");
    // Safari 不认 VP9（返回空串）→ 走 WebP 兜底；检测办法写进源码注释，真机 Safari 未覆盖
    expect(WIDGET).toContain("Safari 不认 VP9");
  });

  it("默认视频开关在位：合乎条件才播待机循环", () => {
    expect(WIDGET).toContain("function ambientEligible()");
    expect(WIDGET).toContain("function startAmbientVideo()");
    expect(WIDGET).toContain("function stopAmbientVideo()");
    const eligible = fnBody("ambientEligible");
    expect(eligible).toContain("!reducedMotion");
    expect(eligible).toContain("!avatarPick");
    expect(eligible).toContain("supportsVp9Alpha()");
    const start = fnBody("startAmbientVideo");
    expect(start).toContain("playClip('idle')");
    expect(start).not.toContain("playClip('walk')");
  });

  it("入场即开默认视频（游乐场没开时）：600ms 后待机视频接管", () => {
    expect(WIDGET).toContain("window.setTimeout(function () { if (!play.on) startAmbientVideo(); }, 600);");
  });

  it("行走/散步播 walk 循环：沿用游乐场同一条 playClip 路径，不另起一套", () => {
    expect(WIDGET).toContain("playClip('walk')");
    // 漫步与追逐都调 walk（不是另起的 ambient walk）
    expect(WIDGET).toContain("play.mode = 'wander';");
    expect(WIDGET).toContain("play.mode = 'chase';");
  });
});

describe("视频在播时舞台透明、姿势图藏起", () => {
  it("xm-has-video 态舞台去白底/描边/圆角裁剪（视频透明区不露白圆）", () => {
    const stage = cssRule("#xiaomaomao.xm-has-video .xm-stage");
    expect(stage).toContain("background:transparent");
    expect(stage).toContain("border-color:transparent");
    expect(stage).toContain("border-radius:0");
    expect(stage).toContain("overflow:visible");
  });

  it("深色模式也有同款透明覆盖（深色奶油底衬不能压过视频态）", () => {
    const dark = cssRule("html.dark #xiaomaomao.xm-has-video .xm-stage");
    expect(dark).toContain("background:transparent");
    expect(dark).toContain("border-color:transparent");
  });

  it("自改形象层藏进视频后面（透明区不露白底图）", () => {
    const lean = cssRule("#xiaomaomao.xm-has-video .xm-lean");
    expect(lean).toContain("opacity:0");
  });

  it("透明类只在视频有首帧后挂（markVideoReady），之前是默认白圆舞台、不闪破图", () => {
    expect(WIDGET).toContain("function markVideoReady(");
    expect(WIDGET).toContain("markVideoReady(next, seq)");
    expect(WIDGET).toContain("root.classList.add('xm-has-video')");
    const mark = fnBody("markVideoReady");
    expect(mark).toContain("readyState >= 2");
    expect(mark).toContain("loadeddata");
  });
});

describe("视频播不了时走 WebP→GIF→藏猫兜底链", () => {
  it("idle 探活失败即视频路判死、走 WebP 兜底（不留白、不报错）", () => {
    // 2026-11-18 删静态图：旧行为是 stopClips() 回静态，现改走 showFallback('idle')；
    // 旧断言按新行为改写（见本 it 注释），断言本身未删
    // 2026-11-18 C-01 改写：判死点改走 markVideoDead('network')（带原因，可 60 秒后重试）；
    // 原“videoDead = true”断言按新行为改写，未删除。
    const play = WIDGET.slice(WIDGET.indexOf("probeMedia(resolved.url).then"), WIDGET.indexOf("probeMedia(resolved.url).then") + 600);
    expect(play).toContain("markVideoDead('network')");
    expect(play).toContain("showFallback('idle')");
    expect(play).not.toContain("stopClips();");
  });

  it("stopClips 仍在：停视频摘透明类、藏兜底图", () => {
    expect(WIDGET).toContain("function stopClips()");
    const stop = fnBody("stopClips");
    expect(stop).toContain("root.classList.remove('xm-has-video')");
    expect(stop).toContain("hideFallback()");
  });

  it("视频解码出错也走兜底：idle 出错判死走 WebP，非 idle 出错回 idle", () => {
    // 2026-11-18 删静态图：旧断言 "clipCurrent === 'idle') stopClips();" 已按新行为改写
    // 2026-11-18 C-01 改写：判死点改走 markVideoDead('network')（带原因，可 60 秒后重试）；
    // 原“videoDead = true”断言按新行为改写，未删除。
    expect(WIDGET).toContain("if (clipCurrent === 'idle') { markVideoDead('network'); showFallback('idle'); }");
    expect(WIDGET).toContain("playClip('idle')");
  });

  it("游乐场关闭回默认视频（不是回静态）：关游乐场先试 ambient，不行才停视频", () => {
    expect(WIDGET).toContain("if (!startAmbientVideo()) stopClips();");
  });

  it("自改形象时默认视频停（用户选的图优先），恢复默认再播", () => {
    expect(WIDGET).toContain("if (avatarPick) stopAmbientVideo(); else startAmbientVideo();");
    const stop = fnBody("stopAmbientVideo");
    expect(stop).toContain("if (!play.on) stopClips();");
  });

  it("收起成圆标即停播视频（pauseClips），点圆标唤回再播", () => {
    expect(WIDGET).toContain("function pauseClips()");
    expect(WIDGET).toContain("function resumeClips()");
    const collapse = WIDGET.slice(WIDGET.indexOf("function collapseCat()"), WIDGET.indexOf("function collapseCat()") + 700);
    expect(collapse).toContain("pauseClips();");
  });
});

describe("贴边/离屏/切后台不白白解码", () => {
  it("贴边半藏即暂停，弹回再续播", () => {
    const dock = WIDGET.slice(WIDGET.indexOf("function doDock()"), WIDGET.indexOf("function doDock()") + 700);
    expect(dock).toContain("pauseClips();");
    const undock = WIDGET.slice(WIDGET.indexOf("function undock()"), WIDGET.indexOf("function undock()") + 400);
    expect(undock).toContain("resumeClips();");
  });

  it("离屏与切后台也暂停（沿用 v8 的 IntersectionObserver + visibilitychange）", () => {
    expect(WIDGET).toContain("pauseClips();");
    expect(WIDGET).toContain("resumeClips();");
    const io = WIDGET.slice(WIDGET.indexOf("IntersectionObserver"), WIDGET.indexOf("IntersectionObserver") + 500);
    expect(io).toContain("pauseClips()");
  });
});
