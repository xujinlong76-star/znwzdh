/**
 * 插件市场前端运行时测试（vitest 风格）。
 *
 * 锁定两条链路的回归：
 *   1. theme-runtime：CSS 变量白名单过滤、accent 属性（必须与 globals.css 的
 *      [data-accent=...] 规则一致）、持久化与重置无残留；
 *   2. preset-staging：安装暂存的「消费一次即删」语义与脏数据自清理。
 *
 * node 环境没有 document/localStorage，测试自建最小桩件（不引入 jsdom 依赖）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyThemeTokens,
  getActiveTheme,
  initThemeRuntime,
  resetTheme,
  setActiveTheme,
  THEME_STORAGE_KEY,
} from "../src/lib/plugins/theme-runtime";
import {
  PRESET_STAGING_KEY,
  clearStagedWorkspacePreset,
  peekStagedWorkspacePreset,
  stageWorkspacePreset,
  takeStagedWorkspacePreset,
} from "../src/lib/plugins/preset-staging";

/* ------------------------------ 最小浏览器环境桩件 ------------------------------ */

function installEnv() {
  const style = new Map<string, string>();
  const attrs = new Map<string, string>();
  const store = new Map<string, string>();
  const events: string[] = [];

  const g = globalThis as Record<string, unknown>;
  g.document = {
    documentElement: {
      style: {
        setProperty: (k: string, v: string) => style.set(k, v),
        removeProperty: (k: string) => style.delete(k),
      },
      setAttribute: (k: string, v: string) => attrs.set(k, v),
      removeAttribute: (k: string) => attrs.delete(k),
    },
  };
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  };
  g.window = {
    dispatchEvent: (e: { type?: string }) => {
      events.push(String(e?.type));
      return true;
    },
  };
  g.CustomEvent = class {
    type: string;
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type;
      this.detail = init?.detail;
    }
  };

  return { style, attrs, store, events };
}

let env: ReturnType<typeof installEnv>;
beforeEach(() => {
  env = installEnv();
});

/* ------------------------------ theme-runtime ------------------------------ */

describe("theme-runtime", () => {
  it("applyThemeTokens：白名单外变量被忽略、值被 trim、accent 落到 data-accent 属性", () => {
    applyThemeTokens({ "--primary": " 262 83% 58% ", "--evil-var": "x" } as never, "violet");
    expect(env.style.get("--primary")).toBe("262 83% 58%");
    expect(env.style.has("--evil-var")).toBe(false);
    expect(env.style.size).toBe(1);
    // 属性名必须与 globals.css 的 [data-accent=...] 强调色块一致：
    // 用 data-theme-accent 等于没有样式生效（历史缺陷，勿回退）
    expect(env.attrs.get("data-accent")).toBe("violet");
  });

  it("setActiveTheme：先清旧变量残留再应用，并持久化 + 广播事件", () => {
    env.style.set("--card", "0 0% 100%"); // 模拟旧主题残留
    setActiveTheme({ slug: "pack-a", name: "主题甲", tokens: { "--primary": "1 2% 3%" }, accent: "rose" });
    expect(env.style.has("--card")).toBe(false);
    expect(env.style.get("--primary")).toBe("1 2% 3%");
    expect(env.attrs.get("data-accent")).toBe("rose");
    const persisted = JSON.parse(env.store.get(THEME_STORAGE_KEY) ?? "null");
    expect(persisted?.slug).toBe("pack-a");
    expect(persisted?.appliedAt).toBeGreaterThan(0);
    expect(env.events).toContain("navhub_theme_changed");
  });

  it("resetTheme：变量、accent 与存储全部清空且无残留", () => {
    setActiveTheme({ slug: "pack-b", name: "主题乙", tokens: { "--radius": "0.75rem" }, accent: "amber" });
    resetTheme();
    expect(env.style.size).toBe(0);
    expect(env.attrs.has("data-accent")).toBe(false);
    expect(env.store.has(THEME_STORAGE_KEY)).toBe(false);
    expect(getActiveTheme()).toBeNull();
  });

  it("initThemeRuntime：从存储恢复主题；损坏 JSON 返回 null", () => {
    setActiveTheme({ slug: "pack-c", name: "主题丙", tokens: { "--ring": "9 9% 9%" }, accent: "emerald" });
    env.style.delete("--ring");
    env.attrs.delete("data-accent");
    const restored = initThemeRuntime();
    expect(restored?.slug).toBe("pack-c");
    expect(env.style.get("--ring")).toBe("9 9% 9%");
    expect(env.attrs.get("data-accent")).toBe("emerald");

    env.store.set(THEME_STORAGE_KEY, "{not-json");
    expect(getActiveTheme()).toBeNull();
  });
});

/* ------------------------------ preset-staging ------------------------------ */

describe("preset-staging", () => {
  it("stage → peek → take：peek 不消费，take 消费一次即删", () => {
    const ok = stageWorkspacePreset("preset-a", "看板合集", {
      boards: [{ name: "驾驶舱", widgets: [{ type: "clock-pomodoro", customTitle: "定时器" }] }],
    });
    expect(ok).toBe(true);
    expect(env.store.has(PRESET_STAGING_KEY)).toBe(true);
    expect(peekStagedWorkspacePreset()?.slug).toBe("preset-a");
    expect(peekStagedWorkspacePreset()?.slug).toBe("preset-a");
    const taken = takeStagedWorkspacePreset();
    expect(taken?.slug).toBe("preset-a");
    expect(taken?.payload.boards?.[0]?.name).toBe("驾驶舱");
    expect(taken?.mode).toBe("append");
    expect(peekStagedWorkspacePreset()).toBeNull();
    expect(env.store.has(PRESET_STAGING_KEY)).toBe(false);
  });

  it("损坏 JSON / 空 boards 视为无暂存并清理脏数据", () => {
    env.store.set(PRESET_STAGING_KEY, "{bad-json");
    expect(peekStagedWorkspacePreset()).toBeNull();
    expect(env.store.has(PRESET_STAGING_KEY)).toBe(false);

    env.store.set(PRESET_STAGING_KEY, JSON.stringify({ slug: "x", name: "x", payload: { boards: [] } }));
    expect(takeStagedWorkspacePreset()).toBeNull();
    expect(env.store.has(PRESET_STAGING_KEY)).toBe(false);
  });

  it("clearStagedWorkspacePreset 支持安装前反悔清空；mode 可携带覆盖意图", () => {
    stageWorkspacePreset("preset-b", "合集乙", { boards: [{ widgets: [{ type: "weather" }] }] }, "replace");
    expect(peekStagedWorkspacePreset()?.mode).toBe("replace");
    clearStagedWorkspacePreset();
    expect(env.store.has(PRESET_STAGING_KEY)).toBe(false);
  });
});
