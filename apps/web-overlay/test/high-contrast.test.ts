/**
 * 高对比度（lib/high-contrast.ts，结构 1:1 对标 elder-mode）：
 *
 *  - 存储格式演进：旧版只存裸布尔 JSON（"true" / "false"），新版存
 *    { on: boolean } 记录——两种都认，不丢旧值；
 *  - 首次访问无已存偏好时跟随系统偏好（matchMedia('(prefers-contrast: more)')），
 *    一旦手动切换过（另存「已手动」标记键）就只认手动值；
 *  - apply 只动 <html data-high-contrast>，不碰长辈模式与主题属性；
 *  - 事件 navhub:high-contrast-changed 的 detail 为 { on: boolean }。
 *
 * 测试形态与 test/elder-mode.test.ts 同款：纯函数 + Storage 注入，
 * 水合前脚本在 node:vm 沙箱里真跑；window/CustomEvent 只在事件一例里
 * 临时桩，跑完恢复（vitest 环境是 node，平时没有 window）。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
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

/** 最小 Storage 替身：setHighContrast 只用 getItem/setItem（其余补齐防意外调用） */
function fakeStorage(entries: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => void map.clear(),
  } as Storage;
}

async function loadModules() {
  const highContrast = await import(pathToFileURL(join(ROOT, "src/lib/high-contrast.ts")).href);
  return { highContrast };
}

describe("loadHighContrast 解析：旧版布尔字符串兼容", () => {
  it("storage 为 null / 空 / 坏 JSON 一律返回 false，不抛错", async () => {
    const { highContrast } = await loadModules();
    const key = highContrast.HIGH_CONTRAST_STORAGE_KEY as string;
    expect(highContrast.loadHighContrast(null)).toBe(false);
    expect(highContrast.loadHighContrast(fakeStorage())).toBe(false);
    expect(highContrast.loadHighContrast(fakeStorage({ [key]: "{oops" }))).toBe(false);
    expect(highContrast.loadHighContrast(fakeStorage({ [key]: "" }))).toBe(false);
  });

  it("旧版裸布尔字符串 'true' / 'false' 按字面值认", async () => {
    const { highContrast } = await loadModules();
    const key = highContrast.HIGH_CONTRAST_STORAGE_KEY as string;
    expect(highContrast.loadHighContrast(fakeStorage({ [key]: "true" }))).toBe(true);
    expect(highContrast.loadHighContrast(fakeStorage({ [key]: "false" }))).toBe(false);
    // 旧版 set 写的是 JSON.stringify(on)，与裸布尔字符串同一值
    expect(highContrast.loadHighContrast(fakeStorage({ [key]: JSON.stringify(true) }))).toBe(true);
    expect(highContrast.loadHighContrast(fakeStorage({ [key]: JSON.stringify(false) }))).toBe(false);
  });

  it("新版 JSON 记录 {on:true} 读出 true，{on:false} 读出 false", async () => {
    const { highContrast } = await loadModules();
    const key = highContrast.HIGH_CONTRAST_STORAGE_KEY as string;
    expect(highContrast.loadHighContrast(fakeStorage({ [key]: JSON.stringify({ on: true }) }))).toBe(true);
    expect(highContrast.loadHighContrast(fakeStorage({ [key]: JSON.stringify({ on: false }) }))).toBe(false);
  });
});

describe("开/关往返与手动标记：手动值压过系统偏好", () => {
  it("开/关往返：记录与手动标记同时落盘，load 读回一致", async () => {
    const { highContrast } = await loadModules();
    const key = highContrast.HIGH_CONTRAST_STORAGE_KEY as string;
    const manual = highContrast.HIGH_CONTRAST_MANUAL_STORAGE_KEY as string;
    const store = fakeStorage();
    highContrast.setHighContrast(true, store);
    expect(JSON.parse(store.getItem(key) as string)).toEqual({ on: true });
    expect(store.getItem(manual)).toBe("true");
    expect(highContrast.loadHighContrast(store)).toBe(true);
    highContrast.setHighContrast(false, store);
    expect(JSON.parse(store.getItem(key) as string)).toEqual({ on: false });
    expect(highContrast.loadHighContrast(store)).toBe(false);
  });

  it("手动关过：系统偏好再命中也不自动开", async () => {
    const { highContrast } = await loadModules();
    const store = fakeStorage();
    highContrast.setHighContrast(false, store);
    expect(highContrast.loadHighContrast(store, true)).toBe(false);
  });

  it("手动开过：系统偏好撤回也不自动关", async () => {
    const { highContrast } = await loadModules();
    const store = fakeStorage();
    highContrast.setHighContrast(true, store);
    expect(highContrast.loadHighContrast(store, false)).toBe(true);
  });

  it("返回值就是传入的开关值；storage 为 null / setItem 全抛错也不抛错", async () => {
    const { highContrast } = await loadModules();
    expect(highContrast.setHighContrast(true, null)).toBe(true);
    expect(highContrast.setHighContrast(false, null)).toBe(false);
    const store = fakeStorage();
    store.setItem = () => {
      throw new Error("denied");
    };
    expect(highContrast.setHighContrast(true, store)).toBe(true);
    expect(highContrast.setHighContrast(false, store)).toBe(false);
  });
});

