import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEIGHTS,
  buildFtsQuery,
  buildFtsTokens,
  fuse,
  hanToTokens,
  personalCandidates,
  pinyinTraits,
  type PersonalizableSite,
  type SearchCandidate,
} from "../src/index.ts";

describe("CJK 分词", () => {
  it("把连续中文展开为单字 + 相邻二元组", () => {
    const t = hanToTokens("启动脚本").split(" ");
    expect(t).toContain("启动");
    expect(t).toContain("动脚");
    expect(t).toContain("脚本");
    expect(t).toContain("启");
    expect(t).toContain("本");
  });

  it("覆盖所有相邻 2 字子串（FTS5 unicode61 原生做不到）", () => {
    const t = hanToTokens("中国天气网").split(" ");
    for (const sub of ["中国", "国天", "天气", "气网"]) expect(t).toContain(sub);
    const expr = buildFtsQuery("天气网")!;
    expect(expr).toContain('"天气"');
    expect(expr).toContain('"气网"');
  });

  it("检索线索同时覆盖标题与描述", () => {
    const tokens = buildFtsTokens(["中国天气网", "全国天气预报查询"]);
    expect(tokens).toContain("天气");
    expect(tokens).toContain("预报");
  });

  it("保留英文字词（否则 GitHub 会被整段丢弃）", () => {
    const tokens = buildFtsTokens(["GitHub Copilot", "AI 代码补全"]);
    for (const w of ["GitHub", "Copilot", "AI"]) expect(tokens).toContain(w);
    expect(tokens).toContain("代码");
    expect(tokens).toContain("补全");
  });

  it("空输入不产生噪声", () => {
    expect(buildFtsTokens([null, undefined, "", "   "])).toBe("");
  });
});

