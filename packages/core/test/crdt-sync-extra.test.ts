/**
 * crdt-sync.ts 补充覆盖：操作合并/规约/压缩、向量时钟比较、CrdtStore。
 * （此前 crdt-and-wayback.test.ts 只覆盖了部分 CrdtStore 行为；
 *  reduce/compact/compareVectorClocks 的分支基本没有断言。）
 */
import { describe, expect, it } from "vitest";
import {
  compareVectorClocks,
  compactOperationLog,
  compactOperationLogs,
  createCRDTOperation,
  CrdtStore,
  mergeOperationLogs,
  reduceOperationsToState,
  type CRDTOperation,
} from "../src/crdt-sync.ts";

function op(
  type: CRDTOperation["type"],
  entityId: string,
  payload: Record<string, unknown>,
  clientId = "c1",
  timestamp = 1000,
): CRDTOperation {
  return createCRDTOperation(type, entityId, payload, clientId, timestamp);
}

describe("createCRDTOperation", () => {
  it("id 含时间戳与 clientId 前缀，字段完整", () => {
    const o = createCRDTOperation("SET_CATEGORY_PIN", "cat-1", { isPinned: true }, "client-abc", 12345);
    expect(o.id).toMatch(/^op_12345_client-a/);
    expect(o).toMatchObject({ type: "SET_CATEGORY_PIN", entityId: "cat-1", timestamp: 12345, clientId: "client-abc" });
  });
});

describe("mergeOperationLogs", () => {
  it("去重、按时间戳排序、时间戳相同按 clientId 再按 id 破除平局", () => {
    const a = op("SET_CATEGORY_PIN", "c1", { isPinned: true }, "alice", 2000);
    const b = op("SET_CATEGORY_PIN", "c2", { isPinned: true }, "bob", 1000);
    const merged = mergeOperationLogs([a], [a, b]);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.entityId).toBe("c2");
    expect(merged[1]!.entityId).toBe("c1");

    const sameTs1 = { ...op("SET_CATEGORY_PIN", "x", {}, "bob", 5000), id: "op_5000_bob_1" };
    const sameTs2 = { ...op("SET_CATEGORY_PIN", "y", {}, "alice", 5000), id: "op_5000_alice_1" };
    const tie = mergeOperationLogs([sameTs1], [sameTs2]);
    expect(tie[0]!.clientId).toBe("alice");
    expect(tie[1]!.clientId).toBe("bob");
  });
});

