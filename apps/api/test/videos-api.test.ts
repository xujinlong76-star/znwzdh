/**
 * 视频库只读 API（阶段二第一刀）。
 *
 * 守三件事：
 *   1. **事实源正确**：`json` / `dual` 模式下 KV 是唯一事实源，关系表只是影子副本 ——
 *      即使表里有几千条，接口也不能拿它供数（否则返回站点上不存在的幻影视频）。
 *   2. **切读后走 SQL**：`NAVHUB_VIDEO_STORE=db` 时才用关系表分页，筛选与 total 同口径。
 *   3. **永不 500**：表为空或读失败时回落 KV 文档，接口始终可用。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { writeVideosData } from "../src/storage.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

function makeItem(id: string, categoryId: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    categoryId,
    title: `视频 ${id}`,
    href: `https://www.bilibili.com/video/${id}`,
    platform: "bilibili",
    externalId: id,
    healthStatus: "healthy",
    qualityScore: 80,
    freshnessScore: 70,
    payload: {
      item: {
        id,
        title: `视频 ${id}`,
        href: `https://www.bilibili.com/video/${id}`,
        videoConfig: { type: "bilibili", bvid: id, chapters: [{ id: "c1", title: "第一章" }] },
      },
      sub: null,
    },
    ...overrides,
  };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-videos-api-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);
  await app.ready();

  // 只写 KV 文档：此时 video_items 为空，用来验证回落路径
  await writeVideosData(ctx, {
    navigationItems: [
      {
        id: "cat_a",
        title: "AI 工程",
        items: [
          { id: "kv1", title: "KV 视频一", href: "https://example.com/1", enabled: true, videoConfig: { type: "bilibili", bvid: "kv1" } },
        ],
        subCategories: [
          {
            id: "sub_a1",
            title: "大模型",
            items: [
              { id: "kv2", title: "KV 视频二", href: "https://example.com/2", enabled: true, videoConfig: { type: "youtube", videoId: "kv2" } },
            ],
          },
        ],
      },
    ],
  });
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  delete process.env.NAVHUB_VIDEO_STORE;
  rmSync(dir, { recursive: true, force: true });
});

describe("关系表为空时回落 KV 文档", () => {
  it("列表返回 source=kv，且包含顶层与子分类条目", async () => {
    const res = await app.inject({ method: "GET", url: "/api/videos" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.source).toBe("kv");
    expect(body.total).toBe(2);
    expect(body.items.map((i: { id: string }) => i.id).sort()).toEqual(["kv1", "kv2"]);
    expect(res.headers["x-video-source"]).toBe("kv");
  });

  it("详情按 id 命中子分类条目", async () => {
    const res = await app.inject({ method: "GET", url: "/api/videos/kv2" });
    expect(res.statusCode).toBe(200);
    expect(res.json().item.videoConfig.type).toBe("youtube");
  });
});

describe("表里有数据但未切读：仍以 KV 为事实源", () => {
  beforeAll(async () => {
    /**
     * 直接写 video_items，而不是 import `replaceVideoCatalog`。
     *
     * 本机 pnpm 的 `better-sqlite3` 是 MSYS 风格软链（`/c/Users/...`），
     * 从测试文件静态 import `@navhub/store` 会让 driver.ts 走 Node 原生 ESM
     * 解析、在该路径上失败；经 `createContext`（Vite 转译）则正常。用 SQL 播种
     * 既避开这个环境差异，也让测试只依赖仓储的公开接口。
     */
    const db = ctx.db.sqlite;
    if (!db) throw new Error("本测试只跑 lite 模式（sqlite）");
    const stmt = db.prepare(
      "INSERT INTO video_items (id,category_id,title,href,description,icon,enabled,sort,platform,external_id,author,duration_sec,published_at,quality_score,freshness_score,health_status,source_type,pinned,payload,created_at,updated_at) " +
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    const insert = (item: ReturnType<typeof makeItem>) =>
      stmt.run(
        item.id,
        item.categoryId,
        item.title,
        item.href,
        null,
        null,
        1,
        0,
        item.platform,
        item.externalId,
        null,
        null,
        null,
        item.qualityScore,
        item.freshnessScore,
        item.healthStatus,
        null,
        0,
        JSON.stringify(item.payload),
        Date.now(),
        Date.now(),
      );

    insert(makeItem("v1", "cat_a"));
    insert(makeItem("v2", "cat_a", { platform: "youtube", healthStatus: "broken" }));
    insert(makeItem("v3", "cat_b"));
  });

  it("默认仍返回 KV 的 2 条，不返回表里的 3 条幻影数据", async () => {
    const res = await app.inject({ method: "GET", url: "/api/videos" });
    const body = res.json();
    expect(body.source).toBe("kv");
    expect(body.total).toBe(2);
    expect(body.items.map((i: { id: string }) => i.id).sort()).toEqual(["kv1", "kv2"]);
  });

  it("?source=db 可显式查看表内数据（灰度排查用）", async () => {
    const res = await app.inject({ method: "GET", url: "/api/videos?source=db" });
    const body = res.json();
    expect(body.source).toBe("db");
    expect(body.total).toBe(3);
  });
});

describe("切到 db 模式后以关系表为事实源", () => {
  beforeAll(() => {
    process.env.NAVHUB_VIDEO_STORE = "db";
  });

  afterAll(() => {
    delete process.env.NAVHUB_VIDEO_STORE;
  });

  it("返回 source=db 与总数", async () => {
    const res = await app.inject({ method: "GET", url: "/api/videos" });
    const body = res.json();
    expect(body.source).toBe("db");
    expect(body.total).toBe(3);
    expect(body.returned).toBe(3);
    expect(res.headers["x-video-source"]).toBe("db");
  });

  it("分页：limit/offset 生效，total 不随分页变化", async () => {
    const res = await app.inject({ method: "GET", url: "/api/videos?limit=2&offset=0" });
    const body = res.json();
    expect(body.total).toBe(3);
    expect(body.returned).toBe(2);
    expect(body.items).toHaveLength(2);
  });

  it("筛选：platform 与 healthStatus 同时生效，total 与筛选口径一致", async () => {
    const res = await app.inject({ method: "GET", url: "/api/videos?platform=youtube" });
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].id).toBe("v2");

    const broken = await app.inject({ method: "GET", url: "/api/videos?healthStatus=broken" });
    expect(broken.json().total).toBe(1);
  });

  it("compact=1 不返回 videoConfig；compact=0 返回", async () => {
    const compact = await app.inject({ method: "GET", url: "/api/videos?limit=1&compact=1" });
    expect(compact.json().items[0].videoConfig).toBeUndefined();

    const full = await app.inject({ method: "GET", url: "/api/videos?limit=1&compact=0" });
    expect(full.json().items[0].videoConfig).toBeTruthy();
  });

  it("详情返回完整 videoConfig，未知 id 返回 404", async () => {
    const hit = await app.inject({ method: "GET", url: "/api/videos/v1" });
    expect(hit.statusCode).toBe(200);
    expect(hit.json().item.videoConfig.chapters).toHaveLength(1);

    const miss = await app.inject({ method: "GET", url: "/api/videos/not-exist" });
    expect(miss.statusCode).toBe(404);
  });

  it("非法参数返回 400（limit 超上限）", async () => {
    const res = await app.inject({ method: "GET", url: "/api/videos?limit=9999" });
    expect(res.statusCode).toBe(400);
  });
});
