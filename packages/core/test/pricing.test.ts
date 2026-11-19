/**
 * A3 定价推导（pricing.ts）回归：
 * 1. 人工核实覆盖表优先，键归一化（www./大小写/尾斜杠）不影响命中；
 * 2. 强信号规则收紧：裸「免费」不判 free、「免费试用」判 freemium 而非 free；
 * 3. 无证据一律 unknown，绝不猜；
 * 4. 数据完整性：线上导航 375 站逐站过推导，确定值/未标注集合与撰写时的
 *    核实结论一致（新增站点落 unknown 是预期——提醒后来者先核实再入表）。
 *    2026-11-15 T5 元宝收录：元宝搜索已核实并入 pricing-overrides（free），确定值 303→304、未标注仍 30。
 *    2026-11-15 卸载合集：GitHub Trending 已在 pricing-overrides（free），确定值 304→305、未标注仍 30。
 *    2026-11-15 升级第 8 条：30 站未标注逐站核实入表（音频 11 + 写作/其它 10 + 考试政务 8；free 9、freemium 21），确定值 305→335、未标注 30→0。
 *    2026-11-16 进化第 89 轮 B 线：补齐「AI 搜索知识」二级 5 站并入 pricing-overrides（free 1、freemium 4），确定值 335→340、未标注仍 0。
 *    2026-11-16 进化第 92 轮 D 线：补站「编程学习」二级 2 站并入 pricing-overrides（free 2），确定值 340→342、未标注仍 0。
 *    2026-11-17 进化轮 U-22：补 5 站（Todoist/Make/Descript/OpusClip/Gemini Notebook）并入 pricing-overrides（freemium 5），确定值 341→346、未标注仍 0。
 *    2026-11-18 进化轮 05:22：补站微博并入 pricing-overrides（freemium），确定值 346→347、未标注仍 0。
 *    2026-11-19 进化轮 16:22：补站 U-08（SkyReels/讯飞绘镜）并入 pricing-overrides（freemium 2），确定值 347→349、未标注仍 0。
 *    2026-11-19 修复 U-246：补站 U-08（配色与色板：Paletton/Color Hunt/Khroma；编程学习：The Odin Project；在线课程：edX），Paletton/Color Hunt/Khroma 入 pricing-overrides（free 3）、edX 入表（freemium 1），The Odin Project 经强信号规则命中 open_source，确定值 349→354、未标注仍 0。
 *    2026-11-19 进化轮 21:22：补站 U-08（UI 资源素材：Photopea；气象与环境：Windy；数字图书馆：Internet Archive/Open Library；免费短剧：ShortMax/GoodShort/NetShort；学习路线：CS自学指南/JavaGuide/W3Schools/Exercism）并入 pricing-overrides（freemium 6、free 3、open_source 2），确定值 354→365、未标注仍 0。
 *    2026-11-19 进化轮 22:22：补站 U-08（影视评分：Rotten Tomatoes/Metacritic）并入 pricing-overrides（free 2），确定值 365→367、未标注仍 0。
 *    2026-11-19 进化轮 23:22：补站 U-08（官方文档：Python 官方文档/Go 官方文档）并入 pricing-overrides（free 2），确定值 367→369、未标注仍 0。
 *    2026-11-20 进化轮 00:22：补站 U-08（配色与色板：Colormind/Happy Hues）并入 pricing-overrides（free 2），确定值 369→371、未标注仍 0。
 *    2026-11-20 进化轮 01:22：补站 U-08（免费短剧：FlexTV/MoboReels）并入 pricing-overrides（freemium 2），确定值 371→373、未标注仍 0。注：首选 ReelShort 已在平台短剧叶入库；第二站弃 Melolo（官网仅 App 下载页、无网页端在线看）改用 MoboReels（网页端可直接看剧）。
 *    2026-11-20 进化轮 02:22：补站 U-08（问答社区：V2EX/百度知道）并入 pricing-overrides（free 2），确定值 373→375、未标注仍 0。
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

describe("导航 375 站全量推导（数据完整性基线）", () => {
  const navPath = fileURLToPath(new URL("../../../apps/web-overlay/src/navsphere/content/navigation.json", import.meta.url));
  const nav = JSON.parse(readFileSync(navPath, "utf8")) as {
    navigationItems: Array<{
      subCategories: Array<{ items: Array<{ title: string; href: string; description?: string; tags?: string[] }> }>;
    }>;
  };
  const sites = nav.navigationItems.flatMap((c) => c.subCategories.flatMap((s) => s.items));

  it("共 375 站", () => {
    expect(sites.length).toBe(375);
  });

  it("确定值 375 站、未标注为 0（30 站已于 2026-11-15 逐站核实入表）", () => {
    const unknownTitles: string[] = [];
    let determinate = 0;
    for (const s of sites) {
      const r = derivePricing({ url: s.href, title: s.title, description: s.description, tags: s.tags }, PRICING_OVERRIDES);
      if (r.value === "unknown") unknownTitles.push(s.title);
      else determinate++;
    }
    expect(determinate).toBe(375);
    expect(unknownTitles).toEqual([]);
  });
});
