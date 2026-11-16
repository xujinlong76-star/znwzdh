/**
 * 插件评价分页 / 筛选参数必须发出去（进化第 85 轮 F 线，修缺陷①）。
 *
 * 根因：fetchPluginReviews / fetchAdminPluginReviews 拼出的查询串 qs
 * 从未拼进 getJson 的 URL（E 线 lint 清理又把拼 qs 的死代码整段删掉，
 * 于是本基底上连 qs 的构造都不剩）。后果是用户可见的：
 *   - 评价区点「加载更多」时 offset 恒为 0，服务端永远返回前 20 条，
 *     追加后出现重复评价，20 条之后的评价永远翻不到；
 *   - 管理台传 status=hidden 也收不到筛选，恒返回全部状态。
 * 本文件只断言「请求 URL 里带了参数」，不碰服务端与调用方。
 */
import { afterEach, describe, expect, it } from "vitest";

import { fetchAdminPluginReviews, fetchPluginReviews } from "../src/lib/navhub-api";

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

const EMPTY_REVIEWS = {
  slug: "demo-plugin",
  stats: { avgRating: 0, reviewCount: 0, ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } },
  myReview: null,
  items: [],
  total: 0,
  limit: 20,
  offset: 0,
};

const EMPTY_ADMIN = { items: [], total: 0, limit: 30, offset: 0 };

describe("fetchPluginReviews：分页参数要发到服务端", () => {
  it("带 limit/offset 时 URL 含 limit=20&offset=20", async () => {
    const calls = stubFetchJson(EMPTY_REVIEWS);
    await fetchPluginReviews("demo-plugin", { limit: 20, offset: 20 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/api/hub/plugins/demo-plugin/reviews");
    expect(calls[0]).toContain("limit=20&offset=20");
  });

  it("只传 limit 时只发 limit，不补 offset=0", async () => {
    const calls = stubFetchJson(EMPTY_REVIEWS);
    await fetchPluginReviews("demo-plugin", { limit: 20 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("limit=20");
    expect(calls[0]).not.toContain("offset=");
  });

  it("无参数时 URL 不带 ?（首屏行为零变化）", async () => {
    const calls = stubFetchJson(EMPTY_REVIEWS);
    await fetchPluginReviews("demo-plugin");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe("/api/hub/plugins/demo-plugin/reviews");
    expect(calls[0]).not.toContain("?");
  });

  it("两页假数据追加后无重复 id、长度 40（loadMore 的用户可见结果）", async () => {
    // 按 URL 里的 offset 分发两页：offset=0 → r1–r20，offset=20 → r21–r40。
    // 修好之前两次请求都带 offset=0（实际是不带参数），会两次拿到同一页，
    // 按组件的 [...prev.items, ...res.items] 追加后出现重复 id。
    const calls: string[] = [];
    globalThis.fetch = (async (input: unknown) => {
      const url = new URL(String(input), "http://localhost");
      calls.push(String(input));
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const page = Array.from({ length: 20 }, (_, i) => ({
        id: `r${offset + i + 1}`,
        rating: 5,
        createdAt: 0,
      }));
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ ...EMPTY_REVIEWS, items: page, total: 40, limit: 20, offset }),
      } as unknown as Response;
    }) as typeof fetch;

    const page1 = await fetchPluginReviews("demo-plugin", { limit: 20, offset: 0 });
    const page2 = await fetchPluginReviews("demo-plugin", { limit: 20, offset: 20 });
    expect(calls[1]).toContain("offset=20");
    // 与 plugin-review-section.tsx 的 loadMore 同款追加：
    const merged = [...page1.items, ...page2.items];
    expect(merged).toHaveLength(40);
    expect(new Set(merged.map((item) => item.id)).size).toBe(40);
  });
});

describe("fetchAdminPluginReviews：筛选参数要发到服务端", () => {
  it("带 status/limit 时 URL 含 status=hidden&limit=20", async () => {
    const calls = stubFetchJson(EMPTY_ADMIN);
    await fetchAdminPluginReviews({ status: "hidden", limit: 20 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/api/hub/admin/plugin-reviews");
    expect(calls[0]).toContain("status=hidden&limit=20");
  });

  it("无参数时 URL 不带 ?（管理台默认列表零变化）", async () => {
    const calls = stubFetchJson(EMPTY_ADMIN);
    await fetchAdminPluginReviews({});
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe("/api/hub/admin/plugin-reviews");
    expect(calls[0]).not.toContain("?");
  });
});
