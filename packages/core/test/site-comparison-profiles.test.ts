/**
 * Batch0-02（W4）：对照表新增 best_for / not_for / license / alternatives 四格。
 *
 * 契约（细化方案 §2.3 / §9-9）：
 *  - 四格复用 ComparisonCell {value, source, verified, verifiedAt}；
 *  - 入参 profile 只接 W3 的 site_profiles 行（verified 行才算数）；
 *  - 缺失（无 profile、字段为空、draft 态）一律 verified:false、value:null，
 *    绝不编造值；不设 winner（item 上不得出现 winner 键）。
 *  - 价格四件套（amountMinor/currency/period/sourceUrl）+ freeTierLimit
 *    的接线不动（见 site-comparison-price.test.ts），本文件只断言新四格
 *    不破坏既有 price 格。
 */
import { describe, expect, it } from "vitest";
import {
  buildSiteComparison,
  type Site,
  type SiteComparisonFavorite,
  type SiteProfileEntry,
} from "../src/index.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-19T12:00:00+08:00");

function site(): Site {
  return {
    id: "site-a",
    url: "https://a.example.com",
    title: "甲工具",
    categoryId: "cat-1",
    tags: [],
    status: "active",
    enabled: true,
    sort: 0,
    weight: 0,
    facets: { pricing: ["freemium"], platform: ["web"], form: ["saas"] },
    health: { ok: true, lastCheckedAt: NOW },
    updatedAt: NOW,
  } as unknown as Site;
}

const favorite: SiteComparisonFavorite = {
  siteId: "site-a",
  note: "备注原文",
  tags: ["PPT"],
  updatedAt: NOW,
};

function profile(overrides: Partial<SiteProfileEntry> = {}): SiteProfileEntry {
  return {
    bestFor: "个人轻量写作",
    notFor: "不支持团队协作",
    license: "MIT",
    alternatives: ["site-b", "site-c"],
    sourceUrl: "https://a.example.com/pricing",
    verifiedAt: NOW - 10 * DAY_MS,
    status: "verified",
    ...overrides,
  };
}

describe("buildSiteComparison：档案四格（verified 行）", () => {
  it("verified 行：四格全部 verified:true，值与来源逐字一致", () => {
    const item = buildSiteComparison([{ site: site(), favorite, profile: profile() }], NOW)[0]!;
    expect(item.best_for).toMatchObject({
      value: "个人轻量写作",
      source: "站点档案",
      verified: true,
      verifiedAt: NOW - 10 * DAY_MS,
    });
    expect(item.not_for).toMatchObject({
      value: "不支持团队协作",
      source: "站点档案",
      verified: true,
      verifiedAt: NOW - 10 * DAY_MS,
    });
    expect(item.license).toMatchObject({ value: "MIT", source: "站点档案", verified: true });
    expect(item.alternatives).toMatchObject({
      value: ["site-b", "site-c"],
      source: "站点档案",
      verified: true,
    });
  });

  it("无 profile：四格全部 verified:false、value:null，不编造值", () => {
    const item = buildSiteComparison([{ site: site(), favorite }], NOW)[0]!;
    for (const key of ["best_for", "not_for", "license", "alternatives"] as const) {
      expect(item[key].value).toBeNull();
      expect(item[key].verified).toBe(false);
      expect(item[key].verifiedAt).toBeNull();
    }
  });

  it("draft 态：永不放行，四格按缺失处理", () => {
    const item = buildSiteComparison(
      [{ site: site(), favorite, profile: profile({ status: "draft" }) }],
      NOW,
    )[0]!;
    for (const key of ["best_for", "not_for", "license", "alternatives"] as const) {
      expect(item[key].value).toBeNull();
      expect(item[key].verified).toBe(false);
      expect(item[key].verifiedAt).toBeNull();
    }
  });

  it("verified 行但某字段为空：只该格未验证，其余格不受影响", () => {
    const item = buildSiteComparison(
      [{ site: site(), favorite, profile: profile({ notFor: null, alternatives: null }) }],
      NOW,
    )[0]!;
    expect(item.not_for.value).toBeNull();
    expect(item.not_for.verified).toBe(false);
    expect(item.alternatives.value).toBeNull();
    expect(item.alternatives.verified).toBe(false);
    expect(item.best_for.verified).toBe(true);
    expect(item.best_for.value).toBe("个人轻量写作");
    expect(item.license.verified).toBe(true);
  });

  it("不设 winner：item 上不得出现 winner 键", () => {
    const item = buildSiteComparison([{ site: site(), favorite, profile: profile() }], NOW)[0]!;
    expect("winner" in item).toBe(false);
  });

  it("新四格不破坏 price 格接线（四件套 + 免费档照旧）", () => {
    const item = buildSiteComparison(
      [
        {
          site: site(),
          favorite,
          profile: profile(),
          price: {
            amountMinor: 1990,
            currency: "CNY",
            period: "month",
            freeTierLimit: "100次/月",
            sourceType: "manual",
            sourceUrl: null,
            verifiedAt: NOW,
          },
        },
      ],
      NOW,
    )[0]!;
    expect(item.price).toMatchObject({ value: "¥19.9/月 · 免费档100次/月", verified: true });
    expect(item.best_for.verified).toBe(true);
  });
});
