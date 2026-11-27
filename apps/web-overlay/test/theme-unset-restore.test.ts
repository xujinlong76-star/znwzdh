/**
 * 设置页「主题偏好」选回「未设置」必须回到跟随全站默认（M-04）。
 *
 * 根因：选「未设置」只把账号级 themePreference 置 null；next-themes 早把
 * 旧值（dark/light）写进了本机 `theme` 键，之后每次加载都以它为准，
 * ThemeProvider 的 defaultTheme 再也生效不了——页面永远停在旧主题。
 *
 * 本测试锁三件事：
 *   1. 选回未设置时先 setTheme(全站默认)让当前会话立即回到默认，
 *      再删 `theme` 键，使下次加载时 next-themes 直接用 defaultTheme；
 *   2. 只在「有值 → 未设置」的跃迁时复位：偏好一直是 null（从未设过）
 *      时不碰本机主题，工具栏的手动切换必须在不相关的设置改动后继续保留；
 *   3. 根布局把服务端算好的全站默认（resolveDefaultTheme）传给同步组件，
 *      不在客户端凭空编一个默认值。
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

describe("M-04 选回「未设置」回到跟随全站默认", () => {
  it("未设置跃迁时先 setTheme(全站默认)再删 theme 键", () => {
    const sync = read("src/components/user-center/user-prefs-sync.tsx");
    expect(sync).toContain("setTheme(defaultTheme)");
    expect(sync).toContain("removeItem('theme')");
    // 顺序不能反：setTheme 是同步写键（next-themes 0.2.1 的 setTheme 内
    // 直接 localStorage.setItem），后删键才删得干净；先删后设会把键写回来。
    expect(sync.indexOf("setTheme(defaultTheme)")).toBeLessThan(sync.indexOf("removeItem('theme')"));
  });

  it("只在有值→未设置的跃迁时复位，不碰一直未设置的本机手动切换", () => {
    const sync = read("src/components/user-center/user-prefs-sync.tsx");
    // 上一次见过的偏好必须被记下来做跃迁判断，否则每次设置改动都会把
    // 工具栏手动切的主题压回默认。
    expect(sync).toContain("prevPreferenceRef");
    expect(sync).toContain("themePreference");
    expect(sync).toContain("M-04");
  });

  it("U-456：挂载时用本机偏好预填 prev，跨会话的 dark→未设置跃迁也能复位", () => {
    const sync = read("src/components/user-center/user-prefs-sync.tsx");
    // 不预填时 reload 后的新会话里 prev 是 undefined，dark→未设置的第一跳
    // 事件看不到跃迁，复位不触发（key 仍 dark、页面仍 dark）。预填必须在
    // effect 里、且只读本机偏好（不复位）：偏好为 null 时预填值是 null，
    // 工具栏手动切换仍不受影响。
    expect(sync).toContain("prevPreferenceRef.current = readLocalUserSettings().themePreference");
    expect(sync).toContain("U-456");
  });

  it("根布局把服务端算好的全站默认传给同步组件", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toContain("resolveDefaultTheme(settings)");
    expect(layout).toContain("<UserPrefsSync defaultTheme={resolveDefaultTheme(settings)} />");
    const sync = read("src/components/user-center/user-prefs-sync.tsx");
    expect(sync).toContain("defaultTheme");
  });
});
