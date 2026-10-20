/**
 * 「固定到工作台」这条自动写入路径，不许把**读不出来的**收藏当成**空收藏**覆盖掉。
 *
 * 真实缺陷（`lib/modular/workbench-bridge.ts`）：
 *
 *     let favoritesList = []
 *     const favRaw = localStorage.getItem('navhub.favorites.v1')
 *     if (favRaw) {
 *       try { const parsed = JSON.parse(favRaw); if (Array.isArray(parsed)) favoritesList = parsed }
 *       catch {}                        // ← 读失败 = 空列表
 *     }
 *     if (!alreadyInFav) {
 *       favoritesList.unshift(site)     // ← 于是「只有这一条」的列表被整个写回去
 *       localStorage.setItem('navhub.favorites.v1', JSON.stringify(favoritesList))
 *     }
 *
 * 后果：只要本地那条 JSON 坏了（半截写入、外部改写、旧格式），用户点一次「固定到
 * 工作台」，**整个收藏夹就被无声清空成一条**。读失败 ≠ 没有数据。
 *
 * 修法：读失败时不再写收藏，并把这件事如实回报（`addedToFavorites: false` +
 * 消息里说明「为避免覆盖已跳过收藏」）。启动坞那部分照旧生效，不因噎废食。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY } from "@/lib/modular/layout-storage";
import { WIDGET_REGISTRY } from "@/lib/modular/registry";
import { pinSiteToWorkbench } from "@/lib/modular/workbench-bridge";

const FAV_KEY = "navhub.favorites.v1";

function installStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  const fake = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
  (globalThis as any).localStorage = fake;
  (globalThis as any).window = { localStorage: fake, dispatchEvent: () => true };
  return store;
}

const SITE = { siteId: "s1", title: "示例站点", href: "https://example.com" };

describe("固定到工作台：收藏读不出来时不许覆盖", () => {
  const originalWindow = (globalThis as any).window;
  const originalStorage = (globalThis as any).localStorage;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    (globalThis as any).window = originalWindow;
    (globalThis as any).localStorage = originalStorage;
  });

  it("正常：没有既有收藏 → 写入这一条", () => {
    const store = installStorage();
    const r = pinSiteToWorkbench(SITE);
    expect(r.ok).toBe(true);
    expect(r.addedToFavorites).toBe(true);
    expect(JSON.parse(store.get(FAV_KEY)!)).toHaveLength(1);
  });

  it("正常：已有可读收藏 → 追加而不是覆盖", () => {
    const store = installStorage({
      [FAV_KEY]: JSON.stringify([{ siteId: "old", title: "旧站点", href: "https://old.example.com" }]),
    });
    const r = pinSiteToWorkbench(SITE);
    expect(r.addedToFavorites).toBe(true);
    expect(JSON.parse(store.get(FAV_KEY)!).map((x: any) => x.siteId)).toEqual(["s1", "old"]);
  });

  it("正常：已经收藏过 → 不重复添加", () => {
    const store = installStorage({ [FAV_KEY]: JSON.stringify([{ siteId: "s1", title: "示例站点", href: SITE.href }]) });
    const r = pinSiteToWorkbench(SITE);
    expect(r.addedToFavorites).toBe(false);
    expect(JSON.parse(store.get(FAV_KEY)!)).toHaveLength(1);
  });

  it("损坏的 JSON：一个字节都不动，并如实报告「没写收藏」", () => {
    const corrupt = '[{ 这不是合法的 JSON';
    const store = installStorage({ [FAV_KEY]: corrupt });
    const r = pinSiteToWorkbench(SITE);
    expect(store.get(FAV_KEY)).toBe(corrupt);
    expect(r.addedToFavorites).toBe(false);
    expect(r.ok).toBe(true);
    expect(r.message).toContain("跳过收藏");
    expect(warn).toHaveBeenCalled();
  });

  it("结构不对（不是数组）：同样不覆盖", () => {
    const weird = JSON.stringify({ items: [] });
    const store = installStorage({ [FAV_KEY]: weird });
    const r = pinSiteToWorkbench(SITE);
    expect(store.get(FAV_KEY)).toBe(weird);
    expect(r.addedToFavorites).toBe(false);
  });

  it("JSON.parse 得到 null：同样不覆盖", () => {
    const store = installStorage({ [FAV_KEY]: "null" });
    const r = pinSiteToWorkbench(SITE);
    expect(store.get(FAV_KEY)).toBe("null");
    expect(r.addedToFavorites).toBe(false);
  });

  it("自动补启动坞：尺寸与注册表默认值一致", () => {
    const store = installStorage({
      [STORAGE_KEY]: JSON.stringify({
        boards: [{ id: "b1", name: "默认", widgets: [] }],
        activeBoardId: "b1",
      }),
    });

    const r = pinSiteToWorkbench(SITE);

    expect(r.ok).toBe(true);
    const workspace = JSON.parse(store.get(STORAGE_KEY)!);
    const dock = workspace.boards[0].widgets[0];
    expect(dock).toMatchObject({ type: "favorites-dock", colSpan: 4, rowSpan: 1, config: {} });
    expect(dock.colSpan).toBe(WIDGET_REGISTRY["favorites-dock"].defaultColSpan);
    expect(dock.rowSpan).toBe(WIDGET_REGISTRY["favorites-dock"].defaultRowSpan);
  });
});
