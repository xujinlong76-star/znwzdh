/**
 * 「我的收藏」按意思找。
 *
 * 锁四件事：
 *  1. 语义召回只认中枢命中的 semantic 通道（contributions 有 semantic 键），
 *     不是「中枢返回了什么都算语义」；
 *  2. 核心痛点：关键词搜不到的收藏能被语义找回（标题里没有查询词也能命中），
 *     且语义命中排在本地全文匹配前面、按中枢分数排序；
 *  3. 语义不可用时本地全文兜底仍在，且来源标注诚实（note / tag / keyword
 *     绝不冒充 semantic）；
 *  4. 首次下载的「准备中」状态机：第一次报不可用 → preparing（可重试），
 *     重试仍不可用 → unavailable，而不是一上来就说「未配置」。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  MEANING_SEARCH_POOL_LIMIT,
  describeMeaningReadyLine,
  describeMeaningResults,
  favoriteMeaningEmptyMessage,
  localMatchReason,
  nextSemanticSearchStatus,
  rankSavesByMeaning,
  saveMatchReasonLabel,
  semanticSiteScores,
} from "../src/lib/favorites-semantic-search";

const HERE = dirname(fileURLToPath(import.meta.url));

/** 定位并读取 overlay 里的文件；镜像副本（apps/web/test）不会被误当成源 */
function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return readFileSync(hit, "utf8");
}

const KITCHEN = {
  siteId: "xiachufang",
  title: "下厨房",
  href: "https://www.xiachufang.com",
  description: "家常菜谱大全",
  note: "周末想做的红烧肉菜谱",
  tags: ["做饭"],
};
const GITHUB = {
  siteId: "github",
  title: "GitHub",
  href: "https://github.com",
  description: "代码托管平台",
};
const BILIBILI = {
  siteId: "bilibili",
  title: "哔哩哔哩",
  href: "https://www.bilibili.com",
  description: "视频网站",
  note: "画画教程收藏",
  tags: ["学习"],
};
const ALL = [KITCHEN, GITHUB, BILIBILI];

describe("semanticSiteScores：只认语义通道召回的命中", () => {
  it("contributions 有 semantic 键的命中才进分数表", () => {
    const scores = semanticSiteScores([
      { siteId: "a", score: 0.8, contributions: { semantic: { rank: 1, value: 0.8 } } },
      // 纯词法命中：中枢在 mode=semantic 下也会让词法通道跑，只是候选被剔除——
      // 没有 semantic 键就不能算「按意思」命中
      { siteId: "b", score: 0.9, contributions: { exact: { rank: 1, value: 1 } } },
      // 兜底路径的 contributions 是 {}：不能把「按标签列出」说成语义命中
      { siteId: "c", score: 0.7, contributions: {} },
    ]);
    expect([...scores.keys()]).toEqual(["a"]);
    expect(scores.get("a")).toBe(0.8);
  });

  it("同一 siteId 多条命中只留最高分；非法分数丢弃；空输入返回空表", () => {
    const scores = semanticSiteScores([
      { siteId: "a", score: 0.6, contributions: { semantic: { rank: 2, value: 0.6 } } },
      { siteId: "a", score: 0.85, contributions: { semantic: { rank: 1, value: 0.85 } } },
      { siteId: "b", score: Number.NaN, contributions: { semantic: { rank: 1, value: 0 } } },
    ]);
    expect(scores.get("a")).toBe(0.85);
    expect(scores.has("b")).toBe(false);
    expect(semanticSiteScores(null).size).toBe(0);
    expect(semanticSiteScores(undefined).size).toBe(0);
    expect(semanticSiteScores([]).size).toBe(0);
  });
});

