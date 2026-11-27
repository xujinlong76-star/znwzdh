/**
 * 小猫猫挂件深度审计视觉/无障碍线：P0+P1 全修中的 7 项 P1 守卫（2026-11-18）
 *
 * 覆盖：A P1-4（坞改回横条药丸）、B-01（减动效见猫）、B-02（扑播满 5 秒）、
 * B-03（走路接缝交叉淡化）、B-04（WebP 兜底懒加载）、B-08（焦点陷阱 + Esc）、
 * B-25a（发送按钮/坞聊天钮/深色收起角标对比度）。
 *
 * 与既有 7 个守卫文件同款写法：读 overlay 侧挂件源码做断言（仓库无 jsdom，
 * 行为级验证走本机无头 Chromium + CDP 探针，见 VERIFICATION.md；对比度数值
 * 在本文件内按 WCAG 公式实算，不是只断字符串）。
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

/** 取某个函数体（从 `function name(` 起到其后 1600 字内，够断言用） */
function fnBody(name: string): string {
  const at = WIDGET.indexOf("function " + name + "(");
  expect(at, "找不到函数 " + name).toBeGreaterThan(-1);
  return WIDGET.slice(at, at + 1600);
}

/** 取两处标记之间的源码段 */
function sliceBetween(start: string, end: string): string {
  const a = WIDGET.indexOf(start);
  expect(a, "找不到起始标记 " + start).toBeGreaterThan(-1);
  const b = WIDGET.indexOf(end, a);
  expect(b, "找不到结束标记 " + end).toBeGreaterThan(-1);
  return WIDGET.slice(a, b);
}

