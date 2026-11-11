/**
 * 视频目录分片读路径（VIDEOS_ISR_PLAN 路线 b 的 web 侧）：
 * 起一个真实 node:http 假中枢，按路径供数并记录请求，验证：
 *   1. 分片齐备且版本一致 → 走分片拼装，绝不请求整包 videos.json；
 *   2. 版本撕裂 / 分片缺失 / 条数对不上 / 索引缺失 → 一律回落整包读，
 *      且回落结果带 degraded 标记（详情页据此不定性 404）；
 *   3. NAVHUB_VIDEOS_READ_MODE=doc → 直走整包（回滚位）；脏值 → 回 doc；
 *   4. 详情页定位：id / bvid（大小写不敏感）命中单分片；未知标识返回 null。
 */
import { describe, expect, it, vi, beforeEach, afterAll, beforeAll } from "vitest";
import { createServer, type Server } from "node:http";
import { invalidateContentCache } from "@/lib/github";
import {
  loadVideoCatalog,
  loadVideoCategoryByIdentifier,
  videoReadMode,
} from "@/lib/video-catalog-read";
import {
  VIDEOS_DOC_PATH,
  VIDEOS_IDMAP_PATH,
  VIDEOS_INDEX_PATH,
  videoShardPath,
} from "@/lib/video-catalog-paths";

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

function catA() {
  return {
    id: "cat-a",
    title: "分片版·分类A",
    items: [
      { id: "v-a1", title: "甲一", videoConfig: { bvid: "BV1Aa" } },
      { id: "v-a2", title: "甲二", videoConfig: { seoSlug: "slug-a2" } },
    ],
    subCategories: [{ id: "sub-a", title: "子A", items: [{ id: "v-a3", title: "甲三" }] }],
  };
}
function catB() {
  return { id: "cat-b", title: "分片版·分类B", items: [{ id: "v-b1", title: "乙一" }], subCategories: [] };
}

function seedShards(version = VERSION) {
  store.set(VIDEOS_INDEX_PATH, {
    kind: "navhub-videos-index",
    sourceVersion: version,
    totalItems: 4,
    replacementHistory: [{ note: "hist" }],
    categories: [
      { id: "cat-a", title: "分片版·分类A", shardPath: videoShardPath("cat-a"), itemCount: 3, subCategories: [] },
      { id: "cat-b", title: "分片版·分类B", shardPath: videoShardPath("cat-b"), itemCount: 1, subCategories: [] },
    ],
  });
  store.set(videoShardPath("cat-a"), {
    kind: "navhub-videos-cat",
    sourceVersion: version,
    categoryId: "cat-a",
    category: catA(),
  });
  store.set(videoShardPath("cat-b"), {
    kind: "navhub-videos-cat",
    sourceVersion: version,
    categoryId: "cat-b",
    category: catB(),
  });
  store.set(VIDEOS_IDMAP_PATH, {
    kind: "navhub-videos-idmap",
    sourceVersion: version,
    totalItems: 4,
    map: { "v-a1": "cat-a", bv1aa: "cat-a", "slug-a2": "cat-a", "v-a3": "cat-a", "v-b1": "cat-b" },
  });
}

