/**
 * 导航目录分片读路径（U-36，主方案 A + 配套 C 的 web 侧）：
 * 起一个真实 node:http 假中枢，按路径供数并记录请求，验证：
 *   1. 分片齐备且版本一致 → 走分片拼装，绝不请求整包 navigation.json；
 *   2. 版本撕裂 / 分片缺失 / 条数对不上 / 索引缺失 → 一律回落整包读，
 *      且回落结果带 degraded 标记；
 *   3. NAVHUB_NAVIGATION_READ_MODE=doc → 直走整包（回滚位）；脏值 → 回 doc；
 *   4. 拼装树与整包树经 getProcessedData 后逐字等值（瘦身只丢重字段，
 *      渲染输出不变——完成检查 4 的核心断言）；
 *   5. 超大分类切子片（-p<页>）时多页合并正确（条目拼接、子分类按 id 归并）；
 *   6. 单个分类按需读：只读该分类的片，不碰整包与其他分类；
 *   7. 路径常量钉子（与中枢 navigation-shards.ts 必须逐字一致）。
 */
import { describe, expect, it, vi, beforeEach, afterAll, beforeAll } from "vitest";
import { createServer, type Server } from "node:http";
import { invalidateContentCache } from "@/lib/github";
import {
  getLastNavigationShardFallback,
  loadNavigationCatalog,
  loadNavigationCategoryById,
  navigationReadMode,
} from "@/lib/navigation-catalog-read";
import {
  NAVIGATION_DOC_PATH,
  NAVIGATION_INDEX_PATH,
  navigationShardPath,
  navigationShardPagePath,
} from "@/lib/navigation-catalog-paths";
import { getProcessedData } from "@/lib/data-loader";

vi.mock("@/lib/auth", () => ({
  auth: () => Promise.resolve(null),
}));

/* ---------------- 假中枢 ---------------- */

const store = new Map<string, unknown>();
const seenPaths: string[] = [];

const server: Server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/api/storage") {
    res.writeHead(404).end();
    return;
  }
  const path = url.searchParams.get("path") ?? "";
  seenPaths.push(path);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(store.has(path) ? JSON.stringify(store.get(path)) : "null");
});

/* ---------------- 夹具 ---------------- */

const VERSION = 777;

/** 整包版分类（含重字段——瘦身要裁掉的正是这些） */
function wholeCatA() {
  return {
    id: "cat-a",
    title: "整包版·分类A",
    enabled: true,
    items: [
      {
        id: "n-a1", title: "甲一", href: "https://a1.example.com", description: "甲一描述",
        icon: "https://a1.example.com/favicon.ico", enabled: true, status: "active",
        weight: 10, trendScore: 9, tags: ["测试"],
        actions: [{ label: "打开", url: "https://a1.example.com/open" }],
        relations: [{ targetTitle: "乙", targetUrl: "https://b.example.com" }],
        liveMetrics: { openSource: true, githubStars: 1234 },
        workspaces: ["w1"],
        health: { ok: true, latencyMs: 100, httpStatus: 200 },
      },
      { id: "n-a2", title: "甲二", href: "https://a2.example.com", enabled: true },
    ],
    subCategories: [
      {
        id: "sub-a", title: "子A", parentId: "cat-a", enabled: true,
        items: [{ id: "n-a3", title: "甲三", href: "https://a3.example.com", enabled: true, trendScore: 3 }],
      },
    ],
  };
}
function wholeCatB() {
  return {
    id: "cat-b", title: "整包版·分类B", enabled: true,
    items: [{ id: "n-b1", title: "乙一", href: "https://b1.example.com", enabled: true }],
    subCategories: [],
  };
}

const RENDER_FIELDS = ["id", "title", "href", "description", "icon", "useDefaultIcon", "enabled", "status", "tags", "health", "videoConfig"] as const;
function slimItem(item: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of RENDER_FIELDS) if (item[f] !== undefined) out[f] = item[f];
  return out;
}
function slimCat(cat: Record<string, unknown>): Record<string, unknown> {
  return {
    ...cat,
    items: ((cat.items as Array<Record<string, unknown>>) ?? []).map(slimItem),
    subCategories: ((cat.subCategories as Array<Record<string, unknown>>) ?? []).map((sub) => ({
      ...sub,
      items: ((sub.items as Array<Record<string, unknown>>) ?? []).map(slimItem),
    })),
  };
}

