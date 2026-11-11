/**
 * 插件主题与深色模式冲突守卫（DEV_BACKLOG B12 后半句）：
 *
 * 种子主题只有一套浅色 tokens（manifest 无深色字段），内联注入的浅色变量会
 * 压过 `.dark` 样式变量，造成「半深半浅」。产品决策：插件主题只在浅色模式
 * 下生效——深色下暂停 tokens（`.dark` 接管），切回浅色自动恢复。
 * 本测试守住运行时与三处 UI 的诚实口径：
 *   1. applyThemeTokens 在深色模式下不注入 tokens（守卫只此一处）；
 *   2. 首屏水合启动 <html> class 观察者，深浅翻转自动暂停/恢复并通知 UI；
 *   3. 暂停只清 tokens 内联变量，不碰 data-accent（与 DIY 共用的强调色 hue）；
 *   4. isThemeSuspended 派生口径：有主题/试用且深色；
 *   5. 设置页、管家页、试用飘带如实显示暂停，不谎称生效。
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
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** 取 source 中从 marker 起的第一个完整花括号块（含嵌套），避免切到内层右括号 */
function braceBlock(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`未找到标记：${marker}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`花括号未闭合：${marker}`);
}

describe("B12 后半句：插件主题与深色模式冲突", () => {
  it("applyThemeTokens 在深色模式下不注入 tokens（守卫只此一处）", () => {
    const runtime = read("src/lib/plugins/theme-runtime.ts");
    expect(runtime).toContain("export function isDarkMode()");
    expect(runtime).toContain("classList.contains('dark')");
    expect(runtime).toContain("if (!isDarkMode() && tokens && typeof tokens === 'object')");
  });

  it("首屏水合启动 <html> class 观察者，深浅翻转自动暂停/恢复", () => {
    const runtime = read("src/lib/plugins/theme-runtime.ts");
    expect(runtime).toContain("startModeObserver()");
    expect(runtime).toContain("new MutationObserver");
    expect(runtime).toContain("attributeFilter: ['class']");
    expect(runtime).toContain("mutation.attributeName === 'class'");
    expect(runtime).toContain("function syncThemeWithMode()");
    // 深色暂停、浅色恢复，且恢复时试用优先于已存主题
    expect(runtime).toContain("suspendThemeTokens()");
    expect(runtime).toContain("applyThemeTokens(activeTryout.tokens, activeTryout.accent)");
    expect(runtime).toContain("applyThemeTokens(active.tokens, active.accent)");
    // 翻转后通知监听者刷新文案
    expect(runtime).toContain("new CustomEvent('navhub_theme_changed'");
  });

  it("暂停只清 tokens 内联变量，不碰 data-accent", () => {
    const runtime = read("src/lib/plugins/theme-runtime.ts");
    // 用括号匹配取整段函数体：此前按第一个右括号切，会停在 for 循环的右括号、
    // 漏掉函数后半段；若有人在循环后加 removeAttribute，旧切法查不出来
    const suspendBody = braceBlock(runtime, "export function suspendThemeTokens()");
    expect(suspendBody).toContain("removeProperty(varName)");
    expect(suspendBody).not.toContain("removeAttribute");
    expect(suspendBody).not.toContain("data-accent");
  });

  it("isThemeSuspended 派生口径：有主题/试用且深色", () => {
    const runtime = read("src/lib/plugins/theme-runtime.ts");
    expect(runtime).toContain("export function isThemeSuspended()");
    expect(runtime).toContain("if (!isDarkMode()) return false");
    expect(runtime).toContain("getActiveTheme() !== null || activeTryout !== null");
  });

  it("setActiveTheme 深色下只保存不注入（走同一守卫，不另立分支）", () => {
    const runtime = read("src/lib/plugins/theme-runtime.ts");
    expect(runtime).toContain("export function setActiveTheme(");
    // setActiveTheme 体内仍调 applyThemeTokens，守卫在该函数内，不在外层重复判断
    const setBody = braceBlock(runtime, "export function setActiveTheme(");
    expect(setBody).toContain("applyThemeTokens(config.tokens, config.accent)");
    expect(setBody).not.toContain("isDarkMode()");
  });

  it("设置页主题字段读暂停态并明说，不谎称正在使用", () => {
    const panel = read("src/components/user-center/settings-panel.tsx");
    expect(panel).toContain("isThemeSuspended");
    expect(panel).toContain("themeSuspended");
    expect(panel).toContain("深色模式下暂停，回到浅色自动恢复");
    // 暂停文案只在「有主题且暂停」时出现
    expect(panel).toContain("activeTheme && themeSuspended");
  });

  it("管家页「生效中」徽标在暂停时改成暂停徽标，激活成功文案分深浅", () => {
    const page = read("src/app/marketplace/installed/page.tsx");
    expect(page).toContain("isThemeSuspended");
    expect(page).toContain("深色模式已暂停");
    expect(page).toContain("isActive && !themeSuspended");
    expect(page).toContain("isActive && themeSuspended");
    expect(page).toContain("已保存主题");
    expect(page).toContain("深色模式下暂停，回到浅色自动恢复");
  });

  it("试用飘带在深色下明说试用暂停", () => {
    const ribbon = read("src/components/plugins/theme-tryout-ribbon.tsx");
    expect(ribbon).toContain("isThemeSuspended");
    expect(ribbon).toContain("深色模式下试用暂停，回到浅色可见效果");
    // 深浅翻转要能刷新飘带：监听主题变更事件
    expect(ribbon).toContain("navhub_theme_changed");
  });

  it("显式激活压过试用：setActiveTheme 清掉残留试用，不让它在回浅色时盖回来", () => {
    const runtime = read("src/lib/plugins/theme-runtime.ts");
    const setBody = braceBlock(runtime, "export function setActiveTheme(");
    expect(setBody).toContain("activeTryout = null");
    expect(setBody).toContain("navhub_theme_tryout_changed");
  });

  it("无 accent 的新主题/试用不残留上一个主题的强调色", () => {
    const runtime = read("src/lib/plugins/theme-runtime.ts");
    const setBody = braceBlock(runtime, "export function setActiveTheme(");
    expect(setBody).toContain("if (!config.accent)");
    expect(setBody).toContain("removeAttribute('data-accent')");
    const tryoutBody = braceBlock(runtime, "export function startThemeTryout(");
    expect(tryoutBody).toContain("if (!config.accent)");
    expect(tryoutBody).toContain("removeAttribute('data-accent')");
  });

  it("试用开始也通知主题监听者（深色下无存量主题时暂停态由此翻转）", () => {
    const runtime = read("src/lib/plugins/theme-runtime.ts");
    const tryoutBody = braceBlock(runtime, "export function startThemeTryout(");
    expect(tryoutBody).toContain("new CustomEvent('navhub_theme_changed'");
  });

  it("深浅翻转只在 dark 值变化时跑：无关 class 变动不重复应用、不重复派发", () => {
    const runtime = read("src/lib/plugins/theme-runtime.ts");
    expect(runtime).toContain("lastModeDark");
    expect(runtime).toContain("if (lastModeDark !== null && lastModeDark === dark) return");
  });

  it("试用飘带：深色下提交只说保存、不谎称已应用；徽标切换，暂停提示移动端也可见", () => {
    const ribbon = read("src/components/plugins/theme-tryout-ribbon.tsx");
    expect(ribbon).toContain("已保存主题");
    expect(ribbon).toContain("深色模式下暂停，回到浅色自动恢复");
    expect(ribbon).toContain("已正式保存并应用主题");
    expect(ribbon).toContain("suspended ? '深色模式已暂停' : '免安装试用中'");
    // 暂停提示在移动端也不能藏起来：只有非暂停态的说明才 hidden sm:block
    expect(ribbon).toContain("suspended ? '' : 'hidden sm:block'");
  });

  it("详情页试用入口：深色下开始试用明说暂停，按钮文案同步改成试用已暂停", () => {
    const view = read("src/app/marketplace/[slug]/plugin-detail-view.tsx");
    expect(view).toContain("isThemeSuspended");
    expect(view).toContain("已开始试用");
    expect(view).toContain("深色模式下暂停，回到浅色可见效果");
    expect(view).toContain("试用已暂停 (点击退出)");
  });

  it("挂件不改：仍只跟 html.dark，与页面模式同源", () => {
    const widget = read("public/xiaomaomao/xiaomaomao.js");
    expect(widget).toContain("document.documentElement.classList.contains('dark')");
    expect(widget).not.toContain("navhub_active_theme_v1");
    expect(widget).not.toContain("isThemeSuspended");
  });
});
