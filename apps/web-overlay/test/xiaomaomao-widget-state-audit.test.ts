/**
 * 小猫猫挂件状态机守卫（2026-11-18，深度审计 P0+P1 全修 · 状态机线）：
 *
 * 钉住 5 项 P1（收起/游乐场/面板/气泡四种状态互斥 + 庆祝不丢）：
 *  1. C-12/A P1-2：收起/睡眠时到的升级/徽章庆祝先排队、唤回/唤醒后补发，不写盘丢弃。
 *  2. A P1-3/C-10：收起即关游乐场；亲手开游乐场清掉持久收起；开机自启 1200ms 内收起过就不自启。
 *  3. C-11：聊天面板开着时游乐场停（位置不动、切待机视频），关面板按模式续播。
 *  4. C-14：气泡与坞双向互斥——TIPS 坞开着不抢，坞展开先收气泡。
 *  5. C-15：850ms 入场招呼与点猫不同帧抢文案——850ms 内用户动过手就跳过自动招呼。
 *
 * 与既有 98 项守卫同款写法：源码断言（不引 jsdom——jsdom 未装进仓库依赖，
 * 行为级验证走本机无头 Chromium + 本地 dev 栈的 CDP 探针，见 VERIFICATION.md）。
 * 每项断言都取“新机制独有的字符串/行内顺序”，先在旧代码上跑红证伪（R7），实现后转绿。
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

/** 取 startMarker 与 endMarker 之间的一段源码（函数体级断言用，避免全文件同名行误命中）。 */
function sliceBetween(src: string, startMarker: string, endMarker: string): string {
  const s = src.indexOf(startMarker);
  expect(s, "找不到起点 " + startMarker).toBeGreaterThan(-1);
  const e = src.indexOf(endMarker, s + startMarker.length);
  expect(e, "找不到终点 " + endMarker + "（起点 " + startMarker + "）").toBeGreaterThan(-1);
  return src.slice(s, e);
}

describe("C-12/A P1-2 升级庆祝排队：收起/睡眠时不丢，唤回/唤醒后补发", () => {
  it("收起/睡眠分支只记队列、不写盘：pendingCelebration 在 return 前，persistV4 不在该分支里", () => {
    const branchStart = WIDGET.indexOf("if (root.classList.contains('xm-closed') || sleeping) {", WIDGET.indexOf("function checkGrowth"));
    expect(branchStart, "checkGrowth 里找不到收起/睡眠分支").toBeGreaterThan(-1);
    const branchEnd = WIDGET.indexOf("return;", branchStart);
    const branch = WIDGET.slice(branchStart, branchEnd);
    expect(branch).toContain("pendingCelebration = { text: text, level: lv.level, ids: ids };");
    expect(branch).not.toContain("persistV4");
    expect(branch).not.toContain("v4.seenLevel = ");
    expect(branch).not.toContain("v4.seenBadges = ");
  });

  it("补发函数在位：flushPendingCelebration 唤回/唤醒后补发，见证在补发时才写盘", () => {
    expect(WIDGET).toContain("function flushPendingCelebration() {");
    expect(WIDGET).toContain("v4.seenBadges = p.ids;");
    expect(WIDGET).toContain("celebrateGrowth(p.text)");
    expect(WIDGET).toContain("function celebrateGrowth(text) {");
  });

  it("唤回三处都补发：wakeUp、圆标唤回、开面板", () => {
    const wakeUp = sliceBetween(WIDGET, "function wakeUp(fromUser) {", "function goSleep() {");
    expect(wakeUp).toContain("flushPendingCelebration()");
    const tab = sliceBetween(WIDGET, "root.querySelector('.xm-tab').addEventListener('click', function () {", "/* ---------- 聊天面板 ----------");
    expect(tab).toContain("flushPendingCelebration()");
    const openPanel = sliceBetween(WIDGET, "function openPanel() {", "function closePanel() {");
    expect(openPanel).toContain("flushPendingCelebration()");
  });

  it("庆祝优先于通用招呼：已补发庆祝就不再出“我回来啦”/“我醒啦”", () => {
    const tab = sliceBetween(WIDGET, "root.querySelector('.xm-tab').addEventListener('click', function () {", "/* ---------- 聊天面板 ----------");
    expect(tab).toContain("var celebrated = wakeUp(false) || flushPendingCelebration();");
    expect(tab).toContain("if (!celebrated) {");
    const wakeUp = sliceBetween(WIDGET, "function wakeUp(fromUser) {", "function goSleep() {");
    expect(wakeUp).toContain("if (fromUser && !celebrated) showBubble(");
    const spm = sliceBetween(WIDGET, "function setPlayMode(on) {", "/* ---------- 拖链接喂猫收藏");
    expect(spm).toContain("if (!celebrated) showBubble('好耶，陪我玩吧～我会追着你的鼠标跑！', true);");
  });
});