describe("首次访问跟随系统偏好：无已存偏好时才跟随", () => {
  it("空存储 + 系统偏好命中 → 开；未命中 → 关", async () => {
    const { highContrast } = await loadModules();
    expect(highContrast.loadHighContrast(fakeStorage(), true)).toBe(true);
    expect(highContrast.loadHighContrast(fakeStorage(), false)).toBe(false);
  });

  it("已存偏好在先：存 false 时系统命中也不开，存 true 时系统撤回也不关", async () => {
    const { highContrast } = await loadModules();
    const key = highContrast.HIGH_CONTRAST_STORAGE_KEY as string;
    expect(highContrast.loadHighContrast(fakeStorage({ [key]: "false" }), true)).toBe(false);
    expect(highContrast.loadHighContrast(fakeStorage({ [key]: JSON.stringify({ on: true }) }), false)).toBe(true);
  });

  it("防御分支：只有手动标记、没有记录时按关计，不跟随系统偏好", async () => {
    const { highContrast } = await loadModules();
    const manual = highContrast.HIGH_CONTRAST_MANUAL_STORAGE_KEY as string;
    expect(highContrast.loadHighContrast(fakeStorage({ [manual]: "true" }), true)).toBe(false);
  });
});

/** 最小 HTMLElement 替身：applyHighContrast 只用 set/removeAttribute */
function fakeRoot() {
  const attrs = new Map<string, string>();
  return {
    attrs,
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
    getAttribute: (k: string) => attrs.get(k) ?? null,
  };
}

describe("applyHighContrast：只动 data-high-contrast，不管持久化", () => {
  it("开启挂属性，关闭摘属性", async () => {
    const { highContrast } = await loadModules();
    const root = fakeRoot();
    highContrast.applyHighContrast(true, root as unknown as HTMLElement);
    expect(root.getAttribute("data-high-contrast")).toBe("on");
    highContrast.applyHighContrast(false, root as unknown as HTMLElement);
    expect(root.getAttribute("data-high-contrast")).toBeNull();
  });

  it("不碰长辈模式与主题属性", async () => {
    const { highContrast } = await loadModules();
    const root = fakeRoot();
    root.setAttribute("data-elder-mode", "on");
    root.setAttribute("data-theme", "dark");
    highContrast.applyHighContrast(true, root as unknown as HTMLElement);
    highContrast.applyHighContrast(false, root as unknown as HTMLElement);
    expect(root.getAttribute("data-elder-mode")).toBe("on");
    expect(root.getAttribute("data-theme")).toBe("dark");
  });

  it("root 为 null 时不抛错、不做任何事", async () => {
    const { highContrast } = await loadModules();
    expect(() => highContrast.applyHighContrast(true, null)).not.toThrow();
    expect(() => highContrast.applyHighContrast(false, null)).not.toThrow();
  });
});

describe("事件 payload：setHighContrast 发 navhub:high-contrast-changed", () => {
  it("开/关各发一次，detail 都是 { on: 开关值 }", async () => {
    const { highContrast } = await loadModules();
    const g = globalThis as Record<string, unknown>;
    const prevWindow = g.window;
    const prevCustomEvent = g.CustomEvent;
    const seen: Array<{ type: string; detail: unknown }> = [];
    g.CustomEvent = class {
      type: string;
      detail: unknown;
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    };
    g.window = {
      dispatchEvent: (e: { type: string; detail: unknown }) => {
        seen.push({ type: e.type, detail: e.detail });
        return true;
      },
    };
    try {
      const store = fakeStorage();
      highContrast.setHighContrast(true, store);
      highContrast.setHighContrast(false, store);
    } finally {
      if (prevWindow === undefined) delete g.window;
      else g.window = prevWindow;
      if (prevCustomEvent === undefined) delete g.CustomEvent;
      else g.CustomEvent = prevCustomEvent;
    }
    expect(seen).toEqual([
      { type: "navhub:high-contrast-changed", detail: { on: true } },
      { type: "navhub:high-contrast-changed", detail: { on: false } },
    ]);
    expect(highContrast.HIGH_CONTRAST_CHANGED_EVENT).toBe("navhub:high-contrast-changed");
  });
});

