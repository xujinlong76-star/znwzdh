/**
 * lib/platform.ts 的行为测试（2026-11-10）。
 *
 * ## 为什么现在才补
 *
 * 这个文件一直有 5 个导出，但**从来没有测试**：
 * `getModifierKey` 只被别的测试间接断言过「源码里调用了它」，
 * 而 `isAppleDevice` / `isTouchDevice` / `isStandalonePwa` 的**实际判定结果**
 * 一行都没有验证过。
 *
 * 事情的转折点是本轮把 `isStandalonePwa()` 接进了 install-prompt ——
 * 那一刻它从「没人调用的死导出」变成了「决定是否弹安装横幅的生产判断」，
 * 却仍然没有任何测试。所以先把行为钉住，再谈接线。
 *
 * ## 怎么测
 *
 * 全部靠注入 `window`（不使用 jsdom 的真实 window）：环境相关判断的
 * 唯一可靠测法是给它一个受控的假 window，而不是指望测试运行器恰好模拟出
 * 「iPadOS 桌面版伪装成 MacIntel」这类边界。
 * 每个用例跑完都还原 globalThis.window，互不污染。
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  getModifierKey,
  isAppleDevice,
  isStandalonePwa,
  isTouchDevice,
} from "../src/lib/platform";

type FakeWindow = Record<string, unknown>;
const ORIGINAL_WINDOW = (globalThis as { window?: unknown }).window;

/** 装上假 window 后跑一段断言，结束后无条件还原 */
function withWindow<T>(win: FakeWindow | undefined, run: () => T): T {
  if (win === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = win;
  }
  try {
    return run();
  } finally {
    if (ORIGINAL_WINDOW === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = ORIGINAL_WINDOW;
    }
  }
}

/** 构造 matchMedia：只有列出的查询返回 true，其余 false */
function matchMediaOf(trueQueries: string[]) {
  return (query: string) => ({ matches: trueQueries.includes(query) });
}

describe("isAppleDevice：三套判据都要认", () => {
  afterEach(() => {
    // 防御：某个用例抛错时也把 window 还原，避免污染后续用例
    if (ORIGINAL_WINDOW === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = ORIGINAL_WINDOW;
  });

  it("无 window（SSR）时返回 false", () => {
    withWindow(undefined, () => expect(isAppleDevice()).toBe(false));
  });

  it("优先用 User-Agent Client Hints 的 platform", () => {
    withWindow(
      { navigator: { userAgentData: { platform: "macOS" }, platform: "", userAgent: "" } },
      () => expect(isAppleDevice()).toBe(true),
    );
    withWindow(
      { navigator: { userAgentData: { platform: "Windows" }, platform: "MacIntel", userAgent: "Macintosh" } },
      // Client Hints 明确说 Windows 时，不该再被 legacy 的 MacIntel 拉回 true
      () => expect(isAppleDevice()).toBe(false),
    );
  });

  it("传统 navigator.platform / userAgent 兜底", () => {
    withWindow({ navigator: { platform: "MacIntel", userAgent: "x" } }, () =>
      expect(isAppleDevice()).toBe(true),
    );
    withWindow({ navigator: { platform: "iPhone", userAgent: "x" } }, () =>
      expect(isAppleDevice()).toBe(true),
    );
    withWindow({ navigator: { platform: "Win32", userAgent: "Windows NT 10.0" } }, () =>
      expect(isAppleDevice()).toBe(false),
    );
  });

  it("iPadOS 13+ 伪装成 MacIntel，靠 maxTouchPoints 识别", () => {
    withWindow({ navigator: { platform: "MacIntel", userAgent: "Macintosh", maxTouchPoints: 5 } }, () =>
      expect(isAppleDevice()).toBe(true),
    );
    // 真 Mac 的 maxTouchPoints 是 0
    withWindow({ navigator: { platform: "MacIntel", userAgent: "Macintosh", maxTouchPoints: 0 } }, () =>
      expect(isAppleDevice()).toBe(true), // 仍然命中 /Mac/ 分支
    );
  });
});

describe("getModifierKey：跟随 Apple 判定", () => {
  it("Apple 给 ⌘，其余给 Ctrl", () => {
    withWindow({ navigator: { platform: "MacIntel", userAgent: "Macintosh" } }, () =>
      expect(getModifierKey()).toBe("⌘"),
    );
    withWindow({ navigator: { platform: "Win32", userAgent: "Windows" } }, () =>
      expect(getModifierKey()).toBe("Ctrl"),
    );
  });
});

describe("isTouchDevice：三个信号任一成立即算触屏", () => {
  it("无 window 时返回 false", () => {
    withWindow(undefined, () => expect(isTouchDevice()).toBe(false));
  });

  it("ontouchstart 存在", () => {
    withWindow({ ontouchstart: null, navigator: {} }, () => expect(isTouchDevice()).toBe(true));
  });

  it("maxTouchPoints > 0", () => {
    withWindow({ navigator: { maxTouchPoints: 2 }, matchMedia: matchMediaOf([]) }, () =>
      expect(isTouchDevice()).toBe(true),
    );
  });

  it("pointer: coarse 媒体查询命中", () => {
    withWindow(
      { navigator: {}, matchMedia: matchMediaOf(["(pointer: coarse)"]) },
      () => expect(isTouchDevice()).toBe(true),
    );
  });

  it("三者都不成立时是鼠标设备", () => {
    withWindow({ navigator: { maxTouchPoints: 0 }, matchMedia: matchMediaOf([]) }, () =>
      expect(isTouchDevice()).toBe(false),
    );
  });

  it("matchMedia 缺失也不抛错", () => {
    withWindow({ navigator: { maxTouchPoints: 0 } }, () => expect(isTouchDevice()).toBe(false));
  });
});

describe("isStandalonePwa：standalone 与 fullscreen 都算已安装", () => {
  it("无 window 时返回 false", () => {
    withWindow(undefined, () => expect(isStandalonePwa()).toBe(false));
  });

  it("iOS 的 navigator.standalone", () => {
    withWindow({ navigator: { standalone: true } }, () => expect(isStandalonePwa()).toBe(true));
  });

  it("display-mode: standalone", () => {
    withWindow(
      { navigator: {}, matchMedia: matchMediaOf(["(display-mode: standalone)"]) },
      () => expect(isStandalonePwa()).toBe(true),
    );
  });

  /**
   * 这条是 install-prompt 修复的直接依据：
   * 旧代码内联只判 standalone，全屏打开时会被判成「未安装」而反复弹横幅。
   */
  it("display-mode: fullscreen 也算已安装（旧内联判断漏掉的正是这一条）", () => {
    withWindow(
      { navigator: {}, matchMedia: matchMediaOf(["(display-mode: fullscreen)"]) },
      () => expect(isStandalonePwa()).toBe(true),
    );
  });

  it("浏览器标签页里既非 standalone 也非 fullscreen", () => {
    withWindow({ navigator: {}, matchMedia: matchMediaOf([]) }, () =>
      expect(isStandalonePwa()).toBe(false),
    );
  });
});
