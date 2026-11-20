/**
 * 导航快照分片派生（U-36，主方案 A + 配套 C）：
 *  1. 纯函数 deriveNavigationShards 对 4,850 站量级合成文档（复刻电脑实库分布：
 *     20 个一级分类、最大 340 站）：分片数/体积/拼装等值/瘦身字段；
 *  2. R7 证红：整包单片（现状）超 750KB 红线；超大分类（2,000 站）必须切子片，
 *     每片仍在红线内；
 *  3. 瘦身投影 C：分片只带渲染字段（id/title/href/description/icon/enabled/
 *     status/tags/hubId/health + videoConfig/useDefaultIcon 透传），重字段
 *     （weight/trendScore/actions/relations/liveMetrics/workspaces）不在分片里；
 *     拼装树在渲染字段上与整包逐字等值（processNavigationSubItem 本就丢掉重字段，
 *     故 getProcessedData 输出不变）；
 *  4. 写路径挂钩：writeNavigationData 提交后分片与源文档同版本；再写一版分片跟随；
 *  5. 派生失败不连带写失败（畸形文档抛错由写路径 catch）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { readStoragePath, readStorageVersion, writeNavigationData } from "../src/storage.ts";
import {
  deriveNavigationShards,
  NAVIGATION_INDEX_PATH,
  NAVIGATION_SHARD_SIZE_LIMIT_BYTES,
  navigationShardPath,
  navigationShardPagePath,
} from "../src/navigation-shards.ts";

/** 电脑实库 2026-11-18 实测分布：20 个一级分类，最大 340 站，合计 4,850 站 */
const REAL_DISTRIBUTION: Array<{ id: string; sites: number; subs: number }> = [
  { id: "reg-ai-tools", sites: 340, subs: 18 },
  { id: "reg-consumer-life", sites: 340, subs: 15 },
  { id: "reg-learning-growth", sites: 319, subs: 16 },
  { id: "reg-office-productivity", sites: 315, subs: 13 },
  { id: "reg-content-creation", sites: 311, subs: 14 },
  { id: "reg-public-services", sites: 309, subs: 13 },
  { id: "reg-finance-and-investing", sites: 306, subs: 14 },
  { id: "reg-entertainment", sites: 297, subs: 15 },
  { id: "reg-frontend-development", sites: 293, subs: 14 },
  { id: "reg-jobs-and-career", sites: 288, subs: 14 },
  { id: "reg-backend-and-cloud", sites: 268, subs: 12 },
  { id: "reg-news-and-media", sites: 249, subs: 12 },
  { id: "reg-design-and-creative", sites: 244, subs: 11 },
  { id: "reg-developer-resources", sites: 241, subs: 10 },
  { id: "reg-gaming-and-esports", sites: 240, subs: 11 },
  { id: "reg-devops-and-security", sites: 204, subs: 9 },
  { id: "reg-academic-research", sites: 148, subs: 7 },
  { id: "reg-data-and-analytics", sites: 126, subs: 6 },
  { id: "reg-short-drama", sites: 12, subs: 2 },
  { id: "cat-uncategorized", sites: 0, subs: 0 },
];

/** 合成一个带重字段的站点（序列化约 650–700B，与实库 679 B/站同量级） */
function syntheticSite(catId: string, i: number): Record<string, unknown> {
  return {
    id: `${catId}-site-${i}`,
    title: `测试站点 ${catId} ${i} 号`,
    href: `https://example-${catId}-${i}.com/`,
    description: `这是一个用于分片派生测试的站点描述，长度与真实收录条目相近，约四十个汉字。${i}`,
    icon: `https://example-${catId}-${i}.com/favicon.ico`,
    enabled: true,
    status: "active",
    // 03 §2.3：hubId 必须随瘦身投影进分片（W2b：白名单漏了即静默丢字段）
    hubId: `${catId}-site-${i}`,
    weight: 100 + (i % 50),
    trendScore: 5 + (i % 10),
    tags: ["测试", "分片"],
    actions: [{ label: "打开", url: `https://example-${catId}-${i}.com/open` }],
    relations: [{ targetTitle: `关联站点 ${i}`, targetUrl: `https://example-${catId}-${i}.com/rel` }],
    liveMetrics: { openSource: i % 3 === 0, githubStars: 1000 + i },
    workspaces: ["workspace-a"],
    health: { ok: true, latencyMs: 120, httpStatus: 200, lastCheckedAt: 1700000000000 },
  };
}

