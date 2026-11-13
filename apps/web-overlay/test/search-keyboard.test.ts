/**
 * 搜索面板键盘可达性守卫。
 *
 * 真实缺陷（改动前）：输入框在 `<Command>` 之外，而 cmdk 的方向键监听挂在
 * Command 根节点上，键盘事件从输入框冒泡不过去。结果是「能打字、不能选」：
 * ↑↓ 无反应、Enter 不打开、Tab 只会跳到每行右侧的收藏星标——键盘用户
 * 在首页/榜单/标签页都打不开任何搜索结果。
 *
 * 这里锁住三件事，任何一项被删掉都会让键盘导航重新失效：
 *   1. 输入框声明 aria-activedescendant（读屏能知道当前高亮项）；
 *   2. 输入框绑定了 onKeyDown（方向键/Enter 有处理入口）；
 *   3. 结果项带稳定 id，处理函数能按索引找到并触发点击。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(hit, "utf8");
}

describe("搜索面板键盘导航", () => {
  const src = overlaySource("src/components/search-palette.tsx");

  it("输入框绑定键盘处理并声明 active descendant", () => {
    expect(src).toContain("onKeyDown={onSearchKeyDown}");
    expect(src).toContain("aria-activedescendant");
    expect(src).toContain("navhub-search-opt-");
  });

  it("方向键、Enter、Escape 都有处理分支", () => {
    expect(src).toContain("e.key === 'ArrowDown'");
    expect(src).toContain("e.key === 'ArrowUp'");
    expect(src).toContain("e.key === 'Enter'");
    expect(src).toContain("e.key === 'Escape'");
  });

  it("导航列表与 DOM 顺序一致：插件在前、站点命中在后", () => {
    // P1 #8：导航列表的组装从组件移进了 lib/palette-actions.ts 的
    // buildPaletteNavItems，组件只负责传各组 id；顺序的唯一来源在那里。
    const actions = overlaySource("src/lib/palette-actions.ts");
    const fn = actions.slice(actions.indexOf("export function buildPaletteNavItems"));
    const kinds = ["suggestion", "diy", "favorite", "action", "tool", "plugin", "site"] as const;
    const positions = kinds.map((kind) => fn.indexOf(`entries.push({ id, kind: '${kind}' })`));
    positions.forEach((pos, i) => expect(pos, `buildPaletteNavItems 缺少 ${kinds[i]} 组`).toBeGreaterThan(-1));
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i - 1], `${kinds[i - 1]} 必须排在 ${kinds[i]} 之前`).toBeLessThan(positions[i]);
    }
    // 组件真的用它组装导航列表：插件 id 与站点 id 都从这里传进去
    expect(src).toContain("return buildPaletteNavItems({");
    expect(src).toContain("pluginIds: pluginItems.map((p) => `plugin-${p.id}`)");
    expect(src).toContain("siteIds: hits.filter((h) => h.site).map((h) => `site-${h.siteId}`)");
    // DOM 侧仍按导航索引渲染：站点行 id 与 navIndexById 对齐
    expect(src).toContain("id={`navhub-search-opt-${navIndexById.get('site-' + site.id) ?? -1}`}");
  });

  it("高亮项会滚进可视区（长列表里不会选中屏幕外的结果）", () => {
    expect(src).toContain("scrollIntoView({ block: 'nearest' })");
  });
});
