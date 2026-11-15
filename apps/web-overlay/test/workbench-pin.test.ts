/**
 * 「固定到工作台」走收藏 store（11b，见 `lib/modular/workbench-bridge.ts`）。
 *
 * 旧实现是 bridge 直接读写 `navhub.favorites.v1`：读失败（损坏 JSON /
 * 结构不对 / `JSON.parse` 得到 null）就被当成「空收藏」，一次 pin 就把
 * 整个收藏夹无声覆盖成一条。新实现收藏写收进 `useFavorites.ts` 的模块级
 * `addFavoritesLocal`，bridge 不再读 storage 里的收藏字节：
 *
 *   - 「读不出来」的守卫现在活在模块态里：`loadLocal` 解析失败时
 *     `sharedBlocked` 非空，`persistLocalFavorites` 直接拒绝写入
 *     （一字节不动），`pinSiteToWorkbench` 返回 `{ ok: false, receipt: null }`；
 *   - 测试里的「存储损坏」因此不再用「往 localStorage 塞损坏 JSON」搭
 *     （bridge 根本不读它，搭了也测不到守卫），改用模块态 seeding：
 *     `__setSharedFavoritesForTests([], <blocked 原因>)`；
 *   - 返回形状改了：`addedToFavorites` 已删除，改为
 *     `{ ok, message, receipt: BatchPinReceipt | null }`，
 *     `BatchPinReceipt = { addedSiteIds, addedItems, createdDockWidgetId, pinnedCount }`；
 *     `pinnedCount` 是 ok 的站数（已固定过的站 ok 但不新加，与
 *     `addedSiteIds` 未必相等）；0 生效时 `receipt.addedSiteIds` 为空。
 *
 * 启动坞补位仍在 bridge 里（看板写），收藏写失败也不拦它：dock 是共享
 * 基础设施，一次 pin 创建后服务的是全部收藏，不只这次 pin 的站。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STORAGE_KEY } from "@/lib/modular/layout-storage";
import { WIDGET_REGISTRY } from "@/lib/modular/registry";
import { pinSiteToWorkbench } from "@/lib/modular/workbench-bridge";
import {
  __getSharedFavoritesForTests,
  __resetFavoritesForTests,
  __setSharedFavoritesForTests,
  type LocalFavorite,
} from "@/hooks/useFavorites";

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

function boardsWithoutDock(): string {
  return JSON.stringify({
    boards: [{ id: "b1", name: "默认", widgets: [] }],
    activeBoardId: "b1",
  });
}

function boardsWithDock(dockId = "widget-favorites-dock-old"): string {
  return JSON.stringify({
    boards: [
      {
        id: "b1",
        name: "默认",
        widgets: [{ id: dockId, type: "favorites-dock", colSpan: 4, rowSpan: 1, config: {} }],
      },
    ],
    activeBoardId: "b1",
  });
}

const SITE = { siteId: "s1", title: "示例站点", href: "https://example.com" };

function oldFav(): LocalFavorite {
  return { siteId: "old", title: "旧站点", href: "https://old.example.com", createdAt: 1000 };
}

describe("固定到工作台：收藏走 store，收据替代 addedToFavorites", () => {
  const originalWindow = (globalThis as any).window;
  const originalStorage = (globalThis as any).localStorage;

  beforeEach(() => {
    installStorage();
    __resetFavoritesForTests();
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    (globalThis as any).localStorage = originalStorage;
  });

  it("正常：没有既有收藏 → 写入这一条，收据记下新建 siteId", () => {
    const store = installStorage();
    __resetFavoritesForTests();
    const r = pinSiteToWorkbench(SITE);
    expect(r.ok).toBe(true);
    expect(r.receipt).not.toBeNull();
    expect(r.receipt!.addedSiteIds).toEqual(["s1"]);
    expect(r.receipt!.addedItems.map((i) => i.siteId)).toEqual(["s1"]);
    expect(r.receipt!.pinnedCount).toBe(1);
    expect(r.receipt!.createdDockWidgetId).toBeNull();
    expect(JSON.parse(store.get(FAV_KEY)!)).toHaveLength(1);
    expect(__getSharedFavoritesForTests().map((i) => i.siteId)).toEqual(["s1"]);
  });

  it("正常：已有可读收藏 → 整块前插而不是覆盖（批量 pin 的展示顺序与选中顺序一致）", () => {
    const store = installStorage();
    __resetFavoritesForTests();
    __setSharedFavoritesForTests([oldFav()]);
    const r = pinSiteToWorkbench(SITE);
    expect(r.ok).toBe(true);
    expect(r.receipt!.addedSiteIds).toEqual(["s1"]);
    expect(r.receipt!.pinnedCount).toBe(1);
    expect(JSON.parse(store.get(FAV_KEY)!).map((x: any) => x.siteId)).toEqual(["s1", "old"]);
  });

  it("正常：已经收藏过 → 不重复添加，pinnedCount 照计、addedSiteIds 为空", () => {
    const store = installStorage();
    __resetFavoritesForTests();
    __setSharedFavoritesForTests([{ siteId: "s1", title: "示例站点", href: SITE.href, createdAt: 1000 }]);
    const r = pinSiteToWorkbench(SITE);
    expect(r.ok).toBe(true);
    expect(r.receipt).not.toBeNull();
    expect(r.receipt!.addedSiteIds).toEqual([]);
    expect(r.receipt!.addedItems).toEqual([]);
    // ok 的站数照计：已固定过的站 ok 但不新加
    expect(r.receipt!.pinnedCount).toBe(1);
    expect(r.message).toContain("已在工作台快捷启动坞中");
    // no-op 不写盘：收藏字节一次也没动过
    expect(store.has(FAV_KEY)).toBe(false);
    expect(__getSharedFavoritesForTests()).toHaveLength(1);
  });

  it("存储损坏（模块态 blocked）：一个字节都不动，并如实报告「没写收藏」", () => {
    const corrupt = "[{ 这不是合法的 JSON";
    const store = installStorage({ [FAV_KEY]: corrupt });
    __resetFavoritesForTests();
    // 模拟 loadLocal 解析失败后的模块态：items 为空、blocked 非空。
    // bridge 不再读 storage 字节，损坏 JSON 本身已测不到守卫——守卫活在这里。
    __setSharedFavoritesForTests([], "本地收藏数据读不出来（测试模拟的损坏）");
    const r = pinSiteToWorkbench(SITE);
    expect(store.get(FAV_KEY)).toBe(corrupt);
    expect(r.ok).toBe(false);
    expect(r.receipt).toBeNull();
    expect(r.message).toContain("写不进去");
    expect(__getSharedFavoritesForTests()).toEqual([]);
  });

  it("存储损坏也不拦启动坞：收藏没写，dock 照补", () => {
    const store = installStorage({ [STORAGE_KEY]: boardsWithoutDock() });
    __resetFavoritesForTests();
    __setSharedFavoritesForTests([], "本地收藏数据读不出来（测试模拟的损坏）");
    const r = pinSiteToWorkbench(SITE);
    expect(r.ok).toBe(false);
    expect(r.receipt).toBeNull();
    const workspace = JSON.parse(store.get(STORAGE_KEY)!);
    const dock = workspace.boards[0].widgets[0];
    expect(dock).toMatchObject({ type: "favorites-dock", colSpan: 4, rowSpan: 1, config: {} });
  });

  it("自动补启动坞：尺寸与注册表默认值一致，收据记下新建的 dock id", () => {
    const store = installStorage({ [STORAGE_KEY]: boardsWithoutDock() });
    __resetFavoritesForTests();
    const r = pinSiteToWorkbench(SITE);
    expect(r.ok).toBe(true);
    expect(r.receipt!.createdDockWidgetId).not.toBeNull();
    expect(r.receipt!.createdDockWidgetId!).toMatch(/^widget-favorites-dock-/);
    const workspace = JSON.parse(store.get(STORAGE_KEY)!);
    const dock = workspace.boards[0].widgets[0];
    expect(dock).toMatchObject({ type: "favorites-dock", colSpan: 4, rowSpan: 1, config: {} });
    expect(dock.id).toBe(r.receipt!.createdDockWidgetId);
    expect(dock.colSpan).toBe(WIDGET_REGISTRY["favorites-dock"].defaultColSpan);
    expect(dock.rowSpan).toBe(WIDGET_REGISTRY["favorites-dock"].defaultRowSpan);
  });

  it("已有启动坞 → 不重复建坞，收据的 createdDockWidgetId 为 null", () => {
    const store = installStorage({ [STORAGE_KEY]: boardsWithDock() });
    __resetFavoritesForTests();
    const r = pinSiteToWorkbench(SITE);
    expect(r.ok).toBe(true);
    expect(r.receipt!.createdDockWidgetId).toBeNull();
    const workspace = JSON.parse(store.get(STORAGE_KEY)!);
    expect(workspace.boards[0].widgets).toHaveLength(1);
    expect(workspace.boards[0].widgets[0].id).toBe("widget-favorites-dock-old");
  });
});
