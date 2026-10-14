import { describe, expect, it } from "vitest";
import { ageInDays, freshnessScore, trendScore } from "../src/ranking.ts";
import { buildProfile, decay, type BehaviorEvent } from "../src/profile.ts";
import { fuse } from "../src/fusion.ts";
import {
  channelWeight,
  channelWeights,
  registerChannel,
  resetChannels,
  searchChannels,
} from "../src/channels.ts";

/* ------------------------------------------------------------------ *
 * 热度公式
 * ------------------------------------------------------------------ */

describe("trendScore", () => {
  const NOW = 1_700_000_000_000;

  it("零互动老站点得 0 分（不会变负）", () => {
    expect(trendScore({ visits7d: 0, favorites7d: 0, ageDays: 365 }, NOW)).toBe(0);
  });

  it("同等互动下新站点排老站点前面（年龄惩罚生效）", () => {
    const fresh = trendScore({ visits7d: 10, favorites7d: 2, ageDays: 1 }, NOW);
    const old = trendScore({ visits7d: 10, favorites7d: 2, ageDays: 60 }, NOW);
    expect(fresh).toBeGreaterThan(old);
  });

  it("点击对数增长：1->10 次的增益大于 100->110 次", () => {
    const a = trendScore({ visits7d: 10, favorites7d: 0, ageDays: 0 }, NOW) - trendScore({ visits7d: 1, favorites7d: 0, ageDays: 0 }, NOW);
    const b = trendScore({ visits7d: 110, favorites7d: 0, ageDays: 0 }, NOW) - trendScore({ visits7d: 100, favorites7d: 0, ageDays: 0 }, NOW);
    expect(a).toBeGreaterThan(b);
  });

  it("收藏权重高于点击（1 次收藏 > 1 次点击）", () => {
    const click = trendScore({ visits7d: 1, favorites7d: 0, ageDays: 0 }, NOW);
    const fav = trendScore({ visits7d: 0, favorites7d: 1, ageDays: 0 }, NOW);
    expect(fav).toBeGreaterThan(click);
  });

  it("确定性：同输入同输出", () => {
    const input = { visits7d: 5, favorites7d: 1, ageDays: 3 };
    expect(trendScore(input, NOW)).toBe(trendScore(input, NOW));
  });
});

describe("freshnessScore / ageInDays", () => {
  it("新品分随创建时间递增（越晚创建分越高）", () => {
    const older = 1_700_000_000_000 - 100_000;
    const newer = 1_700_000_000_000 - 1_000;
    expect(freshnessScore(newer)).toBeGreaterThan(freshnessScore(older));
  });

  it("年龄天数计算正确", () => {
    const now = 1_700_000_000_000;
    expect(ageInDays(now - 7 * 86_400_000, now)).toBeCloseTo(7);
    expect(ageInDays(now + 86_400_000, now)).toBe(0); // 未来时间钳为 0
  });
});

/* ------------------------------------------------------------------ *
 * 个性化画像聚合
 * ------------------------------------------------------------------ */

const NOW = 1_700_000_000_000;
const day = 86_400_000;

function click(siteId: string, categoryId: string | null, tags: string[], ageDays: number): BehaviorEvent {
  return { kind: "click", siteId, categoryId, tags, createdAt: NOW - ageDays * day };
}

describe("decay", () => {
  it("当天为 1，一个半衰期后为 0.5", () => {
    expect(decay(0)).toBe(1);
    expect(decay(7)).toBeCloseTo(0.5);
    expect(decay(14)).toBeCloseTo(0.25);
  });

  it("未来时间（负年龄）钳为 1", () => {
    expect(decay(-5)).toBe(1);
  });
});

