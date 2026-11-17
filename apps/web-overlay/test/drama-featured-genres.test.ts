/**
 * 短剧题材标签（genres）解析测试（U-D2 数据层）。
 *
 * genres 是 featured.json 里的可选字段：只收核实过的题材（详情页首个
 * 标签 chip 为主 题材），没核实的留空。解析口径：非法值丢字段、不跳行；
 * 超过 4 个或含空串/超长串的同样只丢字段。
 */
import { describe, expect, it } from "vitest";
import { loadDramaFeatured, parseDramaFeatured } from "../src/lib/drama-featured.ts";

function entry(overrides: Record<string, unknown> = {}) {
  return {
    title: "测试剧",
    platformSiteId: "nav-557388e01d50",
    platformTitle: "红果短剧",
    url: "https://example.com/drama",
    linkNote: "剧目页",
    episodesKnown: null,
    totalEpisodes: null,
    check: { kind: "none", reason: "测试" },
    ...overrides,
  };
}

describe("parseDramaFeatured genres", () => {
  it("合法题材数组原样保留", () => {
    const { dramas, skipped } = parseDramaFeatured({
      dramas: [entry({ genres: ["玄幻", "穿越"] })],
    });
    expect(skipped).toBe(0);
    expect(dramas[0]?.genres).toEqual(["玄幻", "穿越"]);
  });

  it("非法题材值只丢字段、不跳行；空串只滤掉该项", () => {
    const { dramas, skipped } = parseDramaFeatured({
      dramas: [
        entry({ title: "非法数组", genres: "玄幻" }),
        entry({ title: "含空串", genres: ["玄幻", ""] }),
        entry({ title: "超长串", genres: ["这是一个超过八个字的题材词"] }),
        entry({ title: "超过 4 个", genres: ["玄幻", "穿越", "战斗", "异界", "系统"] }),
      ],
    });
    expect(skipped).toBe(0);
    expect(dramas).toHaveLength(4);
    expect(dramas[0]?.genres).toBeUndefined();
    // 空串只滤掉该项，有效题材保留。
    expect(dramas[1]?.genres).toEqual(["玄幻"]);
    expect(dramas[2]?.genres).toBeUndefined();
    expect(dramas[3]?.genres).toBeUndefined();
  });

  it("重复题材去重、留白裁掉", () => {
    const { dramas } = parseDramaFeatured({
      dramas: [entry({ genres: ["玄幻", " 玄幻 ", "穿越"] })],
    });
    expect(dramas[0]?.genres).toEqual(["玄幻", "穿越"]);
  });

  it("真实 featured.json：8 部剧带已核实的题材，其余留空", () => {
    const { dramas, skipped } = loadDramaFeatured();
    expect(dramas.length).toBe(18);
    expect(skipped).toBe(0);
    const withGenres = new Map(
      dramas.filter((d) => d.genres !== undefined).map((d) => [d.title, d.genres]),
    );
    expect([...withGenres.entries()]).toEqual([
      ["十八岁太奶奶驾到，重整家族荣耀 第五部", ["家族"]],
      ["和离后我带女儿横扫魔域", ["玄幻"]],
      ["少夫人来自东北 3", ["家族"]],
      ["悍妻当家，靠美食扶起一家软骨头", ["种田"]],
      ["万妖图录传 第十四季", ["玄幻"]],
      ["魔神人生：弃子问天 第二季", ["玄幻"]],
      ["满院亲戚全是上古大妖 第七季", ["奇幻"]],
      ["装穷提亲，娶到全家嫌弃的她", ["恋爱"]],
    ]);
  });

  it("真实 featured.json：9 部已完结剧的总集数已按 2026-11-17 核实值填好", () => {
    const { dramas } = loadDramaFeatured();
    const totals = new Map(
      dramas.map((d) => [d.title, d.totalEpisodes]),
    );
    expect(totals.get("十八岁太奶奶驾到，重整家族荣耀 第五部")).toBe(102);
    expect(totals.get("少夫人来自东北 3")).toBe(96);
    expect(totals.get("退役归来，这个保镖不好惹")).toBe(100);
    expect(totals.get("万妖图录传 第十四季")).toBe(202);
    expect(totals.get("魔神人生：弃子问天 第二季")).toBe(586);
    expect(totals.get("满院亲戚全是上古大妖 第七季")).toBe(188);
    expect(totals.get("装穷提亲，娶到全家嫌弃的她")).toBe(80);
  });
});