describe("rankSavesByMeaning：按意思找回关键词搜不到的收藏", () => {
  it("核心痛点：搜「做菜」找回标题里没有这两个字的「下厨房」", () => {
    // 关键词筛选对同一查询是零命中：标题/描述/备注/标签里都没有「做菜」
    const ranked = rankSavesByMeaning(ALL, "做菜", new Map([["xiachufang", 0.8]]));
    expect(ranked.map((r) => r.item.siteId)).toEqual(["xiachufang"]);
    expect(ranked[0]?.reason).toBe("semantic");
    expect(ranked[0]?.semanticScore).toBe(0.8);
  });

  it("语义命中按中枢分数降序排在最前面", () => {
    const ranked = rankSavesByMeaning(
      ALL,
      "做菜",
      new Map([
        ["xiachufang", 0.7],
        ["bilibili", 0.9],
      ]),
    );
    expect(ranked.map((r) => r.item.siteId)).toEqual(["bilibili", "xiachufang"]);
    expect(ranked.every((r) => r.reason === "semantic")).toBe(true);
  });

  it("语义命中的 siteId 不在收藏里时不凭空造出一条收藏", () => {
    expect(rankSavesByMeaning(ALL, "做菜", new Map([["unknown-site", 0.99]]))).toEqual([]);
  });

  it("语义不可用时本地全文兜底仍在，来源如实标注 note / tag / keyword", () => {
    expect(rankSavesByMeaning(ALL, "红烧肉", new Map()).map((r) => [r.item.siteId, r.reason])).toEqual([
      ["xiachufang", "note"],
    ]);
    expect(rankSavesByMeaning(ALL, "做饭", new Map()).map((r) => [r.item.siteId, r.reason])).toEqual([
      ["xiachufang", "tag"],
    ]);
    expect(rankSavesByMeaning(ALL, "代码", new Map()).map((r) => [r.item.siteId, r.reason])).toEqual([
      ["github", "keyword"],
    ]);
  });

  it("语义命中同时也匹配关键词时只出现一次，且算语义功劳", () => {
    const ranked = rankSavesByMeaning(ALL, "家常菜谱", new Map([["xiachufang", 0.75]]));
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.reason).toBe("semantic");
  });

  it("什么都匹配不到返回空数组；空查询返回原顺序（不伪装成语义召回）", () => {
    expect(rankSavesByMeaning(ALL, "不存在的词", new Map())).toEqual([]);
    const empty = rankSavesByMeaning(ALL, "   ", new Map([["xiachufang", 0.9]]));
    expect(empty.map((r) => r.item.siteId)).toEqual(["xiachufang", "github", "bilibili"]);
    expect(empty.every((r) => r.reason === "keyword")).toBe(true);
  });
});

describe("localMatchReason：最个人的字段优先", () => {
  it("备注命中优先于标签，标签优先于标题/描述", () => {
    expect(localMatchReason(KITCHEN, ["红烧肉"])).toBe("note");
    expect(localMatchReason(KITCHEN, ["做饭"])).toBe("tag");
    // 「家常」只在描述里（备注「红烧肉菜谱」没有这两个字，别拿「菜谱」当例子）
    expect(localMatchReason(KITCHEN, ["家常"])).toBe("keyword");
    expect(localMatchReason(GITHUB, ["代码"])).toBe("keyword");
  });
});

describe("nextSemanticSearchStatus：首次下载报准备中，重试仍不可用才报暂不可用", () => {
  it("首次请求即不可用 → preparing（模型可能在首次下载）", () => {
    expect(nextSemanticSearchStatus("idle", false)).toBe("preparing");
    expect(nextSemanticSearchStatus("loading", false)).toBe("preparing");
  });

  it("准备过一次仍不可用、或曾经就绪后不可用 → unavailable", () => {
    expect(nextSemanticSearchStatus("preparing", false)).toBe("unavailable");
    expect(nextSemanticSearchStatus("ready", false)).toBe("unavailable");
    expect(nextSemanticSearchStatus("unavailable", false)).toBe("unavailable");
  });

  it("语义可用时任何前态都回到 ready", () => {
    expect(nextSemanticSearchStatus("idle", true)).toBe("ready");
    expect(nextSemanticSearchStatus("preparing", true)).toBe("ready");
    expect(nextSemanticSearchStatus("unavailable", true)).toBe("ready");
  });
});

describe("文案：语义与本地的数量分开说", () => {
  it("describeMeaningResults 拆出语义与本地各自的数量", () => {
    const matches = [
      { item: KITCHEN, reason: "semantic" as const, semanticScore: 0.8 },
      { item: BILIBILI, reason: "semantic" as const, semanticScore: 0.7 },
      { item: GITHUB, reason: "note" as const },
    ];
    expect(describeMeaningResults(matches, 10)).toBe(
      "按意思找到 3 / 10 个收藏（语义 2 · 备注 / 标签 / 关键词 1）",
    );
  });

  it("favoriteMeaningEmptyMessage 与关键词模式的零结果文案区分开", () => {
    expect(favoriteMeaningEmptyMessage("做菜")).toBe("按意思没找到匹配「做菜」的收藏");
    expect(favoriteMeaningEmptyMessage("   ")).toBe("按意思没找到匹配的收藏");
  });

  it("语义召回池上限是常量（收藏求交用，不写死在页面里）", () => {
    expect(MEANING_SEARCH_POOL_LIMIT).toBe(50);
  });
});

