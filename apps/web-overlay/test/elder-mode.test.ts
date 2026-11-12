/**
 * 长辈模式关闭时不丢手动改档（Item 3a）：
 *
 * 旧行为：开启时把当前字号记进 prevFontSize，关闭时无条件还原它。
 * 但长辈模式开着时，用户经字号入口（工具栏 FontSizeToggle / 设置页）
 * 手动改档只写 FONT_SIZE_STORAGE_KEY，不会更新 prevFontSize——关闭
 * 就把这次手动改档悄悄还原成开启前的旧档。
 *
 * 新口径（lib/elder-mode.ts）：关闭时看当前档——当前档不是特大字，
 * 说明开着期间被手动改过，以当前档为准；仍是特大字才还原记住的档。
 * 另守：已开着时重复开启不覆盖记住的档位（否则 prevFontSize 被写成
 * 特大字本身，之后关闭再也回不到真正的开启前档位）。
 *
 * 已知局限（已钉为当前行为，见「手动改成特大字与没改过无法区分」一例）：
 * 手动改成特大字与「没改过」无法区分，关闭时仍按没改过处理、还原开启前档。
 * 另：parseRecord 的注释称旧版布尔字符串也认，但 JSON.parse('true')
 * 不抛错、走成功分支后 parsed.on 为 undefined，实测 loadElderMode('true')
 * 返回 false——注释与行为不符，见「loadElderMode 解析」一例（钉当前行为，
 * 修注释或修实现由协调方定夺，本测试不改源码）。
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

/** 最小 Storage 替身：setElderMode 只用 getItem/setItem（其余补齐防意外调用） */
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
  const elderMode = await import(pathToFileURL(join(ROOT, "src/lib/elder-mode.ts")).href);
  const fontSize = await import(pathToFileURL(join(ROOT, "src/lib/font-size.ts")).href);
  return { elderMode, fontSize };
}

describe("长辈模式关闭不丢手动改档", () => {
  it("没改过档：关闭还原开启前的档位（旧行为不变）", async () => {
    const { elderMode, fontSize } = await loadModules();
    const key = fontSize.FONT_SIZE_STORAGE_KEY as string;
    const store = fakeStorage({ [key]: "large" });
    elderMode.setElderMode(true, store);
    expect(store.getItem(key)).toBe("xlarge");
    elderMode.setElderMode(false, store);
    expect(store.getItem(key)).toBe("large");
    expect(elderMode.loadElderMode(store)).toBe(false);
  });

  it("开着期间手动改成大字：关闭保留大字，不还原开启前的标准档", async () => {
    const { elderMode, fontSize } = await loadModules();
    const key = fontSize.FONT_SIZE_STORAGE_KEY as string;
    const store = fakeStorage({ [key]: "standard" });
    elderMode.setElderMode(true, store);
    expect(store.getItem(key)).toBe("xlarge");
    // 模拟字号入口的手动改档：只写字号存储键（与 FontSizeToggle 同款写法）
    store.setItem(key, "large");
    elderMode.setElderMode(false, store);
    expect(store.getItem(key)).toBe("large");
  });

  it("开着期间手动改成标准：关闭保留标准，不还原开启前的大字档", async () => {
    const { elderMode, fontSize } = await loadModules();
    const key = fontSize.FONT_SIZE_STORAGE_KEY as string;
    const store = fakeStorage({ [key]: "large" });
    elderMode.setElderMode(true, store);
    store.setItem(key, "standard");
    elderMode.setElderMode(false, store);
    expect(store.getItem(key)).toBe("standard");
  });

  it("关闭后记住的档位同步成保留档：再开再关不跳回更旧的档", async () => {
    const { elderMode, fontSize } = await loadModules();
    const key = fontSize.FONT_SIZE_STORAGE_KEY as string;
    const store = fakeStorage({ [key]: "standard" });
    elderMode.setElderMode(true, store);
    store.setItem(key, "large");
    elderMode.setElderMode(false, store);
    expect(store.getItem(key)).toBe("large");
    // 第二轮：开启记住 large，关闭还原 large（不是第一轮的 standard）
    elderMode.setElderMode(true, store);
    elderMode.setElderMode(false, store);
    expect(store.getItem(key)).toBe("large");
  });

  it("已开着时重复开启：不把记住的档位覆盖成特大字", async () => {
    const { elderMode, fontSize } = await loadModules();
    const key = fontSize.FONT_SIZE_STORAGE_KEY as string;
    const store = fakeStorage({ [key]: "standard" });
    elderMode.setElderMode(true, store);
    elderMode.setElderMode(true, store);
    elderMode.setElderMode(false, store);
    expect(store.getItem(key)).toBe("standard");
  });
});