describe("reduceOperationsToState", () => {
  it("空日志返回空状态；initialState 被复制而非引用", () => {
    const state = reduceOperationsToState([]);
    expect(state).toEqual({
      pinnedCategoryIds: [],
      categoryOrder: [],
      pinnedSiteIdsByCategory: {},
      customCategories: [],
    });
    const init = { pinnedCategoryIds: ["c1"], categoryOrder: ["c1"], pinnedSiteIdsByCategory: {}, customCategories: [] };
    const s2 = reduceOperationsToState([], init);
    expect(s2.pinnedCategoryIds).toEqual(["c1"]);
    expect(s2.pinnedCategoryIds).not.toBe(init.pinnedCategoryIds);
  });

  it("SET_CATEGORY_PIN 置顶与取消置顶；LWW 旧写不胜新写", () => {
    const ops = [
      op("SET_CATEGORY_PIN", "c1", { isPinned: true }, "c1", 1000),
      op("SET_CATEGORY_PIN", "c1", { isPinned: false }, "c1", 2000),
      op("SET_CATEGORY_PIN", "c1", { isPinned: true }, "c1", 1500),
    ];
    const state = reduceOperationsToState(ops);
    expect(state.pinnedCategoryIds).toEqual([]);
    const pinOnly = reduceOperationsToState([op("SET_CATEGORY_PIN", "c1", { isPinned: true }, "c1", 1000)]);
    expect(pinOnly.pinnedCategoryIds).toEqual(["c1"]);
  });

  it("REORDER_CATEGORIES：非数组 payload 被忽略", () => {
    const state = reduceOperationsToState([
      op("REORDER_CATEGORIES", "global", { categoryOrder: ["b", "a"] }, "c1", 1000),
      op("REORDER_CATEGORIES", "global", { categoryOrder: "nope" }, "c1", 2000),
    ]);
    expect(state.categoryOrder).toEqual(["b", "a"]);
  });

  it("PIN/UNPIN_SITE_IN_CATEGORY：缺 siteId 跳过；取消置顶移除", () => {
    const state = reduceOperationsToState([
      op("PIN_SITE_IN_CATEGORY", "cat1", { siteId: "s1" }, "c1", 1000),
      op("PIN_SITE_IN_CATEGORY", "cat1", {}, "c1", 1100),
      op("PIN_SITE_IN_CATEGORY", "cat1", { siteId: "s2" }, "c1", 1200),
      op("UNPIN_SITE_IN_CATEGORY", "cat1", { siteId: "s1" }, "c1", 1300),
    ]);
    expect(state.pinnedSiteIdsByCategory).toEqual({ cat1: ["s2"] });
  });

  it("UPSERT/DELETE_CUSTOM_CATEGORY：新增、更新标题、删除连带清理置顶", () => {
    const state = reduceOperationsToState([
      op("UPSERT_CUSTOM_CATEGORY", "cc1", { id: "cc1", title: "收藏", items: [] }, "c1", 1000),
      op("PIN_SITE_IN_CATEGORY", "cc1", { siteId: "s9" }, "c1", 1100),
      op("UPSERT_CUSTOM_CATEGORY", "cc1", { id: "cc1", title: "新名字" }, "c1", 1200),
      op("DELETE_CUSTOM_CATEGORY", "cc1", {}, "c1", 1300),
    ]);
    expect(state.customCategories).toEqual([]);
    expect(state.pinnedSiteIdsByCategory["cc1"]).toBeUndefined();

    const renamed = reduceOperationsToState([
      op("UPSERT_CUSTOM_CATEGORY", "cc1", { id: "cc1", title: "旧", items: [] }, "c1", 1000),
      op("UPSERT_CUSTOM_CATEGORY", "cc1", { id: "cc1", title: "新" }, "c1", 2000),
    ]);
    expect(renamed.customCategories[0]!.title).toBe("新");
    const noId = reduceOperationsToState([op("UPSERT_CUSTOM_CATEGORY", "cc1", { title: "无 id" }, "c1", 1000)]);
    expect(noId.customCategories).toEqual([]);
  });

  it("UPSERT_CUSTOM_SITE：目标分类不存在时自动建分类；跨分类移动清理旧分类；更新同站", () => {
    const site = { id: "s1", title: "Example", href: "https://example.com" };
    const state = reduceOperationsToState([
      op("UPSERT_CUSTOM_SITE", "s1", { categoryId: "cc1", site }, "c1", 1000),
    ]);
    expect(state.customCategories).toEqual([{ id: "cc1", title: "自定义分类", items: [site] }]);

    const moved = reduceOperationsToState([
      op("UPSERT_CUSTOM_CATEGORY", "cc1", { id: "cc1", title: "A", items: [] }, "c1", 1000),
      op("UPSERT_CUSTOM_CATEGORY", "cc2", { id: "cc2", title: "B", items: [] }, "c1", 1000),
      op("UPSERT_CUSTOM_SITE", "s1", { categoryId: "cc1", site }, "c1", 1100),
      op("UPSERT_CUSTOM_SITE", "s1", { categoryId: "cc2", site: { ...site, title: "改名" } }, "c1", 1200),
    ]);
    expect(moved.customCategories.find((c) => c.id === "cc1")!.items).toEqual([]);
    expect(moved.customCategories.find((c) => c.id === "cc2")!.items[0]!.title).toBe("改名");

    const noSite = reduceOperationsToState([op("UPSERT_CUSTOM_SITE", "s1", {}, "c1", 1000)]);
    expect(noSite.customCategories).toEqual([]);
  });

  it("DELETE_CUSTOM_SITE：按分类过滤或全部分类清理", () => {
    const site = { id: "s1", title: "Example", href: "https://example.com" };
    const base = [
      op("UPSERT_CUSTOM_SITE", "s1", { categoryId: "cc1", site }, "c1", 1000),
      op("UPSERT_CUSTOM_SITE", "s1", { categoryId: "cc2", site }, "c1", 1100),
    ];
    // 注意：同一站点在两个分类里是两条 UPSERT，后一条跨分类移动会清掉前一条，
    // 因此这里只验证「按 categoryId 删除」与「缺 siteId 时用 entityId」
    const scoped = reduceOperationsToState([
      ...base,
      op("DELETE_CUSTOM_SITE", "s1", { siteId: "s1", categoryId: "cc2" }, "c1", 1200),
    ]);
    expect(scoped.customCategories.find((c) => c.id === "cc2")!.items).toEqual([]);
    const byEntity = reduceOperationsToState([
      op("UPSERT_CUSTOM_SITE", "s1", { categoryId: "cc1", site }, "c1", 1000),
      op("DELETE_CUSTOM_SITE", "s1", {}, "c1", 1200),
    ]);
    expect(byEntity.customCategories.find((c) => c.id === "cc1")!.items).toEqual([]);
  });
});

