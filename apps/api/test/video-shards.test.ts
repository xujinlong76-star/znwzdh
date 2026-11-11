/**
 * 视频快照分片派生（VIDEOS_ISR_PLAN 路线 b）：
 *  1. 纯函数 deriveVideoShards 对真实基线文档：分片数/体积/拼装等值/idmap 覆盖；
 *  2. idmap 先到先得语义与详情页线性扫描一致（同键碰撞时文档顺序赢）；
 *  3. 写路径挂钩：writeVideosData 落库后分片与源文档同版本；再写一版分片跟随；
 *  4. 派生失败不连带写失败（畸形文档照样写得进去，只是没分片）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { readStoragePath, readStorageVersion, writeVideosData } from "../src/storage.ts";
import {
  deriveVideoShards,
  VIDEOS_IDMAP_PATH,
  VIDEOS_INDEX_PATH,
  videoShardPath,
  VIDEO_SHARD_SIZE_LIMIT_BYTES,
} from "../src/video-shards.ts";

const baselinePath = fileURLToPath(
  new URL("../../../apps/web/src/navsphere/content/videos.json", import.meta.url),
);
const baselineDoc = JSON.parse(readFileSync(baselinePath, "utf8")) as {
  navigationItems: Array<{
    id: string;
    items?: Array<Record<string, unknown>>;
    subCategories?: Array<{ items?: Array<Record<string, unknown>> }>;
  }>;
  replacementHistory?: unknown[];
};

function countItems(doc: typeof baselineDoc): number {
  let n = 0;
  for (const cat of doc.navigationItems) {
    n += cat.items?.length ?? 0;
    for (const sub of cat.subCategories ?? []) n += sub.items?.length ?? 0;
  }
  return n;
}

describe("deriveVideoShards（真实基线文档）", () => {
  const derived = deriveVideoShards(baselineDoc, 4242);
  const byPath = new Map(derived.writes.map((w) => [w.path, w.data]));

  it("产物集合 = 每分类一片 + idmap + index，且 index 最后落库（提交标记）", () => {
    expect(derived.writes).toHaveLength(baselineDoc.navigationItems.length + 2);
    expect(derived.writes[derived.writes.length - 1].path).toBe(VIDEOS_INDEX_PATH);
    expect(derived.writes[derived.writes.length - 2].path).toBe(VIDEOS_IDMAP_PATH);
    expect(derived.totalItems).toBe(countItems(baselineDoc));
  });

  it("每片体积在红线内，index/idmap 远离 Data Cache 上限", () => {
    for (const w of derived.writes) {
      const size = Buffer.byteLength(JSON.stringify(w.data));
      if (w.path.includes("videos-cat-")) {
        expect(size, w.path).toBeLessThan(VIDEO_SHARD_SIZE_LIMIT_BYTES);
      }
    }
    expect(Buffer.byteLength(JSON.stringify(byPath.get(VIDEOS_INDEX_PATH)))).toBeLessThan(200_000);
    expect(Buffer.byteLength(JSON.stringify(byPath.get(VIDEOS_IDMAP_PATH)))).toBeLessThan(1_500_000);
  });

  it("拼装回源文档逐字等值（分类本体 + replacementHistory）", () => {
    const index = byPath.get(VIDEOS_INDEX_PATH) as {
      categories: Array<{ id: string; shardPath: string }>;
      replacementHistory: unknown[];
    };
    const assembled = {
      navigationItems: index.categories.map((c) => {
        const shard = byPath.get(c.shardPath) as { category: unknown };
        return shard.category;
      }),
      replacementHistory: index.replacementHistory,
    };
    expect(assembled).toEqual(baselineDoc);
  });

  it("idmap 覆盖每条的 id 与 bvid（小写键），且指向正确分类", () => {
    const idmap = byPath.get(VIDEOS_IDMAP_PATH) as { map: Record<string, string>; totalItems: number };
    expect(idmap.totalItems).toBe(countItems(baselineDoc));
    for (const cat of baselineDoc.navigationItems) {
      const items = [
        ...(cat.items ?? []),
        ...(cat.subCategories ?? []).flatMap((s) => s.items ?? []),
      ];
      for (const item of items) {
        expect(idmap.map[item.id as string]).toBe(cat.id);
        const bvid = (item.videoConfig as { bvid?: string } | undefined)?.bvid;
        if (bvid) expect(idmap.map[bvid.toLowerCase()]).toBe(cat.id);
      }
    }
  });

  it("全部产物带同一 sourceVersion", () => {
    for (const w of derived.writes) {
      expect((w.data as { sourceVersion: number }).sourceVersion).toBe(4242);
    }
  });
});

describe("deriveVideoShards（语义钉子）", () => {
  it("同键碰撞先到先得：靠前条目的 bvid 压过靠后条目的同名 id", () => {
    const doc = {
      navigationItems: [
        { id: "cat-a", title: "A", items: [{ id: "item-a", videoConfig: { bvid: "BVShared" } }] },
        { id: "cat-b", title: "B", items: [{ id: "bvshared" }] },
      ],
      replacementHistory: [],
    };
    const derived = deriveVideoShards(doc, 1);
    const idmap = derived.writes.find((w) => w.path === VIDEOS_IDMAP_PATH)?.data as {
      map: Record<string, string>;
    };
    // 详情页线性扫描先命中 cat-a 的 bvid（大小写不敏感），映射必须同结果
    expect(idmap.map["bvshared"]).toBe("cat-a");
  });

  it("源文档形状不对时抛错（由写路径 catch，不连带写失败）", () => {
    expect(() => deriveVideoShards({ navigationItems: "bogus" }, 1)).toThrow();
    expect(() => deriveVideoShards(null, 1)).toThrow();
  });
});

describe("writeVideosData 分片挂钩", () => {
  const dir = mkdtempSync(join(tmpdir(), "navhub-video-shards-"));
  let ctx: AppContext;

  const docV1 = {
    navigationItems: [
      {
        id: "cat-x",
        title: "分类X",
        items: [{ id: "v-1", title: "标题一", videoConfig: { bvid: "BV1xx" } }],
        subCategories: [
          { id: "sub-x", title: "子分类", items: [{ id: "v-2", title: "标题二" }] },
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

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("写源文档后分片齐备且与源文档同版本", async () => {
    await writeVideosData(ctx, docV1);
    const version = await readStorageVersion(ctx, "src/navsphere/content/videos.json");
    expect(version).not.toBeNull();

    const index = (await readStoragePath(ctx, VIDEOS_INDEX_PATH)) as {
      sourceVersion: number;
      totalItems: number;
    };
    expect(index.sourceVersion).toBe(version);
    expect(index.totalItems).toBe(2);

    const shard = (await readStoragePath(ctx, videoShardPath("cat-x"))) as {
      sourceVersion: number;
      category: { title: string };
    };
    expect(shard.sourceVersion).toBe(version);
    expect(shard.category.title).toBe("分类X");

    const idmap = (await readStoragePath(ctx, VIDEOS_IDMAP_PATH)) as {
      map: Record<string, string>;
    };
    expect(idmap.map["v-1"]).toBe("cat-x");
    expect(idmap.map["bv1xx"]).toBe("cat-x");
    expect(idmap.map["v-2"]).toBe("cat-x");
  });

  it("再写一版：分片跟随新版本与新内容", async () => {
    const v1 = await readStorageVersion(ctx, "src/navsphere/content/videos.json");
    const docV2 = structuredClone(docV1);
    docV2.navigationItems[0].items[0].title = "标题一·改";
    await writeVideosData(ctx, docV2);
    const v2 = await readStorageVersion(ctx, "src/navsphere/content/videos.json");
    expect(v2).not.toBe(v1);

    const shard = (await readStoragePath(ctx, videoShardPath("cat-x"))) as {
      sourceVersion: number;
      category: { items: Array<{ title: string }> };
    };
    expect(shard.sourceVersion).toBe(v2);
    expect(shard.category.items[0].title).toBe("标题一·改");
  });

  it("派生失败不连带写失败（分类缺 id：计数可过、派生必抛）", async () => {
    const indexBefore = (await readStoragePath(ctx, VIDEOS_INDEX_PATH)) as { sourceVersion: number };
    const malformed = {
      navigationItems: [{ title: "无 id 分类", items: [{ id: "v-9", title: "标题九" }] }],
      replacementHistory: [],
    };
    await expect(writeVideosData(ctx, malformed as never)).resolves.toBeUndefined();
    // 源文档已按新内容落库（写路径既有语义），分片维持上一版不动——
    // 读路径靠版本校验发现分片与源不一致时回落整包读，不冒充新数据
    const doc = (await readStoragePath(ctx, "src/navsphere/content/videos.json")) as {
      navigationItems: Array<{ title: string }>;
    };
    expect(doc.navigationItems[0].title).toBe("无 id 分类");
    const indexAfter = (await readStoragePath(ctx, VIDEOS_INDEX_PATH)) as { sourceVersion: number };
    expect(indexAfter.sourceVersion).toBe(indexBefore.sourceVersion);
  });
});
