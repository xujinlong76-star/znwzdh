/**
 * A3 定价推导（pricing.ts）回归：
 * 1. 人工核实覆盖表优先，键归一化（www./大小写/尾斜杠）不影响命中；
 * 2. 强信号规则收紧：裸「免费」不判 free、「免费试用」判 freemium 而非 free；
 * 3. 无证据一律 unknown，绝不猜；
 * 4. 数据完整性：线上导航 333 站逐站过推导，确定值/未标注集合与撰写时的
 *    核实结论一致（新增站点落 unknown 是预期——提醒后来者先核实再入表）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  derivePricing,
  lookupPricingOverride,
  pricingOverrideKey,
  type PricingOverride,
  type PricingOverrides,
} from "../src/pricing.ts";

/** 测试自己读覆盖表（core 零 IO，覆盖表由调用方注入，测试文件可用 node:fs）。 */
const PRICING_OVERRIDES = JSON.parse(
  readFileSync(fileURLToPath(new URL("../src/pricing-overrides.json", import.meta.url)), "utf8"),
) as Record<string, PricingOverride>;

describe("pricingOverrideKey 归一化", () => {
  it("去掉 www.、协议与尾斜杠，host 小写", () => {
    expect(pricingOverrideKey("https://www.DramaBoxDB.com/")).toBe("dramaboxdb.com");
    expect(pricingOverrideKey("https://github.com/langgenius/dify/")).toBe("github.com/langgenius/dify");
  });
  it("非法 URL 返回 null", () => {
    expect(pricingOverrideKey("not a url")).toBeNull();
  });
});

describe("derivePricing 覆盖表优先", () => {
  it("短剧三家与证据一致：红果 free / DramaBox freemium / ReelShort freemium", () => {
    expect(derivePricing({ url: "https://hongguoduanju.com" }, PRICING_OVERRIDES).value).toBe("free");
    expect(derivePricing({ url: "https://www.dramaboxdb.com" }, PRICING_OVERRIDES).value).toBe("freemium");
    expect(derivePricing({ url: "https://www.reelshort.com" }, PRICING_OVERRIDES).value).toBe("freemium");
  });
  it("Midjourney paid / Dify open_source / Cursor freemium", () => {
    expect(derivePricing({ url: "https://midjourney.com" }, PRICING_OVERRIDES).value).toBe("paid");
    expect(derivePricing({ url: "https://dify.ai" }, PRICING_OVERRIDES).value).toBe("open_source");
    expect(derivePricing({ url: "https://cursor.com" }, PRICING_OVERRIDES).value).toBe("freemium");
  });
  it("覆盖表条目都带非空 evidence 且值合法", () => {
    for (const [key, entry] of Object.entries(PRICING_OVERRIDES)) {
      expect(entry.evidence.trim().length, key).toBeGreaterThan(0);
      expect(["free", "freemium", "paid", "open_source"], key).toContain(entry.pricing);
    }
  });
  it("lookupPricingOverride 对未收录站点返回 null", () => {
    expect(lookupPricingOverride("https://never-heard-of-it.example.com", PRICING_OVERRIDES)).toBeNull();
  });
  it("不传覆盖表时覆盖表站点落规则/unknown，不再命中人工核实表", () => {
    const empty: PricingOverrides = {};
    expect(derivePricing({ url: "https://hongguoduanju.com" }, empty).value).toBe("unknown");
    expect(derivePricing({ url: "https://hongguoduanju.com" }, empty).source).toBe("unknown");
    expect(lookupPricingOverride("https://hongguoduanju.com", empty)).toBeNull();
  });
});

describe("derivePricing 强信号规则（收紧版）", () => {
  const d = (description: string) => derivePricing({ url: "https://x.example.com", description }, PRICING_OVERRIDES).value;
  it("明示开源 → open_source", () => {
    expect(d("一个开源的本地部署工具")).toBe("open_source");
  });
  it("前几集免费+会员解锁 → freemium（不是 free）", () => {
    expect(d("短剧平台，前几集免费，会员解锁全集")).toBe("freemium");
  });
  it("免费试用 → freemium（旧弱规则会误判 free）", () => {
    expect(d("注册即可免费试用全部功能")).toBe("freemium");
  });
  it("裸『免费』出现在中性句里 → unknown，绝不猜", () => {
    expect(d("提供免费咨询热线与帮助中心")).toBe("unknown");
    expect(d("一款很好用的工具")).toBe("unknown");
  });
  it("完全免费明示 → free；订阅制明示 → paid", () => {
    expect(d("完全免费的在线小工具集合")).toBe("free");
    expect(d("订阅制素材库，会员专享")).toBe("paid");
  });
});

describe("导航 333 站全量推导（数据完整性基线）", () => {
  const navPath = fileURLToPath(new URL("../../../apps/web-overlay/src/navsphere/content/navigation.json", import.meta.url));
  const nav = JSON.parse(readFileSync(navPath, "utf8")) as {
    navigationItems: Array<{
      subCategories: Array<{ items: Array<{ title: string; href: string; description?: string; tags?: string[] }> }>;
    }>;
  };
  const sites = nav.navigationItems.flatMap((c) => c.subCategories.flatMap((s) => s.items));

  it("共 333 站", () => {
    expect(sites.length).toBe(333);
  });

  it("确定值 303 站、未标注恰为核实不了的 30 站", () => {
    const unknownTitles: string[] = [];
    let determinate = 0;
    for (const s of sites) {
      const r = derivePricing({ url: s.href, title: s.title, description: s.description, tags: s.tags }, PRICING_OVERRIDES);
      if (r.value === "unknown") unknownTitles.push(s.title);
      else determinate++;
    }
    expect(determinate).toBe(303);
    expect(unknownTitles.sort()).toEqual(
      [
        "Java", "OpenAI", "Genmo", "有戏AI",
        "Jasper", "Copy.ai", "Writesonic", "Grammarly", "秘塔写作猫", "Sudowrite", "Wordtune",
        "Udio", "Soundraw", "AIVA", "Boomy", "Mubert", "Beatoven.ai", "Loudly",
        "Murf AI", "WellSaid", "NaturalReader", "魔音工坊",
        "2027年国家公务员考试专题", "中央机关公开遴选和公开选调专题",
        "学习强国", "12333 人社服务",
        "全国大学英语四、六级考试官网", "四六级成绩查询", "中国教育考试网", "考研网上报名",
      ].sort(),
    );
  });
});