describe("describeMeaningReadyLine：ready ≠ 有语义命中", () => {
  it("语义可用但命中与本地收藏零求交 → 不说按语义排序，说结果是本地匹配", () => {
    // 完整复现本来的 bug：中枢 semanticAvailable 为 true，状态机报 ready，
    // 但返回的命中全是不在收藏里的 siteId，求交后语义命中是 0 条——
    // 列表里只有一条本地备注匹配，计数行也报「语义 0」。
    expect(nextSemanticSearchStatus("loading", true)).toBe("ready");
    const scores = semanticSiteScores([
      { siteId: "unknown-site", score: 0.99, contributions: { semantic: { rank: 1, value: 0.99 } } },
    ]);
    const ranked = rankSavesByMeaning(ALL, "红烧肉", scores);
    expect(ranked.map((r) => [r.item.siteId, r.reason])).toEqual([["xiachufang", "note"]]);
    expect(describeMeaningResults(ranked, ALL.length)).toContain("语义 0");
    const line = describeMeaningReadyLine(ranked);
    expect(line).not.toContain("语义相关度排序");
    expect(line).toBe("本次结果均为本地匹配（备注 / 标签 / 关键词）。");
  });

  it("至少一条语义命中求交成功 → 才说已按语义相关度排序", () => {
    const ranked = rankSavesByMeaning(ALL, "做菜", new Map([["xiachufang", 0.8]]));
    expect(ranked.filter((r) => r.reason === "semantic")).toHaveLength(1);
    expect(describeMeaningReadyLine(ranked)).toBe("已按语义相关度排序。");
  });

  it("空结果 / 尚未出结果时不说按语义排序", () => {
    expect(describeMeaningReadyLine([])).toBe("本次结果均为本地匹配（备注 / 标签 / 关键词）。");
    expect(describeMeaningReadyLine(null)).toBe("本次结果均为本地匹配（备注 / 标签 / 关键词）。");
  });
});

describe("saveMatchReasonLabel：卡片按匹配来源标注", () => {
  it("四种来源各有自己的标签，不把全文匹配说成语义匹配", () => {
    expect(saveMatchReasonLabel("semantic")).toBe("语义匹配");
    expect(saveMatchReasonLabel("note")).toBe("备注匹配");
    expect(saveMatchReasonLabel("tag")).toBe("标签匹配");
    expect(saveMatchReasonLabel("keyword")).toBe("关键词匹配");
  });
});

describe("接线守卫：收藏页真的挂上了按意思搜与准备中状态", () => {
  it("收藏页有「按意思搜」切换、准备中文案与重试入口", () => {
    const page = overlaySource("src/app/favorites/page.tsx");
    expect(page).toContain("按意思搜");
    expect(page).toContain("正在准备语义搜索");
    expect(page).toContain("重试语义搜索");
    expect(page).toContain("语义检索暂不可用");
    expect(page).toContain("mode: 'semantic'");
    expect(page).toContain("searchSites(");
    expect(page).toContain("favoriteMeaningEmptyMessage");
    // 语义不可用时本地全文兜底仍在；语义请求只带 q/mode/limit，不带身份——
    // 这是本地收藏的筛选，不该因为一次筛选就把查询写进服务端搜索历史
    expect(page).toContain("rankSavesByMeaning");
    expect(page).toContain("{ q: meaningQuery, mode: 'semantic', limit: MEANING_SEARCH_POOL_LIMIT }");
  });

  it("navhub-api 把 mode 透传给中枢（否则 mode=semantic 到不了服务端）", () => {
    const api = overlaySource("src/lib/navhub-api.ts");
    expect(api).toContain("mode?: 'hybrid' | 'keyword' | 'semantic'");
    expect(api).toContain("query.set('mode', params.mode)");
  });

  it("ready 状态行不硬编码「已按语义相关度排序」，而是按语义命中数选文案", () => {
    const page = overlaySource("src/app/favorites/page.tsx");
    // 排序文案只活在 lib 的 describeMeaningReadyLine 里：ready 只代表
    // 「语义通道可用」，零语义命中时页面必须改口说本地匹配
    expect(page).toContain("{describeMeaningReadyLine(meaningMatches)}");
    expect(page).not.toContain("已按语义相关度排序");
  });

  it("卡片按匹配来源标注：meaningMatches 的 reason 落到每张卡片上", () => {
    const page = overlaySource("src/app/favorites/page.tsx");
    expect(page).toContain("meaningReasonBySiteId");
    expect(page).toContain("saveMatchReasonLabel(");
  });
});
