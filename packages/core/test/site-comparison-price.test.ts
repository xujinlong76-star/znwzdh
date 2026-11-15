/**
 * Batch 4 Phase 2 P2-2：价格数值字段——core 纯函数测试。
 *
 * 覆盖准备文档 §1“测试计划”的 core 部分：
 *  - 三档过期边界：90 天整 = fresh、180 天整 = stale、180 天+1ms = expired；
 *  - 四件套缺一件不出数值（amount / currency / period / verifiedAt），
 *    pricing 定性档照旧兜底（price 格本身为未验证）；
 *  - formatSitePrice 各货币/周期（符号、/月/年/次/用量、免费档后缀、JPY/KRW 无小数位）；
 *  - stale 标记只在 90–180 天出现（fresh 与 expired 均不带 stale）；
 *  - expired 值仍保留（灰显用），source 与 verifiedAt 保留；
 *  - buildSiteComparison 的 price 格随输入走，不参与排序/打分/推荐
 *    （本文件只断言格子形态，不做顺序断言）。
 */
import { describe, expect, it } from "vitest";
import {
  buildSiteComparison,
  formatSitePrice,
  getPriceStaleness,
  type Site,
  type SiteComparisonFavorite,
  type SitePriceEntry,
} from "../src/index.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-14T12:00:00Z");

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
    facets: { pricing: ["paid"], platform: ["web"], form: ["saas"] },
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

function price(overrides: Partial<SitePriceEntry> = {}): SitePriceEntry {
  return {
    amountMinor: 1990,
    currency: "CNY",
    period: "month",
    freeTierLimit: "100次/月",
    sourceType: "manual",
    sourceUrl: null,
    verifiedAt: NOW,
    ...overrides,
  };
}

describe("getPriceStaleness：三档过期边界", () => {
  it("恰好 90 天整 = fresh", () => {
    expect(getPriceStaleness(NOW - 90 * DAY_MS, NOW)).toBe("fresh");
    expect(getPriceStaleness(NOW - 90 * DAY_MS + 1, NOW)).toBe("fresh");
  });

  it("90 天+1ms = stale；恰好 180 天整 = stale", () => {
    expect(getPriceStaleness(NOW - 90 * DAY_MS - 1, NOW)).toBe("stale");
    expect(getPriceStaleness(NOW - 180 * DAY_MS, NOW)).toBe("stale");
  });

  it("180 天+1ms = expired", () => {
    expect(getPriceStaleness(NOW - 180 * DAY_MS - 1, NOW)).toBe("expired");
    expect(getPriceStaleness(NOW - 365 * DAY_MS, NOW)).toBe("expired");
  });
});

describe("formatSitePrice：各货币/周期", () => {
  it("CNY ¥19.9/月 · 免费档100次/月", () => {
    expect(formatSitePrice(price())).toBe("¥19.9/月 · 免费档100次/月");
  });

  it("去尾零：2000 → 20，1999 → 19.99；无免费档不追加后缀", () => {
    expect(formatSitePrice(price({ amountMinor: 2000, freeTierLimit: null }))).toBe("¥20/月");
    expect(formatSitePrice(price({ amountMinor: 1999, freeTierLimit: null }))).toBe("¥19.99/月");
  });

  it("各货币符号与周期后缀", () => {
    expect(formatSitePrice(price({ currency: "USD", period: "year", amountMinor: 9900, freeTierLimit: null }))).toBe("$99/年");
    expect(formatSitePrice(price({ currency: "EUR", period: "once", amountMinor: 500, freeTierLimit: null }))).toBe("€5/次");
    expect(formatSitePrice(price({ currency: "GBP", period: "usage", amountMinor: 250, freeTierLimit: null }))).toBe("£2.5/用量");
    expect(formatSitePrice(price({ currency: "HKD", amountMinor: 1000, freeTierLimit: null }))).toBe("HK$10/月");
    expect(formatSitePrice(price({ currency: "AUD", amountMinor: 1000, freeTierLimit: null }))).toBe("A$10/月");
    expect(formatSitePrice(price({ currency: "CAD", amountMinor: 1000, freeTierLimit: null }))).toBe("C$10/月");
    expect(formatSitePrice(price({ currency: "SGD", amountMinor: 1000, freeTierLimit: null }))).toBe("S$10/月");
  });

  it("JPY/KRW 无小数位：金额不除以 100", () => {
    expect(formatSitePrice(price({ currency: "JPY", amountMinor: 500, freeTierLimit: null }))).toBe("¥500/月");
    expect(formatSitePrice(price({ currency: "KRW", amountMinor: 9900, freeTierLimit: null }))).toBe("₩9900/月");
  });
});

describe("buildSiteComparison 的 price 格", () => {
  function build(entry: SitePriceEntry | null | undefined, now: number = NOW) {
    return buildSiteComparison([{ site: site(), favorite, price: entry }], now)[0]!.price;
  }

  it("fresh：verified true，无 stale 标记，值与来源齐全", () => {
    const cell = build(price({ verifiedAt: NOW - 10 * DAY_MS }));
    expect(cell).toMatchObject({
      value: "¥19.9/月 · 免费档100次/月",
      source: "手工填写",
      verified: true,
      verifiedAt: NOW - 10 * DAY_MS,
    });
    expect(cell.stale).toBeUndefined();
  });

  it("stale（90–180 天）：verified 仍为 true，且只在这一档带 stale: true", () => {
    const cell = build(price({ verifiedAt: NOW - 100 * DAY_MS }));
    expect(cell.verified).toBe(true);
    expect(cell.stale).toBe(true);
    expect(cell.value).toBe("¥19.9/月 · 免费档100次/月");
  });

  it("expired（>180 天）：verified false，值仍保留（灰显用），source 与 verifiedAt 保留", () => {
    const cell = build(price({ verifiedAt: NOW - 200 * DAY_MS }));
    expect(cell.verified).toBe(false);
    expect(cell.stale).toBeUndefined();
    expect(cell.value).toBe("¥19.9/月 · 免费档100次/月");
    expect(cell.source).toBe("手工填写");
    expect(cell.verifiedAt).toBe(NOW - 200 * DAY_MS);
  });

  it("官方抓取来源：source 为“官方定价页”，sourceUrl 透出", () => {
    const cell = build(
      price({ sourceType: "official_scrape", sourceUrl: "https://a.example.com/pricing" }),
    );
    expect(cell.source).toBe("官方定价页");
    expect(cell.sourceUrl).toBe("https://a.example.com/pricing");
    expect(cell.verified).toBe(true);
  });

  it("四件套缺一件不出数值：无记录 / 金额缺失 / 货币缺失 / 周期缺失 / 核实时间缺失", () => {
    const cases: Array<SitePriceEntry | null | undefined> = [
      null,
      undefined,
      price({ amountMinor: Number.NaN }),
      price({ currency: "" }),
      price({ period: "" }),
      price({ verifiedAt: Number.NaN }),
    ];
    for (const entry of cases) {
      const cell = build(entry);
      expect(cell.value).toBeNull();
      expect(cell.verified).toBe(false);
      expect(cell.verifiedAt).toBeNull();
    }
    // pricing 定性档照旧兜底：price 格未验证不影响 pricing 格
    const item = buildSiteComparison([{ site: site(), favorite, price: null }], NOW)[0]!;
    expect(item.pricing).toMatchObject({ value: "商业付费", verified: true });
  });

  it("无价格记录时 sourceUrl 为 null（前端抓取按钮不启用）", () => {
    expect(build(null).sourceUrl).toBeNull();
    expect(build(undefined).sourceUrl).toBeNull();
  });
});
