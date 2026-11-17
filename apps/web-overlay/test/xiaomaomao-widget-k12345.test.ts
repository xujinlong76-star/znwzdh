/**
 * 小猫猫挂件快修 K1–K5 守卫（2026-11-17，研究落盘
 * ~/workspace/research/xiaomaomao-widget-optimization-2026-11-17.md §5.1）：
 *
 *  K1 右下角悬浮栈规范：猫底边 96px→112px（桌面与 640–1023px 档）、z-index
 *     99990→60；移动端胶囊底边抬到猫顶之上（168px，留 12px 间隙），sm 起
 *     仍 bottom-12（与 112px 的猫留 16px 间隙）。
 *  K2 收起持久化：store.closed/closedAt、collapseCat() 落盘、启动时 7 天内
 *     恢复收起态、亲手唤回即清掉；自动收起（autoClosed）不走这条。
 *  K3 滚动停止 8 秒自动半藏：lastScrollAt 计时 + 悬停守卫；另钉死一个已证伪
 *     的前提——滚动从来不重置 60 秒贴边计时（xmLastAct 与 markActive 的
 *     lastActive 是两个时钟），故不拆 markActive 的 scroll 监听。
 *  K4 一键归位：坞里归位钮（ICONS.reset），清已存拖动位置回默认右下角。
 *  K5 弹窗打开时猫暂隐/降层：open-spotlight 事件 + MutationObserver 捕获
 *     [role="dialog"][aria-modal="true"]，猫降到 z-index 30 并淡出。
 *
 * 行为级验证（真机点击/几何）在仓外 Playwright 脚手架：
 * ~/workspace/xiaomaomao-k12345-evidence/（repro.mjs + server.mjs）。
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

const ROOT = overlayRoot();
const WIDGET = readFileSync(join(ROOT, "public/xiaomaomao/xiaomaomao.js"), "utf8");
const QUICK_NAV = readFileSync(
  join(ROOT, "src/components/floating-quick-nav.tsx"),
  "utf8",
);
const DRAWER = readFileSync(
  join(ROOT, "src/components/ai/ai-copilot-drawer.tsx"),
  "utf8",
);

describe("K1 悬浮栈规范", () => {
  it("猫底边 112px、z-index 60（桌面档）", () => {
    expect(WIDGET).toContain("bottom:calc(112px + env(safe-area-inset-bottom,0px));z-index:60");
    expect(WIDGET).not.toContain("z-index:99990");
  });

  it("640–1023px 档底边同样 112px（原 4.5rem+18px=90px 会蹭胶囊顶部）", () => {
    expect(WIDGET).toContain(
      "@media (min-width:640px) and (max-width:1023px){#xiaomaomao{bottom:calc(112px + env(safe-area-inset-bottom,0px))}}",
    );
    expect(WIDGET).not.toContain("4.5rem + 18px");
  });

  it("移动端猫底边仍为 68px（只动胶囊，不动猫）", () => {
    expect(WIDGET).toContain("bottom:calc(68px + env(safe-area-inset-bottom,0px))");
  });

  it("移动端胶囊底边抬到猫顶之上 168px（68+88+12），sm 起仍 bottom-12", () => {
    expect(QUICK_NAV).toContain("bottom-[calc(68px+88px+12px+env(safe-area-inset-bottom,0px))]");
    expect(QUICK_NAV).toContain("sm:bottom-12");
    expect(QUICK_NAV).not.toContain("bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px)+3rem)]");
  });

  it("抽屉仍在猫之上（z-[100000] 不变），注释里的旧 z-index 已同步", () => {
    expect(DRAWER).toContain("z-[100000]");
    expect(DRAWER).not.toContain("z-index 99990");
  });
});

describe("K2 收起持久化", () => {
  it("store 有 closed/closedAt 字段，启动时读存档", () => {
    expect(WIDGET).toContain("closed: false, closedAt: 0");
    expect(WIDGET).toContain("if (typeof saved.closed === 'boolean') store.closed = saved.closed;");
    expect(WIDGET).toContain("if (typeof saved.closedAt === 'number' && saved.closedAt > 0) store.closedAt = saved.closedAt;");
  });

  it("collapseCat() 落盘收起态", () => {
    const at = WIDGET.indexOf("function collapseCat()");
    const body = WIDGET.slice(at, at + 900);
    expect(body).toContain("store.closed = true;");
    expect(body).toContain("store.closedAt = Date.now();");
    expect(body).toContain("persist();");
  });

  it("启动时 7 天内恢复收起态，过期自动恢复展开", () => {
    expect(WIDGET).toContain("var CLOSED_TTL = 7 * 24 * 3600 * 1000;");
    expect(WIDGET).toContain("if (Date.now() - store.closedAt > CLOSED_TTL)");
  });

  it("亲手唤回（点圆标）即清掉持久收起", () => {
    const at = WIDGET.indexOf("root.querySelector('.xm-tab').addEventListener('click'");
    const body = WIDGET.slice(at, at + 900);
    expect(body).toContain("store.closed = false;");
    expect(body).toContain("store.closedAt = 0;");
    expect(body).toContain("persist();");
  });

  it("自动收起的恢复仍只认 autoClosed，不动用户亲手收起", () => {
    expect(WIDGET).toContain("if (autoClosed) { autoClosed = false; root.classList.remove('xm-closed'); }");
  });
});

describe("K3 滚动停止 8 秒自动半藏", () => {
  it("8 秒阈值与最后滚动时刻齐全", () => {
    expect(WIDGET).toContain("var SCROLL_STOP_DOCK_AFTER = 8000;");
    expect(WIDGET).toContain("lastScrollAt = Date.now();");
  });

  it("4 秒巡检里有滚动停止分支（滚过 300px、停 8 秒、猫 8 秒内无交互）", () => {
    expect(WIDGET).toContain("Date.now() - lastScrollAt > SCROLL_STOP_DOCK_AFTER");
    expect(WIDGET).toContain("Date.now() - xmLastAct > SCROLL_STOP_DOCK_AFTER");
  });

  it("悬停猫时不缩（进出守卫齐全）", () => {
    expect(WIDGET).toContain("xmHovering = true;");
    expect(WIDGET).toContain("xmHovering = false;");
    expect(WIDGET).toContain("!xmHovering");
  });

  it("两个闲置时钟分开钉死：贴边认 xmLastAct（滚动不重置），睡觉/气泡认 lastActive", () => {
    // 60 秒贴边巡检只读 xmLastAct；scroll 监听只喂 markActive（睡觉/气泡时钟）。
    expect(WIDGET).toContain("if (!docked && Date.now() - xmLastAct > DOCK_AFTER)");
    expect(WIDGET).toContain("document.addEventListener('scroll', markActive, { passive: true });");
    expect(WIDGET).toContain("function markActive() { lastActive = Date.now(); }");
    expect(WIDGET).toContain("function noteXmAct() { xmLastAct = Date.now(); }");
  });
});

describe("K4 一键归位", () => {
  it("ICONS 有 24 网格 reset 图标", () => {
    const at = WIDGET.indexOf("reset: SVG_OPEN");
    expect(at).toBeGreaterThan(-1);
    // 与 v7 断言同款：走 SVG_OPEN 前缀即为 24 网格（viewBox 在前缀里）
    expect(WIDGET.slice(at, at + 200)).toContain("SVG_OPEN");
    expect(WIDGET.slice(at, at + 300)).toContain("<path");
  });

  it("坞里有归位钮，插在关闭钮之前", () => {
    expect(WIDGET).toContain("resetBtn.className = 'xm-btn xm-reset-btn';");
    expect(WIDGET).toContain("resetBtn.setAttribute('aria-label', '把小猫放回右下角');");
    expect(WIDGET).toContain("dockBox.insertBefore(resetBtn, closeBtnEl);");
  });

  it("resetCatPos 清已存位置并摘掉行内定位", () => {
    const at = WIDGET.indexOf("function resetCatPos()");
    const body = WIDGET.slice(at, at + 700);
    expect(body).toContain("store.pos = null;");
    expect(body).toContain("persist();");
    expect(body).toContain("root.style.left = '';");
    expect(body).toContain("root.style.top = '';");
    expect(body).toContain("root.style.right = '';");
    expect(body).toContain("root.style.bottom = '';");
  });
});

describe("K5 弹窗打开时猫暂隐/降层", () => {
  it("xm-behind-modal 规则：降到 z-index 30 并淡出、点不着", () => {
    expect(WIDGET).toContain("#xiaomaomao.xm-behind-modal{z-index:30;opacity:0;pointer-events:none");
  });

  it("检测信号齐全：open-spotlight 事件 + MutationObserver + dialog 判定", () => {
    expect(WIDGET).toContain("window.addEventListener('open-spotlight'");
    expect(WIDGET).toContain("new MutationObserver");
    expect(WIDGET).toContain("function anySiteModalOpen()");
    expect(WIDGET).toContain("'[role=\"dialog\"][aria-modal=\"true\"], [role=\"alertdialog\"]'");
    expect(WIDGET).toContain("if (!root.contains(els[i])) return true;");
  });

  it("开关只切 xm-behind-modal 类，不动猫的位置与收起态", () => {
    const at = WIDGET.indexOf("function syncModalDim()");
    const body = WIDGET.slice(at, at + 400);
    expect(body).toContain("root.classList.toggle('xm-behind-modal'");
    expect(body).not.toContain("xm-closed");
  });
});
