/**
 * 搜索作用域编解码（U-374）：写侧（/api/search 记录时）与读侧（历史页
 * 「再次搜索」恢复时）共用同一份实现，见 packages/core/src/search-scope.ts。
 */
import { describe, expect, it } from "vitest";
import { decodeSearchScope, encodeSearchScope } from "../src/search-scope.ts";

describe("encodeSearchScope", () => {
  it("无作用域时返回 ''（列是 NOT NULL，旧行与空作用域都存空串）", () => {
    expect(encodeSearchScope(undefined)).toBe("");
    expect(encodeSearchScope(null)).toBe("");
    expect(encodeSearchScope({})).toBe("");
    expect(encodeSearchScope({ category: "  ", tag: "" })).toBe("");
  });

  it("category/tag/facets 只保留非空键", () => {
    expect(encodeSearchScope({ category: "ai-tools", tag: "chat" })).toBe(
      JSON.stringify({ category: "ai-tools", tag: "chat" }),
    );
    expect(
      encodeSearchScope({ category: "ai-tools", facets: { pricing: ["free"] } }),
    ).toBe(JSON.stringify({ category: "ai-tools", facets: { pricing: ["free"] } }));
  });

  it("category/tag 超长截断到与 /api/search 同形的上限", () => {
    const encoded = encodeSearchScope({ category: "c".repeat(100), tag: "t".repeat(100) });
    const decoded = JSON.parse(encoded) as { category: string; tag: string };
    expect(decoded.category).toBe("c".repeat(64));
    expect(decoded.tag).toBe("t".repeat(40));
  });

  it("非法 facets 被丢掉而不是让整行写失败", () => {
    expect(encodeSearchScope({ category: "x", facets: { pricing: [""] } })).toBe(
      JSON.stringify({ category: "x" }),
    );
  });
});

describe("decodeSearchScope", () => {
  it("空串/非字符串/非法 JSON 一律退回 {}，永不抛错", () => {
    expect(decodeSearchScope("")).toEqual({});
    expect(decodeSearchScope(undefined)).toEqual({});
    expect(decodeSearchScope(null)).toEqual({});
    expect(decodeSearchScope("not-json{")).toEqual({});
    expect(decodeSearchScope("[1,2]")).toEqual({});
    expect(decodeSearchScope("123")).toEqual({});
  });

  it("往返一致：encode 后 decode 还原 category/tag/facets", () => {
    const scope = { category: "ai-tools", tag: "chat", facets: { pricing: ["free", "freemium"] } };
    expect(decodeSearchScope(encodeSearchScope(scope))).toEqual(scope);
  });

  it("脏字段被丢掉，只保留合法的 category/tag/facets", () => {
    expect(
      decodeSearchScope(JSON.stringify({ category: "ai", tag: 123, evil: "x", facets: "nope" })),
    ).toEqual({ category: "ai" });
  });

  it("facets 值被归一化（键与值小写、去空），与 /api/search 同口径", () => {
    expect(
      decodeSearchScope(JSON.stringify({ facets: { Pricing: ["FREE", ""] } })),
    ).toEqual({ facets: { pricing: ["free"] } });
  });

  it("facets 清洗与 clampFacetFilter 对「接受/丢弃」一致（防两处悄悄分叉）", async () => {
    const { clampFacetFilter } = await import("../src/facets.ts");
    const matrices: unknown[] = [
      { pricing: ["free", "freemium"] },
      { pricing: ["FREE", ""] },
      { Pricing: ["free"] },
      { pricing: [""] },
      { pricing: "free,freemium" },
      { pricing: [123] },
      { pricing: [null] },
      { bad: ["x".repeat(101)] },
      { ["k".repeat(51)]: ["v"] },
      Object.fromEntries(Array.from({ length: 21 }, (_, i) => ["k" + i, ["v"]])),
      { pricing: Array.from({ length: 201 }, (_, i) => "v" + i) },
      "not-an-object",
      [1, 2],
      null,
    ];
    for (const facets of matrices) {
      const clamped = clampFacetFilter(facets);
      const viaScope = decodeSearchScope(JSON.stringify({ category: "x", facets }));
      if (clamped.error || !clamped.facets) {
        // clamp 拒绝或判空时，scope 侧也不应带 facets（category 本身仍保留）。
        expect(viaScope, JSON.stringify(facets)).toEqual({ category: "x" });
      } else {
        expect(viaScope, JSON.stringify(facets)).toEqual({ category: "x", facets: clamped.facets });
      }
    }
  });
});