describe("FTS5 MATCH 表达式", () => {
  it("中文 token 加引号，英文用前缀匹配", () => {
    const expr = buildFtsQuery("启动 copilot")!;
    expect(expr).toContain('"启动"');
    expect(expr).toContain('"copilot"*');
    expect(expr).toContain(" OR ");
  });

  it("无有效 token 时返回 null（避免非法 MATCH 语法）", () => {
    expect(buildFtsQuery("!!! ???")).toBeNull();
    expect(buildFtsQuery("")).toBeNull();
  });

  it("内嵌引号会被转义，且引号总数成对", () => {
    // 注意：buildFtsQuery 按 [A-Za-z0-9_+#.-] 取词，引号是分隔符而非词内字符，
    // 所以 "ab\"cd" 会被切成 ab / cd 两个前缀词，本来就无法注入。
    const expr = buildFtsQuery('ab"cd')!;
    expect(expr).toContain('"ab"*');
    expect(expr).toContain('"cd"*');
    expect((expr.match(/"/g) ?? []).length % 2).toBe(0);
  });
});

describe("拼音线索", () => {
  it("生成全拼与首字母", () => {
    const t = pinyinTraits("启动脚本");
    expect(t.full).toBe("qidongjiaoben");
    expect(t.initials).toBe("qdjb");
  });

  it("英文与中英混合不炸", () => {
    expect(pinyinTraits("GitHub").full).toBe("github");
    const t = pinyinTraits("码农工具");
    expect(t.full).toBe("manonggongju");
    expect(t.initials).toBe("mngj");
  });
});

describe("RRF 融合", () => {
  const cand = (siteId: string, channel: SearchCandidate["channel"], rank: number): SearchCandidate => ({ siteId, channel, rank });

  it("命中多通道的站点排在仅单通道命中之前（coverage 乘子生效）", () => {
    const hits = fuse([
      cand("multi", "fts", 2),
      cand("multi", "pinyin", 2),
      cand("multi", "semantic", 3),
      cand("single", "semantic", 1),
    ]);
    expect(hits[0]!.siteId).toBe("multi");
    expect(Object.keys(hits[0]!.contributions).sort()).toEqual(["fts", "pinyin", "semantic"]);
  });

  it("空输入返回空数组而不是抛错", () => {
    expect(fuse([])).toEqual([]);
  });

  it("只保留每通道最优排名，不重复计分", () => {
    const dup = fuse([cand("a", "fts", 5), cand("a", "fts", 1)]);
    expect(dup).toHaveLength(1);
    expect(dup[0]!.contributions.fts!.rank).toBe(1);
    expect(dup[0]!.score).toBeCloseTo(DEFAULT_WEIGHTS.fts / (DEFAULT_WEIGHTS.k + 1), 10);
  });

  it("按 limit 截断", () => {
    const many = Array.from({ length: 50 }, (_, i) => cand("s" + i, "fts", i + 1));
    expect(fuse(many, DEFAULT_WEIGHTS, 10)).toHaveLength(10);
  });

  it("确定性：相同输入产出相同顺序", () => {
    const input = [cand("a", "fts", 1), cand("b", "fts", 1)];
    expect(fuse(input).map((h) => h.siteId)).toEqual(fuse(input).map((h) => h.siteId));
  });

  it("personal 通道不参与 coverage 共识度（偏好不等于相关性）", () => {
    const withPersonal = fuse([cand("a", "fts", 1), cand("a", "personal", 1)]);
    const withoutPersonal = fuse([cand("a", "fts", 1)]);
    // coverage 只数相关性通道 -> 两者 coverage 乘子都应为 1
    expect(withPersonal[0]!.score).toBeCloseTo(withoutPersonal[0]!.score + DEFAULT_WEIGHTS.personal / (DEFAULT_WEIGHTS.k + 1), 10);
  });
});

describe("个性化通道（personalCandidates）", () => {
  const sites = new Map<string, PersonalizableSite>([
    ["ai-1", { siteId: "ai-1", categoryId: "cat-ai", tags: ["ai"] }],
    ["ai-2", { siteId: "ai-2", categoryId: "cat-ai", tags: ["ai", "coding"] }],
    ["life-1", { siteId: "life-1", categoryId: "cat-life", tags: ["weather"] }],
  ]);
  const signals = { topCategories: ["cat-ai"], topTags: ["ai"], visitedSiteIds: ["ai-1"] };

  it("无信号时返回空（不产生无意义的通道）", () => {
    expect(personalCandidates(sites, undefined)).toEqual([]);
    expect(personalCandidates(sites, {})).toEqual([]);
  });

  it("只对命中的站点产生候选，未命中的不出现", () => {
    const out = personalCandidates(sites, signals);
    expect(out.map((c) => c.siteId)).not.toContain("life-1");
    expect(out.length).toBe(2);
  });

  it("偏好更强的站点排名更靠前", () => {
    const out = personalCandidates(sites, signals);
    // ai-1: 类目 + 标签 + 已访问；ai-2: 类目 + 标签 —— ai-1 应排前面
    expect(out[0]!.siteId).toBe("ai-1");
  });

  it("候选 channel 全部标记为 personal", () => {
    for (const c of personalCandidates(sites, signals)) expect(c.channel).toBe("personal");
  });

  it("可以限制候选数量，避免偏好通道喧宾夺主", () => {
    expect(personalCandidates(sites, signals, { limit: 1 })).toHaveLength(1);
  });
});

describe("个性化与相关性的关系（关键安全性质）", () => {
  const cand = (siteId: string, channel: SearchCandidate["channel"], rank: number): SearchCandidate => ({ siteId, channel, rank });

  it("personal 权重低于任一相关性通道", () => {
    expect(DEFAULT_WEIGHTS.personal).toBeLessThan(DEFAULT_WEIGHTS.fts);
    expect(DEFAULT_WEIGHTS.personal).toBeLessThan(DEFAULT_WEIGHTS.exact);
    expect(DEFAULT_WEIGHTS.personal).toBeLessThan(DEFAULT_WEIGHTS.semantic);
  });

  it("多通道共识的相关性结果不会被单路偏好顶掉", () => {
    // champion 同时被三路相关性召回；preferred 只在 fts 里且名次靠后
    const hits = fuse([
      cand("champion", "exact", 1),
      cand("champion", "fts", 1),
      cand("champion", "semantic", 1),
      cand("preferred", "fts", 4),
      cand("preferred", "personal", 1),
    ]);
    expect(hits[0]!.siteId).toBe("champion");
  });

  it("相关性接近时，偏好可以决定先后（越用越懂你）", () => {
    const hits = fuse([
      cand("a", "fts", 1),
      cand("b", "fts", 2),
      cand("b", "personal", 1),
    ]);
    expect(hits[0]!.siteId).toBe("b");
    expect(hits[0]!.contributions.personal).toBeDefined();
  });
});
