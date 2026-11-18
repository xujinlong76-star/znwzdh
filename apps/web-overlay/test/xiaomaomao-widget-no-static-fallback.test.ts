/**
 * 小猫猫挂件删静态图 + WebP 兜底守卫（2026-11-18，William 11:42 点选「用 WebP（推荐）」）：
 *
 *  默认猫只播透明视频；视频播不了（Safari 不认 VP9 / 文件缺失 / 解码失败）时显示
 *  动画 WebP，WebP 失败显示 GIF，GIF 也失败猫直接藏起来，绝不回静态图。
 *  poses/ 25 张静态图已从仓库删除；用户上传的自改形象（data URL）不受影响。
 *
 * 与 v7/视频默认守卫同款写法：源码断言（不引 jsdom），读 overlay 侧的挂件源码。
 * 兜底文件本身（media/*.webp/.gif，二进制不进仓库）不由本文件断言存在与否，
 * 只断言源码里的文件约定；透明与会动由浏览器 CDP 探针验（见 VERIFICATION.md）。
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

describe("删静态图：源码零静态图引用", () => {
  it("源码里没有 poses/ 字面引用", () => {
    expect(WIDGET.includes("poses/"), "源码仍有 poses/ 引用").toBe(false);
  });

  it("POSES 三套图与取图出口已删", () => {
    expect(WIDGET).not.toContain("var POSES =");
    expect(WIDGET).not.toContain("var POSES_CLASSIC =");
    expect(WIDGET).not.toContain("var POSES_DARK =");
    expect(WIDGET).not.toContain("function poseUrl(");
    expect(WIDGET).not.toContain("function poseSetOf(");
    expect(WIDGET).not.toContain("function preloadPoses(");
  });

  it("poses/ 目录已从仓库删除（overlay 源树）", () => {
    expect(existsSync(join(overlayRoot(), "public/xiaomaomao/poses")), "poses/ 目录还在").toBe(false);
  });
});

describe("兜底链：视频 → WebP → GIF → 藏猫", () => {
  it("三段兜底全有（idle/walk/pounce 各有 WebP 与 GIF 文件约定）", () => {
    expect(WIDGET).toContain("var PLAY_FALLBACKS = { idle: 'play-idle.webp', walk: 'play-walk.webp', pounce: 'play-pounce.webp' };");
    expect(WIDGET).toContain("var PLAY_FALLBACK_GIFS = { idle: 'play-idle.gif', walk: 'play-walk.gif', pounce: 'play-pounce.gif' };");
  });

  it("playClip 视频路已死时直接走兜底（三段共用一条链）", () => {
    const play = fnBody("playClip");
    expect(play).toContain("if (videoDead)");
    expect(play).toContain("showFallback(name)");
  });

  it("WebP 失败 → GIF，GIF 失败 → 藏猫", () => {
    expect(WIDGET).toContain("function showFallback(");
    expect(WIDGET).toContain("function hideCat(");
    const ensure = fnBody("ensureFallbackImg");
    expect(ensure).toContain("fallbackTier === 'webp'");
    expect(ensure).toContain("fallbackUrl(fallbackCurrent, 'gif')");
    expect(ensure).toContain("fallbackDead = true");
    expect(ensure).toContain("hideCat()");
  });

  // 2026-11-18 C-06 改写：hideCat 不再是 display:none 死刑，改为收成圆标 +
  // 控制台报错 + 30 秒后重试视频路；原“display:none 级别隐藏”断言按新行为改写，未删除。
  it("hideCat 不再是 display:none 死刑（收成圆标 + 30 秒后重试）", () => {
    const hide = fnBody("hideCat");
    expect(hide, "hideCat 还在写 display:none").not.toContain("style.display");
    expect(hide).toContain("collapseCat()");
    expect(hide).toContain("HIDE_CAT_RETRY_MS");
    expect(hide).toContain("clearVideoDead()");
  });

  it("stopClips 藏兜底图、摘透明类", () => {
    const stop = fnBody("stopClips");
    expect(stop).toContain("hideFallback()");
    expect(stop).toContain("root.classList.remove('xm-has-video')");
  });

  it("视频首帧就绪时兜底图让位（markVideoReady 藏兜底）", () => {
    const mark = fnBody("markVideoReady");
    expect(mark).toContain("hideFallback()");
    expect(mark).toContain("root.classList.add('xm-has-video')");
  });

  // 2026-11-18 C-01 改写：VP9 不支持的判死点改走 markVideoDead('capability')（带原因，
  // 能力原因永不自动重试）；原“videoDead = true”断言按新行为改写，未删除。
  it("VP9 不支持时直接判死走 WebP（Safari 路）", () => {
    const start = fnBody("startAmbientVideo");
    expect(start).toContain("markVideoDead('capability')");
    expect(start).toContain("showFallback('idle')");
    expect(start).toContain("playClip('idle')");
  });

  it("贴边/离屏暂停与续播也管兜底图", () => {
    const pause = fnBody("pauseClips");
    expect(pause).toContain("fallbackImg");
    const resume = fnBody("resumeClips");
    expect(resume).toContain("fallbackImg");
    expect(resume).toContain("fallbackCurrent");
  });
});

describe("兜底态舞台透明、整只猫不裁", () => {
  it("xm-has-fallback 态舞台去白底/描边/圆角裁剪", () => {
    const stage = cssRule("#xiaomaomao.xm-has-fallback .xm-stage");
    expect(stage).toContain("background:transparent");
    expect(stage).toContain("border-color:transparent");
    expect(stage).toContain("border-radius:0");
    expect(stage).toContain("overflow:visible");
  });

  it("深色模式也有同款兜底透明覆盖", () => {
    const dark = cssRule("html.dark #xiaomaomao.xm-has-fallback .xm-stage");
    expect(dark).toContain("background:transparent");
    expect(dark).toContain("border-color:transparent");
  });

  it("兜底图 object-fit:contain、整只猫不裁", () => {
    const fb = cssRule("#xiaomaomao .xm-fallback");
    expect(fb).toContain("object-fit:contain");
    expect(fb).toContain("position:absolute");
  });

  it("兜底态自改形象层藏起", () => {
    const lean = cssRule("#xiaomaomao.xm-has-fallback .xm-lean");
    expect(lean).toContain("opacity:0");
  });
});

describe("自改形象（上传）不受影响", () => {
  it("上传形象加载在位（只认 upload，旧内置选择不再接受）", () => {
    expect(WIDGET).toContain("savA.kind === 'upload'");
    expect(WIDGET).toContain("data:image/");
    expect(WIDGET).not.toContain("avatarPick = { kind: 'builtin'");
  });

  it("setPose 只服务上传形象，没有时是空操作", () => {
    const set = fnBody("setPose");
    expect(set).toContain("avatarPick.kind !== 'upload'");
    expect(set).toContain("return;");
  });

  it("小图标走 WebP（上传优先），失败链在位", () => {
    expect(WIDGET).toContain("function setIconImg(");
    expect(WIDGET).toContain("function iconUrl(");
    expect(WIDGET).toContain("media/play-idle.webp");
    expect(WIDGET).toContain("media/play-idle.gif");
  });

  it("图库只剩默认视频与我的上传", () => {
    expect(WIDGET).toContain("label: '默认视频'");
    expect(WIDGET).toContain("label: '我的上传'");
    expect(WIDGET).not.toContain("POSE_LABELS");
    expect(WIDGET).not.toContain("POSE_KEYS");
    expect(WIDGET).not.toContain("CLASSIC_LABELS");
  });
});
