/**
 * 离线壳快照组合（Batch 3 第 8 项 P0 · B2/B3）的纯函数与失败语义。
 *
 * 锁：
 *   - 白名单/黑名单：哪些路由进离线壳（/search、/me/* 子页、/api/* 不进）
 *   - 候选排序：最近访问按 visitedAt、续播按 lastWatchedAt、稍后再看按 downloadedAt
 *   - 淘汰：稍后再看超 50 条时丢最旧；最近访问复用已有的 50 截断
 *   - 上限：各分区 10 条、最近访问 50 条、稍后再看 50 条
 *   - 收藏 corrupt 时返回空 + 标 corrupt（绝不把坏数据当空收藏）
 *   - 一键清空的顺序与失败语义：某步失败不阻断后续，但结果不许谎报成功
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, afterEach } from "vitest";

import {
  OFFLINE_SHELL_CACHE,
  OFFLINE_SHELL_ROUTES,
  OFFLINE_SNAPSHOT_SECTION_LIMIT,
  WATCH_LATER_LIMIT,
  clearOfflineShellData,
  isShellRoute,
  readLocalFavorites,
  readOfflineSnapshot,
  sortRecentVisits,
  sortResumeByRecency,
  trimWatchLater,
} from "../src/lib/offline-shell";
import { OFFLINE_RECENT_LIMIT, type RecentVisit } from "../src/lib/offline-recent";
import type { PlaybackHistoryItem } from "../src/lib/video-playback-storage";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(hit, "utf8");
}

const visit = (id: string, visitedAt: number): RecentVisit => ({
  id,
  title: `站点 ${id}`,
  href: `https://example.com/${id}`,
  visitedAt,
});

const saved = (id: string, downloadedAt: number) => ({ id, downloadedAt });

const resumeItem = (videoId: string, lastWatchedAt: number, progressPercent = 42): PlaybackHistoryItem => ({
  videoId,
  title: `视频 ${videoId}`,
  author: "讲师",
  platform: "bilibili",
  timestampSec: 100,
  durationSec: 200,
  lastWatchedAt,
  progressPercent,
});

describe("isShellRoute：离线壳白名单/黑名单", () => {
  it("SHELL 的 9 条 HTML 路由都在白名单内", () => {
    expect(OFFLINE_SHELL_ROUTES).toHaveLength(9);
    for (const route of ["/", "/offline", "/favorites", "/me", "/algorithms", "/videos", "/scenes", "/hot", "/tags"]) {
      expect(isShellRoute(route)).toBe(true);
    }
  });

  it("/search 不进壳：无本地数据会给用户「能搜」的错觉", () => {
    expect(isShellRoute("/search")).toBe(false);
  });

  it("/me/* 子页不进壳，只留 /me", () => {
    expect(isShellRoute("/me/history")).toBe(false);
    expect(isShellRoute("/me/data")).toBe(false);
    expect(isShellRoute("/me")).toBe(true);
  });

  it("动态路由与接口不进壳", () => {
    expect(isShellRoute("/tags/xxx")).toBe(false);
    expect(isShellRoute("/videos/player")).toBe(false);
    expect(isShellRoute("/api/search")).toBe(false);
    expect(isShellRoute("/pub/abc")).toBe(false);
  });

  it("末尾斜杠归一", () => {
    expect(isShellRoute("/favorites/")).toBe(true);
  });
});

describe("sortRecentVisits：最近访问候选排序与上限", () => {
  it("按 visitedAt 新→旧排序", () => {
    const sorted = sortRecentVisits([visit("a", 1), visit("b", 3), visit("c", 2)]);
    expect(sorted.map((v) => v.id)).toEqual(["b", "c", "a"]);
  });

  it("50 条上限：超了丢最旧（与已有的 OFFLINE_RECENT_LIMIT 对齐）", () => {
    expect(OFFLINE_RECENT_LIMIT).toBe(50);
    const list = Array.from({ length: 55 }, (_, i) => visit(`v${i}`, i + 1));
    const sorted = sortRecentVisits(list);
    expect(sorted).toHaveLength(50);
    expect(sorted[0].id).toBe("v54");
    expect(sorted[49].id).toBe("v5");
  });

  it("不改动输入数组", () => {
    const list = [visit("a", 1), visit("b", 2)];
    sortRecentVisits(list);
    expect(list.map((v) => v.id)).toEqual(["a", "b"]);
  });
});

describe("trimWatchLater：稍后再看淘汰", () => {
  it("按 downloadedAt 新→旧排序", () => {
    const trimmed = trimWatchLater([saved("a", 1), saved("b", 3), saved("c", 2)]);
    expect(trimmed.map((v) => v.id)).toEqual(["b", "c", "a"]);
  });

  it("上限 50：超了丢最旧，不是最新", () => {
    expect(WATCH_LATER_LIMIT).toBe(50);
    const list = Array.from({ length: 55 }, (_, i) => saved(`s${i}`, i + 1));
    const trimmed = trimWatchLater(list);
    expect(trimmed).toHaveLength(50);
    expect(trimmed[0].id).toBe("s54");
    expect(trimmed[49].id).toBe("s5");
  });

  it("limit 参数钉死小上限", () => {
    const trimmed = trimWatchLater([saved("a", 1), saved("b", 2), saved("c", 3)], 2);
    expect(trimmed.map((v) => v.id)).toEqual(["c", "b"]);
  });
});

describe("sortResumeByRecency：续播候选排序", () => {
  it("按 lastWatchedAt 新→旧排序，默认取前 10", () => {
    expect(OFFLINE_SNAPSHOT_SECTION_LIMIT).toBe(10);
    const list = Array.from({ length: 12 }, (_, i) => resumeItem(`v${i}`, i + 1));
    const sorted = sortResumeByRecency(list);
    expect(sorted).toHaveLength(10);
    expect(sorted[0].videoId).toBe("v11");
  });
});

describe("readLocalFavorites：收藏 corrupt 语义", () => {
  const g = globalThis as unknown as Record<string, unknown>;
  const prevLocalStorage = g.localStorage;

  afterEach(() => {
    if (prevLocalStorage === undefined) delete g.localStorage;
    else g.localStorage = prevLocalStorage;
  });

  it("没有数据时是空收藏、不是损坏", () => {
    g.localStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
    expect(readLocalFavorites()).toEqual({ items: [], corrupt: false });
  });

  it("坏 JSON 时返回空 + corrupt: true（绝不把坏数据当空收藏）", () => {
    g.localStorage = { getItem: () => "{坏数据", setItem: () => undefined, removeItem: () => undefined };
    expect(readLocalFavorites()).toEqual({ items: [], corrupt: true });
  });

  it("结构不是数组时 corrupt: true", () => {
    g.localStorage = { getItem: () => '{"a":1}', setItem: () => undefined, removeItem: () => undefined };
    expect(readLocalFavorites()).toEqual({ items: [], corrupt: true });
  });

  it("正常数组读出条目", () => {
    const raw = JSON.stringify([{ siteId: "s1", title: "站", href: "https://example.com", createdAt: 1 }]);
    g.localStorage = { getItem: () => raw, setItem: () => undefined, removeItem: () => undefined };
    const res = readLocalFavorites();
    expect(res.corrupt).toBe(false);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].title).toBe("站");
  });
});

describe("readOfflineSnapshot：组合读不拖垮整份快照", () => {
  it("Node 环境下四库皆空也不 reject", async () => {
    const snap = await readOfflineSnapshot();
    expect(snap.recent).toEqual([]);
    expect(snap.favorites).toEqual({ items: [], corrupt: false });
    expect(snap.offlineVideos).toEqual([]);
    expect(snap.resume).toEqual([]);
  });
});

describe("clearOfflineShellData：一键清空的顺序与失败语义", () => {
  it("全部成功时 ok 为 true，且按 视频缓存 → 最近访问 → SHELL 缓存 → 重注册 的顺序执行", async () => {
    const order: string[] = [];
    const res = await clearOfflineShellData({
      clearVideoCache: async () => { order.push("video"); },
      clearVisits: async () => { order.push("visits"); },
      deleteShellCache: async (name) => { order.push("shell"); expect(name).toBe(OFFLINE_SHELL_CACHE); return true; },
      reregisterServiceWorker: async () => { order.push("reregister"); },
    });
    expect(order).toEqual(["video", "visits", "shell", "reregister"]);
    expect(res.ok).toBe(true);
  });

  it("清视频缓存失败不阻断后续步骤，但 ok 为 false、不许谎报成功", async () => {
    const called: string[] = [];
    const res = await clearOfflineShellData({
      clearVideoCache: async () => { throw new Error("IDB 挂了"); },
      clearVisits: async () => { called.push("visits"); },
      deleteShellCache: async () => { called.push("shell"); return true; },
      reregisterServiceWorker: async () => { called.push("reregister"); },
    });
    expect(called).toEqual(["visits", "shell", "reregister"]);
    expect(res.ok).toBe(false);
    expect(res.videoCache.ok).toBe(false);
    expect(res.videoCache.error).toContain("IDB 挂了");
    expect(res.visits.ok).toBe(true);
  });

  it("caches.delete 抛错时 shellCache 失败、重注册仍执行", async () => {
    const called: string[] = [];
    const res = await clearOfflineShellData({
      clearVideoCache: async () => undefined,
      clearVisits: async () => undefined,
      deleteShellCache: async () => { throw new Error("CacheStorage 拒绝"); },
      reregisterServiceWorker: async () => { called.push("reregister"); },
    });
    expect(called).toEqual(["reregister"]);
    expect(res.ok).toBe(false);
    expect(res.shellCache.ok).toBe(false);
  });

  it("caches.delete 返回 false（缓存本来就不存在）不算失败：三处已是空", async () => {
    const res = await clearOfflineShellData({
      clearVideoCache: async () => undefined,
      clearVisits: async () => undefined,
      deleteShellCache: async () => false,
      reregisterServiceWorker: async () => undefined,
    });
    expect(res.shellCache.ok).toBe(true);
    expect(res.ok).toBe(true);
  });

  it("重注册失败时 ok 为 false", async () => {
    const res = await clearOfflineShellData({
      clearVideoCache: async () => undefined,
      clearVisits: async () => undefined,
      deleteShellCache: async () => true,
      reregisterServiceWorker: async () => { throw new Error("SW 注册被拒"); },
    });
    expect(res.ok).toBe(false);
    expect(res.reregistered.ok).toBe(false);
  });
});

describe("接线守卫：页面与管理面确实用了离线壳", () => {
  it("/offline 页挂载快照分区（收藏 + 稍后再看 / 续播）", () => {
    const page = overlaySource("src/app/offline/page.tsx");
    expect(page).toContain("OfflineContent");
    // P2：页直挂客户端容器 OfflineContent，容器内再挂两个分区 + 标题过滤框
    const content = overlaySource("src/components/offline-content.tsx");
    expect(content).toContain("OfflineSnapshotSections");
    expect(content).toContain("OfflineRecentList");
    expect(content).toContain("仅搜本机内容");
    const sections = overlaySource("src/components/offline-snapshot-sections.tsx");
    expect(sections).toContain("收藏（本机）");
    expect(sections).toContain("稍后再看 / 续播");
    expect(sections).toContain("联网后打开");
    expect(sections).toContain("describeOfflineBanner");
    expect(sections).not.toContain("已下载");
    expect(sections).not.toContain("离线可播");
  });

  it("/me/data 的「离线壳」行接一键清空，失败时不谎报成功", () => {
    const src = overlaySource("src/components/user-center/local-data-manager.tsx");
    expect(src).toContain("离线壳");
    expect(src).toContain("清空离线数据");
    expect(src).toContain("clearOfflineShellData()");
    expect(src).toContain("countShellCacheEntries()");
    expect(src).toContain("离线数据未完全清空");
  });
});
