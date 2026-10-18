/**
 * 离线「最近访问」快照（P2-3）的纯逻辑。
 *
 * 需求背景：Service Worker 让站点外壳离线可开，但「我常用的那几个站点」
 * 的数据必须在本地——否则断网时用户面对的是一个空壳。
 * 存储层（IndexedDB → localStorage → 内存）在 `lib/offline-recent.ts`，
 * 这里只锁与 DOM 无关的合并语义：去重、置顶、容量截断。
 */
import { describe, expect, it } from "vitest";

import { mergeRecentVisit, OFFLINE_RECENT_LIMIT, type RecentVisit } from "../src/lib/offline-recent";

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