/** 在 node:vm 里跑水合前内联脚本：沙箱只给 localStorage/document/window，不碰真实 DOM。
 * opts.manual：手动标记键的值（null = 无标记）；opts.systemMore：matchMedia('(prefers-contrast: more)') 是否命中；
 * opts.storageKey / opts.manualKey：按 key 分流 getItem（不传时沿用旧行为：所有 key 都返回 raw）。 */
function execPrepaint(
  raw: string | null,
  opts: { manual?: string | null; systemMore?: boolean; storageKey?: string; manualKey?: string } = {},
) {
  const root = fakeRoot();
  const sandbox = {
    localStorage: {
      getItem: (k: string) => {
        if (opts.storageKey && k === opts.storageKey) return raw;
        if (opts.manualKey && k === opts.manualKey) return opts.manual ?? null;
        return raw;
      },
    },
    window: { matchMedia: (_q: string) => ({ matches: opts.systemMore === true }) },
    document: { documentElement: root },
  };
  return { root, sandbox };
}

describe("HIGH_CONTRAST_PREPAINT_SCRIPT：真跑一遍水合前脚本（node:vm 沙箱）", () => {
  it("新版记录 {on:true} 落 data-high-contrast=on", async () => {
    const { highContrast } = await loadModules();
    const { root, sandbox } = execPrepaint(JSON.stringify({ on: true }));
    runInNewContext(highContrast.HIGH_CONTRAST_PREPAINT_SCRIPT as string, sandbox);
    expect(root.getAttribute("data-high-contrast")).toBe("on");
  });

  it("旧版裸布尔 'true' 也落属性（与旧版 set 写出的值兼容）", async () => {
    const { highContrast } = await loadModules();
    const { root, sandbox } = execPrepaint("true");
    runInNewContext(highContrast.HIGH_CONTRAST_PREPAINT_SCRIPT as string, sandbox);
    expect(root.getAttribute("data-high-contrast")).toBe("on");
  });

  it("on=false / 'false' / 无记录 / 坏 JSON：什么都不落，也不抛错", async () => {
    const { highContrast } = await loadModules();
    for (const raw of [JSON.stringify({ on: false }), "false", null, "{oops"]) {
      const { root, sandbox } = execPrepaint(raw);
      expect(() => runInNewContext(highContrast.HIGH_CONTRAST_PREPAINT_SCRIPT as string, sandbox)).not.toThrow();
      expect(root.getAttribute("data-high-contrast")).toBeNull();
    }
  });

  it("无已存值 + 系统偏好 more + 无手动标记：首访自动开启，开关状态与页面一致", async () => {
    const { highContrast } = await loadModules();
    const { root, sandbox } = execPrepaint(null, {
      systemMore: true,
      storageKey: highContrast.HIGH_CONTRAST_STORAGE_KEY as string,
      manualKey: highContrast.HIGH_CONTRAST_MANUAL_STORAGE_KEY as string,
    });
    runInNewContext(highContrast.HIGH_CONTRAST_PREPAINT_SCRIPT as string, sandbox);
    expect(root.getAttribute("data-high-contrast")).toBe("on");
  });

  it("无已存值 + 系统偏好 no-preference：不开启", async () => {
    const { highContrast } = await loadModules();
    const { root, sandbox } = execPrepaint(null, {
      systemMore: false,
      storageKey: highContrast.HIGH_CONTRAST_STORAGE_KEY as string,
      manualKey: highContrast.HIGH_CONTRAST_MANUAL_STORAGE_KEY as string,
    });
    runInNewContext(highContrast.HIGH_CONTRAST_PREPAINT_SCRIPT as string, sandbox);
    expect(root.getAttribute("data-high-contrast")).toBeNull();
  });

  it("无已存值 + 系统偏好 more + 有手动标记（防御分支）：手动值优先，不跟随系统", async () => {
    const { highContrast } = await loadModules();
    const { root, sandbox } = execPrepaint(null, {
      manual: "true",
      systemMore: true,
      storageKey: highContrast.HIGH_CONTRAST_STORAGE_KEY as string,
      manualKey: highContrast.HIGH_CONTRAST_MANUAL_STORAGE_KEY as string,
    });
    runInNewContext(highContrast.HIGH_CONTRAST_PREPAINT_SCRIPT as string, sandbox);
    expect(root.getAttribute("data-high-contrast")).toBeNull();
  });

  it("已存 {on:false} + 系统偏好 more：已存值在先，不跟随系统", async () => {
    const { highContrast } = await loadModules();
    const { root, sandbox } = execPrepaint(JSON.stringify({ on: false }), {
      systemMore: true,
      storageKey: highContrast.HIGH_CONTRAST_STORAGE_KEY as string,
      manualKey: highContrast.HIGH_CONTRAST_MANUAL_STORAGE_KEY as string,
    });
    runInNewContext(highContrast.HIGH_CONTRAST_PREPAINT_SCRIPT as string, sandbox);
    expect(root.getAttribute("data-high-contrast")).toBeNull();
  });

  it("脚本只含编译期常量：出现存储键与属性名，不含 fetch / eval / 外部输入", async () => {
    const { highContrast } = await loadModules();
    const script = highContrast.HIGH_CONTRAST_PREPAINT_SCRIPT as string;
    expect(script).toContain(highContrast.HIGH_CONTRAST_STORAGE_KEY as string);
    expect(script).toContain("data-high-contrast");
    expect(script).not.toContain("fetch(");
    expect(script).not.toContain("eval(");
    expect(script).not.toContain("localStorage.setItem");
  });
});