describe("buildProfile", () => {
  it("topCategories 按衰减加权计数排序", () => {
    const events = [
      click("s1", "cat-ai", ["ai"], 0),
      click("s2", "cat-ai", ["ai"], 0),
      click("s3", "cat-ai", ["ai"], 0),
      click("s4", "cat-dev", ["dev"], 0),
    ];
    const p = buildProfile(events, { now: NOW });
    expect(p.topCategories[0]).toBe("cat-ai");
    expect(p.topCategories).toContain("cat-dev");
    expect(p.topCategories.length).toBeLessThanOrEqual(5);
  });

  it("老事件的权重低于新事件（时间衰减）", () => {
    const fresh = buildProfile([click("s1", "cat-a", [], 0)], { now: NOW });
    const old = buildProfile([click("s1", "cat-a", [], 60)], { now: NOW });
    // 只有一个事件时 topCategories 都含 cat-a，用 visited 长度无法区分；
    // 改验证两个事件竞争时新的赢
    const mixed = buildProfile([
      click("s1", "cat-old", [], 60),
      click("s2", "cat-new", [], 0),
    ], { now: NOW });
    expect(mixed.topCategories[0]).toBe("cat-new");
    expect(fresh.topCategories).toEqual(old.topCategories); // 单事件时集合相同
  });

  it("收藏权重是点击的 2 倍", () => {
    const events: BehaviorEvent[] = [
      click("s1", "cat-click", [], 0),
      { kind: "favorite", siteId: "s2", categoryId: "cat-fav", tags: [], createdAt: NOW },
    ];
    const p = buildProfile(events, { now: NOW });
    expect(p.topCategories[0]).toBe("cat-fav");
  });

  it("visitedSiteIds 保序去重，最多 maxVisited 条", () => {
    const events: BehaviorEvent[] = [];
    for (let i = 0; i < 60; i++) events.push(click("s" + i, "cat", [], 0));
    events.push(click("s0", "cat", [], 0)); // 重复
    const p = buildProfile(events, { now: NOW, maxVisited: 50 });
    expect(p.visitedSiteIds.length).toBe(50);
    // 顺序 = 输入顺序（调用方 behaviorEvents 按 created_at DESC 传入，即最新在前）
    expect(p.visitedSiteIds[0]).toBe("s0");
    expect(new Set(p.visitedSiteIds).size).toBe(50); // 去重
  });

  it("空事件返回空画像（不抛错）", () => {
    const p = buildProfile([], { now: NOW });
    expect(p.topCategories).toEqual([]);
    expect(p.topTags).toEqual([]);
    expect(p.visitedSiteIds).toEqual([]);
    expect(p.eventCount).toBe(0);
  });

  it("标签按加权计数聚合并受限数量", () => {
    const events: BehaviorEvent[] = [];
    for (let i = 0; i < 12; i++) {
      events.push({ kind: "click", siteId: "s" + i, categoryId: null, tags: ["tag" + i], createdAt: NOW });
    }
    events.push(click("sx", null, ["tag0", "tag0b"], 0));
    const p = buildProfile(events, { now: NOW, topTags: 8 });
    expect(p.topTags.length).toBe(8);
    expect(p.topTags[0]).toBe("tag0"); // 2 次加权最高
  });

  it("输出结构可直接喂给 PersonalizationSignals", () => {
    const p = buildProfile([click("s1", "cat-a", ["t1"], 0)], { now: NOW });
    expect(Array.isArray(p.topCategories)).toBe(true);
    expect(Array.isArray(p.topTags)).toBe(true);
    expect(Array.isArray(p.visitedSiteIds)).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * 检索通道注册表
 * ------------------------------------------------------------------ */

describe("通道注册表", () => {
  it("内置五路开箱即用且权重不变", () => {
    expect(searchChannels().slice(0, 5)).toEqual(["exact", "fts", "pinyin", "semantic", "personal"]);
    const w = channelWeights();
    expect(w.exact).toBe(1.4);
    expect(w.fts).toBe(1.0);
    expect(w.pinyin).toBe(0.9);
    expect(w.semantic).toBe(1.15);
    expect(w.personal).toBe(0.3); // 个性化刻意低于相关性通道（RRF 教训）
  });

  it("registerChannel 追加通道并纳入默认权重", () => {
    resetChannels();
    registerChannel("collab", 0.5);
    expect(searchChannels()).toContain("collab");
    expect(channelWeight("collab")).toBe(0.5);
    expect(channelWeight("never-registered")).toBe(0);
    resetChannels();
  });

  it("非法通道名/权重被拒绝", () => {
    expect(() => registerChannel("  ")).toThrow(/不能为空/);
    expect(() => registerChannel("bad", -1)).toThrow(/非负/);
    expect(() => registerChannel("bad", Number.NaN)).toThrow(/非负/);
    resetChannels();
  });

  it("fuse 把已注册的新通道纳入融合与 coverage 统计", () => {
    resetChannels();
    registerChannel("collab", 1.0);
    const candidates = [
      { siteId: "a", channel: "collab", rank: 1 },
      { siteId: "b", channel: "fts", rank: 1 },
      { siteId: "a", channel: "fts", rank: 2 },
    ];
    const hits = fuse(candidates, { collab: 1.0, fts: 1.0, coverageStrength: 0.35, k: 60 }, 10);
    // a 被两路命中（collab + fts），coverage 加权后应排在只被 fts 命中的 b 前面
    expect(hits[0]!.siteId).toBe("a");
    resetChannels();
  });

  it("resetChannels 后回到内置状态（测试隔离）", () => {
    registerChannel("temp");
    resetChannels();
    expect(searchChannels()).not.toContain("temp");
    expect(searchChannels().length).toBe(5);
  });
});
