/**
 * 设置页主题选择器守卫（DEV_BACKLOG B12 第一刀）：
 *
 * 种子主题早已能经「市场安装→本机激活」链用上，但普通用户日常入口只有
 * /marketplace/installed 管家页，设置页（用户找偏好的第一直觉位置）没有
 * 主题选择器——等于白做一半。本测试守住设置页里的 ThemeField：
 *   1. 系统默认在首位 + 已安装主题逐个可选，一点即换；
 *   2. 切换与管家页共用 lib/plugins/theme-runtime 的同一套函数，不另立真相；
 *   3. 没装主题时给去市场主题分类的直达链接，不谎称已装；
 *   4. 拉取失败时明说取不到并给重试，不按空态处理；
 *   5. 只存本机（与主题运行时同一份 localStorage），匿名可用。
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

describe("B12 设置页主题选择器", () => {
  it("设置面板里有带标签的「主题外观」字段", () => {
    const panel = read("src/components/user-center/settings-panel.tsx");
    expect(panel).toContain("ThemeField");
    expect(panel).toContain("主题外观");
    expect(panel).toContain("idPrefix}-theme");
  });

  it("系统默认在首位，已安装主题逐个可选", () => {
    const panel = read("src/components/user-center/settings-panel.tsx");
    expect(panel).toContain('<option value="">系统默认</option>');
    expect(panel).toContain("item.kind === 'theme'");
    expect(panel).toContain("themes.map((theme) =>");
  });

  it("切换共用主题运行时，不另立真相", () => {
    const panel = read("src/components/user-center/settings-panel.tsx");
    expect(panel).toContain("from '@/lib/plugins/theme-runtime'");
    expect(panel).toContain("getActiveTheme");
    expect(panel).toContain("setActiveTheme");
    expect(panel).toContain("resetTheme");
    expect(panel).toContain("fetchPluginDetail");
    expect(panel).toContain("fetchInstalledPlugins");
    expect(panel).toContain("navhub_theme_changed");
    // 激活前先取清单 payload（tokens/accent），不凭空编配色
    expect(panel).toContain("detail?.plugin?.manifest?.payload");
    expect(panel).toContain("payload.tokens");
  });

  it("没装主题时给市场主题分类直达链接，不谎称已装", () => {
    const panel = read("src/components/user-center/settings-panel.tsx");
    expect(panel).toContain('href="/marketplace?kind=theme"');
    expect(panel).toContain("还没安装主题");
    expect(panel).toContain("去插件市场看看主题");
  });

  it("拉取失败明说取不到并给重试，不按空态处理", () => {
    const panel = read("src/components/user-center/settings-panel.tsx");
    expect(panel).toContain("主题列表暂时取不到");
    expect(panel).toContain("重新加载主题列表");
    expect(panel).toContain("loadFailed");
  });

  it("只存本机：文案不承诺同步，设置页描述提到主题外观", () => {
    const panel = read("src/components/user-center/settings-panel.tsx");
    expect(panel).toContain("只存这台设备");
    expect(panel).not.toContain("同步到云端");
    const view = read("src/components/user-center/me-settings-view.tsx");
    expect(view).toContain("主题外观");
    const page = read("src/app/me/settings/page.tsx");
    expect(page).toContain("主题外观");
  });

  it("主题运行时导出口径不变：同一份本机存储键", async () => {
    const runtime = await import(pathToFileURL(join(ROOT, "src/lib/plugins/theme-runtime.ts")).href);
    expect(runtime.THEME_STORAGE_KEY).toBe("navhub_active_theme_v1");
    expect(typeof runtime.getActiveTheme).toBe("function");
    expect(typeof runtime.setActiveTheme).toBe("function");
    expect(typeof runtime.resetTheme).toBe("function");
    expect(typeof runtime.initThemeRuntime).toBe("function");
  });
});
