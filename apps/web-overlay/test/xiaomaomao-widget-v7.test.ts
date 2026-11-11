/**
 * 小猫猫挂件 v7 守卫（William 点名：遮挡太多看不了猫、平时不显示按钮、图标太丑）：
 *
 *  1. 平时零遮挡（几何级）：控件全部收进悬浮坞 .xm-dock，坞以 bottom:calc(100% + Npx)
 *     定位在主列上方留白处——坞的底边在主列顶边之上 Npx，而猫的舞台恰好占满主列，
 *     两者纵向区间不相交（桌面 10px / 移动 8px 间隔）。旧的舞台内操作格 .xm-actions
 *     与骑角聊天钮定位不许复活。坞默认态必须是 opacity:0 + visibility:hidden +
 *     pointer-events:none（看不见、点不着、进不了 Tab 顺序），展开只认 .xm-ctl。
 *  2. 按需唤出接线：悬停（pointerenter）/ 移动端轻点（pointer:coarse 分支，先于 petCat）/
 *     移开 350ms / 点别处 / Esc / 闲置 3000ms 收起；气泡与坞互斥（showBubble 先收坞）；
 *     面板与游戏打开时先收坞；首次访问自动展示一次（store.hinted）。
 *  3. 图标全套 SVG：ICONS 里 13 个手工图标（24 网格）齐全，每个控件用的都是对应图标；
 *     只许出现在控件里的 emoji（🔊🔇🖼🎤📷）全仓绝迹，骨架/动态创建段里不许再有
 *     emoji 或字符当图标（台词、徽章播报文字、节日装饰、表情符号层属内容层，不在此列）。
 *  4. v6 功能锚点零回归：深色套图、贴边半藏、自改形象、喂鱼/游戏、视频钩子、A12 成长桥。
 *
 * 行为级验证（真实 DOM 唤出/收起/互斥）在仓外 jsdom harness：
 * ~/workspace/znwzdh-widget-v7-evidence/widget-v7-jsdom-test.js（仓内不引 jsdom 依赖，沿 v4–v6 惯例）。
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

/** DOM 骨架段（root.innerHTML 起到 appendChild(root) 止）：控件在这里拼装 */
function skeleton(): string {
  const a = WIDGET.indexOf("root.innerHTML =");
  const b = WIDGET.indexOf("document.body.appendChild(root)");
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return WIDGET.slice(a, b);
}

const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

describe("v7 零遮挡几何", () => {
  it("悬浮坞定位在主列上方留白处，与舞台纵向零重叠（桌面 +10px / 移动 +8px）", () => {
    const dock = cssRule("#xiaomaomao .xm-dock");
    const m = /bottom:calc\(100% \+ (\d+)px\)/.exec(dock);
    expect(m, "坞必须以 bottom:calc(100% + Npx) 悬在主列之上").not.toBeNull();
    // 坞底边 = 主列顶边 + N；舞台占满主列（顶边=主列顶边）→ 纵向间隔 N ≥ 0 即零重叠
    expect(Number(m![1])).toBeGreaterThanOrEqual(0);
    expect(WIDGET).toContain("#xiaomaomao .xm-dock{gap:5px;padding:5px;bottom:calc(100% + 8px)");
  });

  it("坞默认态看不见、点不着；展开只认 .xm-ctl", () => {
    const dock = cssRule("#xiaomaomao .xm-dock");
    expect(dock).toContain("opacity:0");
    expect(dock).toContain("visibility:hidden");
    expect(dock).toContain("pointer-events:none");
    const open = cssRule("#xiaomaomao.xm-ctl .xm-dock");
    expect(open).toContain("opacity:1");
    expect(open).toContain("visibility:visible");
    expect(open).toContain("pointer-events:auto");
  });

  it("旧遮挡物绝迹：舞台内操作格与骑角聊天钮不许复活", () => {
    expect(WIDGET).not.toContain("xm-actions");
    expect(WIDGET).not.toContain(".xm-chat-btn{position:absolute");
    expect(WIDGET).not.toContain("right:-9px;bottom:-9px");
  });

  it("坞是主列的子、舞台的兄弟（结构上不在猫身上）", () => {
    const sk = skeleton();
    const wrapAt = sk.indexOf('<div class="xm-wrap">');
    const dockAt = sk.indexOf('<div class="xm-dock"');
    expect(wrapAt).toBeGreaterThan(-1);
    expect(dockAt).toBeGreaterThan(wrapAt);
    // 舞台段内零按钮：wrap 开标签到 panel 之前的按钮只能出现在 dock 段里
    const panelAt = sk.indexOf('<div class="xm-panel"');
    const stageZone = sk.slice(wrapAt, dockAt);
    expect(stageZone).not.toContain("<button");
    expect(sk.slice(dockAt, panelAt)).toContain('role="toolbar"');
  });
});

