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
    expect(src).toContain("items.push({ id: `plugin-${p.id}`, kind: 'plugin' })");
    expect(src).toContain("items.push({ id: `site-${h.siteId}`, kind: 'site' })");
    expect(src).toContain("id={`navhub-search-opt-${navIndexById.get('site-' + site.id) ?? -1}`}");
  });

  it("高亮项会滚进可视区（长列表里不会选中屏幕外的结果）", () => {
    expect(src).toContain("scrollIntoView({ block: 'nearest' })");
  });
});
