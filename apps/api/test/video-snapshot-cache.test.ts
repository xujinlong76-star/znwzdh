/**
 * 视频库 KV 快照缓存（P1-4）的行为回归。
 *
 * 三条铁律：
 *   1. 命中：版本号不变时返回同一份对象（不再付 6.37MB 的 JSON.parse）；
 *   2. 写后失效：writeVideosData 成功后下一次读立即拿到新数据（即使版本号降级）；
 *   3. 只缓存 KV 路径：db 模式读关系表，与 KV 版本无关，不进缓存。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { invalidateVideoSnapshotCache, readVideosData, writeVideosData } from "../src/storage.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

function doc(count: number) {
  return {
    navigationItems: [
      {
        id: "cat-v",
        title: "视频",
        enabled: true,
        items: Array.from({ length: count }, (_, i) => ({
          id: `v-${i}`,
          title: `视频 ${i}`,
          href: `https://v.example.com/${i}`,
          enabled: true,
          videoConfig: { type: "bilibili", bvid: `BV${String(i).padStart(10, "0")}` },
        })),
      },
    ],
  };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-video-cache-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "cache.db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "m"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubVideoCacheTest/0.1" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await ctx?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("视频库快照缓存", () => {
  it("命中：版本号不变时返回同一份对象", async () => {
    await writeVideosData(ctx, doc(2));
    const first = await readVideosData(ctx);
    const second = await readVideosData(ctx);
    expect(second).toBe(first); // 同一引用 = 没有再付一次 parse
  });

  it("写后失效：下一次读立即拿到新数据", async () => {
    await writeVideosData(ctx, doc(2));
    const before = await readVideosData(ctx);
    expect((before as { navigationItems: Array<{ items: unknown[] }> }).navigationItems[0]!.items.length).toBe(2);

    await writeVideosData(ctx, doc(5));
    const after = await readVideosData(ctx);
    expect(after).not.toBe(before);
    expect((after as { navigationItems: Array<{ items: unknown[] }> }).navigationItems[0]!.items.length).toBe(5);
  });

  it("空文档语义保留：从未写入时返回 null 而不是抛错", async () => {
    const fresh = await createContext(
      loadConfig({
        mode: "lite",
        sqlitePath: join(dir, "empty.db"),
        embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "m2"), dim: 512, enabled: false },
        llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
        fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubVideoCacheTest/0.1" },
        corsOrigins: ["*"],
      }),
    );
    try {
      const appFresh = await buildServer(fresh);
      try {
        // 缓存是进程级模块单例：换库测试前先失效，避免读到前一个 ctx 的版本降级数据
        invalidateVideoSnapshotCache();
        expect(await readVideosData(fresh)).toBeNull();
      } finally {
        await appFresh.close();
      }
    } finally {
      await fresh.close();
    }
  });
});