describe("v7 按需唤出接线", () => {
  it("状态机齐全：show/hide + 3 秒闲置收起 + 移开/点别处/Esc", () => {
    expect(WIDGET).toContain("function showControls()");
    expect(WIDGET).toContain("function hideControls()");
    expect(WIDGET).toContain("var CTL_HIDE_AFTER = 3000;");
    expect(WIDGET).toContain("root.addEventListener('pointerleave'");
    expect(WIDGET).toContain("if (ev.key === 'Escape') hideControls();");
    expect(WIDGET).toContain("if (ctlShown && !root.contains(ev.target)) hideControls();");
    expect(WIDGET).toContain("if (!wasDocked) showControls();");
  });

  it("移动端轻点猫只唤坞不摸猫：coarse 分支在 petCat 之前", () => {
    expect(WIDGET).toContain("window.matchMedia('(pointer: coarse)')");
    const clickAt = WIDGET.indexOf("stageEl.addEventListener('click'");
    const slice = WIDGET.slice(clickAt, clickAt + 900);
    expect(slice.indexOf("if (coarsePointer)")).toBeGreaterThan(-1);
    expect(slice.indexOf("if (coarsePointer)")).toBeLessThan(slice.indexOf("petCat();"));
  });

  it("互斥：气泡出现先收坞；面板/游戏打开先收坞", () => {
    const bubbleAt = WIDGET.indexOf("function showBubble(text, speakIt)");
    expect(WIDGET.slice(bubbleAt, bubbleAt + 200)).toContain("hideControls();");
    const panelAt = WIDGET.indexOf("function openPanel()");
    expect(WIDGET.slice(panelAt, panelAt + 120)).toContain("hideControls();");
    const gameAt = WIDGET.indexOf("function openGame()");
    expect(WIDGET.slice(gameAt, gameAt + 160)).toContain("hideControls();");
  });

  it("首次访问自动展示一次：hinted 读/写齐全", () => {
    expect(WIDGET).toContain("if (typeof saved.hinted === 'boolean') store.hinted = saved.hinted;");
    expect(WIDGET).toContain("store.hinted = true;");
    expect(WIDGET).toContain("if (!store.hinted) {");
  });

  it("拖动开始即收坞，免得拖着猫时坞跟着晃", () => {
    expect(WIDGET).toContain("drag.moved = true; hideControls();");
  });
});

