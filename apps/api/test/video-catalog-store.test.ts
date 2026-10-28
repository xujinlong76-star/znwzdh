/**
 * C6：视频库关系表的读写切换测试。
 *
 * 覆盖三档模式（json / dual / db）的行为差异，以及三条安全约束：
 *   1. 影子表写失败不能让正本写入失败；
 *   2. db 模式下表为空必须回落文档，不能返回空视频库；
 *   3. 文档里的子分类与重复 id 必须能无损 round-trip。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import {
  checkVideoCatalogConsistency,
  flattenVideoCatalog,
  loadVideoCatalogFromDb,
  rebuildVideoCatalog,
  resetVideoCatalogSyncState,
  resetVideoStoreModeWarning,
  resolveVideoStoreMode,
  syncVideoCatalog,
  videoCatalogSyncState,
  VIDEO_REPLACEMENTS_PATH,
} from "../src/video-catalog.ts";
import { readVideosData, writeStoragePath, writeVideosData } from "../src/storage.ts";
import { countVideoItems, listVideoCategories, listVideoItems, listVideoReplacements } from "@navhub/store";

/** 刻意构造三种边界：子分类、重复 id、章节大字段 */
const DOC = {
  navigationItems: [
    {
      id: "cat_ai",
      title: "AI 与大模型",
      icon: "https://example.com/ai.png",
      description: "AI 分类",
      enabled: true,
      harvestPolicy: { enabled: true, keywords: ["LLM"] },
      items: [
        {
          id: "v1",
          title: "DeepSeek 实战",
          href: "https://www.bilibili.com/video/BV1aa411c7mD",
          description: "课程",
          icon: "https://example.com/c1.jpg",
          enabled: true,
          videoConfig: {
            type: "bilibili",
            bvid: "BV1aa411c7mD",
            author: "某作者",
            durationSec: 600,
            publishedAt: "2026-01-01T00:00:00.000Z",
            qualityScore: 80,
            freshnessScore: 90,
            healthStatus: "healthy",
            sourceType: "auto_trend",
            pinned: false,
            chapters: [{ title: "第一章", startTime: 0, codeSnippet: "x" }],
          },
        },
        { id: "dup", title: "重复 ID 一", href: "https://example.com/dup1", enabled: true },
      ],
      subCategories: [
        {
          id: "sub_beginner",
          title: "入门",
          icon: "https://example.com/sub.png",
          items: [
            { id: "v2", title: "入门第一课", href: "https://example.com/v2", enabled: true },
          ],
        },
      ],
    },
    {
      id: "cat_dev",
      title: "全栈开发",
      enabled: true,
      items: [{ id: "dup", title: "重复 ID 二", href: "https://example.com/dup2", enabled: false }],
    },
  ],
  replacementHistory: [
    {
      id: "r1",
      timestamp: 1700000000000,
      categoryId: "cat_ai",
      categoryTitle: "AI 与大模型",
      oldItem: { id: "old" },
      newItem: { id: "new" },
      reason: "freshness_decay",
      scoreDiff: 12,
      trendKeyword: "DeepSeek",
    },
  ],
};

let dir: string;
let ctx: AppContext;
let savedMode: string | undefined;