function seedShards(version = VERSION) {
  store.set(NAVIGATION_INDEX_PATH, {
    kind: "navhub-navigation-index",
    sourceVersion: version,
    totalItems: 4,
    replacementHistory: [{ note: "hist" }],
    categories: [
      { id: "cat-a", title: "整包版·分类A", shardPaths: [navigationShardPath("cat-a")], itemCount: 3, subCategories: [{ id: "sub-a", title: "子A", itemCount: 1 }] },
      { id: "cat-b", title: "整包版·分类B", shardPaths: [navigationShardPath("cat-b")], itemCount: 1, subCategories: [] },
    ],
  });
  store.set(navigationShardPath("cat-a"), {
    kind: "navhub-navigation-cat",
    sourceVersion: version,
    categoryId: "cat-a",
    page: 1,
    pageCount: 1,
    category: slimCat(wholeCatA()),
  });
  store.set(navigationShardPath("cat-b"), {
    kind: "navhub-navigation-cat",
    sourceVersion: version,
    categoryId: "cat-b",
    page: 1,
    pageCount: 1,
    category: slimCat(wholeCatB()),
  });
}

function seedWholeDoc() {
  store.set(NAVIGATION_DOC_PATH, {
    navigationItems: [wholeCatA(), wholeCatB()],
    // 与 index 登记的 replacementHistory 一致（派生时原样随 index 走）：
    // 等值断言比较的就是「拼装树 vs 整包树」，两者必须同源
    replacementHistory: [{ note: "hist" }],
  });
}

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  process.env.STORAGE_ADAPTER = "http";
  process.env.NAVHUB_STORAGE_BASE_URL = "http://127.0.0.1:" + port;
});

