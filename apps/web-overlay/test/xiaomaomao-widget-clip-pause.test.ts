/**
 * 游乐场 A/B 切换旧一路暂停守卫（2026-11-18）：
 *
 *  双视频交叉淡化切换后，旧一路在淡化结束时暂停，只留可见的一路解码，
 *  否则两路同时解码白白耗电（旧路不可见却 paused:false）。
 *  淡化期间两路短暂同播是刻意的，断言只测淡化结束后的稳态。
 *
 * 与 v7/互动玩法守卫同款写法：源码断言（不引 jsdom），读 overlay 侧的挂件源码；
 * 切换后旧路 paused:true、新路 playing 的行为由 CDP 真机探针验证
 * （见 ~/workspace/xiaomaomao-dock-icon/video/v7-verify/ 下的 clip-pause 探针记录）。
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

/** 取 playClip 的 show() 切换段（从 `var show = function` 起一段，覆盖整段切换体） */
function showSegment(): string {
  const at = WIDGET.indexOf("var show = function () {");
  expect(at, "找不到 playClip 的 show() 切换段").toBeGreaterThan(-1);
  return WIDGET.slice(at, at + 1800);
}

describe("A/B 切换旧一路暂停：淡化结束后只留一路解码", () => {
  it("切换后旧路会停：show() 里有停旧路的定时器", () => {
    const seg = showSegment();
    expect(seg).toContain("cur.pause()");
    expect(seg).toContain("window.setTimeout(function ()");
  });

  it("停旧路只在淡化结束后：延时 300ms，略长于 .xm-clip 的 .28s 透明度过渡", () => {
    const clip = cssRule("#xiaomaomao .xm-video.xm-clip");
    expect(clip).toContain("transition:opacity .28s");
    const seg = showSegment();
    expect(seg).toContain("}, 300);");
    // 停旧路不在切换当下立即执行（否则淡化还没播完就黑了）
    const beforeTimer = seg.slice(0, seg.indexOf("window.setTimeout"));
    expect(beforeTimer).not.toContain("cur.pause()");
  });

  it("误停守卫：定时器里有 seq 与 clipVisible 双重判断", () => {
    const seg = showSegment();
    expect(seg).toContain("seq === clipSeq");
    expect(seg).toContain("clipVisible !== cur");
    expect(seg).toContain("!cur.paused");
  });

  it("只停旧路不碰新路：pause 目标是 cur，且有 cur !== next 前置判断", () => {
    const seg = showSegment();
    expect(seg).toContain("if (cur && cur !== next)");
    expect(seg).not.toContain("next.pause()");
  });

  it("交叉淡化本身不变：新路加 .xm-on、旧路摘 .xm-on、新路照常 play()", () => {
    const seg = showSegment();
    expect(seg).toContain("next.classList.add('xm-on')");
    expect(seg).toContain("cur.classList.remove('xm-on')");
    expect(seg).toContain("var p = next.play();");
  });

  it("其余暂停路径不受影响：stopClips 仍会停两路，pauseClips/resumeClips 只动可见路", () => {
    expect(WIDGET).toContain("function stopClips()");
    const stop = WIDGET.slice(WIDGET.indexOf("function stopClips()"), WIDGET.indexOf("function stopClips()") + 500);
    expect(stop).toContain("v.pause()");
    expect(stop).toContain("clipVisible = null;");
    expect(WIDGET).toContain("function pauseClips()");
    expect(WIDGET).toContain("if (clipVisible && !clipVisible.paused) clipVisible.pause();");
    expect(WIDGET).toContain("function resumeClips()");
  });
});
