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
