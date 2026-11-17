/**
 * A-4b 前端复现（先红后绿的守卫）：
 *
 * 基底 1d876565：公开作者页 author-plugins-view.tsx 的 load() 固定
 * fetchAuthorPlugins(ownerKey, { limit: 100 })，作者中心 mine/page.tsx 的
 * load() 固定 fetchMyPlugins({ identity, limit: 100 })，两处全文件无 offset、
 * 无「加载更多」：作者插件 >100 时第 101 个起的条目在列表 UI 里不可达。
 * 服务端与 fetch 层早已支持 offset（见 apps/api/test/
 * plugin-author-list-paging-a4b.test.ts），只是页面没接。
 * 本文件断言两个页面把 offset 接上并给出「加载更多」入口。
 *
 * 断言风格沿用本仓既有守卫（A-3 的 plugin-admin-paging-a34.test.ts 的
 * 源码断言 + fetch 桩断言），不引入新测试基建。
 * 本文件经 mirror:web 镜像到 apps/web/test/ 后跑（vitest include 只含该目录）。
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAuthorPlugins, fetchMyPlugins } from "../src/lib/navhub-api";

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

describe("A-4b：公开作者页必须能翻到第 101 个插件之后", () => {
  it("load 接 offset：翻页时按已显示条数取下一页", () => {
    const src = read("src/app/marketplace/author/[key]/author-plugins-view.tsx");
    // 修前：load 固定 fetchAuthorPlugins(ownerKey, { limit: 100 })，无 offset 参数。
    expect(src).toContain("offset");
    expect(src).toContain("data.items.length < data.total");
  });

  it("列表区有「加载更多」入口，显示已显示/共计", () => {
    const src = read("src/app/marketplace/author/[key]/author-plugins-view.tsx");
    expect(src).toContain("加载更多");
    expect(src).toContain("data.items.length}/{data.total}");
  });

  it("fetchAuthorPlugins 本就会拼 offset（页面要用的 API 能力已就绪）", async () => {
    const calls = stubFetchJson({
      ownerKey: "a".repeat(24),
      author: "测试作者",
      stats: { plugins: 105, installs: 0, stars: 0 },
      items: [],
      total: 105,
      limit: 100,
      offset: 100,
    });
    await fetchAuthorPlugins("a".repeat(24), { limit: 100, offset: 100 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("offset=100");
  });
});

describe("A-4b：作者中心列表必须能翻到第 101 个插件之后", () => {
  it("load 接 offset：翻页时按已显示条数取下一页", () => {
    const src = read("src/app/marketplace/mine/page.tsx");
    // 修前：load 固定 fetchMyPlugins({ identity, limit: 100 })，无 offset 参数。
    expect(src).toContain("offset");
    // P1-2 返工：列表状态收进 list 快照（applyMarketplaceListLoad），
    // 翻页守卫改为 list.items.length < list.total；行为不变（load(list.items.length, true) 仍按已显示条数取下一页）。
    expect(src).toContain("list.items.length < list.total");
  });

  it("列表区有「加载更多」入口，显示已显示/共计", () => {
    const src = read("src/app/marketplace/mine/page.tsx");
    expect(src).toContain("加载更多");
    // P1-2 返工：同上，计数渲染改为 {list.items.length}/{list.total}（仍显示“已显示/共计”）。
    expect(src).toContain("{list.items.length}/{list.total}");
  });

  it("fetchMyPlugins 本就会拼 offset（页面要用的 API 能力已就绪）", async () => {
    const calls = stubFetchJson({ items: [], total: 105, limit: 100, offset: 100 });
    await fetchMyPlugins({ limit: 100, offset: 100 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("offset=100");
  });
});