/** 最小 HTMLElement 替身：applyElderMode 只用 set/removeAttribute、style、dataset */
function fakeRoot() {
  const attrs = new Map<string, string>();
  return {
    attrs,
    style: {} as Record<string, string>,
    dataset: {} as Record<string, string>,
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
    getAttribute: (k: string) => attrs.get(k) ?? null,
  };
}

/** 在 node:vm 里跑水合前内联脚本：沙箱只给 localStorage/document，不碰真实 DOM */
function execPrepaint(raw: string | null) {
  const root = fakeRoot();
  const sandbox = {
    localStorage: { getItem: (_k: string) => raw },
    document: { documentElement: root },
  };
  return { root, sandbox };
}

describe("loadElderMode 解析：坏记录不炸、缺失默认关", () => {
  it("storage 为 null / 空 / 坏 JSON 一律返回 false，不抛错", async () => {
    const { elderMode } = await loadModules();
    const key = elderMode.ELDER_MODE_STORAGE_KEY as string;
    expect(elderMode.loadElderMode(null)).toBe(false);
    expect(elderMode.loadElderMode(fakeStorage())).toBe(false);
    expect(elderMode.loadElderMode(fakeStorage({ [key]: "{oops" }))).toBe(false);
    expect(elderMode.loadElderMode(fakeStorage({ [key]: "" }))).toBe(false);
  });

  it("JSON 记录 {on:true} 读出 true，{on:false} 读出 false", async () => {
    const { elderMode } = await loadModules();
    const key = elderMode.ELDER_MODE_STORAGE_KEY as string;
    expect(elderMode.loadElderMode(fakeStorage({ [key]: JSON.stringify({ on: true }) }))).toBe(true);
    expect(
      elderMode.loadElderMode(fakeStorage({ [key]: JSON.stringify({ on: false, prevFontSize: "large" }) })),
    ).toBe(false);
  });

  it("旧版布尔字符串 'true'：JSON.parse 成功后补布尔分支，注释与行为一致", async () => {
    const { elderMode } = await loadModules();
    const key = elderMode.ELDER_MODE_STORAGE_KEY as string;
    // 之前 parseRecord 只在 catch 里认 raw==='true'，但 JSON.parse('true')
    // 成功（不进 catch），parsed.on 为 undefined，于是 on 落 false，与注释
    // 「旧版只存过布尔字符串时也认」不符。合并时已在 JSON.parse 成功后
    // 补布尔分支：布尔字符串现在按字面值认。
    expect(elderMode.loadElderMode(fakeStorage({ [key]: "true" }))).toBe(true);
    expect(elderMode.loadElderMode(fakeStorage({ [key]: "false" }))).toBe(false);
  });

  it("记录里 prevFontSize 是非法串：关闭还原时按 standard 计（parseFontSizeLevel 兜底）", async () => {
    const { elderMode, fontSize } = await loadModules();
    const key = fontSize.FONT_SIZE_STORAGE_KEY as string;
    const ekey = elderMode.ELDER_MODE_STORAGE_KEY as string;
    const store = fakeStorage({
      [ekey]: JSON.stringify({ on: true, prevFontSize: "bogus" }),
      [key]: "xlarge",
    });
    elderMode.setElderMode(false, store);
    expect(store.getItem(key)).toBe("standard");
  });
});

