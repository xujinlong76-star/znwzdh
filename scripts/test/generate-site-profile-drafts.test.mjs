/**
 * generate-site-profile-drafts.mjs 的口径守卫（Batch0-02）。
 *
 * 钉住四处同步点与三条硬约束：
 *  1. pricingOverrideKey 与 core pricing.ts 同口径（行为用例）；
 *  2. PRICING_RULES 的正则源与 core pricing.ts 逐条一致（同序）；
 *  3. 裸“免费”二字不判 free（旧事故教训）；覆盖表优先于规则；
 *  4. 脚本绝不生成 best_for / not_for；license 只在 open_source +
 *     GitHub 仓库地址可推导时预填；
 *  5. 抽样确定性（同一种子同一样本）、配额合计 30、强制 2 站必在样本内、
 *     enabled=false 永不入样、mergeDrafts 永不覆盖 verified 行。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DRAFT_SEED,
  SAMPLE_QUOTAS,
  buildDraftRow,
  deriveLicenseUrl,
  derivePricingModel,
  flattenNavigation,
  mergeDrafts,
  pricingOverrideKey,
  sampleStratified,
} from "../generate-site-profile-drafts.mjs";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("pricingOverrideKey：与 core 同口径", () => {
  it("host+path、去 www、去尾部斜杠", () => {
    expect(pricingOverrideKey("https://www.chatgpt.com/")).toBe("chatgpt.com");
    expect(pricingOverrideKey("https://github.com/cline/cline/")).toBe("github.com/cline/cline");
    expect(pricingOverrideKey("https://example.com/a/b/?x=1")).toBe("example.com/a/b");
    expect(pricingOverrideKey("not a url")).toBeNull();
  });
});

describe("PRICING_RULES：与 core pricing.ts 逐条一致", () => {
  it("四条规则的正则源同序相等", () => {
    const core = read("../../packages/core/src/pricing.ts");
    const script = read("../generate-site-profile-drafts.mjs");
    const coreBlock = core.slice(core.indexOf("const PRICING_RULES"), core.indexOf("];", core.indexOf("const PRICING_RULES")));
    const scriptBlock = script.slice(
      script.indexOf("export const PRICING_RULES"),
      script.indexOf("];", script.indexOf("export const PRICING_RULES")),
    );
    const corePatterns = [...coreBlock.matchAll(/pattern:\s*(\/[^/]+\/[a-z]*)/g)].map((m) => m[1]);
    const scriptPatterns = [...scriptBlock.matchAll(/pattern:\s*(\/[^/]+\/[a-z]*)/g)].map((m) => m[1]);
    expect(corePatterns).toHaveLength(4);
    expect(scriptPatterns).toEqual(corePatterns);
  });
});

describe("derivePricingModel：覆盖表优先，裸免费不判 free", () => {
  const overrides = { "chatgpt.com": { pricing: "freemium", evidence: "官网设免费层" } };

  it("覆盖表命中即取覆盖值", () => {
    expect(derivePricingModel({ href: "https://chatgpt.com", title: "ChatGPT", description: "" }, overrides).value).toBe("freemium");
  });

  it("免费试用 → freemium（不是 free）", () => {
    const r = derivePricingModel({ href: "https://x.example.com", title: "甲", description: "新用户免费试用 7 天" }, {});
    expect(r.value).toBe("freemium");
    expect(r.source).toBe("rule");
  });

  it("裸“免费”二字 → unknown（旧事故：描述含免费不等于免费）", () => {
    const r = derivePricingModel({ href: "https://x.example.com", title: "甲", description: "免费注册即可使用" }, {});
    expect(r.value).toBe("unknown");
  });

  it("完全免费 → free；开源 → open_source", () => {
    expect(derivePricingModel({ href: "https://x.example.com", title: "甲", description: "永久免费使用" }, {}).value).toBe("free");
    expect(derivePricingModel({ href: "https://x.example.com", title: "甲", description: "开源项目" }, {}).value).toBe("open_source");
  });
});

describe("deriveLicenseUrl：只在可推导时预填", () => {
  it("GitHub 仓库地址 → LICENSE URL", () => {
    expect(deriveLicenseUrl({ href: "https://github.com/owner/repo" }, "open_source")).toBe(
      "https://github.com/owner/repo/blob/HEAD/LICENSE",
    );
    expect(deriveLicenseUrl({ href: "https://github.com/owner/repo/tree/main/docs" }, "open_source")).toBe(
      "https://github.com/owner/repo/blob/HEAD/LICENSE",
    );
  });

  it("非 open_source / 非 GitHub / 非仓库页 → null", () => {
    expect(deriveLicenseUrl({ href: "https://github.com/owner/repo" }, "freemium")).toBeNull();
    expect(deriveLicenseUrl({ href: "https://ollama.com" }, "open_source")).toBeNull();
    expect(deriveLicenseUrl({ href: "https://github.com/pricing" }, "open_source")).toBeNull();
    expect(deriveLicenseUrl({ href: "not a url" }, "open_source")).toBeNull();
  });
});

describe("buildDraftRow：硬约束", () => {
  it("草稿态、best_for/not_for 留空、三枚举缺省 unknown", () => {
    const row = buildDraftRow(
      { id: "s1", title: "甲", href: "https://github.com/o/r", description: "开源项目", tags: [] },
      {},
      1790000000000,
    );
    expect(row.profile_status).toBe("draft");
    expect(row.verified_by).toBe("draft-script");
    expect(row.profile_verified_at).toBe(1790000000000);
    expect(row.best_for).toBeNull();
    expect(row.not_for).toBeNull();
    expect(row.alternatives).toBeNull();
    expect(row.requires_account).toBe("unknown");
    expect(row.free_trial).toBe("unknown");
    expect(row.data_export).toEqual(["unknown"]);
    expect(row.pricing_model).toBe("open_source");
    expect(row.license).toBe("https://github.com/o/r/blob/HEAD/LICENSE");
  });

  it("非开源站 license 留空", () => {
    const row = buildDraftRow({ id: "s2", title: "乙", href: "https://x.example.com", description: "永久免费使用" }, {}, 1);
    expect(row.pricing_model).toBe("free");
    expect(row.license).toBeNull();
  });
});

describe("mergeDrafts：永不覆盖 verified 行", () => {
  it("verified 行原样保留，draft 行被新草稿替换", () => {
    const existing = [
      { site_id: "a", profile_status: "verified", best_for: "人工核实值" },
      { site_id: "b", profile_status: "draft", best_for: null },
    ];
    const fresh = [
      { site_id: "a", profile_status: "draft", best_for: null },
      { site_id: "b", profile_status: "draft", best_for: null, license: "MIT" },
      { site_id: "c", profile_status: "draft", best_for: null },
    ];
    const merged = mergeDrafts(existing, fresh);
    expect(merged.find((r) => r.site_id === "a")).toEqual(existing[0]);
    expect(merged.find((r) => r.site_id === "b")).toMatchObject({ license: "MIT" });
    expect(merged.map((r) => r.site_id)).toEqual(["a", "b", "c"]);
  });
});

describe("sampleStratified：30 站分层抽样", () => {
  /** 合成导航：14 类，每类站数按配额 ×3（保证可抽），另塞 1 个 open_source 与免费站 */
  function fixtureNav() {
    const categories = Object.keys(SAMPLE_QUOTAS);
    let n = 0;
    const navigationItems = categories.map((title) => {
      const quota = SAMPLE_QUOTAS[title];
      const items = Array.from({ length: quota * 3 }, (_, i) => ({
        id: `nav-${title}-${i}`,
        title: `${title}站${i}`,
        href: `https://${title}.example-${n++}.com/`,
        description: "普通站点",
        enabled: true,
      }));
      return { id: `cat-${title}`, title, items, subCategories: [] };
    });
    // AI 工具类里放 1 个 open_source（GitHub 仓库）与 1 个免费档站
    navigationItems[0].items[0] = {
      id: "nav-oss",
      title: "开源站",
      href: "https://github.com/acme/oss",
      description: "开源项目",
      enabled: true,
    };
    navigationItems[0].items[1] = {
      id: "nav-free",
      title: "免费站",
      href: "https://free.example.com",
      description: "永久免费使用",
      enabled: true,
    };
    // 学习成长类里放 1 个 enabled=false（永不入样）
    navigationItems[7].items.push({
      id: "nav-disabled",
      title: "停用站",
      href: "https://off.example.com",
      description: "",
      enabled: false,
    });
    return { navigationItems };
  }

  const sites = flattenNavigation(fixtureNav());

  it("合计 30 站、无重复、同一种子同一样本、停用站永不入样", () => {
    const a = sampleStratified(sites, { seed: DRAFT_SEED, overrides: {} });
    const b = sampleStratified(sites, { seed: DRAFT_SEED, overrides: {} });
    expect(a.record.total_sampled).toBe(30);
    expect(Object.values(a.record.per_category).reduce((x, y) => x + y, 0)).toBe(30);
    expect(a.record.sampled.map((s) => s.site_id)).toEqual(b.record.sampled.map((s) => s.site_id));
    expect(new Set(a.record.sampled.map((s) => s.site_id)).size).toBe(30);
    expect(a.record.sampled.map((s) => s.site_id)).not.toContain("nav-disabled");
    // 配额核算可审计：物理分布 + 强制抵扣说明能还原每类配额
    expect(a.record.quota_notes.length).toBeGreaterThan(0);
  });

  it("强制 2 站必在样本内：open_source 验 license、免费档替补 site_prices", () => {
    const { record } = sampleStratified(sites, {
      seed: DRAFT_SEED,
      overrides: {},
      pricedSiteIds: null,
      sitePricesCount: 0,
    });
    const ids = new Set(record.sampled.map((s) => s.site_id));
    expect(ids.has("nav-oss")).toBe(true);
    expect(record.forced.find((f) => f.slot === 1)?.site_id).toBe("nav-oss");
    expect(record.forced.find((f) => f.slot === 2)?.kind).toBe("free_tier");
    expect(record.site_prices.count).toBe(0);
  });

  it("site_prices 有记录时强制站 ② 抽有记录的站", () => {
    const priced = new Set(["nav-priced"]);
    const extra = [
      { id: "nav-priced", title: "有价站", href: "https://priced.example.com", description: "", tags: [], enabled: true, category: "学习成长" },
    ];
    const { record } = sampleStratified([...sites, ...extra], {
      seed: DRAFT_SEED,
      overrides: {},
      pricedSiteIds: priced,
      sitePricesCount: 1,
    });
    expect(record.forced.find((f) => f.slot === 2)?.kind).toBe("priced");
    expect(record.forced.find((f) => f.slot === 2)?.site_id).toBe("nav-priced");
    expect(new Set(record.sampled.map((s) => s.site_id)).has("nav-priced")).toBe(true);
  });
});
