/**
 * 热榜逐源解析器测试：fixture 是 2026-11-11 在本机对各源公开接口的
 * 真实响应录制（只裁剪条数、对象未改），不是编造的假数据。
 * 守的约束：
 *  1. 每个 covered 源都能从真实响应的形状里解出标题+链接+热度；
 *  2. 已知真实条目逐字对得上（源改版/字段漂移会在这里变红）；
 *  3. 形状坏掉时解析器抛错（刷新链路据此标 failed、保留旧缓存），
 *     绝不静默产出空榜或错榜；
 *  4. 未覆盖源（知乎/快手）必须登记实测原因，不许悄悄缺席。
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
  it("七个主流源全部登记，五个可采集、两个如实登记未覆盖", () => {
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
    expect(hotlistSourceById("zhihu")?.endpoint).toBeTruthy();
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

describe("知乎：亿级热度与超大问题 id", () => {
  function zhihuPayload(
    entries: Array<{ id?: unknown; url?: string; title: string; detail_text: string }>,
  ): unknown {
    return {
      data: entries.map((e) => ({
        target: { id: e.id, url: e.url, title: e.title },
        detail_text: e.detail_text,
        card_label: null,
      })),
    };
  }

  it("亿级热度按 1 亿 = 100,000,000 换算，万与纯数字不受影响", () => {
    const items = parseOf("zhihu")(
      zhihuPayload([
        { id: 101, url: "https://api.zhihu.com/questions/101", title: "1.2亿热度", detail_text: "1.2亿热度" },
        { id: 102, url: "https://api.zhihu.com/questions/102", title: "2亿热度", detail_text: "2亿热度" },
        // 真实 detail_text 是 "3695\n万热度" 这种数字换行再跟单位的写法，亿也一样
        { id: 103, url: "https://api.zhihu.com/questions/103", title: "换行亿", detail_text: "1.2\n亿热度" },
        { id: 104, url: "https://api.zhihu.com/questions/104", title: "纯数字", detail_text: "12345热度" },
        { id: 105, url: "https://api.zhihu.com/questions/105", title: "万级回归", detail_text: "1.5万热度" },
      ]),
    );
    expect(items.map((i) => i.hotValue)).toEqual([120000000, 200000000, 120000000, 12345, 15000]);
    expect(items.map((i) => i.url)).toEqual([
      "https://www.zhihu.com/question/101",
      "https://www.zhihu.com/question/102",
      "https://www.zhihu.com/question/103",
      "https://www.zhihu.com/question/104",
      "https://www.zhihu.com/question/105",
    ]);
    expect(items.map((i) => i.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it("真实录制 fixture：超大 id 从 url 精确恢复，万级热度换算正确", () => {
    const items = parseOf("zhihu")(fixture("zhihu.json"));
    expect(items.length).toBe(5);
    expect(items[0]?.title).toContain("网传腾讯裁员");
    expect(items[0]?.hotValue).toBe(36950000);
    expect(items[0]?.url).toBe("https://www.zhihu.com/question/2104132164308530649");
    expect(items[1]?.url).toBe("https://www.zhihu.com/question/2103852272970987363");
    // 任何一条都不许出现 JSON.parse 舍入后的错 id
    for (const item of items) expect(item.url).not.toContain("2104132164308530700");
  });

  it("超大数值 id 但 url 含 /questions/<id> 时从 url 精确恢复，绝不用舍入值", () => {
    // 字面量 2104132164308530649 在 JS 里解析时就已被舍入（与 JSON.parse 一致），
    // 先把这个前提钉住：下面断言的恢复只能来自 url 字符串，不可能来自数值 id。
    expect(String(2104132164308530649)).toBe("2104132164308530700");
    const items = parseOf("zhihu")(
      zhihuPayload([
        {
          id: 2104132164308530649,
          url: "https://api.zhihu.com/questions/2104132164308530649",
          title: "超大 id 从 url 恢复",
          detail_text: "3695万热度",
        },
      ]),
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.url).toBe("https://www.zhihu.com/question/2104132164308530649");
    expect(items[0]?.url).not.toContain("2104132164308530700");
  });

  it("超大数值 id 且 url 里没有 /questions/<id> 时丢弃该条，绝不链到错问题", () => {
    const items = parseOf("zhihu")(
      zhihuPayload([
        { id: 101, url: "https://api.zhihu.com/questions/101", title: "正常条目", detail_text: "100热度" },
        // 无 url：数值 id 已舍入，无处恢复精确 id
        { id: 2104132164308530649, title: "超大 id 无 url", detail_text: "3695万热度" },
        // url 里没有 /questions/<id>：同样无处恢复
        {
          id: 2104132164308530649,
          url: "https://www.zhihu.com/answer/999",
          title: "超大 id 的 url 不是问题链接",
          detail_text: "3695万热度",
        },
      ]),
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("正常条目");
    expect(items[0]?.url).toBe("https://www.zhihu.com/question/101");
    for (const item of items) expect(item.url).not.toContain("2104132164308530700");
  });
});