/** 按真实分布合成整包 public 文档（4,850 站） */
function syntheticPublicDoc(): { navigationItems: Array<Record<string, unknown>>; replacementHistory: unknown[] } {
  const navigationItems = REAL_DISTRIBUTION.map((cat) => {
    const perSub = cat.subs > 0 ? Math.floor(cat.sites / cat.subs) : 0;
    const topCount = cat.sites - perSub * cat.subs;
    const items = Array.from({ length: topCount }, (_, i) => syntheticSite(cat.id, i));
    const subCategories = Array.from({ length: cat.subs }, (_, s) => ({
      id: `${cat.id}-sub-${s}`,
      title: `子分类 ${s}`,
      parentId: cat.id,
      enabled: true,
      items: Array.from({ length: perSub }, (_, i) => syntheticSite(`${cat.id}-sub-${s}`, i)),
    }));
    return { id: cat.id, title: cat.id, enabled: true, items, subCategories };
  });
  return { navigationItems, replacementHistory: [] };
}

function countItems(doc: { navigationItems: Array<Record<string, unknown>> }): number {
  let n = 0;
  for (const cat of doc.navigationItems) {
    n += (cat.items as unknown[])?.length ?? 0;
    for (const sub of (cat.subCategories as Array<Record<string, unknown>>) ?? []) {
      n += (sub.items as unknown[])?.length ?? 0;
    }
  }
  return n;
}

/** 渲染字段白名单（与 data-loader.ts 的 processNavigationSubItem 逐字一致，含 03 的 hubId） */
const RENDER_FIELDS = ["id", "title", "href", "description", "icon", "useDefaultIcon", "enabled", "status", "tags", "hubId", "health", "videoConfig"] as const;

function renderProjection(item: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of RENDER_FIELDS) {
    if (item[f] !== undefined) out[f] = item[f];
  }
  return out;
}

function allRenderProjections(doc: { navigationItems: Array<Record<string, unknown>> }): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const cat of doc.navigationItems) {
    for (const item of (cat.items as Array<Record<string, unknown>>) ?? []) out.push(renderProjection(item));
    for (const sub of (cat.subCategories as Array<Record<string, unknown>>) ?? []) {
      for (const item of (sub.items as Array<Record<string, unknown>>) ?? []) out.push(renderProjection(item));
    }
  }
  return out;
}

describe("deriveNavigationShards（4,850 站合成文档，复刻实库）", () => {
  const doc = syntheticPublicDoc();
  const derived = deriveNavigationShards(doc, 4242);
  const byPath = new Map(derived.writes.map((w) => [w.path, w.data]));

  it("产物集合 = 每分类至少一片 + index，且 index 最后落库（提交标记）", () => {
    // 20 个一级分类，每分类 ≥1 片；index 必须是最后一笔写
    expect(derived.writes[derived.writes.length - 1].path).toBe(NAVIGATION_INDEX_PATH);
    expect(derived.totalItems).toBe(4850);
    expect(derived.totalItems).toBe(countItems(doc));
    const index = byPath.get(NAVIGATION_INDEX_PATH) as { categories: Array<{ id: string }> };
    expect(index.categories).toHaveLength(20);
  });

  it("每片体积在红线内（字符数与字节双口径），index 远离 Data Cache 上限", () => {
    for (const w of derived.writes) {
      const chars = JSON.stringify(w.data).length;
      const bytes = Buffer.byteLength(JSON.stringify(w.data), "utf8");
      if (w.path.includes("navigation-cat-")) {
        expect(chars, w.path).toBeLessThan(NAVIGATION_SHARD_SIZE_LIMIT_BYTES);
        expect(bytes, w.path).toBeLessThan(NAVIGATION_SHARD_SIZE_LIMIT_BYTES);
      }
    }
    expect(JSON.stringify(byPath.get(NAVIGATION_INDEX_PATH)).length).toBeLessThan(200_000);
  });

  it("拼装树在渲染字段上与整包逐字等值（瘦身只丢重字段）", () => {
    const index = byPath.get(NAVIGATION_INDEX_PATH) as {
      categories: Array<{ id: string; shardPaths: string[] }>;
      replacementHistory: unknown[];
    };
    // 按 index 的 shardPaths 顺序拼回各分类
    const assembledItems: Array<Record<string, unknown>> = [];
    for (const entry of index.categories) {
      for (const shardPath of entry.shardPaths) {
        const shard = byPath.get(shardPath) as { category: Record<string, unknown> };
        const cat = shard.category;
        for (const item of (cat.items as Array<Record<string, unknown>>) ?? []) assembledItems.push(item);
        for (const sub of (cat.subCategories as Array<Record<string, unknown>>) ?? []) {
          for (const item of (sub.items as Array<Record<string, unknown>>) ?? []) assembledItems.push(item);
        }
      }
    }
    expect(assembledItems).toHaveLength(4850);
    expect(assembledItems).toEqual(allRenderProjections(doc));
    expect(index.replacementHistory).toEqual([]);
  });

  it("分片里不含重字段（瘦身投影 C）", () => {
    const heavy = ["weight", "trendScore", "actions", "relations", "liveMetrics", "workspaces"];
    for (const w of derived.writes) {
      if (!w.path.includes("navigation-cat-")) continue;
      const text = JSON.stringify(w.data);
      for (const f of heavy) {
        expect(text, `${w.path} 不应含 ${f}`).not.toContain(`"${f}":`);
      }
    }
  });

  it("全部产物带同一 sourceVersion", () => {
    for (const w of derived.writes) {
      expect((w.data as { sourceVersion: number }).sourceVersion).toBe(4242);
    }
  });
});