afterAll(async () => {
  vi.resetModules();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  store.clear();
  seenPaths.length = 0;
  delete process.env.NAVHUB_NAVIGATION_READ_MODE;
  invalidateContentCache();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("loadNavigationCatalog", () => {
  it("分片齐备：拼装等值且不碰整包", async () => {
    seedShards();
    seedWholeDoc();
    const load = await loadNavigationCatalog();
    expect(load.mode).toBe("shard");
    expect(load.degraded).toBe(false);
    expect(load.sourceVersion).toBe(VERSION);
    expect(load.data.navigationItems.map((c) => c.title)).toEqual(["整包版·分类A", "整包版·分类B"]);
    expect(load.data.replacementHistory).toEqual([{ note: "hist" }]);
    expect(seenPaths).not.toContain(NAVIGATION_DOC_PATH);
    expect(seenPaths).toContain(NAVIGATION_INDEX_PATH);
  });

  it("拼装树与整包树经 getProcessedData 后逐字等值（瘦身只丢重字段）", async () => {
    seedShards();
    seedWholeDoc();
    const load = await loadNavigationCatalog();
    expect(load.mode).toBe("shard");
    const whole = store.get(NAVIGATION_DOC_PATH) as never;
    const siteRaw = {} as never;
    const fromShards = getProcessedData(load.data as never, siteRaw);
    const fromWhole = getProcessedData(whole, siteRaw);
    expect(fromShards).toEqual(fromWhole);
    // 拼装出的条目确实不含重字段（瘦身投影 C 落地）
    const first = load.data.navigationItems[0].items?.[0] as unknown as Record<string, unknown>;
    expect(first).not.toHaveProperty("actions");
    expect(first).not.toHaveProperty("relations");
    expect(first).not.toHaveProperty("liveMetrics");
    expect(first).not.toHaveProperty("weight");
    expect(first).not.toHaveProperty("trendScore");
    expect(first).not.toHaveProperty("workspaces");
    expect(first.tags).toEqual(["测试"]);
    expect(first.health).toEqual({ ok: true, latencyMs: 100, httpStatus: 200 });
  });

  it("某片版本与索引不一致（撕裂）→ 回落整包", async () => {
    seedShards();
    seedWholeDoc();
    const shard = store.get(navigationShardPath("cat-b")) as { sourceVersion: number };
    store.set(navigationShardPath("cat-b"), { ...shard, sourceVersion: VERSION - 1 });
    const load = await loadNavigationCatalog();
    expect(load.mode).toBe("doc");
    expect(load.degraded).toBe(true);
    expect(load.data.navigationItems[0].title).toBe("整包版·分类A");
    expect(seenPaths).toContain(NAVIGATION_DOC_PATH);
  });

  it("doc 模式整包可读 → degraded 为 false；中枢无整包（基线替代）→ degraded 为 true", async () => {
    seedWholeDoc();
    vi.stubEnv("NAVHUB_NAVIGATION_READ_MODE", "doc");
    const ok = await loadNavigationCatalog();
    expect(ok.mode).toBe("doc");
    expect(ok.degraded).toBe(false);
    store.clear();
    invalidateContentCache();
    const degraded = await loadNavigationCatalog();
    expect(degraded.mode).toBe("doc");
    expect(degraded.degraded).toBe(true);
  });

  it("某片缺失 → 回落整包", async () => {
    seedShards();
    seedWholeDoc();
    store.delete(navigationShardPath("cat-a"));
    const load = await loadNavigationCatalog();
    expect(load.mode).toBe("doc");
    expect(seenPaths).toContain(NAVIGATION_DOC_PATH);
  });

  it("回落即告警（U-386）：error 级日志 + 最近一次回落记录可查，不再是 info 一句", async () => {
    seedShards();
    seedWholeDoc();
    store.delete(navigationShardPath("cat-a"));
    const load = await loadNavigationCatalog();
    expect(load.mode).toBe("doc");
    expect(load.degraded).toBe(true);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("分片读回落告警"));
    expect(console.info).not.toHaveBeenCalledWith(expect.stringContaining("回落整包读"));
    const last = getLastNavigationShardFallback();
    expect(last).not.toBeNull();
    expect(last?.reason).toContain("cat-a");
    expect(typeof last?.at).toBe("string");
  });

  it("索引缺失（中枢尚未派生）→ 回落整包", async () => {
    seedWholeDoc();
    const load = await loadNavigationCatalog();
    expect(load.mode).toBe("doc");
    expect(load.data.navigationItems[0].title).toBe("整包版·分类A");
  });

  it("条数与索引登记对不上 → 回落整包", async () => {
    seedShards();
    seedWholeDoc();
    const shard = store.get(navigationShardPath("cat-a")) as { category: ReturnType<typeof wholeCatA> };
    store.set(navigationShardPath("cat-a"), {
      ...shard,
      category: { ...shard.category, items: (shard.category.items ?? []).slice(0, 1) },
    });
    const load = await loadNavigationCatalog();
    expect(load.mode).toBe("doc");
  });

  it("NAVHUB_NAVIGATION_READ_MODE=doc → 直走整包，不读分片", async () => {
    seedShards();
    seedWholeDoc();
    process.env.NAVHUB_NAVIGATION_READ_MODE = "doc";
    const load = await loadNavigationCatalog();
    expect(load.mode).toBe("doc");
    expect(seenPaths).toEqual([NAVIGATION_DOC_PATH]);
  });

  it("超大分类切子片：多页合并后条数、顺序与子分类归并都正确", async () => {
    // 分类 cat-huge：顶级 2 条 + 子分类 sub-h 分 2 页（每页 1 条），共 4 条
    const page1Cat = {
      id: "cat-huge", title: "超大分类", enabled: true,
      items: [{ id: "h-1", title: "大一", href: "https://h1.example.com", enabled: true }],
      subCategories: [{ id: "sub-h", title: "子H", parentId: "cat-huge", enabled: true, items: [{ id: "h-3", title: "大三", href: "https://h3.example.com", enabled: true }] }],
    };
    const page2Cat = {
      id: "cat-huge", title: "超大分类", enabled: true,
      items: [{ id: "h-2", title: "大二", href: "https://h2.example.com", enabled: true }],
      subCategories: [{ id: "sub-h", title: "子H", parentId: "cat-huge", enabled: true, items: [{ id: "h-4", title: "大四", href: "https://h4.example.com", enabled: true }] }],
    };
    store.set(NAVIGATION_INDEX_PATH, {
      kind: "navhub-navigation-index",
      sourceVersion: VERSION,
      totalItems: 4,
      replacementHistory: [],
      categories: [
        { id: "cat-huge", title: "超大分类", shardPaths: [navigationShardPagePath("cat-huge", 1), navigationShardPagePath("cat-huge", 2)], itemCount: 4, subCategories: [{ id: "sub-h", title: "子H", itemCount: 2 }] },
      ],
    });
    store.set(navigationShardPagePath("cat-huge", 1), {
      kind: "navhub-navigation-cat", sourceVersion: VERSION, categoryId: "cat-huge", page: 1, pageCount: 2, category: page1Cat,
    });
    store.set(navigationShardPagePath("cat-huge", 2), {
      kind: "navhub-navigation-cat", sourceVersion: VERSION, categoryId: "cat-huge", page: 2, pageCount: 2, category: page2Cat,
    });
    const load = await loadNavigationCatalog();
    expect(load.mode).toBe("shard");
    expect(load.degraded).toBe(false);
    const cat = load.data.navigationItems[0];
    expect(cat.items?.map((i) => i.id)).toEqual(["h-1", "h-2"]);
    expect(cat.subCategories).toHaveLength(1);
    expect(cat.subCategories?.[0].items?.map((i) => i.id)).toEqual(["h-3", "h-4"]);
    expect(seenPaths).not.toContain(NAVIGATION_DOC_PATH);
  });
});

describe("navigationReadMode", () => {
  it("未设置/shard → shard；doc → doc；脏值 → doc", () => {
    expect(navigationReadMode({})).toBe("shard");
    expect(navigationReadMode({ NAVHUB_NAVIGATION_READ_MODE: "shard" })).toBe("shard");
    expect(navigationReadMode({ NAVHUB_NAVIGATION_READ_MODE: "doc" })).toBe("doc");
    expect(navigationReadMode({ NAVHUB_NAVIGATION_READ_MODE: "bogus" })).toBe("doc");
  });
});

describe("loadNavigationCategoryById", () => {
  it("按 id 命中：只读索引+目标分片，不碰整包与其他分类", async () => {
    seedShards();
    const hit = await loadNavigationCategoryById("cat-b");
    expect(hit?.category.id).toBe("cat-b");
    expect(hit?.sourceVersion).toBe(VERSION);
    expect(seenPaths).toContain(NAVIGATION_INDEX_PATH);
    expect(seenPaths).toContain(navigationShardPath("cat-b"));
    expect(seenPaths).not.toContain(navigationShardPath("cat-a"));
    expect(seenPaths).not.toContain(NAVIGATION_DOC_PATH);
  });

  it("未知分类 → null（由调用方全量读裁定）", async () => {
    seedShards();
    expect(await loadNavigationCategoryById("no-such-cat")).toBeNull();
  });

  it("目标分片版本撕裂 → null", async () => {
    seedShards();
    const shard = store.get(navigationShardPath("cat-a")) as { sourceVersion: number };
    store.set(navigationShardPath("cat-a"), { ...shard, sourceVersion: VERSION + 1 });
    expect(await loadNavigationCategoryById("cat-a")).toBeNull();
  });

  it("doc 模式 → null", async () => {
    seedShards();
    process.env.NAVHUB_NAVIGATION_READ_MODE = "doc";
    expect(await loadNavigationCategoryById("cat-a")).toBeNull();
  });
});

describe("路径常量钉子（与中枢 navigation-shards.ts 必须逐字一致）", () => {
  it("常量值", () => {
    expect(NAVIGATION_DOC_PATH).toBe("src/navsphere/content/navigation.json");
    expect(NAVIGATION_INDEX_PATH).toBe("src/navsphere/content/navigation-index.json");
    expect(navigationShardPath("reg-ai-tools")).toBe(
      "src/navsphere/content/navigation-cat-reg-ai-tools.json",
    );
    expect(navigationShardPagePath("reg-ai-tools", 2)).toBe(
      "src/navsphere/content/navigation-cat-reg-ai-tools-p2.json",
    );
  });
});