/** WCAG 相对亮度与对比度（与 B 线探针同一公式） */
function luminance(hex: string): number {
  // 兼容 #fff 三位简写与 #ffffff 六位两种写法（B 线探针同一公式）。
  let c = hex.replace("#", "");
  if (c.length === 3) c = c.split("").map((ch) => ch + ch).join("");
  const v = [0, 2, 4].map((i) => {
    const x = parseInt(c.slice(i, i + 2), 16) / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
function contrast(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
/** 从 linear-gradient(135deg,#xxx,#yyy) 里取两端色 */
function gradientEnds(rule: string): [string, string] {
  const m = /linear-gradient\(135deg,([^,]+),([^)]+)\)/.exec(rule);
  expect(m, "规则里找不到 linear-gradient(135deg,色,色)： " + rule).not.toBeNull();
  return [m![1].trim(), m![2].trim()];
}

describe("A P1-4：悬浮坞改回横条药丸", () => {
  it("坞按内容定宽、不再被 112px 主列缩成高叠块", () => {
    const dock = cssRule("#xiaomaomao .xm-dock");
    expect(dock).toContain("width:max-content");
    expect(dock).toContain("max-width:calc(100vw - 24px)");
  });

  it("成长 chip 仍独占一行，8 颗按钮排成单行", () => {
    const chip = cssRule("#xiaomaomao .xm-growth-chip");
    expect(chip).toContain("flex:0 0 100%");
    // 按钮行不换行：坞定宽后 8 颗 36px 钮 + 间距约 342px 一行放下
    const dock = cssRule("#xiaomaomao .xm-dock");
    expect(dock).toContain("display:flex");
  });

  it("≤640px 仍用窄叠块（不加宽盖胶囊：B-21 另案，见注释）", () => {
    // 2026-11-18 视觉线定：桌面改横条；≤640px 保持 width:auto 竖叠——横条在小屏会
    // 把回到顶部胶囊盖到 100%（B-21 实测现为 69–72%），小屏形态留给 B-21 的侧挂方案
    const mq = sliceBetween("@media (max-width:640px)", "#xiaomaomao .xm-bubble{max-width");
    expect(mq).toContain(".xm-dock{gap:5px;padding:5px;bottom:calc(100% + 8px);width:auto}");
  });

  it("横条不再顶出横屏视口：坞高约 48px（旧 176px 在 844×390 下 y=-20）", () => {
    // 行为级验证见 CDP 探针（844×390 坞 top ≥ 0）；此处钉住形态根因：定宽单行
    const dock = cssRule("#xiaomaomao .xm-dock");
    expect(dock).toContain("width:max-content");
  });
});

describe("B-01：减动效用户也能看到猫（静态首帧）", () => {
  it("减动效不再直接 return false：走静态首帧分支", () => {
    const start = fnBody("startAmbientVideo");
    expect(start).toContain("showStillFrame('idle')");
    expect(start).not.toContain("if (reducedMotion || avatarPick");
  });

  it("静态首帧是真冻结：WebP 首帧画到 canvas 再显示（不动、不耗解码）", () => {
    expect(WIDGET).toContain("function showStillFrame(");
    const still = fnBody("showStillFrame");
    expect(still).toContain("drawImage");
    expect(still).toContain("toDataURL('image/png')");
    expect(still).toContain("fallbackUrl(name");
    // 冻结失败逐级退：WebP 不行试 GIF，再不行藏猫（与兜底链同终局）
    expect(still).toContain("'gif'");
    expect(still).toContain("hideCat()");
  });

  it("静态首帧也挂透明舞台（不留白圆），且不建 video 元素", () => {
    const still = fnBody("showStillFrame");
    expect(still).toContain("xm-has-video");
    expect(still).not.toContain("createElement('video')");
  });

  it("减动效 CSS 熄火开关仍在（浮动/呼吸动画停）", () => {
    expect(WIDGET).toContain("@media (prefers-reduced-motion: reduce)");
    expect(WIDGET).toContain("animation-duration:.01s");
  });
});

describe("B-02：扑视频播满扑跃弧线（不再 1.6 秒切断）", () => {
  it("扑收尾定时器改到 5 秒（抽帧时序：1s 下蹲、4s 扑跃、5s 坐回）", () => {
    expect(WIDGET).toContain("var PLAY_POUNCE_MS = 5000;");
  });

  it("playPounce 用该常量收尾，旧 1600 已清", () => {
    const pounce = fnBody("playPounce");
    expect(pounce).toContain("PLAY_POUNCE_MS");
    expect(pounce).not.toContain(", 1600)");
  });
});

describe("B-03：走路循环接缝交叉淡化", () => {
  it("clip 元素监听 timeupdate，近循环点时换路重播", () => {
    expect(WIDGET).toContain("addEventListener('timeupdate'");
    expect(WIDGET).toContain("var WALK_SEAM_LEAD = 0.35;");
  });

  it("接缝换路只发生在走路循环上（不碰待机/扑）", () => {
    const ensure = fnBody("ensureClipEls");
    expect(ensure).toContain("clipCurrent === 'walk'");
    expect(ensure).toContain("playClip('walk', { forceSwap: true })");
  });

  it("playClip 支持 forceSwap：同名快路径可被接缝换路绕过", () => {
    const play = fnBody("playClip");
    expect(play).toContain("opts.forceSwap");
    expect(play).toContain("next.currentTime = 0");
  });
});

describe("B-04：WebP 兜底只在需要时加载", () => {
  it("启动时不再给面板头像与收起圆标设 WebP src（首屏不拉 3.7MB）", () => {
    const boot = sliceBetween(
      "var imgB = root.querySelector('.xm-img-b');",
      "/* ---------- 姿势状态机",
    );
    expect(boot).not.toContain("setIconImg(");
  });

  it("面板头像懒加载：打开面板时才设 src", () => {
    const open = fnBody("openPanel");
    expect(open).toContain("setIconImg(root.querySelector('.xm-p-head img'))");
  });

  it("收起圆标懒加载：收起时与启动恢复收起态时才设 src", () => {
    const collapse = fnBody("collapseCat");
    expect(collapse).toContain("setIconImg(root.querySelector('.xm-tab img'))");
    const bootClosed = sliceBetween("root.classList.add('xm-closed');", "var wrapEl = root.querySelector('.xm-wrap');");
    expect(bootClosed).toContain("setIconImg(root.querySelector('.xm-tab img'))");
  });

  it("主题切换刷新只动已加载过的图标（没加载过的不提前拉取）", () => {
    const refresh = fnBody("refreshAvatarImages");
    expect(refresh).toContain("hasAttribute('src')");
  });

  it("兜底图本身仍懒创建：ensureFallbackImg 不设 src，只 showFallback 设", () => {
    const ensure = fnBody("ensureFallbackImg");
    // 2026-11-18 视觉线订正：断言只钉创建路径——error 处理里的
    // fallbackImg.src = fallbackUrl(fallbackCurrent, 'gif') 是 WebP 失败后的
    // 合法重试（加载已开始才触发），不在此断言范围内；旧断言用裸 ".src = "
    // 会把重试也算进来，在旧代码上就是假红。
    const creation = ensure.slice(0, ensure.indexOf("addEventListener('error'"));
    expect(creation).not.toContain(".src = ");
    const show = fnBody("showFallback");
    expect(show).toContain("fallbackImg.src = fallbackUrl(name, 'webp')");
  });
});

describe("B-08：聊天面板/游戏焦点陷阱 + Esc", () => {
  it("面板是模态对话框（aria-modal），游戏同样", () => {
    expect(WIDGET).toContain('<div class="xm-panel" role="dialog" aria-modal="true"');
    const game = sliceBetween("gameEl.className = 'xm-game';", "var gBig = ");
    expect(game).toContain("setAttribute('role', 'dialog')");
    expect(game).toContain("setAttribute('aria-modal', 'true')");
  });

  it("Tab 有焦点陷阱：面板/游戏开着时 Tab 不漏到页面背后", () => {
    expect(WIDGET).toContain("function trapTabIn(");
    const trap = fnBody("trapTabIn");
    expect(trap).toContain("getClientRects()");
    expect(trap).toContain("ev.preventDefault()");
    const keydown = sliceBetween(
      "document.addEventListener('keydown', function (ev) {",
      "/* 坞内有动静",
    );
    expect(keydown).toContain("ev.key === 'Tab'");
    expect(keydown).toContain("trapTabIn(gameEl, ev)");
    expect(keydown).toContain("trapTabIn(panelEl, ev)");
  });

  it("Esc 按游戏 > 面板 > 坞的优先级关闭（不再只收坞）", () => {
    const keydown = sliceBetween(
      "document.addEventListener('keydown', function (ev) {",
      "/* 坞内有动静",
    );
    expect(keydown).toContain("closeGame()");
    expect(keydown).toContain("closePanel()");
    expect(keydown).toContain("hideControls()");
    expect(keydown.indexOf("closeGame()")).toBeLessThan(keydown.indexOf("closePanel()"));
  });

  it("打开面板/游戏记下触发焦点，关闭时还回去", () => {
    const open = fnBody("openPanel");
    expect(open).toContain("document.activeElement");
    const close = fnBody("closePanel");
    expect(close).toContain(".focus()");
    const openGame = fnBody("openGame");
    expect(openGame).toContain("document.activeElement");
    const closeGame = fnBody("closeGame");
    expect(closeGame).toContain(".focus()");
  });
});

describe("B-25a：发送按钮/坞聊天钮/深色收起角标对比度", () => {
  it("发送按钮白字在新渐变两端都 ≥4.5:1（双模式同一条渐变）", () => {
    const send = cssRule("#xiaomaomao .xm-send");
    expect(send).not.toContain("var(--xm-accent),#ff8fab");
    const [a, b] = gradientEnds(send);
    expect(contrast("#fff", a)).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#fff", b)).toBeGreaterThanOrEqual(4.5);
  });

  it("坞聊天钮白图标在同一条新渐变上 ≥3:1（非文字）", () => {
    const chat = cssRule("#xiaomaomao .xm-chat-btn");
    expect(chat).not.toContain("var(--xm-accent),#ff8fab");
    const [a, b] = gradientEnds(chat);
    expect(contrast("#fff", a)).toBeGreaterThanOrEqual(3);
    expect(contrast("#fff", b)).toBeGreaterThanOrEqual(3);
  });

  it("深色收起角标白图标 ≥3:1（旧 #ff7096 实底只有 2.62:1）", () => {
    const badge = cssRule("html.dark #xiaomaomao .xm-tab-badge");
    expect(badge).toContain("background:#d6336c");
    expect(contrast("#fff", "#d6336c")).toBeGreaterThanOrEqual(3);
  });

  it("浅色收起角标仍过 3:1（旧 #f4507e 实底 3.34:1，未动）", () => {
    const badge = cssRule("#xiaomaomao .xm-tab-badge");
    expect(badge).toContain("background:var(--xm-accent)");
    expect(contrast("#fff", "#f4507e")).toBeGreaterThanOrEqual(3);
  });
});