describe("setElderMode 返回值与降级：存储不可用也不抛错", () => {
  it("返回值就是传入的开关值；storage 为 null 时不抛错", async () => {
    const { elderMode } = await loadModules();
    expect(elderMode.setElderMode(true, null)).toBe(true);
    expect(elderMode.setElderMode(false, null)).toBe(false);
  });

  it("从未开启过就关闭：字号落 standard，记录写成 {on:false, prevFontSize:'standard'}", async () => {
    const { elderMode, fontSize } = await loadModules();
    const key = fontSize.FONT_SIZE_STORAGE_KEY as string;
    const ekey = elderMode.ELDER_MODE_STORAGE_KEY as string;
    const store = fakeStorage();
    elderMode.setElderMode(false, store);
    expect(store.getItem(key)).toBe("standard");
    expect(elderMode.loadElderMode(store)).toBe(false);
    expect(JSON.parse(store.getItem(ekey) as string)).toEqual({ on: false, prevFontSize: "standard" });
  });

  it("存储是坏 JSON：开启不抛错，写回的记录是合法 JSON 且 on 为 true", async () => {
    const { elderMode, fontSize } = await loadModules();
    const key = fontSize.FONT_SIZE_STORAGE_KEY as string;
    const ekey = elderMode.ELDER_MODE_STORAGE_KEY as string;
    const store = fakeStorage({ [ekey]: "{oops", [key]: "large" });
    expect(() => elderMode.setElderMode(true, store)).not.toThrow();
    expect(store.getItem(key)).toBe("xlarge");
    expect(JSON.parse(store.getItem(ekey) as string).on).toBe(true);
    elderMode.setElderMode(false, store);
    expect(store.getItem(key)).toBe("large");
  });

  it("setItem 全抛错（存储被禁/满了）：切换仍返回开关值、不抛错，本次会话外无持久化", async () => {
    const { elderMode } = await loadModules();
    const store = fakeStorage();
    store.setItem = () => {
      throw new Error("denied");
    };
    expect(elderMode.setElderMode(true, store)).toBe(true);
    expect(elderMode.setElderMode(false, store)).toBe(false);
  });

  it("已知局限（钉当前行为）：开着期间手动改成特大字与没改过无法区分，关闭还原开启前档", async () => {
    const { elderMode, fontSize } = await loadModules();
    const key = fontSize.FONT_SIZE_STORAGE_KEY as string;
    const store = fakeStorage({ [key]: "standard" });
    elderMode.setElderMode(true, store);
    // 手动改成 xlarge：与「没改过」写出的值一模一样，关闭无法分辨
    store.setItem(key, "xlarge");
    elderMode.setElderMode(false, store);
    expect(store.getItem(key)).toBe("standard");
  });
});

describe("applyElderMode：只动 <html> 属性与字号，不管持久化", () => {
  it("开启：挂 data-elder-mode=on，字号置 20px / xlarge", async () => {
    const { elderMode } = await loadModules();
    const root = fakeRoot();
    elderMode.applyElderMode(true, root as unknown as HTMLElement);
    expect(root.getAttribute("data-elder-mode")).toBe("on");
    expect(root.style.fontSize).toBe("20px");
    expect(root.dataset.fontSize).toBe("xlarge");
  });

  it("关闭：只摘属性，不动字号（字号还原是 setElderMode 另调 applyFontSizeLevel 的事）", async () => {
    const { elderMode } = await loadModules();
    const root = fakeRoot();
    elderMode.applyElderMode(true, root as unknown as HTMLElement);
    elderMode.applyElderMode(false, root as unknown as HTMLElement);
    expect(root.getAttribute("data-elder-mode")).toBeNull();
    expect(root.style.fontSize).toBe("20px");
    expect(root.dataset.fontSize).toBe("xlarge");
  });

  it("root 为 null 时不抛错、不做任何事", async () => {
    const { elderMode } = await loadModules();
    expect(() => elderMode.applyElderMode(true, null)).not.toThrow();
    expect(() => elderMode.applyElderMode(false, null)).not.toThrow();
  });
});

