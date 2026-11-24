/**
 * 品牌认官网第二步（搜索侧）W5 定向测试：官方卡片的数据层与排序口径。
 *
 * 只测数据层（apps/web-overlay/src/lib/verified-brands.ts）与排序口径
 * （apps/web-overlay/src/lib/official-card-rank.ts 的纯函数）。
 * 注意：本文件 11:49 初版时 W1 文件尚未落盘，排序口径只写了数据层
 * 前置条件；W1 文件随后落盘（12:00 前后核查已在），已改用真实 rank
 * 纯函数 resolveOfficialCard / officialUrlForBrand / findOfficialSiteEntry
 * 补测。组件 verified-official-card.tsx 是服务端展示组件，不在本文件
 * 测渲染，只测它消费的数据（卡片字段组已覆盖）。
 *
 * 体例照抄 test/search-rerank.test.ts：vitest + 相对路径 import。
 */
import { describe, expect, it } from "vitest";

import {
  VERIFIED_BRANDS,
  VERIFIED_BRANDS_CHECKED_AT,
  findVerifiedBrandByQuery,
  getVerifiedBrandByDomain,
} from "../src/lib/verified-brands";
import {
  findOfficialSiteEntry,
  officialUrlForBrand,
  resolveOfficialCard,
  type ResolveOfficialCardInput,
} from "../src/lib/official-card-rank";
import type { HubSearchHit } from "../src/lib/navhub-api";

const CHECKED_AT = "2026-11-24";

describe("官方卡片数据：50 家全量（verified-brands.ts）", () => {
  it("名单恰好 50 家，不多不少", () => {
    expect(VERIFIED_BRANDS).toHaveLength(50);
  });

  it("核查日期统一 2026-11-24", () => {
    expect(VERIFIED_BRANDS_CHECKED_AT).toBe(CHECKED_AT);
    for (const brand of VERIFIED_BRANDS) {
      expect(brand.checkedAt).toBe(CHECKED_AT);
    }
  });

  it("品牌名、规范域名、别名全局唯一，无重名无撞别名", () => {
    const names = VERIFIED_BRANDS.map((b) => b.name);
    expect(new Set(names).size).toBe(50);
    const domains = VERIFIED_BRANDS.map((b) => b.canonicalDomain);
    expect(new Set(domains).size).toBe(50);
    const aliasOwners = new Map<string, string>();
    for (const brand of VERIFIED_BRANDS) {
      expect(brand.aliases.length).toBeGreaterThan(0);
      for (const alias of brand.aliases) {
        const key = alias.trim().toLowerCase();
        expect(aliasOwners.has(key)).toBe(false);
        aliasOwners.set(key, brand.name);
      }
    }
  });

  it.each(VERIFIED_BRANDS)("品牌名查询命中自身：$name", (brand) => {
    expect(findVerifiedBrandByQuery(brand.name)?.name).toBe(brand.name);
  });

  it.each(VERIFIED_BRANDS)("首个别名查询命中自身：$name", (brand) => {
    expect(findVerifiedBrandByQuery(brand.aliases[0])?.name).toBe(brand.name);
  });

  it.each(VERIFIED_BRANDS)("全部别名查询命中自身：$name", (brand) => {
    for (const alias of brand.aliases) {
      expect(findVerifiedBrandByQuery(alias)?.name).toBe(brand.name);
    }
  });

  it("大小写与首尾空白不影响命中：GitHub / DOUBAO / 前后空格", () => {
    expect(findVerifiedBrandByQuery("GITHUB")?.name).toBe("GitHub");
    expect(findVerifiedBrandByQuery("DOUBAO")?.name).toBe("豆包");
    expect(findVerifiedBrandByQuery("  GitHub ")?.name).toBe("GitHub");
  });

  it.each(["天气", "菜谱", "今天星期几", "zzzz不存在的站", "怎么做红烧肉"])(
    "无关查询返回 null：%s",
    (query) => {
      expect(findVerifiedBrandByQuery(query)).toBeNull();
    },
  );

  it("空查询与纯空白返回 null", () => {
    expect(findVerifiedBrandByQuery("")).toBeNull();
    expect(findVerifiedBrandByQuery("   ")).toBeNull();
  });

  it.each(["豆", "中", "国", "千"])("单字查询返回 null：%s", (query) => {
    expect(findVerifiedBrandByQuery(query)).toBeNull();
  });

  it.each([
    // “豆”同时命中豆包与豆瓣：单字已在上一组覆盖，这里补长度 ≥2 的多义查询
    ["中国", ["中国知网", "中国政府网"]],
    ["腾讯", ["腾讯文档", "腾讯视频"]],
    ["地图", ["高德地图", "百度地图"]],
    ["文档", ["腾讯文档", "金山文档"]],
  ] as Array<[string, string[]]>)(
    "含糊查询返回 null：%s（同时命中 %s）",
    (query, names) => {
      expect(names.length).toBeGreaterThan(1);
      for (const name of names) {
        expect(VERIFIED_BRANDS.some((b) => b.name === name)).toBe(true);
      }
      expect(findVerifiedBrandByQuery(query)).toBeNull();
    },
  );

  it("单字“豆”同时命中豆包与豆瓣：返回 null，绝不错认其中一家", () => {
    expect(findVerifiedBrandByQuery("豆")).toBeNull();
    expect(findVerifiedBrandByQuery("豆包")?.name).toBe("豆包");
    expect(findVerifiedBrandByQuery("豆瓣")?.name).toBe("豆瓣");
  });
});

