/**
 * A-3/A-4 前端复现（先红后绿的守卫）：
 *
 * A-3（基底 1d876565）：管理端 page.tsx 的 loadReviews 固定 { status, limit: 20 }、
 * loadList 固定 { status, q, limit: 100 }，全文件无 offset、无「加载更多」：
 * 评价第 21 条起、任一状态 Tab 的第 101 个插件起不可达。服务端早已支持
 * offset（/api/admin/plugin-reviews、/api/admin/plugins 均有 offset 参数，
 * fetchAdminPluginReviews/fetchAdminPlugins 也已会拼 offset），只是页面没接。
 * 本文件断言页面把 offset 接上并给出「加载更多」入口。
 *
 * A-4（作者中心）：mine/page.tsx 的状态计数与安装/星标/remix 合计直接对
 * fetchMyPlugins({ limit: 100 }) 的当页 items 求和；服务端修后 /mine 返回
 * 全量聚合 stats，页面应优先读 res.stats（取不到时才回落到当页求和）。
 * 本文件断言 navhub-api 的 HubPluginsResponse 带 stats 字段且 mine 页读它。
 *
 * 断言风格沿用本仓既有守卫（me-plugins.test.ts 的源码断言 + 
 * plugin-reviews-pagination.test.ts 的 fetch 桩断言），不引入新测试基建。
 * 本文件经 mirror:web 镜像到 apps/web/test/ 后跑（vitest include 只含该目录）。
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAdminPluginReviews, fetchAdminPlugins, fetchMyPlugins } from "../src/lib/navhub-api";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** 把 fetch 换成固定 JSON 响应，返回记录到的请求 URL 列表。 */
function stubFetchJson(body: unknown): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    calls.push(String(input));
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }) as typeof fetch;
  return calls;
}

describe("A-3：管理端评价治理队列必须能翻到第 21 条之后", () => {
  it("loadReviews 接 offset：翻页时按已显示条数取下一页", () => {
    const src = read("src/app/admin/plugins/page.tsx");
    // 修前：loadReviews 固定 { status: reviewStatus, limit: 20 }，无 offset 参数。
    expect(src).toContain("loadReviews(adminReviews.length)");
    expect(src).toContain("adminReviews.length < reviewsTotal");
  });

  it("评价区有「加载更多」入口，显示已显示/共计", () => {
    const src = read("src/app/admin/plugins/page.tsx");
    expect(src).toContain("加载更多");
    expect(src).toContain("adminReviews.length} / {reviewsTotal}");
  });

  it("fetchAdminPluginReviews 本就会拼 offset（页面要用的 API 能力已就绪）", async () => {
    const calls = stubFetchJson({ items: [], total: 0, limit: 20, offset: 20 });
    await fetchAdminPluginReviews({ status: "visible", limit: 20, offset: 20 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("offset=20");
  });
});

describe("A-3：管理端插件列表必须能翻到第 101 个之后，并展示总数", () => {
  it("loadList 接 offset：翻页时按已显示条数取下一页", () => {
    const src = read("src/app/admin/plugins/page.tsx");
    // 修前：loadList 固定 { status, q, limit: 100 }，无 offset、无总数 state。
    expect(src).toContain("loadList(plugins.length)");
    expect(src).toContain("plugins.length < listTotal");
    expect(src).toContain("listTotal");
  });

  it("列表区展示总数与「加载更多」入口", () => {
    const src = read("src/app/admin/plugins/page.tsx");
    expect(src).toContain("plugins.length} / {listTotal}");
  });

  it("fetchAdminPlugins 本就会拼 offset（页面要用的 API 能力已就绪）", async () => {
    const calls = stubFetchJson({ items: [], total: 0, limit: 100, offset: 100 });
    await fetchAdminPlugins({ status: "pending", limit: 100, offset: 100 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("offset=100");
  });
});

describe("A-4：作者中心计数必须读服务端全量聚合，不只按前 100 条求和", () => {
  it("HubPluginsResponse 带可选的全量聚合 stats", () => {
    const api = read("src/lib/navhub-api.ts");
    expect(api).toContain("HubMyPluginStats");
    expect(api).toContain("stats?: HubMyPluginStats");
  });

  it("mine 页优先读 res.stats（取不到时才回落到当页求和）", () => {
    const src = read("src/app/marketplace/mine/page.tsx");
    // 修前：counts/metrics 只对 items（limit: 100 当页）求和，全文件无 stats。
    expect(src).toContain("res.stats");
    expect(src).toContain("stats?.pending");
    expect(src).toContain("stats?.installs");
  });

  it("fetchMyPlugins 会把 offset 发出去（分页取数能力已就绪）", async () => {
    const calls = stubFetchJson({ items: [], total: 0, limit: 100, offset: 100 });
    await fetchMyPlugins({ limit: 100, offset: 100 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("offset=100");
  });
});