describe("ELDER_MODE_PREPAINT_SCRIPT：真跑一遍水合前脚本（node:vm 沙箱）", () => {
  it("on=true：落 20px + dataset xlarge + data-elder-mode=on", async () => {
    const { elderMode } = await loadModules();
    const { root, sandbox } = execPrepaint(JSON.stringify({ on: true }));
    runInNewContext(elderMode.ELDER_MODE_PREPAINT_SCRIPT as string, sandbox);
    expect(root.style.fontSize).toBe("20px");
    expect(root.dataset.fontSize).toBe("xlarge");
    expect(root.getAttribute("data-elder-mode")).toBe("on");
  });

  it("on=false / 无记录 / 坏 JSON：什么都不落，也不抛错", async () => {
    const { elderMode } = await loadModules();
    for (const raw of [JSON.stringify({ on: false }), null, "{oops"]) {
      const { root, sandbox } = execPrepaint(raw);
      expect(() => runInNewContext(elderMode.ELDER_MODE_PREPAINT_SCRIPT as string, sandbox)).not.toThrow();
      expect(root.style.fontSize).toBeUndefined();
      expect(root.getAttribute("data-elder-mode")).toBeNull();
    }
  });

  it("脚本只含编译期常量：出现存储键与 xlarge，不含 fetch / eval / 外部输入", async () => {
    const { elderMode } = await loadModules();
    const script = elderMode.ELDER_MODE_PREPAINT_SCRIPT as string;
    expect(script).toContain(elderMode.ELDER_MODE_STORAGE_KEY as string);
    expect(script).toContain('"xlarge"');
    expect(script).toContain("20");
    expect(script).not.toContain("fetch(");
    expect(script).not.toContain("eval(");
    expect(script).not.toContain("localStorage.setItem");
  });
});

describe("ELDER_MODE_LABEL 与事件名：开关文案与监听常量一致", () => {
  it("开关文案：开/关/提示齐全，提示含 20px 与 44px", async () => {
    const { elderMode } = await loadModules();
    expect(elderMode.ELDER_MODE_LABEL.on).toBe("长辈模式已开启");
    expect(elderMode.ELDER_MODE_LABEL.off).toBe("长辈模式");
    expect(elderMode.ELDER_MODE_LABEL.hint).toContain("20px");
    expect(elderMode.ELDER_MODE_LABEL.hint).toContain("44px");
  });

  it("提示不撒谎：不许再说「关闭后字号还原」，要说明手动改档会保留", async () => {
    const { elderMode } = await loadModules();
    expect(elderMode.ELDER_MODE_LABEL.hint).not.toContain("关闭后字号还原");
    expect(elderMode.ELDER_MODE_LABEL.hint).toContain("关闭后恢复之前的字号");
    expect(elderMode.ELDER_MODE_LABEL.hint).toContain("期间手动改过的字号会保留");
  });

  it("事件名常量与开关组件里写的监听字面量是同一个串", async () => {
    const { elderMode } = await loadModules();
    expect(elderMode.ELDER_MODE_CHANGED_EVENT).toBe("navhub:elder-mode-changed");
    const toggle = readFileSync(join(ROOT, "src/components/elder-mode-toggle.tsx"), "utf8");
    expect(toggle).toContain("window.addEventListener('navhub:elder-mode-changed'");
    expect(toggle).toContain("window.removeEventListener('navhub:elder-mode-changed'");
  });
});

describe("长辈模式开关接线（源码守卫：组件需 DOM，无法挂载，见文件头）", () => {
  it("挂载读 localStorage、点按取反并写回、状态驱动 aria-pressed 与文案", () => {
    const toggle = readFileSync(join(ROOT, "src/components/elder-mode-toggle.tsx"), "utf8");
    expect(toggle).toContain("setOn(loadElderMode(window.localStorage))");
    expect(toggle).toContain("setOn(setElderMode(!on, window.localStorage))");
    expect(toggle).toContain("onClick={toggle}");
    expect(toggle).toContain("aria-pressed={on}");
    expect(toggle).toContain("aria-label={on ? ELDER_MODE_LABEL.on : ELDER_MODE_LABEL.off}");
    expect(toggle).toContain("title={on ? ELDER_MODE_LABEL.on : `${ELDER_MODE_LABEL.off}：${ELDER_MODE_LABEL.hint}`}");
    // 跨组件同步靠事件：别的入口切了开关，本开关靠监听即时跟上
    expect(toggle).toContain("detail?.on");
  });
});