function seedWholeDoc() {
  store.set(VIDEOS_DOC_PATH, {
    navigationItems: [{ id: "cat-a", title: "整包版·分类A", items: [], subCategories: [] }],
    replacementHistory: [],
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
  delete process.env.NAVHUB_VIDEOS_READ_MODE;
  delete process.env.NEXT_PHASE;
  invalidateContentCache();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("loadVideoCatalog", () => {
  it("分片齐备：拼装等值且不碰整包", async () => {
    seedShards();
    seedWholeDoc();
    const load = await loadVideoCatalog();
    expect(load.mode).toBe("shard");
    expect(load.degraded).toBe(false);
    expect(load.sourceVersion).toBe(VERSION);
    expect(load.data.navigationItems.map((c) => c.title)).toEqual(["分片版·分类A", "分片版·分类B"]);
    expect(load.data.replacementHistory).toEqual([{ note: "hist" }]);
    expect(seenPaths).not.toContain(VIDEOS_DOC_PATH);
    expect(seenPaths).toContain(VIDEOS_INDEX_PATH);
  });

  it("某片版本与索引不一致（撕裂）→ 回落整包", async () => {
    seedShards();
    seedWholeDoc();
    const shard = store.get(videoShardPath("cat-b")) as { sourceVersion: number };
    store.set(videoShardPath("cat-b"), { ...shard, sourceVersion: VERSION - 1 });
    const load = await loadVideoCatalog();
    expect(load.mode).toBe("doc");
    expect(load.degraded).toBe(true);
    expect(load.data.navigationItems[0].title).toBe("整包版·分类A");
    expect(seenPaths).toContain(VIDEOS_DOC_PATH);
  });

  it("doc 模式整包可读 → degraded 为 false；中枢无整包（基线替代）→ degraded 为 true", async () => {
    seedWholeDoc();
    vi.stubEnv("NAVHUB_VIDEOS_READ_MODE", "doc");
    const ok = await loadVideoCatalog();
    expect(ok.mode).toBe("doc");
    expect(ok.degraded).toBe(false);
    store.clear();
    invalidateContentCache();
    const degraded = await loadVideoCatalog();
    expect(degraded.mode).toBe("doc");
    expect(degraded.degraded).toBe(true);
  });

  it("某片缺失 → 回落整包", async () => {
    seedShards();
    seedWholeDoc();
    store.delete(videoShardPath("cat-a"));
    const load = await loadVideoCatalog();
    expect(load.mode).toBe("doc");
    expect(seenPaths).toContain(VIDEOS_DOC_PATH);
  });

  it("索引缺失（中枢尚未派生）→ 回落整包", async () => {
    seedWholeDoc();
    const load = await loadVideoCatalog();
    expect(load.mode).toBe("doc");
    expect(load.data.navigationItems[0].title).toBe("整包版·分类A");
  });

  it("条数与索引登记对不上 → 回落整包", async () => {
    seedShards();
    seedWholeDoc();
    const shard = store.get(videoShardPath("cat-a")) as { category: ReturnType<typeof catA> };
    store.set(videoShardPath("cat-a"), {
      ...shard,
      category: { ...shard.category, items: shard.category.items.slice(0, 1) },
    });
    const load = await loadVideoCatalog();
    expect(load.mode).toBe("doc");
  });

  it("NAVHUB_VIDEOS_READ_MODE=doc → 直走整包，不读分片", async () => {
    seedShards();
    seedWholeDoc();
    process.env.NAVHUB_VIDEOS_READ_MODE = "doc";
    const load = await loadVideoCatalog();
    expect(load.mode).toBe("doc");
    expect(seenPaths).toEqual([VIDEOS_DOC_PATH]);
  });

  it("构建期分片缺失 → 回落内联基线，绝不发整包读（防 ISR 被污染回动态）", async () => {
    seedWholeDoc();
    process.env.NEXT_PHASE = "phase-production-build";
    try {
      const load = await loadVideoCatalog();
      expect(load.mode).toBe("doc");
      // 用的是仓库基线（真实 6007 条那份），不是假中枢里的整包夹具
      expect(load.data.navigationItems.length).toBeGreaterThan(1);
      expect(load.data.navigationItems[0].title).not.toBe("整包版·分类A");
      expect(seenPaths).not.toContain(VIDEOS_DOC_PATH);
    } finally {
      delete process.env.NEXT_PHASE;
    }
  });
});

describe("videoReadMode", () => {
  it("未设置/shard → shard；doc → doc；脏值 → doc", () => {
    expect(videoReadMode({})).toBe("shard");
    expect(videoReadMode({ NAVHUB_VIDEOS_READ_MODE: "shard" })).toBe("shard");
    expect(videoReadMode({ NAVHUB_VIDEOS_READ_MODE: "doc" })).toBe("doc");
    expect(videoReadMode({ NAVHUB_VIDEOS_READ_MODE: "bogus" })).toBe("doc");
  });
});

describe("loadVideoCategoryByIdentifier", () => {
  it("按 id 命中：只读 idmap+索引+目标分片", async () => {
    seedShards();
    const hit = await loadVideoCategoryByIdentifier("v-b1");
    expect(hit?.category.id).toBe("cat-b");
    expect(hit?.sourceVersion).toBe(VERSION);
    expect(seenPaths).toContain(VIDEOS_IDMAP_PATH);
    expect(seenPaths).toContain(videoShardPath("cat-b"));
    expect(seenPaths).not.toContain(videoShardPath("cat-a"));
    expect(seenPaths).not.toContain(VIDEOS_DOC_PATH);
  });

  it("按 bvid 命中（大小写不敏感）与 seoSlug 命中", async () => {
    seedShards();
    expect((await loadVideoCategoryByIdentifier("BV1AA"))?.category.id).toBe("cat-a");
    invalidateContentCache();
    seenPaths.length = 0;
    expect((await loadVideoCategoryByIdentifier("slug-a2"))?.category.id).toBe("cat-a");
  });

  it("未知标识 → null（由调用方全量扫描裁定 404）", async () => {
    seedShards();
    expect(await loadVideoCategoryByIdentifier("no-such-id")).toBeNull();
  });

  it("idmap 与索引版本不一致 → null", async () => {
    seedShards();
    const idmap = store.get(VIDEOS_IDMAP_PATH) as { sourceVersion: number };
    store.set(VIDEOS_IDMAP_PATH, { ...idmap, sourceVersion: VERSION + 1 });
    expect(await loadVideoCategoryByIdentifier("v-a1")).toBeNull();
  });

  it("doc 模式 → null", async () => {
    seedShards();
    process.env.NAVHUB_VIDEOS_READ_MODE = "doc";
    expect(await loadVideoCategoryByIdentifier("v-a1")).toBeNull();
  });
});

describe("路径常量钉子（与中枢 video-shards.ts 必须逐字一致）", () => {
  it("常量值", () => {
    expect(VIDEOS_DOC_PATH).toBe("src/navsphere/content/videos.json");
    expect(VIDEOS_INDEX_PATH).toBe("src/navsphere/content/videos-index.json");
    expect(VIDEOS_IDMAP_PATH).toBe("src/navsphere/content/videos-idmap.json");
    expect(videoShardPath("cat_ai_engineering")).toBe(
      "src/navsphere/content/videos-cat-cat_ai_engineering.json",
    );
  });
});
