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

  it("真实 featured.json：12 部剧带已核实的题材，其余留空", () => {
    const { dramas, skipped } = loadDramaFeatured();
    expect(dramas.length).toBe(17);
    expect(skipped).toBe(0);
    const withGenres = new Map(
      dramas.filter((d) => d.genres !== undefined).map((d) => [d.title, d.genres]),
    );
    expect([...withGenres.entries()]).toEqual([
      ["穿越八零，我把娘俩宠成宝", ["年代爱情"]],
      ["持械入宋：第十一季", ["古风权谋"]],
      ["全球死考：刚下刑场你让我去考试一季", ["都市脑洞"]],
      ["少夫人来自东北 3", ["家庭伦理"]],
      ["嫌疑人的秘密2藏金生死线", ["犯罪"]],
      ["王妈在顾家当保姆后全家只会搞笑了", ["喜剧"]],
      ["认下混混老爹，我一路青云", ["家庭"]],
      ["卖掉养老房那天，我重获新生", ["家庭"]],
      ["迟来的情缘，董事长的暖心妻", ["爱情"]],
      ["高考出分后女儿劝我离婚", ["成长"]],
      ["小镇是非多之同床异梦", ["家庭"]],
      ["十八岁太奶奶驾到，重整家族荣耀 第五部", ["家族"]],
    ]);
  });

  it("真实 featured.json：已完结剧的总集数已按 2026-11-18/11-16 核实值填好，未核实只写已更集数或留空", () => {
    const { dramas } = loadDramaFeatured();
    const totals = new Map(
      dramas.map((d) => [d.title, d.totalEpisodes]),
    );
    const known = new Map(
      dramas.map((d) => [d.title, d.episodesKnown]),
    );
    expect(totals.get("穿越八零，我把娘俩宠成宝")).toBe(317);
    expect(totals.get("持械入宋：第十一季")).toBe(113);
    expect(totals.get("全球死考：刚下刑场你让我去考试一季")).toBe(785);
    expect(totals.get("少夫人来自东北 3")).toBe(96);
    expect(totals.get("王妈在顾家当保姆后全家只会搞笑了")).toBe(86);
    expect(totals.get("十八岁太奶奶驾到，重整家族荣耀 第五部")).toBe(102);
    // 只核实了集数、未核实是否完结：只写已更集数，总集数留空，不写成“全 X 集”。
    expect(known.get("嫌疑人的秘密2藏金生死线")).toBe(88);
    expect(totals.get("嫌疑人的秘密2藏金生死线")).toBeNull();
    expect(known.get("小镇是非多之同床异梦")).toBe(63);
    expect(totals.get("小镇是非多之同床异梦")).toBeNull();
    // 未核实集数的留空，不编。
    for (const title of [
      "帐中香第二季",
      "和离后我带女儿横扫魔域",
      "聚宝仙盆之杂灵根才是真BOSS 第十六季",
      "烛九阴第九季",
      "莞城人生",
      "认下混混老爹，我一路青云",
      "卖掉养老房那天，我重获新生",
      "迟来的情缘，董事长的暖心妻",
      "高考出分后女儿劝我离婚",
    ]) {
      expect(known.get(title)).toBeNull();
      expect(totals.get(title)).toBeNull();
    }
  });
});