describe("A P1-3/C-10 收起即关游乐场，收起粘得住", () => {
  it("collapseCat 同步关游乐场（不停 rAF/定时器）", () => {
    const body = sliceBetween(WIDGET, "function collapseCat() {", "root.querySelector('.xm-close-btn')");
    expect(body).toContain("if (play.on) setPlayMode(false);");
  });

  it("亲手开游乐场清掉持久收起并写盘", () => {
    const body = sliceBetween(WIDGET, "function setPlayMode(on) {", "/* ---------- 拖链接喂猫收藏");
    expect(body).toContain("if (store.closed) { store.closed = false; store.closedAt = 0; persist(); }");
  });

  it("开机自启 1200ms 内用户刚收起猫就不自启（回调内再查一次 store.closed）", () => {
    const auto = sliceBetween(WIDGET, "window.XIAOMAOMAO_PLAY === true", "}, 1200);");
    expect(auto).toContain("if (store.closed) return;");
    expect(auto).toContain("setPlayMode(true)");
  });
});

describe("C-11 面板开着游乐场停", () => {
  it("playTick 面板开着不移动（循环继续、位置不动）", () => {
    const body = sliceBetween(WIDGET, "function playTick(now) {", "function playEnsureLoop() {");
    expect(body).toContain("if (root.classList.contains('xm-open')) return;");
  });

  it("开面板切待机视频、关面板按模式续播", () => {
    const openPanel = sliceBetween(WIDGET, "function openPanel() {", "function closePanel() {");
    expect(openPanel).toContain("if (play.on && (play.mode === 'chase' || play.mode === 'wander' || play.mode === 'pounce')) playClip('idle');");
    const closePanel = sliceBetween(WIDGET, "function closePanel() {", "root.querySelector('.xm-chat-btn')");
    expect(closePanel).toContain("if (play.mode === 'chase' || play.mode === 'wander') playClip('walk');");
  });
});

describe("C-14 气泡与坞双向互斥", () => {
  it("TIPS 定时气泡坞开着不抢：条件含 !ctlShown，本次提示不消费（lastTipAt/tipIdx 不动）", () => {
    expect(WIDGET).toContain("if (!userTyping && !ctlShown && idleFor > 50000 && Date.now() - lastTipAt > 58000) {");
  });

  it("坞展开先收气泡：showControls 用户唤出时 hideBubble，自动提示气泡在就不开", () => {
    const body = sliceBetween(WIDGET, "function showControls(fromUser) {", "function hideControls() {");
    expect(body).toContain("hideBubble();");
    expect(body).toContain("if (!fromUser) return;");
    expect(WIDGET).toContain("if (!root.classList.contains('xm-open') && !root.classList.contains('xm-closed') && !docked) showControls();");
  });
});

describe("C-15 850ms 入场招呼不抢用户气泡", () => {
  it("850ms 内用户动过手（点/按）就跳过本次自动招呼", () => {
    expect(WIDGET).toContain("var userActed = false;");
    expect(WIDGET).toContain("userActed = true; markActive();");
    const greet = sliceBetween(WIDGET, "window.setTimeout(function () {\n    greeted = true;", "}, 850);");
    expect(greet).toContain("if (userActed) return;");
  });
});
