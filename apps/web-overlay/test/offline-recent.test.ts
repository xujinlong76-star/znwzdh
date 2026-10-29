/**
 * 离线「最近访问」快照（P2-3）的纯逻辑。
 *
 * 需求背景：Service Worker 让站点外壳离线可开，但「我常用的那几个站点」
 * 的数据必须在本地——否则断网时用户面对的是一个空壳。
 * 存储层（IndexedDB → localStorage → 内存）在 `lib/offline-recent.ts`，
 * 这里锁与 DOM 无关的合并语义（去重、置顶、容量截断），
 * 以及出箱那一条轨的淘汰方向与「全清」契约（用 localStorage 替身，不碰 IndexedDB）。
 */
import { describe, expect, it, vi } from "vitest";

import {
  CLICK_OUTBOX_LIMIT,
  clearOfflineVisits,
  mergeOutbox,
  mergeRecentVisit,
  readClickOutbox,
  readOfflineVisits,
  OFFLINE_RECENT_LIMIT,
  type ClickOutboxEntry,
  type RecentVisit,
} from "../src/lib/offline-recent";

function visitedAtOf(list: RecentVisit[], id: string): number | undefined {
  return list.find((v) => v.id === id)?.visitedAt;
}

const visit = (id: string, visitedAt: number, extra: Partial<RecentVisit> = {}): RecentVisit => ({
  id,
  title: `站点 ${id}`,
  href: `https://example.com/${id}`,
  visitedAt,
  ...extra,
});

describe("mergeRecentVisit", () => {
  it("新访问置顶，其余保持原有相对顺序", () => {
    const list = [visit("a", 1), visit("b", 2)];
    const merged = mergeRecentVisit(list, visit("c", 3));
    expect(merged.map((v) => v.id)).toEqual(["c", "a", "b"]);
  });

  it("重复访问同一站点：移到最前并刷新时间，不产生重复项", () => {
    // 注意列表顺序即「新→旧」：result 应为 [新 a, b, c]（其余保持原相对顺序）
    const list = [visit("a", 1), visit("b", 2), visit("c", 3)];
    const merged = mergeRecentVisit(list, visit("a", 9));
    expect(visitedAtOf(merged, "a")).toBe(9);
    expect(merged.map((v) => v.id)).toEqual(["a", "b", "c"]);

    expect(merged.filter((v) => v.id === "a")).toHaveLength(1);
  });

  it("容量默认 50，超出则丢弃最旧的", () => {
    // 真实约定的列表顺序是「新→旧」：s0 最新，s59 最旧
    const list = Array.from({ length: 60 }, (_, i) => visit(`s${i}`, 100 - i));
    const merged = mergeRecentVisit(list, visit("new", 999));
    expect(merged).toHaveLength(OFFLINE_RECENT_LIMIT);
    expect(merged[0]!.id).toBe("new");
    expect(merged.some((v) => v.id === "s59")).toBe(false); // 最旧被淘汰
    expect(merged.at(-1)!.id).toBe("s48");
  });

  it("自定义 limit 生效（至少 1）", () => {
    const list = [visit("a", 1), visit("b", 2), visit("c", 3)];
    expect(mergeRecentVisit(list, visit("d", 4), 2).map((v) => v.id)).toEqual(["d", "a"]);
    expect(mergeRecentVisit(list, visit("d", 4), 0)).toHaveLength(1);
  });

  it("不改传入数组（纯函数）", () => {
    const list = [visit("a", 1)];
    const snapshot = JSON.stringify(list);
    mergeRecentVisit(list, visit("b", 2));
    expect(JSON.stringify(list)).toBe(snapshot);
  });
});

/**
 * 点击证据出箱（run100）与快照分轨后的合并语义。
 *
 * 与 mergeRecentVisit 相反的一条约定，必须写死在测试里：
 * 快照按 id 去重（展示用，重复访问只留最新一条），证据流按 eventId 去重但**不折叠**——
 * 同站连点三次就是三条不同的 eventId。超限淘汰的方向也不同：出箱丢最旧，
 * 因为刚产生那条还没送达，丢了等于永久丢失用户的行为证据。
 */
describe("mergeOutbox", () => {
  const entry = (eventId: string, queuedAt: number): ClickOutboxEntry => ({
    eventId,
    queuedAt,
    body: { kind: "click", siteId: "s-" + eventId },
  });

  it("新条目排最前（返回列表是新→旧）", () => {
    const merged = mergeOutbox([entry("a", 1), entry("b", 2)], entry("c", 3));
    expect(merged.map((e) => e.eventId)).toEqual(["c", "b", "a"]);
  });

  it("同 eventId 覆盖而不是占两格（重放不该重复入队）", () => {
    const merged = mergeOutbox([entry("a", 1), entry("b", 2)], entry("a", 5));
    expect(merged.map((e) => e.eventId)).toEqual(["a", "b"]);
    expect(merged[0]!.queuedAt).toBe(5);
  });

  it("容量上限丢的是最旧，不是最新", () => {
    const list = Array.from({ length: CLICK_OUTBOX_LIMIT + 10 }, (_, i) => entry(`e${i}`, i));
    const merged = mergeOutbox(list, entry("fresh", 9999));
    expect(merged).toHaveLength(CLICK_OUTBOX_LIMIT);
    expect(merged[0]!.eventId).toBe("fresh");
    // 原列表按 queuedAt 递增，61 条留 50 → 最旧的 e0..e10 被淘汰
    expect(merged.some((e) => e.eventId === "e0")).toBe(false);
    expect(merged.some((e) => e.eventId === "e10")).toBe(false);
    expect(merged.some((e) => e.eventId === "e11")).toBe(true);
  });

  it("不改传入数组（纯函数）", () => {
    const list = [entry("a", 1)];
    const snapshot = JSON.stringify(list);
    mergeOutbox(list, entry("b", 2));
    expect(JSON.stringify(list)).toBe(snapshot);
  });
});

/**
 * 「忘记我的访问记录」必须两个 store 一起清（数据主权：说了就要做到）。
 *
 * 只清快照会留一个洞：出箱里还躺着带查询词的点击证据，
 * 用户以为删干净了，回到线上又会被送出。
 * 这里用 localStorage 替身走非 IndexedDB 分支（node 环境没有 indexedDB）。
 */
describe("clearOfflineVisits 的端侧全清", () => {
  it("快照键与出箱键一起清空", async () => {
    const map = new Map<string, string>([
      ["navhub:recent-offline:v1", JSON.stringify([visit("a", 1)])],
      ["navhub:click-outbox:v1", JSON.stringify([{ eventId: "e1", queuedAt: 1, body: { kind: "click" } }])],
    ]);
    const store = {
      get length() {
        return map.size;
      },
      key: (i: number) => [...map.keys()][i] ?? null,
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
    };
    vi.stubGlobal("localStorage", store);
    try {
      await clearOfflineVisits();
      expect(JSON.parse(map.get("navhub:recent-offline:v1")!)).toEqual([]);
      expect(JSON.parse(map.get("navhub:click-outbox:v1")!)).toEqual([]);
      await expect(readClickOutbox()).resolves.toEqual([]);
      await expect(readOfflineVisits()).resolves.toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