describe("deriveNavigationShards（R7：红线证伪与超大分类切子片）", () => {
  it("现状整包单片超红线：4,850 站合成文档序列化远超 750KB（真实旧错）", () => {
    const doc = syntheticPublicDoc();
    // 电脑实库实测：public 快照 2,087,826 字符，离 2MB 上限只剩 9,326 字符；
    // 整包当一片时超 750KB 红线 2.8 倍——分片不是优化，是必须。
    expect(JSON.stringify(doc).length).toBeGreaterThan(NAVIGATION_SHARD_SIZE_LIMIT_BYTES);
    expect(JSON.stringify(doc).length).toBeGreaterThan(2_000_000);
  });

  it("超大分类（2,000 站）切子片：每片仍在红线内，拼装后条数与顺序不变", () => {
    const items = Array.from({ length: 2000 }, (_, i) => syntheticSite("reg-huge", i));
    const doc = {
      navigationItems: [{ id: "reg-huge", title: "超大分类", enabled: true, items, subCategories: [] }],
      replacementHistory: [],
    };
    const derived = deriveNavigationShards(doc, 7);
    const shards = derived.writes.filter((w) => w.path.includes("navigation-cat-"));
    expect(shards.length).toBeGreaterThan(1);
    for (const w of shards) {
      expect(JSON.stringify(w.data).length, w.path).toBeLessThan(NAVIGATION_SHARD_SIZE_LIMIT_BYTES);
      expect(Buffer.byteLength(JSON.stringify(w.data), "utf8"), w.path).toBeLessThan(NAVIGATION_SHARD_SIZE_LIMIT_BYTES);
    }
    const index = derived.writes.find((w) => w.path === NAVIGATION_INDEX_PATH)?.data as {
      categories: Array<{ id: string; shardPaths: string[]; itemCount: number }>;
    };
    expect(index.categories[0].itemCount).toBe(2000);
    expect(index.categories[0].shardPaths).toHaveLength(shards.length);
    // 子片路径用 -p<页> 后缀，页号从 1 起连续
    expect(index.categories[0].shardPaths[0]).toBe(navigationShardPagePath("reg-huge", 1));
    // 拼装后条数与顺序不变
    const byPath = new Map(derived.writes.map((w) => [w.path, w.data]));
    const assembled: Array<Record<string, unknown>> = [];
    for (const p of index.categories[0].shardPaths) {
      const shard = byPath.get(p) as { category: Record<string, unknown> };
      for (const item of (shard.category.items as Array<Record<string, unknown>>) ?? []) assembled.push(item);
    }
    expect(assembled).toHaveLength(2000);
    expect(assembled.map((i) => i.id)).toEqual(items.map((i) => i.id));
  });

  it("单分类恰好在红线内时不切子片（用基础路径，不带 -p 后缀）", () => {
    const doc = syntheticPublicDoc();
    const derived = deriveNavigationShards(doc, 1);
    const index = derived.writes.find((w) => w.path === NAVIGATION_INDEX_PATH)?.data as {
      categories: Array<{ id: string; shardPaths: string[] }>;
    };
    // 实库最大分类 340 站，单片远未到红线，全部走基础路径
    for (const entry of index.categories) {
      expect(entry.shardPaths).toHaveLength(1);
      expect(entry.shardPaths[0]).toBe(navigationShardPath(entry.id));
    }
  });

  it("源文档形状不对时抛错（由写路径 catch，不连带写失败）", () => {
    expect(() => deriveNavigationShards({ navigationItems: "bogus" }, 1)).toThrow();
    expect(() => deriveNavigationShards(null, 1)).toThrow();
    expect(() => deriveNavigationShards({ navigationItems: [{ title: "无 id 分类" }] }, 1)).toThrow();
  });
});

