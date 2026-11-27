/**
 * `/api/home/navigation` 的取数路径（U-463）：
 *
 * 该路由曾整包读 navigation.json（3.16MB）经 Next Data Cache——单条目
 * 2MB 上限写不进缓存，每次调用都重拉整包并在日志里留
 * "items over 2MB can not be cached"。现改读分片拼装
 * （loadNavigationCatalog，U-36）：index + 按分类分片每片 ≤750KB，
 * 都能进 Data Cache。本测试用真实 node:http 假中枢 + 真实取数链路验证：
 *   1. 分片齐备 → 路由返回分片拼装结果，且全程不请求整包 navigation.json；
 *   2. 分片缺失 → 自动回落整包读（degraded），路由仍 200（永不比现状差）；
 *   3. 响应头 `s-maxage=60, stale-while-revalidate` 契约不变。
 *
 * 夹具复用 navigation-catalog-read.test.ts 的同款形状（整包带重字段、
 * 分片为瘦身投影），断言只看路由行为，不重复测拼装本身。
 */
import { describe, expect, it, vi, beforeEach, afterAll, beforeAll } from "vitest";
import { createServer, type Server } from "node:http";
import { invalidateContentCache } from "@/lib/github";
import {
  NAVIGATION_DOC_PATH,
  NAVIGATION_INDEX_PATH,
  navigationShardPath,
} from "@/lib/navigation-catalog-paths";

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
    ],
    subCategories: [
      {
        id: "sub-a", title: "子A", parentId: "cat-a", enabled: true,
        items: [{ id: "n-a3", title: "甲三", href: "https://a3.example.com", enabled: true, trendScore: 3 }],
      },
    ],
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

function seedShards() {
  store.set(NAVIGATION_INDEX_PATH, {
    kind: "navhub-navigation-index",
    sourceVersion: VERSION,
    totalItems: 2,
    replacementHistory: [],
    categories: [
      { id: "cat-a", title: "整包版·分类A", shardPaths: [navigationShardPath("cat-a")], itemCount: 2, subCategories: [{ id: "sub-a", title: "子A", itemCount: 1 }] },
    ],
  });
  store.set(navigationShardPath("cat-a"), {
    kind: "navhub-navigation-cat",
    sourceVersion: VERSION,
    categoryId: "cat-a",
    page: 1,
    pageCount: 1,
    category: slimCat(wholeCatA()),
  });
}

function seedWholeDoc() {
  store.set(NAVIGATION_DOC_PATH, {
    navigationItems: [wholeCatA()],
    replacementHistory: [],
  });
}

async function loadRoute() {
  vi.resetModules();
  const mod = (await import("@/app/api/home/navigation/route")) as {
    GET: () => Promise<Response>;
  };
  return mod.GET;
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

describe("GET /api/home/navigation（U-463）", () => {
  it("分片齐备：返回分片拼装结果，全程不请求整包 navigation.json", async () => {
    seedShards();
    seedWholeDoc();
    const GET = await loadRoute();
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=60");
    const body = (await res.json()) as {
      navigationItems: Array<{ id: string; title: string; items: Array<Record<string, unknown>> }>;
    };
    expect(body.navigationItems).toHaveLength(1);
    expect(body.navigationItems[0].id).toBe("cat-a");
    expect(body.navigationItems[0].title).toBe("整包版·分类A");
    // 拼装结果只带渲染字段：重字段 weight/actions 不在响应里，
    // 证明走的是分片而不是整包
    expect(body.navigationItems[0].items[0]).not.toHaveProperty("weight");
    expect(body.navigationItems[0].items[0]).not.toHaveProperty("actions");
    expect(body.navigationItems[0].items[0]).toHaveProperty("health");
    // 关键断言：整包路径一次都没被请求
    expect(seenPaths).not.toContain(NAVIGATION_DOC_PATH);
    expect(seenPaths).toContain(NAVIGATION_INDEX_PATH);
    expect(seenPaths).toContain(navigationShardPath("cat-a"));
  });

  it("分片缺失：回落整包读，仍 200（永不比现状差）", async () => {
    seedWholeDoc();
    const GET = await loadRoute();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      navigationItems: Array<{ items: Array<Record<string, unknown>> }>;
    };
    expect(body.navigationItems).toHaveLength(1);
    // 回落走整包：重字段原样在
    expect(body.navigationItems[0].items[0]).toHaveProperty("weight", 10);
    expect(seenPaths).toContain(NAVIGATION_DOC_PATH);
  });
});
