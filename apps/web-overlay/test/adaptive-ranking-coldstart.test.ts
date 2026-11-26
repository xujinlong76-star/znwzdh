/**
 * P0 D 线：冷启动排序——打开现成自适应排序并接通个人频次。
 *
 * 钉住的契约（数据口径：仓库 388 站 `navigation.json`，不是实况库 4,805 站）：
 *  1. 默认开启：`DEFAULT_CONFIG.enableAdaptiveRanking === true`。
 *     此前默认 false，自适应排序对新用户恒关，调用点传不传 visitStats
 *     都无人在意——这是本线要修的第一半。
 *  2. 冷启动基线：无个人数据时「对话助手」文件顺序不变，
 *     ChatGPT 1 / DeepSeek 2 / Claude 3（`navigation.json` 的真实顺序，
 *     三站均无 weight / trendScore / liveMetrics，分数全 0，稳定排序保序）。
 *  3. 个人频次接通：调用点把 `navhub_visit_counts_v1`（`bumpVisitCount`
 *     的写入口，`recordOfflineVisit` 每次点击同步累加）读出来传给
 *     `computeAdaptiveSiteRanking` 的 `visitStats`，有访问记录时顺序
 *     真的因此变化；7 天半衰期下 30 天前的访问应衰减到几乎不计分。
 *  4. 不开自适应时行为与改前一致：`sortCategoryItemsWithPinned` 保序。
 *
 * 夹具用 `navigation.json` 里「对话助手」的真实 id 与标题（10 站全量），
 * 不编造权重数据集。
 */
import { describe, expect, it, vi } from "vitest";

import {
  computeAdaptiveSiteRanking,
  sortCategoryItemsWithPinned,
} from "../src/lib/modular/diy-presets";
import { DEFAULT_CONFIG } from "../src/lib/modular/home-diy-storage";
import {
  VISIT_COUNTS_KEY,
  VISIT_COUNTS_UPDATED_EVENT,
  bumpVisitCount,
  readVisitStats,
} from "../src/lib/offline-recent";

/** 「对话助手」在 navigation.json 里的真实文件顺序（10 站，全部无权重字段）。 */
const DIALOG_ASSISTANT = [
  { id: "nav-da02af4f6414", title: "ChatGPT" },
  { id: "nav-9336ef9971b1", title: "DeepSeek" },
  { id: "nav-b6079f993ed2", title: "Claude" },
  { id: "nav-8a13a0d53f1b", title: "Kimi" },
  { id: "nav-3a7b360cd001", title: "通义千问" },
  { id: "nav-2685c645b208", title: "豆包" },
  { id: "nav-c9117d4ee05c", title: "文心一言" },
  { id: "nav-6599732737b8", title: "智谱清言" },
  { id: "nav-e7027bfb74ad", title: "讯飞星火" },
  { id: "nav-0bc5477b0ff7", title: "Gemini" },
] as const;

const TITLES = (items: readonly { title: string }[]) => items.map((i) => i.title);

function stubMapStorage(map = new Map<string, string>()) {
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
  return map;
}

describe("P0 D：自适应排序默认开启", () => {
  it("新用户默认 enableAdaptiveRanking 为 true", () => {
    expect(DEFAULT_CONFIG.enableAdaptiveRanking).toBe(true);
  });
});

describe("P0 D：冷启动基线（无个人数据）", () => {
  it("空 visitStats 时文件顺序不变：ChatGPT 1 / DeepSeek 2 / Claude 3", () => {
    const ranked = computeAdaptiveSiteRanking([...DIALOG_ASSISTANT], {
      pinnedItemIds: [],
      visitStats: {},
    });
    expect(TITLES(ranked).slice(0, 3)).toEqual(["ChatGPT", "DeepSeek", "Claude"]);
    expect(TITLES(ranked)).toEqual(TITLES(DIALOG_ASSISTANT));
  });

  it("不开自适应时 sortCategoryItemsWithPinned 与改前一致：保序", () => {
    const ranked = sortCategoryItemsWithPinned([...DIALOG_ASSISTANT], []);
    expect(TITLES(ranked)).toEqual(TITLES(DIALOG_ASSISTANT));
  });
});