describe("writeNavigationData 分片挂钩", () => {
  const dir = mkdtempSync(join(tmpdir(), "navhub-navigation-shards-"));
  let ctx: AppContext;

  const docV1 = {
    navigationItems: [
      {
        id: "cat-x",
        title: "分类X",
        items: [{ id: "n-1", title: "标题一", href: "https://example.com/1", enabled: true }],
        subCategories: [
          { id: "sub-x", title: "子分类", parentId: "cat-x", enabled: true, items: [{ id: "n-2", title: "标题二", href: "https://example.com/2", enabled: true }] },
        ],
      },
    ],
    replacementHistory: [],
  };

  beforeAll(async () => {
    ctx = await createContext(
      loadConfig({
        mode: "lite" as const,
        embedding: { model: "m", endpoint: "https://hf-mirror.com", dtype: "q8" as const, cacheDir: join(dir, "models"), dim: 512, enabled: false },
        sqlitePath: join(dir, "shards.db"),
        corsOrigins: ["*"],
      }),
    );
  });

  afterAll(async () => {
    await ctx?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("写导航后分片齐备且与源文档同版本", async () => {
    await writeNavigationData(ctx, docV1 as never);
    const version = await ctx.repo.readNavDataVersion();
    expect(version).not.toBeNull();

    const index = (await readStoragePath(ctx, NAVIGATION_INDEX_PATH)) as {
      sourceVersion: number;
      totalItems: number;
      categories: Array<{ id: string; shardPaths: string[]; itemCount: number }>;
    };
    expect(index.sourceVersion).toBe(version);
    expect(index.totalItems).toBe(2);
    expect(index.categories).toHaveLength(1);
    expect(index.categories[0].id).toBe("cat-x");
    expect(index.categories[0].itemCount).toBe(2);

    const shard = (await readStoragePath(ctx, navigationShardPath("cat-x"))) as {
      sourceVersion: number;
      category: { title: string; items: Array<{ id: string }>; subCategories: Array<{ id: string }> };
    };
    expect(shard.sourceVersion).toBe(version);
    expect(shard.category.title).toBe("分类X");
    expect(shard.category.items.map((i) => i.id)).toEqual(["n-1"]);
    expect(shard.category.subCategories.map((s) => s.id)).toEqual(["sub-x"]);
  });

  it("再写一版：分片跟随新版本与新内容", async () => {
    const v1 = await ctx.repo.readNavDataVersion();
    const docV2 = structuredClone(docV1);
    docV2.navigationItems[0].items[0].title = "标题一·改";
    await writeNavigationData(ctx, docV2 as never);
    const v2 = await ctx.repo.readNavDataVersion();
    expect(v2).not.toBe(v1);

    const shard = (await readStoragePath(ctx, navigationShardPath("cat-x"))) as {
      sourceVersion: number;
      category: { items: Array<{ title: string }> };
    };
    expect(shard.sourceVersion).toBe(v2);
    expect(shard.category.items[0].title).toBe("标题一·改");
  });

  it("分片只含公开可见站点（停用站不进分片）", async () => {
    const docV3 = structuredClone(docV1);
    docV3.navigationItems[0].items.push({ id: "n-3", title: "停用站", href: "https://example.com/3", enabled: false });
    await writeNavigationData(ctx, docV3 as never);
    const index = (await readStoragePath(ctx, NAVIGATION_INDEX_PATH)) as { totalItems: number };
    // 公开分片只数可见站：n-1、n-2 在，停用的 n-3 不在
    expect(index.totalItems).toBe(2);
  });
});