describe("HIGH_CONTRAST_LABEL 与事件名：开关文案与监听常量一致", () => {
  it("开关文案：开/关/提示齐全，提示说明系统偏好跟随与手动优先", async () => {
    const { highContrast } = await loadModules();
    expect(highContrast.HIGH_CONTRAST_LABEL.on).toBe("高对比已开启");
    expect(highContrast.HIGH_CONTRAST_LABEL.off).toBe("高对比");
    expect(highContrast.HIGH_CONTRAST_LABEL.hint).toContain("提高对比度");
    expect(highContrast.HIGH_CONTRAST_LABEL.hint).toContain("手动切换后以你的选择为准");
  });

  it("事件名常量与外观弹窗里写的监听字面量是同一个串", async () => {
    const { highContrast } = await loadModules();
    expect(highContrast.HIGH_CONTRAST_CHANGED_EVENT).toBe("navhub:high-contrast-changed");
    const dialog = readFileSync(
      join(ROOT, "src/components/home-windows/appearance-guide-dialog.tsx"),
      "utf8",
    );
    expect(dialog).toContain("window.addEventListener('navhub:high-contrast-changed'");
    expect(dialog).toContain("window.removeEventListener('navhub:high-contrast-changed'");
  });
});

describe("高对比开关接线（源码守卫：组件需 DOM，无法挂载，W3 补）", () => {
  const toggle = readFileSync(join(ROOT, "src/components/high-contrast-toggle.tsx"), "utf8");

  it("挂载读 localStorage、点按取反并写回、状态驱动 aria-pressed 与文案", () => {
    expect(toggle).toContain("setOn(loadHighContrast(window.localStorage))");
    expect(toggle).toContain("setOn(setHighContrast(!on, window.localStorage))");
    expect(toggle).toContain("onClick={toggle}");
    expect(toggle).toContain("aria-pressed={on}");
    expect(toggle).toContain("aria-label={");
    expect(toggle).toContain("HIGH_CONTRAST_LABEL.on");
    expect(toggle).toContain("HIGH_CONTRAST_LABEL.off");
  });

  it("title 逐字用任务书约定：开启「高对比已开启」，关闭「高对比：加深文字与边框，关闭后恢复」", () => {
    expect(toggle).toContain("HIGH_CONTRAST_LABEL.on");
    expect(toggle).toContain("'高对比：加深文字与边框，关闭后恢复'");
    // 关闭态不用 LABEL.off 与 LABEL.hint 拼接：W2 的 hint 是弹窗长版，
    // 与任务书短串不一致（见组件头注释）；W6 e2e 按任务书逐字断言。
    expect(toggle).not.toContain("`${HIGH_CONTRAST_LABEL.off}：${HIGH_CONTRAST_LABEL.hint}`");
  });

  it("事件驱动同步：别的入口切了开关，本开关靠监听即时跟上", () => {
    expect(toggle).toContain("window.addEventListener('navhub:high-contrast-changed'");
    expect(toggle).toContain("window.removeEventListener('navhub:high-contrast-changed'");
    expect(toggle).toContain("detail?.on");
  });

  it("开启态样式对标 elder-mode-toggle：bg-primary/10 text-primary，ghost 按钮 h-11 w-11", () => {
    expect(toggle).toContain("bg-primary/10 text-primary");
    expect(toggle).toContain('variant="ghost"');
    expect(toggle).toContain('size="icon"');
    // 44px 触控目标：ghost 按钮 h-11 w-11，与字号/长辈开关同档
    expect(toggle).toContain("h-11 w-11");
  });

  it("图标用 lucide Contrast，不用文字或占位图", () => {
    expect(toggle).toContain("import { Contrast } from 'lucide-react'");
    expect(toggle).toContain('<Contrast className="h-4 w-4" />');
  });

  it("forced-colors 禁用态：监听 change、不只首帧判断，禁用并注明系统已接管", () => {
    expect(toggle).toContain("window.matchMedia('(forced-colors: active)')");
    expect(toggle).toContain("mq.addEventListener('change', update)");
    expect(toggle).toContain("mq.removeEventListener('change', update)");
    expect(toggle).toContain("disabled={systemForced}");
    expect(toggle).toContain("系统已开启高对比");
  });
});

