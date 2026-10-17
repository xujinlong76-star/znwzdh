/**
 * 离线提示：既要**挂上**，也要**说实话**。
 *
 * 真实缺陷（改动前）：
 *   1. `components/offline-banner.tsx` 写好了但全仓无人渲染 —— 用户离线时
 *      只能看到各页面零散的「无法连接中枢」，没人告诉他原因是自己的网络断了；
 *   2. 它的文案在编造能力：「私密收藏与端侧工具 100% 可用」「已自动恢复云端同步
 *      与实时检索」。离线时搜索 / 榜单 / 收藏云端同步都不存在；重连后也**没有**
 *      自动同步（云端同步只在打开收藏页时触发）。说了做不到 = 更伤信任。
 *
 * 这里锁：判定与文案（纯函数）、不许出现的虚假承诺、以及组件/布局的接线。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { RECONNECTED_NOTICE_MS, describeOfflineBanner } from "../src/lib/offline-banner";

const HERE = dirname(fileURLToPath(import.meta.url));

/** 定位并读取 overlay 里的文件；镜像副本（apps/web/test）不会被误当成源 */
function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return readFileSync(hit, "utf8");
}

describe("describeOfflineBanner：什么时候显示、显示什么", () => {
  it("在线且不在提示期时不显示（不要常驻打扰）", () => {
    const s = describeOfflineBanner(true, false);
    expect(s.visible).toBe(false);
  });

  it("离线时显示，并明确说「是你离线」+ 哪些功能不可用 + 联网后重试", () => {
    const s = describeOfflineBanner(false, false);
    expect(s.visible).toBe(true);
    expect(s.tone).toBe("offline");
    expect(s.title).toContain("离线");
    expect(s.hint).toContain("中枢");
    expect(s.hint).toContain("联网后重试");
    expect(s.hint).toContain("已加载的内容");
  });

  it("重连后短暂提示「已恢复」，并说明要手动重试（不承诺自动同步）", () => {
    const s = describeOfflineBanner(true, true);
    expect(s.visible).toBe(true);
    expect(s.tone).toBe("restored");
    expect(s.title).toContain("恢复");
    expect(s.hint).toContain("重试");
  });

  it("离线优先于「刚恢复」：正在离线时不许显示绿色的恢复提示", () => {
    const s = describeOfflineBanner(false, true);
    expect(s.tone).toBe("offline");
    expect(s.title).not.toContain("恢复");
  });

  it("提示期是有限时长（不会永远停在屏幕上）", () => {
    expect(RECONNECTED_NOTICE_MS).toBeGreaterThan(0);
    expect(RECONNECTED_NOTICE_MS).toBeLessThanOrEqual(10000);
  });
});

describe("文案不许编造能力（回归守卫）", () => {
  const allText = [describeOfflineBanner(false, false), describeOfflineBanner(true, true)]
    .map((s) => s.title + " " + s.hint)
    .join(" ");

  it("不说「100% 可用」这类无法保证的话", () => {
    expect(allText).not.toContain("100%");
  });

  it("不承诺「自动同步 / 自动恢复」（重连后并不会自动同步收藏）", () => {
    expect(allText).not.toContain("自动同步");
    expect(allText).not.toContain("自动恢复");
  });

  it("离线文案必须承认功能受限，而不是只说好话", () => {
    expect(describeOfflineBanner(false, false).hint).toContain("不可用");
  });
});

describe("源码守卫：真的挂上了，且监听器与定时器都收干净", () => {
  it("根布局渲染了 OfflineBanner（回归：写好了却从未挂载）", () => {
    const src = overlaySource("src/app/layout.tsx");
    expect(src).toContain("import { OfflineBanner } from '@/components/offline-banner'");
    expect(src).toContain("<OfflineBanner />");
  });

  it("组件监听 online / offline 并成对移除，且用 ref 清掉重连提示的定时器", () => {
    const src = overlaySource("src/components/offline-banner.tsx");
    expect(src).toContain("'use client'");
    expect(src).toContain("addEventListener('online'");
    expect(src).toContain("addEventListener('offline'");
    expect(src).toContain("removeEventListener('online'");
    expect(src).toContain("removeEventListener('offline'");
    expect(src).toContain("clearTimeout");
    expect(src).toContain("timerRef");
    // 旧实现的 bug：把清理函数 return 给事件监听器（永远不会被调用）
    expect(src).not.toContain("return () => clearTimeout(timer)");
  });

  it("组件只负责渲染：判定来自 lib/offline-banner.ts", () => {
    const src = overlaySource("src/components/offline-banner.tsx");
    expect(src).toContain("describeOfflineBanner(isOnline, justReconnected)");
    expect(src).toContain("if (!state.visible) return null");
    expect(src).toContain('role="status"');
    expect(src).toContain('aria-live="polite"');
  });
});