beforeAll(async () => {
  savedMode = process.env.NAVHUB_VIDEO_STORE;
  dir = mkdtempSync(join(tmpdir(), "navhub-video-catalog-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "catalog.db"),
    embedding: {
      model: "Xenova/bge-small-zh-v1.5",
      endpoint: "https://hf-mirror.com",
      dtype: "q8",
      cacheDir: join(dir, "models"),
      dim: 512,
      enabled: false,
    },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
});

afterAll(async () => {
  if (savedMode === undefined) delete process.env.NAVHUB_VIDEO_STORE;
  else process.env.NAVHUB_VIDEO_STORE = savedMode;
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  delete process.env.NAVHUB_VIDEO_STORE;
  resetVideoStoreModeWarning();
  resetVideoCatalogSyncState();
  ctx.db.sqlite!.exec("DELETE FROM video_items");
  ctx.db.sqlite!.exec("DELETE FROM video_categories");
  ctx.db.sqlite!.exec("DELETE FROM video_replacements");
  ctx.db.sqlite!.exec("DELETE FROM jobs WHERE id = 'kv:videos'");
  // 外置替换审计文档走通用 JSON 文档分支（doc: 前缀），也要清
  ctx.db.sqlite!.exec("DELETE FROM jobs WHERE id LIKE 'kv:doc:%'");
});

describe("模式解析", () => {
  it("默认 json：未配置时行为与改造前完全一致", () => {
    expect(resolveVideoStoreMode(undefined)).toBe("json");
    expect(resolveVideoStoreMode("")).toBe("json");
    expect(resolveVideoStoreMode("   ")).toBe("json");
  })

  it("识别 dual / db（大小写与空白无关）", () => {
    expect(resolveVideoStoreMode("dual")).toBe("dual");
    expect(resolveVideoStoreMode(" DB ")).toBe("db");
  })

  it("非法值退化为 json，而不是退化成 db", () => {
    // 拼错一个字母就直接改变读路径是灾难；这里必须保持现状
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(resolveVideoStoreMode("database")).toBe("json")
    expect(resolveVideoStoreMode("dbb")).toBe("json")
    expect(warn).toHaveBeenCalledTimes(1) // 只告警一次，避免每次读写都刷日志
    warn.mockRestore()
  })
})

describe("压平与重建", () => {
  it("把子分类条目挂在所属分类下，重复 id 自动加后缀", () => {
    const flat = flattenVideoCatalog(DOC)
    expect(flat.categories.map(c => c.id)).toEqual(["cat_ai", "cat_dev"])
    expect(flat.items).toHaveLength(4)
    // cat_ai 直属 2 条 + 子分类 1 条 + cat_dev 1 条
    expect(flat.items.filter(i => i.categoryId === "cat_ai")).toHaveLength(3)
    // 重复 id 不会让整批 INSERT 失败
    const ids = flat.items.map(i => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain("dup#2")
    expect(flat.replacements).toHaveLength(1)
    expect(flat.replacements[0].createdAt).toBe(1700000000000)
  })

  it("可查询列来自 videoConfig 投影", () => {
    const flat = flattenVideoCatalog(DOC)
    const v1 = flat.items.find(i => i.id === "v1")!
    expect(v1.platform).toBe("bilibili")
    expect(v1.externalId).toBe("BV1aa411c7mD")
    expect(v1.healthStatus).toBe("healthy")
    expect(v1.qualityScore).toBe(80)
    expect(v1.durationSec).toBe(600)
  })

  it("重建保留子分类结构与章节大字段", () => {
    const flat = flattenVideoCatalog(DOC)
    const categories = flat.categories.map((c, i) => ({
      id: c.id,
      title: c.title,
      description: c.description ?? null,
      icon: c.icon ?? null,
      enabled: c.enabled ?? true,
      sort: c.sort ?? i,
      harvestPolicy: c.harvestPolicy ?? {},
    }))
    const items = flat.items.map((it, i) => ({
      id: it.id,
      categoryId: it.categoryId,
      title: it.title,
      href: it.href,
      description: it.description ?? null,
      icon: it.icon ?? null,
      enabled: it.enabled ?? true,
      sort: it.sort ?? i,
      platform: it.platform ?? null,
      externalId: it.externalId ?? null,
      author: it.author ?? null,
      durationSec: it.durationSec ?? null,
      publishedAt: it.publishedAt ?? null,
      qualityScore: it.qualityScore ?? null,
      freshnessScore: it.freshnessScore ?? null,
      healthStatus: it.healthStatus ?? null,
      sourceType: it.sourceType ?? null,
      pinned: it.pinned ?? false,
      payload: it.payload,
      updatedAt: 0,
    }))

    const rebuilt = rebuildVideoCatalog(categories, items)
    const ai = rebuilt.navigationItems.find(c => c.id === "cat_ai") as Record<string, unknown>
    expect(ai).toBeTruthy()
    const aiItems = ai.items as Array<Record<string, unknown>>
    expect(aiItems.map(i => i.id)).toEqual(["v1", "dup"])

    const subs = ai.subCategories as Array<Record<string, unknown>>
    expect(subs).toHaveLength(1)
    expect(subs[0].id).toBe("sub_beginner")
    expect(subs[0].title).toBe("入门")
    expect((subs[0].items as Array<Record<string, unknown>>).map(i => i.id)).toEqual(["v2"])

    // 章节树必须原样回来：它是最容易被「只存列」丢掉的字段
    const v1 = aiItems[0] as { videoConfig?: { chapters?: unknown[] } }
    expect(v1.videoConfig?.chapters).toHaveLength(1)
    expect(ai.harvestPolicy).toEqual({ enabled: true, keywords: ["LLM"] })
  })
})

describe("模式行为", () => {
  it("json 模式：不写表，读的是文档", async () => {
    await writeVideosData(ctx, DOC)
    expect(await countVideoItems(ctx.repo)).toBe(0)
    expect(await readVideosData(ctx)).toEqual(DOC)
  })

  it("dual 模式：文档与表都写，读的仍是文档", async () => {
    process.env.NAVHUB_VIDEO_STORE = "dual"
    await writeVideosData(ctx, DOC)

    expect(await countVideoItems(ctx.repo)).toBe(4)
    const cats = await listVideoCategories(ctx.repo)
    expect(cats.map(c => c.id)).toEqual(["cat_ai", "cat_dev"])
    // 可查询性：按健康状态过滤拿到唯一一条
    expect((await listVideoItems(ctx.repo, { healthStatus: "healthy" })).map(r => r.id)).toEqual(["v1"])

    expect(await readVideosData(ctx)).toEqual(DOC)
    expect(videoCatalogSyncState().consecutiveFailures).toBe(0)
    expect(videoCatalogSyncState().lastSuccessAt).toBeGreaterThan(0)
  })

  it("db 模式：读路径来自关系表，且内容与文档等价", async () => {
    process.env.NAVHUB_VIDEO_STORE = "dual"
    await writeVideosData(ctx, DOC)

    process.env.NAVHUB_VIDEO_STORE = "db"
    const fromDb = (await readVideosData(ctx)) as typeof DOC
    expect(fromDb.navigationItems).toHaveLength(2)
    expect(fromDb.navigationItems[0].items.map(i => i.id)).toEqual(["v1", "dup"])
    expect(fromDb.navigationItems[0].subCategories?.[0].id).toBe("sub_beginner")
    // 审计记录也要能从表里重建
    expect(fromDb.replacementHistory).toHaveLength(1)
    expect(fromDb.replacementHistory[0].id).toBe("r1")
    expect(fromDb.replacementHistory[0].timestamp).toBe(1700000000000)
  })

  it("db 模式下表为空时回落文档（绝不返回空视频库）", async () => {
    process.env.NAVHUB_VIDEO_STORE = "dual"
    await writeVideosData(ctx, DOC)

    ctx.db.sqlite!.exec("DELETE FROM video_items")
    ctx.db.sqlite!.exec("DELETE FROM video_categories")
    process.env.NAVHUB_VIDEO_STORE = "db"

    expect(await loadVideoCatalogFromDb(ctx)).toBeNull()
    const fallback = (await readVideosData(ctx)) as typeof DOC
    expect(fallback.navigationItems).toHaveLength(2)
  })

  it("影子表写失败不阻断文档写入", async () => {
    process.env.NAVHUB_VIDEO_STORE = "dual"
    const spy = vi.spyOn(ctx.repo, "withTransaction").mockRejectedValueOnce(new Error("disk full"))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    await expect(writeVideosData(ctx, DOC)).resolves.toBeUndefined()

    // 文档确实写进去了
    process.env.NAVHUB_VIDEO_STORE = "json"
    expect(await readVideosData(ctx)).toEqual(DOC)
    // 失败被记录，但没有让调用方看到异常
    expect(videoCatalogSyncState().consecutiveFailures).toBe(1)
    expect(videoCatalogSyncState().lastSyncError).toContain("disk full")

    spy.mockRestore()
    warn.mockRestore()
  })

  it("一致性检查：同步后一致，删表后能报出缺失", async () => {
    process.env.NAVHUB_VIDEO_STORE = "dual"
    await writeVideosData(ctx, DOC)

    const ok = await checkVideoCatalogConsistency(ctx, DOC)
    expect(ok.ok).toBe(true)
    expect(ok.docItems).toBe(ok.dbItems)

    ctx.db.sqlite!.exec("DELETE FROM video_items WHERE id = 'v2'")
    const bad = await checkVideoCatalogConsistency(ctx, DOC)
    expect(bad.ok).toBe(false)
    expect(bad.missingInDb).toContain("v2")
  })

  it("全量替换语义：文档删掉的条目在表里也应消失", async () => {
    process.env.NAVHUB_VIDEO_STORE = "dual"
    await writeVideosData(ctx, DOC)
    expect(await countVideoItems(ctx.repo)).toBe(4)

    const trimmed = {
      navigationItems: [DOC.navigationItems[0]],
    }
    await writeVideosData(ctx, trimmed)
    // cat_ai 直属 2 条 + 子分类 1 条；cat_dev 已整体移除
    expect(await countVideoItems(ctx.repo)).toBe(3)
    expect((await listVideoCategories(ctx.repo)).map(c => c.id)).toEqual(["cat_ai"])
  })
})

describe('外置替换审计：全量进表，不受内联 100 条限制', () => {
  const makeRecords = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `rep-${i}`,
      timestamp: 1_700_000_000_000 + i,
      categoryId: 'cat_ai',
      categoryTitle: 'AI 与大模型',
      oldItem: { id: `old-${i}` },
      newItem: { id: `new-${i}` },
      reason: 'freshness_decay',
      scoreDiff: i,
    }))

  it('写这份文档会把 120 条全部同步进表（内联数组只留 100 是另一层的事）', async () => {
    process.env.NAVHUB_VIDEO_STORE = 'dual'
    await writeStoragePath(
      ctx,
      VIDEO_REPLACEMENTS_PATH,
      JSON.stringify({ version: 1, records: makeRecords(120) }),
    )

    const rows = await listVideoReplacements(ctx.repo, { limit: 500 })
    expect(rows).toHaveLength(120)
    expect(rows[0].id).toBe('rep-119') // 按 created_at 倒序
  })

  it('文档形状不认识时不清表（宁可不同步，也不能把审计抹掉）', async () => {
    process.env.NAVHUB_VIDEO_STORE = 'dual'
    await writeStoragePath(
      ctx,
      VIDEO_REPLACEMENTS_PATH,
      JSON.stringify({ version: 1, records: makeRecords(3) }),
    )
    expect(await listVideoReplacements(ctx.repo, { limit: 500 })).toHaveLength(3)

    // 上游把 records 改名了 / 写成了别的结构
    await writeStoragePath(ctx, VIDEO_REPLACEMENTS_PATH, JSON.stringify({ version: 2, items: [] }))
    expect(await listVideoReplacements(ctx.repo, { limit: 500 })).toHaveLength(3)
  })

  it('db 模式重建文档只带内联上限条数，不把全量塞回整包文档', async () => {
    process.env.NAVHUB_VIDEO_STORE = 'dual'
    await writeVideosData(ctx, DOC)
    await writeStoragePath(
      ctx,
      VIDEO_REPLACEMENTS_PATH,
      JSON.stringify({ version: 1, records: makeRecords(120) }),
    )

    process.env.NAVHUB_VIDEO_STORE = 'db'
    const fromDb = (await readVideosData(ctx)) as { replacementHistory?: unknown[] }
    expect(fromDb.replacementHistory).toHaveLength(100)
    // 表里仍是全量：文档截断只影响重建出来的整包大小，不影响审计
    expect(await listVideoReplacements(ctx.repo, { limit: 500 })).toHaveLength(120)
  })

  it('json 模式不写表（行为与改造前一致）', async () => {
    await writeStoragePath(
      ctx,
      VIDEO_REPLACEMENTS_PATH,
      JSON.stringify({ version: 1, records: makeRecords(5) }),
    )
    expect(await listVideoReplacements(ctx.repo, { limit: 500 })).toHaveLength(0)
  })
})