describe("P0 D：个人频次真实改变顺序", () => {
  const NOW = Date.now();

  it("Claude 近期被点 5 次 → 升到第 1，其余保序", () => {
    const ranked = computeAdaptiveSiteRanking([...DIALOG_ASSISTANT], {
      pinnedItemIds: [],
      now: NOW,
      visitStats: { "nav-b6079f993ed2": { count: 5, lastVisitedAt: NOW } },
    });
    expect(TITLES(ranked).slice(0, 3)).toEqual(["Claude", "ChatGPT", "DeepSeek"]);
  });

  it("半衰期：Claude 30 天前点 10 次（≈5.1 分） < Gemini 刚才点 1 次（10 分）", () => {
    const thirtyDaysAgo = NOW - 30 * 24 * 60 * 60 * 1000;
    const ranked = computeAdaptiveSiteRanking([...DIALOG_ASSISTANT], {
      pinnedItemIds: [],
      now: NOW,
      visitStats: {
        "nav-b6079f993ed2": { count: 10, lastVisitedAt: thirtyDaysAgo },
        "nav-0bc5477b0ff7": { count: 1, lastVisitedAt: NOW },
      },
    });
    expect(ranked[0]!.title).toBe("Gemini");
    expect(TITLES(ranked).indexOf("Claude")).toBeGreaterThan(
      TITLES(ranked).indexOf("Gemini"),
    );
  });

  it("置顶仍优先于频次：置顶 ChatGPT + Claude 点 5 次 → ChatGPT 仍第 1", () => {
    const ranked = computeAdaptiveSiteRanking([...DIALOG_ASSISTANT], {
      pinnedItemIds: ["nav-da02af4f6414"],
      now: NOW,
      visitStats: { "nav-b6079f993ed2": { count: 5, lastVisitedAt: NOW } },
    });
    expect(TITLES(ranked).slice(0, 2)).toEqual(["ChatGPT", "Claude"]);
  });
});

describe("P0 D：readVisitStats（调用点的数据来源）", () => {
  it("读到 bumpVisitCount 写下的真实计数", () => {
    const map = stubMapStorage();
    try {
      bumpVisitCount("nav-b6079f993ed2");
      bumpVisitCount("nav-b6079f993ed2");
      const stats = readVisitStats();
      expect(stats["nav-b6079f993ed2"]!.count).toBe(2);
      expect(typeof stats["nav-b6079f993ed2"]!.lastVisitedAt).toBe("number");
      expect(map.has(VISIT_COUNTS_KEY)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("无键 / 坏 JSON / 非对象旧值 → 空对象，不抛错", () => {
    for (const seed of [
      new Map<string, string>(),
      new Map([[VISIT_COUNTS_KEY, "{not-json"]]),
      new Map([[VISIT_COUNTS_KEY, "[]"]]),
    ]) {
      stubMapStorage(seed);
      try {
        expect(readVisitStats()).toEqual({});
      } finally {
        vi.unstubAllGlobals();
      }
    }
  });

  it("畸形条目被丢弃，合法条目保留", () => {
    const map = stubMapStorage(
      new Map([
        [
          VISIT_COUNTS_KEY,
          JSON.stringify({
            good: { count: 3, lastVisitedAt: 1000 },
            noCount: { lastVisitedAt: 1000 },
            zeroCount: { count: 0 },
            stringCount: { count: "5" },
            badTime: { count: 2, lastVisitedAt: "yesterday" },
          }),
        ],
      ]),
    );
    try {
      const stats = readVisitStats();
      expect(Object.keys(stats).sort()).toEqual(["badTime", "good"]);
      expect(stats.good).toEqual({ count: 3, lastVisitedAt: 1000 });
      // lastVisitedAt 非法只丢时间，不丢计数
      expect(stats.badTime).toEqual({ count: 2 });
      expect(map.has(VISIT_COUNTS_KEY)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("P0 D：点击后同页即时刷新（事件通知）", () => {
  it("bumpVisitCount 写盘后派发 navhub:visit-counts-updated", () => {
    stubMapStorage();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    try {
      bumpVisitCount("nav-b6079f993ed2");
      expect(dispatchEvent).toHaveBeenCalledTimes(1);
      expect(dispatchEvent.mock.calls[0]![0]).toBeInstanceOf(Event);
      expect((dispatchEvent.mock.calls[0]![0] as Event).type).toBe(
        VISIT_COUNTS_UPDATED_EVENT,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