describe("v7 全套 SVG 图标", () => {
  it("ICONS 13 个手工图标齐全（24 网格）", () => {
    const blockAt = WIDGET.indexOf("var ICONS = {");
    expect(blockAt).toBeGreaterThan(-1);
    const block = WIDGET.slice(blockAt, WIDGET.indexOf("};", blockAt) + 2);
    const keys = ["chat", "paw", "fish", "star", "starSoft", "starGold", "volOn", "volOff", "close", "image", "mic", "camera", "arrow"];
    for (const k of keys) {
      const at = block.indexOf(k + ":");
      expect(at, "缺图标 " + k).toBeGreaterThan(-1);
      // 线条图标拼 SVG_OPEN 前缀（viewBox 在前缀里），填色图标自带完整 <svg viewBox>
      const seg = block.slice(at, at + 420);
      expect(seg.includes('viewBox="0 0 24 24"') || seg.includes("SVG_OPEN"), "图标 " + k + " 不是 24 网格 SVG").toBe(true);
      expect(seg).toContain("<path");
    }
    expect(WIDGET).toContain("var SVG_OPEN = '<svg viewBox=\"0 0 24 24\"");
  });

  it("每个控件用的都是对应 SVG 图标，且带无障碍标签", () => {
    expect(WIDGET).toContain('aria-label="跟小猫猫聊天找站">' + "' + ICONS.chat + '");
    expect(WIDGET).toContain('aria-label="摸摸小猫猫">' + "' + ICONS.paw + '");
    expect(WIDGET).toContain('aria-label="开关小猫语音">' + "' + ICONS.volOn + '");
    expect(WIDGET).toContain('aria-label="收起小猫猫">' + "' + ICONS.close + '");
    expect(WIDGET).toContain('aria-label="换个伙伴形象">' + "' + ICONS.image + '");
    expect(WIDGET).toContain('aria-label="收起聊天">' + "' + ICONS.close + '");
    expect(WIDGET).toContain("fishBtn.innerHTML = ICONS.fish + '<span class=\"xm-fish-n\"></span>';");
    expect(WIDGET).toContain("gameBtn.innerHTML = ICONS.star;");
    expect(WIDGET).toContain("micBtn.innerHTML = ICONS.mic;");
    expect(WIDGET).toContain("go.innerHTML = ICONS.arrow;");
    expect(WIDGET).toContain('class="xm-tab-badge" aria-hidden="true">' + "' + ICONS.chat + '");
    expect(WIDGET).toContain("' + ICONS.camera + '上传我的图片</button>'");
    expect(WIDGET).toContain("s.innerHTML = gold ? ICONS.starGold : ICONS.starSoft;");
    // 语音开关换图走同一套 SVG（不再是文字/emoji 切换）
    expect(WIDGET).toContain("var icon = voiceOn ? ICONS.volOn : ICONS.volOff;");
    expect(WIDGET).toContain("btns[i].innerHTML = icon;");
  });

  it("只许出现在控件里的 emoji 全仓绝迹", () => {
    for (const e of ["🔊", "🔇", "🖼", "🎤", "📷"]) {
      expect(WIDGET.includes(e), "控件 emoji 残留 " + e).toBe(false);
    }
  });

  it("骨架段无 emoji 图标、无字符图标（✕/‹/›）", () => {
    const sk = skeleton();
    expect(EMOJI_RE.test(sk), "骨架段混入 emoji").toBe(false);
    expect(sk).not.toContain(">✕<");
    expect(sk).not.toContain("‹");
    // 收起圆标的「聊」字角标已换 SVG
    expect(WIDGET).not.toContain('.xm-tab:after{content:"聊"');
  });
});

describe("v7 不回归 v6 功能锚点", () => {
  it("核心功能接点都在", () => {
    for (const anchor of [
      "var POSES_DARK", // 深色整套图
      "function doDock()", // 贴边半藏
      "var DOCK_AFTER = 60000",
      "function openLook()", // 自改形象
      "function feedFish()", // 喂鱼
      "function startGame()", // 接星星
      "function celebrateVideo(kind)", // 视频钩子
      "new CustomEvent('navhub:ai-chat-used')", // A12 成长桥
      "#xiaomaomao .xm-stage{touch-action:none}", // 触摸拖动
      "function petCat()", // 摸猫本体
    ]) {
      expect(WIDGET, "丢了 v6 锚点 " + anchor).toContain(anchor);
    }
  });
});