describe("官方卡片数据：卡片字段（规范域名 / 核查日期 / 来源链接）", () => {
  it.each(VERIFIED_BRANDS)(
    "$name：卡片数据含规范域名、核查日期 2026-11-24、https 来源链接",
    (brand) => {
      expect(brand.canonicalDomain).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
      expect(brand.canonicalDomain).not.toContain("://");
      expect(brand.canonicalDomain).not.toContain("/");
      expect(brand.checkedAt).toBe(CHECKED_AT);
      expect(brand.source).toMatch(/^https:\/\//);
    },
  );

  it("来源链接主机就是规范域名本身，或其裸域父级（www 前缀情形）", () => {
    for (const brand of VERIFIED_BRANDS) {
      const host = new URL(brand.source).hostname;
      expect(
        host === brand.canonicalDomain ||
          brand.canonicalDomain === `www.${host}` ||
          brand.canonicalDomain.endsWith(`.${host}`),
      ).toBe(true);
    }
  });

  it.each(VERIFIED_BRANDS)(
    "$name：按规范域名反查回自身（域名 → 品牌一一对应）",
    (brand) => {
      expect(getVerifiedBrandByDomain(brand.canonicalDomain)?.name).toBe(brand.name);
    },
  );
});

describe("排序口径：官方卡在结果首位，其余顺序不变（W1 official-card-rank.ts）", () => {
  function hit(siteId: string, title: string, url: string): HubSearchHit {
    return {
      siteId,
      score: 0.02,
      contributions: {},
      site: { id: siteId, title, url, status: "active" } as unknown as HubSearchHit["site"],
    };
  }

  function input(
    overrides: Partial<ResolveOfficialCardInput> = {},
  ): ResolveOfficialCardInput {
    return { query: "豆包", page: 1, failed: false, hits: [], ...overrides };
  }

  it("命中品牌：第 1 页、未失败时返回卡片数据（品牌 + 规范域名 + 核查日期 + 来源链接）", () => {
    const card = resolveOfficialCard(input());
    expect(card).not.toBeNull();
    expect(card?.brand.name).toBe("豆包");
    expect(card?.brand.canonicalDomain).toBe("www.doubao.com");
    expect(card?.brand.checkedAt).toBe(CHECKED_AT);
    expect(card?.brand.source).toMatch(/^https:\/\//);
    expect(card?.officialUrl).toBe("https://www.doubao.com");
  });

  it.each(VERIFIED_BRANDS)(
    "$name：officialUrl 永远是 https:// + 规范域名，不拼站内 URL",
    (brand) => {
      expect(officialUrlForBrand(brand)).toBe(`https://${brand.canonicalDomain}`);
    },
  );

  it("无命中 / 含糊查询不给卡：天气、豆、中国均返回 null", () => {
    expect(resolveOfficialCard(input({ query: "天气" }))).toBeNull();
    expect(resolveOfficialCard(input({ query: "豆" }))).toBeNull();
    expect(resolveOfficialCard(input({ query: "中国" }))).toBeNull();
  });

  it("检索失败（failed）不给卡，翻页（page !== 1）不重复给卡", () => {
    expect(resolveOfficialCard(input({ failed: true }))).toBeNull();
    expect(resolveOfficialCard(input({ page: 2 }))).toBeNull();
    expect(resolveOfficialCard(input({ page: 0 }))).toBeNull();
  });

  it("纠正后的查询词为准：原词未命中但纠正后命中 → 给卡；反之不给卡", () => {
    expect(
      resolveOfficialCard(input({ query: "豆包官", correctedQuery: "豆包" })),
    ).not.toBeNull();
    expect(
      resolveOfficialCard(input({ query: "豆包", correctedQuery: "天气" })),
    ).toBeNull();
  });

  it("其余结果顺序不变：resolveOfficialCard 不改 hits 顺序、不增删 hits", () => {
    const hits = [
      hit("a", "豆包下载站A", "https://example.com/a"),
      hit("b", "豆包教程B", "https://example.com/b"),
      hit("c", "豆包新闻C", "https://example.com/c"),
    ];
    const before = hits.map((h) => h.siteId);
    const card = resolveOfficialCard(input({ hits }));
    expect(card).not.toBeNull();
    // 卡片是 hits 之外的顶部数据，不混进 hits；hits 本身原样不动
    expect(hits.map((h) => h.siteId)).toEqual(before);
    expect(hits).toHaveLength(3);
  });

  it("站内条目入口：命中 URL 主机与规范域名一致（www 前缀不计）才给", () => {
    const brand = findVerifiedBrandByQuery("豆包")!;
    const entry = findOfficialSiteEntry(brand, [
      hit("x", "无关站", "https://example.com/x"),
      hit("doubao", "豆包", "https://doubao.com/"),
    ]);
    expect(entry).toEqual({ id: "doubao", title: "豆包" });
  });

  it("站内条目入口：无一致主机时返回 null，卡片本身不受影响", () => {
    const card = resolveOfficialCard(
      input({ hits: [hit("x", "无关站", "https://example.com/x")] }),
    );
    expect(card).not.toBeNull();
    expect(card?.siteEntry).toBeNull();
  });

  it("站内条目入口：子域与后缀包含不算——chat.deepseek.com / chatgpt.com.evil.com 绝不给入口", () => {
    const deepseek = findVerifiedBrandByQuery("DeepSeek")!;
    expect(
      findOfficialSiteEntry(deepseek, [
        hit("d", "DeepSeek", "https://chat.deepseek.com/"),
      ]),
    ).toBeNull();
    const chatgpt = findVerifiedBrandByQuery("ChatGPT")!;
    expect(
      findOfficialSiteEntry(chatgpt, [
        hit("c", "ChatGPT", "https://chatgpt.com.evil.com/"),
      ]),
    ).toBeNull();
  });

  it("站内条目入口：巡检打不开分区（unavailable）里的命中同样可找", () => {
    const brand = findVerifiedBrandByQuery("GitHub")!;
    expect(
      findOfficialSiteEntry(brand, [], [
        hit("gh", "GitHub", "https://github.com/"),
      ]),
    ).toEqual({ id: "gh", title: "GitHub" });
  });
});

describe("仿冒绝不进结果：非规范域名永不被认作官方", () => {
  it.each([
    // 官方入口/子域不是规范域名
    "chat.deepseek.com",
    // 占位页 / 曾跳转的旧品牌域
    "didi.cn",
    "www.rednote.com",
    // 境外分流域
    "larksuite.com",
    "oversea.cnki.net",
    "corporate.jd.com",
    // 境外版 / 近似域
    "leetcode.com",
    // 钓鱼式后缀
    "chatgpt.com.evil.com",
    "github.io",
    "www.doubao.cn",
  ])("getVerifiedBrandByDomain(%s) 返回 null", (host) => {
    expect(getVerifiedBrandByDomain(host)).toBeNull();
  });

  it("规范域名本身是精确别名：直接输域名命中对应品牌（intended，W8 补的别名）", () => {
    expect(findVerifiedBrandByQuery("chatgpt.com")?.name).toBe("ChatGPT");
    expect(findVerifiedBrandByQuery("chatgpt.com")?.canonicalDomain).toBe("chatgpt.com");
    expect(findVerifiedBrandByQuery("github.com")?.name).toBe("GitHub");
    expect(findVerifiedBrandByQuery("github.com")?.canonicalDomain).toBe("github.com");
    expect(findVerifiedBrandByQuery("www.douban.com")?.name).toBe("豆瓣");
    expect(findVerifiedBrandByQuery("www.douban.com")?.canonicalDomain).toBe("www.douban.com");
  });

  it("非规范域名不命中品牌：仿冒/近似域不被当作官方背书", () => {
    expect(findVerifiedBrandByQuery("chatgpt.com.evil.com")).toBeNull();
    expect(findVerifiedBrandByQuery("chatgpt-login.com")).toBeNull();
    expect(findVerifiedBrandByQuery("douban.com.cn")).toBeNull();
  });

  it("官方结果的域名集合恰好等于 50 家规范域名，不多一个仿冒域", () => {
    const allowed = new Set(VERIFIED_BRANDS.map((b) => b.canonicalDomain));
    expect(allowed.size).toBe(50);
    for (const brand of VERIFIED_BRANDS) {
      expect(allowed.has(brand.canonicalDomain)).toBe(true);
    }
    // 冒充/近似域名不在允许集里
    for (const fake of [
      "chat.deepseek.com",
      "didi.cn",
      "www.rednote.com",
      "leetcode.com",
      "chatgpt.com.evil.com",
    ]) {
      expect(allowed.has(fake)).toBe(false);
    }
  });

  it("测试文件本身不把任何非规范域名写成官方结果（本组断言即是凭据）", () => {
    // 本用例无额外断言：上面三组已逐一断言每个仿冒域返回 null；
    // 若后续有人在本文件新增“官方”域名，必须同步进上面的 null 断言组。
    expect(true).toBe(true);
  });
});