describe("compactOperationLog", () => {
  it("压缩后规约结果与压缩前一致；空日志返回空数组", () => {
    expect(compactOperationLog([])).toEqual([]);
    const ops = [
      op("SET_CATEGORY_PIN", "c1", { isPinned: true }, "c1", 1000),
      op("SET_CATEGORY_PIN", "c1", { isPinned: false }, "c1", 2000),
      op("SET_CATEGORY_PIN", "c1", { isPinned: true }, "c1", 3000),
      op("REORDER_CATEGORIES", "global", { categoryOrder: ["c1", "c2"] }, "c1", 1000),
      op("PIN_SITE_IN_CATEGORY", "c1", { siteId: "s1" }, "c1", 1000),
      op("UPSERT_CUSTOM_CATEGORY", "cc1", { id: "cc1", title: "收藏", items: [] }, "c1", 1000),
      op("UPSERT_CUSTOM_SITE", "s1", { categoryId: "cc1", site: { id: "s1", title: "E" } }, "c1", 1000),
    ];
    const compacted = compactOperationLog(ops);
    expect(reduceOperationsToState(compacted)).toEqual(reduceOperationsToState(ops));
    expect(compacted.every((o) => o.clientId === "compact_sys")).toBe(true);
    expect(compactOperationLogs).toBe(compactOperationLog);
  });
});

describe("compareVectorClocks", () => {
  it("EQUAL / GREATER / LESS / CONCURRENT 四种关系", () => {
    expect(compareVectorClocks({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe("EQUAL");
    expect(compareVectorClocks({}, {})).toBe("EQUAL");
    expect(compareVectorClocks({ a: 2 }, { a: 1 })).toBe("GREATER");
    expect(compareVectorClocks({ a: 1 }, { a: 2 })).toBe("LESS");
    expect(compareVectorClocks({ a: 2, b: 1 }, { a: 1, b: 2 })).toBe("CONCURRENT");
    expect(compareVectorClocks({ a: 1 }, {})).toBe("GREATER");
  });
});

describe("CrdtStore", () => {
  it("getOperations 返回副本；addSite/getSiteByUrl/getActiveSites", () => {
    const store = new CrdtStore("node-a");
    expect(store.getOperations()).toEqual([]);
    const id = store.addSite({ url: "https://example.com", title: "Example", categoryId: "c1" });
    expect(typeof id).toBe("string");
    expect(store.getSiteByUrl("https://example.com")?.title).toBe("Example");
    expect(store.getActiveSites()).toHaveLength(1);
    expect(store.getSiteByUrl("https://missing.example.com")).toBeUndefined();
    expect(store.getVectorClock()).toEqual({ "node-a": 1 });
    // getOperations 返回的是副本，外部修改不影响内部
    const ops = store.getOperations();
    ops.length = 0;
    expect(store.getOperations()).toHaveLength(1);
  });

  it("getDeltaSince 按 seq 过滤；applyRemoteBatch 去重并推进时钟", () => {
    const a = new CrdtStore("node-a");
    const b = new CrdtStore("node-b");
    a.addSite({ url: "https://a.example.com", title: "A", categoryId: "c1" });
    const ops = a.getOperations();
    expect(b.applyRemoteBatch(ops)).toBe(1);
    expect(b.applyRemoteBatch(ops)).toBe(0);
    expect(b.getSiteByUrl("https://a.example.com")?.title).toBe("A");
    expect(b.getDeltaSince({})).toHaveLength(1);
    expect(b.getDeltaSince({ "node-a": 99 })).toHaveLength(0);
  });
});