describe("工具栏挂载（源码守卫）：2026-11-24 外观与阅读聚合浮层收口（全尺寸一键可达，零宽度溢出）", () => {
  const toolbar = readFileSync(join(ROOT, "src/components/navigation-toolbar.tsx"), "utf8");
  const popover = readFileSync(join(ROOT, "src/components/appearance-quick-popover.tsx"), "utf8");

  it("工具栏挂载 AppearanceQuickPopover，浮层内按顺序集成字号 / 高对比 / 深浅主题", () => {
    expect(toolbar).toContain("import { AppearanceQuickPopover } from '@/components/appearance-quick-popover'");
    expect(toolbar).toContain("<AppearanceQuickPopover");
    expect(popover).toContain("import { HighContrastToggle } from '@/components/high-contrast-toggle'");
    expect(popover).toContain("<HighContrastToggle />");
    const fontSizeAt = popover.indexOf("<FontSizeToggle />");
    const contrastAt = popover.indexOf("<HighContrastToggle />");
    const modeAt = popover.indexOf("<ModeToggle />");
    expect(fontSizeAt).toBeGreaterThan(-1);
    expect(contrastAt).toBeGreaterThan(fontSizeAt);
    expect(modeAt).toBeGreaterThan(contrastAt);
  });

  it("高对比与深浅主题在外观聚合浮层内全尺寸直出（不隐藏）", () => {
    expect(popover).toContain("高对比度");
    expect(popover).toContain("深色 / 浅色");
    expect(popover).toContain('aria-label="打开外观与阅读设置"');
  });

  it("移动端探索菜单仍保留 <sm 可见的「切换深色 / 浅色」条目，setTheme 三元式与 ModeToggle 一致", () => {
    expect(toolbar).toContain("import { useTheme } from 'next-themes'");
    expect(toolbar).toContain("const { resolvedTheme, setTheme } = useTheme()");
    expect(toolbar).toContain("setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')");
    expect(toolbar).toContain("切换深色 / 浅色");
    expect(toolbar).toContain("Sun,");
    expect(toolbar).toContain("Moon,");
    expect(toolbar).toContain("resolvedTheme === 'dark' ? (");
    const themeAt = toolbar.indexOf("切换深色 / 浅色</span>");
    const selectAt = toolbar.indexOf("多选模式 (M)</span>");
    expect(themeAt).toBeGreaterThan(selectAt);
    const itemStart = toolbar.lastIndexOf("<DropdownMenuItem", themeAt);
    const itemChunk = toolbar.slice(itemStart, themeAt + 200);
    expect(itemChunk).toContain("sm:hidden");
  });

  it("360/390 宽度账：融合后移动端固定 7 钮 320px ≤ 336px，不留过期文字", () => {
    expect(toolbar).not.toContain("需协调方裁决");
    // M-02（2026-11-25）：顶栏加第 7 个 44px 热榜按钮，宽度账由
    // 6×44 + 5×2 = 274px 更新为 7×44 + 6×2 = 320px，仍 ≤ 336px 预算，CDP 390 零溢出。
    expect(toolbar).toContain("7×44 + 6×2 = 320px ≤ 336px");
  });
});
