/**
 * 个性化画像聚合：行为事件 -> PersonalizationSignals。
 *
 * 输入是用户近 N 天的 click / favorite 事件（含站点类目与标签），
 * 输出直接喂给 SearchEngine 的 personal 通道（权重 0.3）——
 * 这就是「越用越懂你」的唯一入口，且翻转能力被通道权重天然限界。
 *
 * 时间衰减（7 天半衰期）：上个月的兴趣不应该和今天的一样重。
 * 收藏权重是点击的 2 倍：主动收藏是比偶然点击强得多的信号。
 */

import type { PersonalizationSignals } from "./types.ts";

export interface BehaviorEvent {
  kind: "click" | "favorite" | string;
  siteId: string;
  categoryId: string | null;
  tags: string[];
  createdAt: number;
}

export interface BuildProfileOptions {
  now?: number;
  /** 半衰期（天） */
  halfLifeDays?: number;
  /** 最近点击站点保留条数（保序，最新的在前） */
  maxVisited?: number;
  topCategories?: number;
  topTags?: number;
  /** 收藏的相对权重（点击 = 1） */
  favoriteWeight?: number;
}

export const DEFAULT_PROFILE_OPTIONS = {
  halfLifeDays: 7,
  maxVisited: 50,
  topCategories: 5,
  topTags: 8,
  favoriteWeight: 2,
} as const;

/** 半衰期衰减：ageDays=0 -> 1，ageDays=halfLife -> 0.5 */
export function decay(ageDays: number, halfLifeDays: number = DEFAULT_PROFILE_OPTIONS.halfLifeDays): number {
  if (ageDays <= 0) return 1;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

export interface BuiltProfile extends PersonalizationSignals {
  /** 聚合到的事件数（诊断用） */
  eventCount: number;
}

export function buildProfile(events: BehaviorEvent[], opts: BuildProfileOptions = {}): BuiltProfile {
  const now = opts.now ?? Date.now();
  const halfLife = opts.halfLifeDays ?? DEFAULT_PROFILE_OPTIONS.halfLifeDays;
  const maxVisited = opts.maxVisited ?? DEFAULT_PROFILE_OPTIONS.maxVisited;
  const topCatN = opts.topCategories ?? DEFAULT_PROFILE_OPTIONS.topCategories;
  const topTagN = opts.topTags ?? DEFAULT_PROFILE_OPTIONS.topTags;
  const favWeight = opts.favoriteWeight ?? DEFAULT_PROFILE_OPTIONS.favoriteWeight;

  const catScore = new Map<string, number>();
  const tagScore = new Map<string, number>();
  const visited: string[] = [];
  const seen = new Set<string>();

  for (const e of events) {
    if (!e.siteId) continue;
    const ageDays = Math.max(0, (now - e.createdAt) / 86_400_000);
    const w = decay(ageDays, halfLife) * (e.kind === "favorite" ? favWeight : 1);

    if (e.categoryId) catScore.set(e.categoryId, (catScore.get(e.categoryId) ?? 0) + w);
    for (const t of e.tags ?? []) {
      if (!t) continue;
      tagScore.set(t, (tagScore.get(t) ?? 0) + w);
    }
    if (!seen.has(e.siteId)) {
      seen.add(e.siteId);
      visited.push(e.siteId);
    }
  }

  const topOf = (map: Map<string, number>, n: number): string[] =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, n)
      .map(([k]) => k);

  return {
    topCategories: topOf(catScore, topCatN),
    topTags: topOf(tagScore, topTagN),
    visitedSiteIds: visited.slice(0, maxVisited),
    eventCount: events.length,
  };
}
