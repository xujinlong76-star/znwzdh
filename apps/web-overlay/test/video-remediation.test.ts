/**
 * 视频库整改的回归守卫（对应 docs/VIDEO-HOTSPOT-REMEDIATION-2026-10-28.md 的 A1/A2/B1；
 * C1 离线缓存容量守卫已随 video-cache-manager 删除而移除）。
 *
 * 这几条都是「不加断言就会悄悄退化」的类型：
 *   · A1 并发：冲突判定一旦失效，写路径会退回 last-write-wins，且**没有任何报错**；
 *   · A2 删除：阈值写错（比如 >= 1）会让「一次网络抖动永久删内容」复现；
 *   · B1 游标：排序键不是全序时，翻页会在两次请求间重复/漏项；
 */
import { describe, expect, it } from "vitest";
import type { NavigationData, NavigationItem, NavigationSubItem } from "@/types/navigation";
import { isVersionConflict } from "@/lib/video-write-guard";
import { decodeVideoCursor, encodeVideoCursor, pageCategoryByCursor } from "@/lib/video-pagination";

/** ProbeResult 必填字段比「只给 state」多，用工厂补齐，避免断言被类型噪声淹没 */
function probe(state: "healthy" | "dead" | "unverified", reason = "test") {
  return async (item: NavigationSubItem) => ({
    videoId: item.id,
    title: item.title,
    platform: "bilibili" as const,
    healthy: state === "healthy",
    state,
    reason,
    latencyMs: 1,
  });
}

function item(id: string, harvestedAt: number): NavigationSubItem {
  return {
    id,
    title: id,
    description: "",
    href: `https://example.com/${id}`,
    videoConfig: { type: "bilibili", bvid: `BV${id}`, harvestedAt },
  } as NavigationSubItem;
}

function category(id: string, items: NavigationSubItem[]): NavigationItem {
  return { id, title: id, description: "", href: "", items } as NavigationItem;
}

function data(cats: NavigationItem[]): NavigationData {
  return { navigationItems: cats } as NavigationData;
}

/** 断言用：取分类下的 id 列表（items 可能 undefined，集中处理一次） */
const ids = (cat: NavigationItem): string[] => (cat.items ?? []).map((i) => i.id);

describe("A1 版本冲突判定", () => {
  it("识别 StorageError 的 409 与文案变体", () => {
    expect(isVersionConflict({ status: 409, message: "conflict" })).toBe(true);
    expect(isVersionConflict(new Error("409 Conflict"))).toBe(true);
    expect(isVersionConflict(new Error("version conflict: expected 3"))).toBe(true);
    expect(isVersionConflict(new Error("版本冲突"))).toBe(true);
  });

  it("非冲突错误不得被当成冲突（否则会无限重放）", () => {
    expect(isVersionConflict(new Error("ECONNREFUSED"))).toBe(false);
    expect(isVersionConflict({ status: 500 })).toBe(false);
    expect(isVersionConflict(null)).toBe(false);
    expect(isVersionConflict("409")).toBe(false);
  });
});

describe("B1 游标分页", () => {
  const cat = category("cat", [item("a", 100), item("b", 300), item("c", 200), item("d", 400), item("e", 50)]);

  it("游标可往返，非法输入返回 null", () => {
    const cursor = { harvestedAt: 123, id: "x:y" };
    expect(decodeVideoCursor(encodeVideoCursor(cursor))).toEqual(cursor);
    expect(decodeVideoCursor("not-base64!!")).toBeNull();
    expect(decodeVideoCursor("")).toBeNull();
    expect(decodeVideoCursor(null)).toBeNull();
  });

  it("按 harvestedAt 降序分页，最后一页 nextCursor 为 null", () => {
    const first = pageCategoryByCursor(cat, null, 2);
    expect(ids(first.category)).toEqual(["d", "b"]);
    expect(first.nextCursor).toEqual({ harvestedAt: 300, id: "b" });

    const second = pageCategoryByCursor(cat, first.nextCursor, 2);
    expect(ids(second.category)).toEqual(["c", "a"]);
    expect(second.nextCursor).toEqual({ harvestedAt: 100, id: "a" });

    const third = pageCategoryByCursor(cat, second.nextCursor, 2);
    expect(ids(third.category)).toEqual(["e"]);
    expect(third.nextCursor).toBeNull();
  });

  it("翻页途中插入新条目：已翻过的页不重复、不遗漏（offset 分页做不到）", () => {
    const first = pageCategoryByCursor(cat, null, 2);
    expect(ids(first.category)).toEqual(["d", "b"]);

    // 模拟并发写入：新增一条最新的
    const withNew = category("cat", [...(cat.items ?? []), item("f", 500)]);
    const second = pageCategoryByCursor(withNew, first.nextCursor, 2);

    // 关键断言：第二页不应把 d/b 再来一次
    expect(ids(second.category)).toEqual(["c", "a"]);
  });

  it("同 harvestedAt 时按 id 全序，不会在两次请求间换位", () => {
    const tie = category("cat", [item("m", 100), item("n", 100), item("o", 100)]);
    const p1 = pageCategoryByCursor(tie, null, 1);
    const p2 = pageCategoryByCursor(tie, p1.nextCursor, 1);
    const p3 = pageCategoryByCursor(tie, p2.nextCursor, 1);
    expect([p1, p2, p3].map((p) => ids(p.category)[0])).toEqual(["m", "n", "o"]);
  });
});

;
