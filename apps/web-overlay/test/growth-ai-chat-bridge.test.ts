/**
 * 成长系统 ai_chat 经验断链修复守卫（DEV_BACKLOG A12）：
 *
 * 图鉴写「点右下角小猫猫（聊天）」给 ai_chat 经验，但挂件按设计只读
 * navhub.growth.v1、从不回写，此前照图鉴做的人永远拿不到经验、
 * 「猫语者」徽章点不亮（真触发点只有 Cmd+J 的 AI 抽屉）。
 *
 * 修复口径：挂件只发事件（navhub:ai-chat-used）、不直接改成长档案；
 * 站内 GrowthTracker 监听后走 recordGrowthEvent('ai_chat') 统一落账，
 * 防刷口径与现有规则一致。本测试守三层：
 *   1. 事件桥三方接点都在（growth 常量 / tracker 监听 / 挂件在 sendChat 里 dispatch）；
 *   2. 挂件仍然只读成长档案（getItem 可以，setItem 绝不允许碰 GROWTH_KEY）；
 *   3. 落账规则真能点亮徽章且刷不动（首次 30、重复 +2、当日第 6 次起 0）。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("A12 事件桥接点", () => {
  it("growth.ts 定义统一事件名常量", () => {
    expect(read("src/lib/growth.ts")).toContain(
      "export const AI_CHAT_USED_EVENT = 'navhub:ai-chat-used'",
    );
  });

  it("GrowthTracker 监听该事件并按 ai_chat 落账", () => {
    const tracker = read("src/components/growth/growth-tracker.tsx");
    expect(tracker).toContain("AI_CHAT_USED_EVENT");
    expect(tracker).toContain("addEventListener(AI_CHAT_USED_EVENT");
    expect(tracker).toContain("recordGrowthEvent('ai_chat')");
    // 卸载时要摘监听，不能只挂不摘
    expect(tracker).toContain("removeEventListener(AI_CHAT_USED_EVENT");
  });

  it("挂件在 sendChat 里 dispatch 同名事件（且只在有效发送时）", () => {
    const widget = read("public/xiaomaomao/xiaomaomao.js");
    const sendChatAt = widget.indexOf("function sendChat(text)");
    expect(sendChatAt).toBeGreaterThan(-1);
    const slice = widget.slice(sendChatAt, sendChatAt + 1200);
    expect(slice).toContain("new CustomEvent('navhub:ai-chat-used')");
    // 空消息/忙碌守卫在 dispatch 之前：无效发送不给经验
    expect(slice.indexOf("if (!q || busy) return;")).toBeLessThan(
      slice.indexOf("navhub:ai-chat-used"),
    );
  });

  it("挂件仍然只读成长档案：绝不 setItem 成长 key", () => {
    const widget = read("public/xiaomaomao/xiaomaomao.js");
    expect(widget).toContain("localStorage.getItem(GROWTH_KEY)");
    expect(widget).not.toContain("setItem(GROWTH_KEY");
    expect(widget).not.toContain('setItem("navhub.growth.v1"');
    expect(widget).not.toContain("setItem('navhub.growth.v1'");
  });

  it("图鉴文案仍指向右下角小猫猫（桥接上后文案与行为一致）", () => {
    expect(read("src/lib/growth.ts")).toContain("点右下角小猫猫，问它找站");
  });
});

describe("A12 落账规则（与现有经验口径一致）", () => {
  it("首次 ai_chat +30 并点亮「猫语者」徽章，重复递减、当日封顶后 0", async () => {
    const growth = await import(pathToFileURL(join(ROOT, "src/lib/growth.ts")).href);
    const now = new Date("2026-11-11T10:00:00+08:00");

    let profile = growth.emptyProfile(now);
    const first = growth.awardEvent(profile, "ai_chat", {}, now);
    expect(first.gained).toBe(30); // 生涯首次 20 + 每日首次 10
    profile = first.profile;
    expect(profile.features.ai_chat?.count).toBe(1);
    const badge = growth.deriveBadges(profile, now).find((b: { id: string }) => b.id === "cat-talk");
    expect(badge?.earned).toBe(true);

    // 当日第 2 次 +2，第 6 次起 0（防刷口径与其它功能一致）
    let gained = 0;
    for (let i = 0; i < 5; i++) {
      const r = growth.awardEvent(profile, "ai_chat", {}, now);
      gained = r.gained;
      profile = r.profile;
    }
    expect(gained).toBe(0);
    expect(profile.features.ai_chat?.count).toBe(6);
  });
});
