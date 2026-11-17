/**
 * 小猫猫挂件 c3001 守卫（2026-11-18，:3001 遮挡问题 (c) 复验）：
 *
 *  实测（2026-11-18 02:15，最新 main 4a64ad0b 生产构建，1686px 真浏览器）：
 *  开场招呼气泡 221×55（x 1451–1672，y 609–664）盖住了「网址包精选」卡片的
 *  描述文字（气泡中心 elementFromPoint 落在 .nav-card-glow 卡片上）；猫的白圆
 *  舞台只蹭到内容区右缘 7px、无可点元素相交，不挡内容。
 *
 *  修法（只拦自动招呼，不动用户主动触发的气泡）：
 *  850ms 自动招呼先把文案放进未显示的气泡再量——按锚定位置算出显示后的矩形
 *  （右缘 = 猫右缘 + 4px，下缘 = 猫顶 - 12px），与 <main> 内的链接/按钮/文章/
 *  卡片（.nav-card-glow）求交；会盖住就跳过本次自动招呼（猫还在原地，点猫照常聊天）。
 *
 *  行为级验证（真浏览器几何）在仓外探针：
 *  C:\Users\88\Desktop\web\c3001-overlap\（probe-c3001.cjs）。
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

describe("c3001 开场招呼不盖卡", () => {
  it("有量测门函数 autoGreetWouldCoverContent", () => {
    expect(WIDGET).toContain("function autoGreetWouldCoverContent()");
  });

  it("门按锚定位置算显示后的气泡矩形（右缘=猫右缘+4，下缘=猫顶-12）", () => {
    expect(WIDGET).toContain(
      "var rect = { left: catRect.right + 4 - bw, top: catRect.top - 12 - bh, right: catRect.right + 4, bottom: catRect.top - 12 };",
    );
  });

  it("门查 <main> 内的链接/按钮/文章/卡片（.nav-card-glow）求交", () => {
    expect(WIDGET).toContain(
      "main.querySelectorAll('a, button, [role=\"button\"], article, .nav-card-glow')",
    );
  });

  it("850ms 自动招呼先放文案再量，盖住就跳过、不出气泡", () => {
    const at = WIDGET.indexOf("bubbleEl.textContent = greetText;");
    expect(at).toBeGreaterThan(-1);
    const body = WIDGET.slice(at, at + 700);
    expect(body).toContain("if (autoGreetWouldCoverContent())");
    expect(body).toContain("bubbleEl.textContent = '';");
    expect(body).toContain("showBubble(greetText, hasUserActivation());");
  });

  it("showBubble 本身不拦（用户主动触发的气泡不受影响）", () => {
    const at = WIDGET.indexOf("function showBubble(text, speakIt)");
    const body = WIDGET.slice(at, at + 500);
    expect(body).not.toContain("autoGreetWouldCoverContent");
  });
});
