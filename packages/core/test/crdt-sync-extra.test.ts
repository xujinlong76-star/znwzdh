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
      videoProgress: {},
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
    expect(compacted.find((o) => o.type === "SET_CATEGORY_PIN" && o.entityId === "c1")?.timestamp).toBe(3000);
    expect(compacted.find((o) => o.type === "REORDER_CATEGORIES")?.timestamp).toBe(1000);
    expect(compacted.find((o) => o.type === "PIN_SITE_IN_CATEGORY")?.timestamp).toBe(1000);
    expect(compacted.find((o) => o.type === "UPSERT_CUSTOM_CATEGORY")?.timestamp).toBe(1000);
    expect(compacted.find((o) => o.type === "UPSERT_CUSTOM_SITE")?.timestamp).toBe(1000);
    expect(new Set(compacted.map((o) => o.id)).size).toBe(compacted.length);
    expect(compactOperationLogs).toBe(compactOperationLog);
  });

  it("保留取消 pin 与删除 tombstone，和老 peer 正向日志合流不复活", () => {
    const site = { id: "s1", title: "E", href: "https://example.com" };
    const progress = {
      videoId: "v1", title: "视频", platform: "other" as const,
      timestampSec: 10, durationSec: 100, progressPercent: 10,
      updatedAt: 1000, deviceId: "c1",
    };
    const oldPeer = [
      op("SET_CATEGORY_PIN", "c1", { isPinned: true }, "old", 1000),
      op("PIN_SITE_IN_CATEGORY", "c1", { siteId: "s1" }, "old", 1000),
      op("REORDER_CATEGORIES", "global", { categoryOrder: ["c1"] }, "old", 1000),
      op("UPSERT_CUSTOM_CATEGORY", "cc1", { id: "cc1", title: "旧分类", items: [] }, "old", 1000),
      op("UPSERT_CUSTOM_SITE", "s1", { categoryId: "cc1", site }, "old", 1000),
      op("UPSERT_VIDEO_PROGRESS", "v1", progress, "old", 1000),
    ];
    const local = [
      op("SET_CATEGORY_PIN", "c1", { isPinned: false }, "new", 2000),
      op("UNPIN_SITE_IN_CATEGORY", "c1", { siteId: "s1" }, "new", 2000),
      op("REORDER_CATEGORIES", "global", { categoryOrder: [] }, "new", 2000),
      op("DELETE_CUSTOM_CATEGORY", "cc1", {}, "new", 2000),
      op("DELETE_CUSTOM_SITE", "s1", { siteId: "s1", categoryId: "cc1" }, "new", 2000),
      op("DELETE_VIDEO_PROGRESS", "v1", { updatedAt: 2000 }, "new", 2000),
    ];
    const compacted = compactOperationLog(local);
    expect(compacted.map((o) => o.type)).toEqual(expect.arrayContaining([
      "SET_CATEGORY_PIN", "UNPIN_SITE_IN_CATEGORY", "REORDER_CATEGORIES",
      "DELETE_CUSTOM_CATEGORY", "DELETE_CUSTOM_SITE", "DELETE_VIDEO_PROGRESS",
    ]));
    const merged = mergeOperationLogs(compacted, oldPeer);
    expect(reduceOperationsToState(merged)).toEqual(reduceOperationsToState(mergeOperationLogs(local, oldPeer)));
    expect(reduceOperationsToState(merged)).toEqual({
      pinnedCategoryIds: [], categoryOrder: [], pinnedSiteIdsByCategory: { c1: [] },
      customCategories: [], videoProgress: {},
    });
  });

  it("分类删除后重建保留最新跨键屏障，老 peer 的旧 pin/site 不复活", () => {
    const oldSite = { id: "old-site", title: "旧站点", href: "https://old.example.com" };
    const freshSite = { id: "fresh-site", title: "新站点", href: "https://fresh.example.com" };
    const oldPeer = [
      op("UPSERT_CUSTOM_CATEGORY", "cc1", { id: "cc1", title: "旧分类", items: [oldSite] }, "old", 1000),
      op("PIN_SITE_IN_CATEGORY", "cc1", { siteId: "old-site" }, "old", 1100),
      op("UPSERT_CUSTOM_SITE", "old-site", { categoryId: "cc1", site: oldSite }, "old", 1200),
    ];
    const latestDelete = op("DELETE_CUSTOM_CATEGORY", "cc1", {}, "new", 4000);
    const local = [
      op("UPSERT_CUSTOM_CATEGORY", "cc1", { id: "cc1", title: "初始分类", items: [] }, "c1", 1000),
      op("UPSERT_CUSTOM_SITE", "old-site", { categoryId: "cc1", site: oldSite }, "c1", 1100),
      op("PIN_SITE_IN_CATEGORY", "cc1", { siteId: "old-site" }, "c1", 1200),
      op("DELETE_CUSTOM_CATEGORY", "cc1", {}, "c1", 2000),
      op("UPSERT_CUSTOM_CATEGORY", "cc1", { id: "cc1", title: "第一次重建", items: [] }, "c1", 3000),
      latestDelete,
      op("UPSERT_CUSTOM_CATEGORY", "cc1", { id: "cc1", title: "最终重建", items: [] }, "c1", 5000),
      op("UPSERT_CUSTOM_SITE", "fresh-site", { categoryId: "cc1", site: freshSite }, "c1", 6000),
      op("PIN_SITE_IN_CATEGORY", "cc1", { siteId: "fresh-site" }, "c1", 6100),
    ];

    const compacted = compactOperationLog(local);
    const barriers = compacted.filter((o) => o.type === "DELETE_CUSTOM_CATEGORY" && o.entityId === "cc1");
    expect(barriers).toHaveLength(1);
    expect(barriers[0]).toMatchObject({
      id: latestDelete.id,
      clientId: latestDelete.clientId,
      timestamp: latestDelete.timestamp,
    });
    expect(reduceOperationsToState(compacted)).toEqual(reduceOperationsToState(local));

    const expected = reduceOperationsToState(mergeOperationLogs(local, oldPeer));
    expect(expected.customCategories).toEqual([
      { id: "cc1", title: "最终重建", items: [freshSite] },
    ]);
    expect(expected.pinnedSiteIdsByCategory).toEqual({ cc1: ["fresh-site"] });
    expect(reduceOperationsToState(mergeOperationLogs(compacted, oldPeer))).toEqual(expected);

    // 每分类只保留最新删除水位；重复压缩不得继续累积历史删除操作。
    expect(compactOperationLog(compacted)).toEqual(compacted);
  });

  it("歧义删除写不派生正向 UPSERT：压缩后合流较早分类删除不复活站点", () => {
    const shared = { id: "shared", title: "共享站点", href: "https://shared.example.com" };
    // 同一站点被两个分类的内嵌数据引用；A 的范围删除只删 A，B 仍保留站点。
    // 但 custom_site_shared 的 LWW 水位是 DELETE，不能拿它给 B 合成正值 UPSERT。
    const local = [
      op("UPSERT_CUSTOM_CATEGORY", "cat-a", { id: "cat-a", title: "分类 A", items: [shared] }, "local", 1000),
      op("UPSERT_CUSTOM_CATEGORY", "cat-b", { id: "cat-b", title: "分类 B", items: [shared] }, "local", 2000),
      op("DELETE_CUSTOM_SITE", "shared", { siteId: "shared", categoryId: "cat-a" }, "local", 3000),
    ];
    const remote = [
      op("DELETE_CUSTOM_CATEGORY", "cat-b", {}, "remote", 2500),
    ];

    // 第一阶段先压缩本地；第二阶段才接收另一端较早的分类删除。
    const compacted = compactOperationLog(local);
    expect(compacted).toEqual(local);
    expect(compacted.some((o) => o.id.startsWith(`${local[2]!.id}_UPSERT_`))).toBe(false);

    const expected = reduceOperationsToState(mergeOperationLogs(local, remote));
    expect(expected.customCategories).toEqual([
      { id: "cat-a", title: "分类 A", items: [] },
    ]);
    expect(reduceOperationsToState(mergeOperationLogs(compacted, remote))).toEqual(expected);
  });

  it("自动建类不合成显式分类写：压缩后合流较早分类删除不污染标题", () => {
    const seed = { id: "seed", title: "旧站点", href: "https://seed.example.com" };
    const fresh = { id: "fresh", title: "新站点", href: "https://fresh.example.com" };
    const local = [
      op("UPSERT_CUSTOM_SITE", "seed", { categoryId: "auto-cat", site: seed }, "local", 1000),
      op("UPSERT_CUSTOM_SITE", "fresh", { categoryId: "auto-cat", site: fresh }, "local", 3000),
    ];
    const remote = [
      op("DELETE_CUSTOM_CATEGORY", "auto-cat", {}, "remote", 2500),
      op("UPSERT_CUSTOM_CATEGORY", "auto-cat", { id: "auto-cat", title: "远端命名", items: [] }, "remote", 2750),
    ];

    // 原日志中 fresh 写入时分类已被远端命名，自动建类逻辑不会覆盖它；
    // 若压缩合成 timestamp=3000 的默认标题 UPSERT，则会反向污染标题。
    const compacted = compactOperationLog(local);
    expect(compacted).toEqual(local);
    expect(compacted.some((o) => o.type === "UPSERT_CUSTOM_CATEGORY")).toBe(false);

    const expected = reduceOperationsToState(mergeOperationLogs(local, remote));
    expect(expected.customCategories).toEqual([
      { id: "auto-cat", title: "远端命名", items: [fresh] },
    ]);
    expect(reduceOperationsToState(mergeOperationLogs(compacted, remote))).toEqual(expected);
  });

  it("多键交错时间戳压缩使用每键水位，无关 op 不抬高目标 tombstone", () => {
    const targetDelete = op("SET_CATEGORY_PIN", "target", { isPinned: false }, "z-target", 2000);
    const ops = [
      op("SET_CATEGORY_PIN", "target", { isPinned: true }, "target", 1000),
      op("SET_CATEGORY_PIN", "other", { isPinned: true }, "other", 9000),
      targetDelete,
      op("REORDER_CATEGORIES", "global", { categoryOrder: ["other"] }, "layout", 8000),
    ];
    const compacted = compactOperationLog(ops);
    const tombstone = compacted.find((o) => o.type === "SET_CATEGORY_PIN" && o.entityId === "target")!;

    // 目标键只保留自己的 2000 水位、原始操作时间戳及 clientId/id tie-break。
    expect(tombstone).toMatchObject({
      id: targetDelete.id,
      clientId: targetDelete.clientId,
      timestamp: 2000,
      payload: { isPinned: false },
    });
    expect(compacted.find((o) => o.entityId === "other")?.timestamp).toBe(9000);
    expect(compacted.find((o) => o.type === "REORDER_CATEGORIES")?.timestamp).toBe(8000);

    // 本节点从未见过的中间更新必须能胜出，不能被 other/layout 的 8000/9000 误删。
    const unseen = op("SET_CATEGORY_PIN", "target", { isPinned: true }, "peer", 5000);
    const merged = mergeOperationLogs(compacted, [unseen]);
    expect(reduceOperationsToState(merged).pinnedCategoryIds).toEqual(expect.arrayContaining(["target", "other"]));

    // 同时间戳仍按原 clientId/id 决胜，不能因压缩改写 tie-break。
    const tiedPeer = op("SET_CATEGORY_PIN", "target", { isPinned: true }, "a-peer", 2000);
    expect(reduceOperationsToState(mergeOperationLogs(compacted, [tiedPeer])).pinnedCategoryIds).not.toContain("target");
  });

  it("视频删除压缩保留原始 updatedAt 和 op.timestamp，不误删压缩后新增的断点", () => {
    const deleted = op("DELETE_VIDEO_PROGRESS", "v1", { updatedAt: 1000 }, "new", 2000);
    const newer = op("UPSERT_VIDEO_PROGRESS", "v1", {
      videoId: "v1", title: "更新", platform: "other", timestampSec: 20,
      durationSec: 100, progressPercent: 20, updatedAt: 1500, deviceId: "peer",
    }, "peer", 1500);
    const unrelated = op("SET_CATEGORY_PIN", "other", { isPinned: true }, "other", 9000);
    const compacted = compactOperationLog([deleted, unrelated]);
    const tombstone = compacted.find((o) => o.type === "DELETE_VIDEO_PROGRESS")!;
    expect(tombstone).toMatchObject({
      id: deleted.id,
      clientId: deleted.clientId,
      timestamp: 2000,
      payload: { updatedAt: 1000 },
    });
    expect(reduceOperationsToState(mergeOperationLogs(compacted, [newer])).videoProgress.v1?.title).toBe("更新");
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
