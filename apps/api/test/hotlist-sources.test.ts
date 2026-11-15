/**
 * 热榜逐源解析器测试：fixture 是 2026-11-11 在本机对各源公开接口的
 * 真实响应录制（只裁剪条数、对象未改），不是编造的假数据。
 * 知乎 fixture 是 2026-11-12 对官方开放平台 hot_list 接口的真实响应
 * 全文原样（30 条，见方案 ~/workspace/research/zhihu-wiring-plan.md）。
 * 守的约束：
 *  1. 每个 covered 源都能从真实响应的形状里解出标题+链接+热度；
 *  2. 已知真实条目逐字对得上（源改版/字段漂移会在这里变红）；
 *  3. 形状坏掉时解析器抛错（刷新链路据此标 failed、保留旧缓存），
 *     绝不静默产出空榜或错榜；
 *  4. 未覆盖源（快手）必须登记实测原因，不许悄悄缺席。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOTLIST_SOURCES, hotlistSourceById } from "../src/hotlist/sources.ts";

const here = dirname(fileURLToPath(import.meta.url));
function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(here, "fixtures", "hotlist", name), "utf8"));
}

function parseOf(id: string) {
  const def = hotlistSourceById(id);
  if (!def?.parse) throw new Error(`源 ${id} 缺解析器`);
  return def.parse;
}

describe("热榜源注册表", () => {
  it("七个主流源全部登记，六个可采集、一个如实登记未覆盖", () => {
    expect(HOTLIST_SOURCES.map((s) => s.id)).toEqual([
      "weibo",
      "baidu",
      "toutiao",
      "douyin",
      "bilibili",
      "zhihu",
      "kuaishou",
    ]);
    for (const def of HOTLIST_SOURCES) {
      if (def.covered) {
        expect(def.endpoint, `${def.id} 缺端点`).toBeTruthy();
        expect(def.parse, `${def.id} 缺解析器`).toBeTypeOf("function");
      } else {
        expect(def.uncoveredReason?.length, `${def.id} 未覆盖必须写实测原因`).toBeGreaterThan(20);
      }
    }
    expect(hotlistSourceById("zhihu")?.covered).toBe(true);
    expect(hotlistSourceById("zhihu")?.endpoint).toBe(
      "https://developer.zhihu.com/api/v1/content/hot_list?Limit=30",
    );
    expect(hotlistSourceById("zhihu")?.parse).toBeTypeOf("function");
    expect(hotlistSourceById("kuaishou")?.uncoveredReason).toContain("无官方公开");
  });
});

describe("逐源解析器（真实录制响应）", () => {
  it("微博：realtime 解出词条与热度数值", () => {
    const items = parseOf("weibo")(fixture("weibo.json"));
    expect(items.length).toBeGreaterThanOrEqual(5);
    expect(items[0]?.title).toBe("商场看中羽绒服网上便宜一千");
    expect(items[0]?.hotValue).toBe(1123390);
    expect(items[0]?.url).toContain("s.weibo.com/weibo?q=");
    expect(items.map((i) => i.rank)).toEqual(items.map((_, idx) => idx + 1));
  });

  it("百度：cards 多层结构摊平，链接用源站给的 url，无热度数值时留 null", () => {
    const items = parseOf("baidu")(fixture("baidu.json"));
    expect(items.length).toBeGreaterThanOrEqual(5);
    for (const item of items) {
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.url).toMatch(/^https:\/\/m\.baidu\.com\//);
    }
    expect(items.some((i) => i.title.includes("取消外卖"))).toBe(true);
  });

  it("头条：Title/HotValue/Url 逐字对上", () => {
    const items = parseOf("toutiao")(fixture("toutiao.json"));
    expect(items.length).toBeGreaterThanOrEqual(5);
    expect(items[0]?.title).toBe("中方回应中日领导人APEC是否会晤");
    expect(items[0]?.hotValue).toBe(14473246);
    expect(items[0]?.url).toContain("toutiao.com/trending/");
  });

  it("抖音：word_list 解出词条与 hot_value，链接落到抖音搜索", () => {
    const items = parseOf("douyin")(fixture("douyin.json"));
    expect(items.length).toBeGreaterThanOrEqual(5);
    expect(items[0]?.title).toBe("开拓者123:103雷霆");
    expect(items[0]?.hotValue).toBe(11790321);
    expect(items[0]?.url).toContain("douyin.com/search/");
  });

  it("B站：官方 search/square 热搜词榜解出 keyword 与 heat_score", () => {
    const items = parseOf("bilibili")(fixture("bilibili.json"));
    expect(items.length).toBeGreaterThanOrEqual(5);
    expect(items[0]?.title).toBe("空军多型主力战机列阵长空");
    expect(items[0]?.hotValue).toBe(1992815);
    expect(items[0]?.url).toContain("search.bilibili.com/all?keyword=");
  });

  it("形状坏掉时抛错而不是产出空榜", () => {
    expect(() => parseOf("weibo")({})).toThrow();
    expect(() => parseOf("weibo")({ data: { realtime: "nope" } })).toThrow();
    expect(() => parseOf("bilibili")({ code: -404, data: {} })).toThrow();
    expect(() => parseOf("toutiao")({ data: [] })).toThrow();
    expect(() => parseOf("douyin")({ data: { word_list: [] } })).toThrow();
  });
});

describe("知乎：官方开放平台 Data.Items", () => {
  it("官方开放平台 Data.Items 解出标题与干净链接，热度留 null，配图与摘要与样例一致", () => {
    const raw = fixture("zhihu.json") as {
      Code: number;
      Message: string;
      Data: {
        Total: number;
        Items: Array<{ Title: string; Url: string; ThumbnailUrl: string; Summary: string }>;
      };
    };
    const items = parseOf("zhihu")(raw);
    expect(items.length).toBe(30);
    expect(items[0]?.title).toBe(
      "高三生在拼豆店干坐1小时，留下5元钱、道歉纸条和父母电话，为什么能引发热议？给孩子教育留下怎样的启发？",
    );
    expect(items[0]?.url).toBe("https://www.zhihu.com/question/2103852272970987363");
    expect(items[0]?.url).not.toContain("utm_");
    // 30 条逐项与官方返回一致：标题/链接/配图/简介四字段，热度留空
    items.forEach((item, idx) => {
      const src = raw.Data.Items[idx]!;
      expect(item.title).toBe(src.Title);
      expect(item.thumbnailUrl).toBe(src.ThumbnailUrl);
      // 样例里 2 条 Summary 为空串，解析后记 null；其余逐字一致
      expect(item.summary).toBe(src.Summary === "" ? null : src.Summary);
      expect(item.hotValue).toBeNull();
      expect(item.hotLabel).toBeNull();
      expect(item.url).toMatch(/^https:\/\/www\.zhihu\.com\/question\/\d+$/);
      expect(item.url).not.toContain("utm_");
      expect(item.thumbnailUrl).toMatch(/^https:\/\/pic\d\.zhimg\.com\//);
    });
    expect(items.map((i) => i.rank)).toEqual(items.map((_, idx) => idx + 1));
  });

  it("形状坏掉时抛错而不是产出空榜", () => {
    expect(() => parseOf("zhihu")({ Code: 1001, Message: "额度不足", Data: {} })).toThrow();
    expect(() => parseOf("zhihu")({ Code: 0, Message: "success", Data: {} })).toThrow();
    expect(() => parseOf("zhihu")({ Code: 0, Message: "success", Data: { Total: 30, Items: [] } })).toThrow();
    expect(() =>
      parseOf("zhihu")({ Code: 0, Message: "success", Data: { Total: 1, Items: [{ Title: "", Url: "" }] } }),
    ).toThrow();
    // 非知乎问题链接直接丢弃，0 条有效即抛错
    expect(() =>
      parseOf("zhihu")({
        Code: 0,
        Message: "success",
        Data: { Total: 1, Items: [{ Title: "有标题", Url: "https://example.com/x" }] },
      }),
    ).toThrow();
  });
});

describe("知乎动态请求头与缺密钥", () => {
  function zhihuHeaders(): Record<string, string> {
    const def = hotlistSourceById("zhihu")!;
    if (typeof def.headers !== "function") throw new Error("知乎 headers 必须是工厂函数");
    return def.headers();
  }

  it("动态头：Bearer + 秒级时间戳，每次调用现算", () => {
    const prev = process.env.NAVHUB_ZHIHU_ACCESS_SECRET;
    try {
      // 密钥用假值，现设现撤，绝不用真实 Secret
      process.env.NAVHUB_ZHIHU_ACCESS_SECRET = "test-secret-for-unit-test";
      const headers = zhihuHeaders();
      expect(headers.Authorization).toBe("Bearer test-secret-for-unit-test");
      expect(headers["X-Request-Timestamp"]).toMatch(/^\d{10}$/);
      expect(headers["Content-Type"]).toBe("application/json");
    } finally {
      if (prev === undefined) delete process.env.NAVHUB_ZHIHU_ACCESS_SECRET;
      else process.env.NAVHUB_ZHIHU_ACCESS_SECRET = prev;
    }
  });

  it("缺密钥时工厂抛错（fail-closed，不发匿名请求）", () => {
    const prev = process.env.NAVHUB_ZHIHU_ACCESS_SECRET;
    try {
      delete process.env.NAVHUB_ZHIHU_ACCESS_SECRET;
      expect(() => zhihuHeaders()).toThrow(/NAVHUB_ZHIHU_ACCESS_SECRET/);
    } finally {
      if (prev === undefined) delete process.env.NAVHUB_ZHIHU_ACCESS_SECRET;
      else process.env.NAVHUB_ZHIHU_ACCESS_SECRET = prev;
    }
  });
});
