/**
 * 问问我的收藏：问答检索测试（ask-retrieval.ts）。
 *
 * 锁的是「只答收藏」的检索口径：
 *  - 词法路只在收藏子集里打分：备注/标签命中、标题命中、0 命中；
 *  - 语义路只认收藏集内的向量：收藏外的相似站进不来；
 *  - 两路去重、截断 12 条、0 命中不调模型（这里是纯检索层，调模型与否由
 *    ask-api.test.ts 在路由层断言；这里断言 0 命中时 candidates 为空）；
 *  - 纠错只在收藏子集词典上跑：收藏外的词纠不出来。
 */
import { describe, expect, it } from "vitest";
import {
  askRetrievalText,
  correctQueryAgainstFavorites,
  cosineSimilarity,
  lexicalAskCandidates,
  loadAskCorpus,
  mergeAskCandidates,
  retrieveAskCandidates,
  semanticAskCandidates,
  type AskEmbedder,
} from "../src/ask-retrieval.ts";
import type { AskCandidate } from "../src/ask.ts";

function candidate(over: Partial<AskCandidate> & { siteId: string }): AskCandidate {
  return {
    title: "未命名站点",
    url: "https://example.com",
    description: null,
    note: null,
    tags: [],
    folderId: null,
    createdAt: 1000,
    ...over,
  };
}

const CORPUS: AskCandidate[] = [
  candidate({
    siteId: "ppt",
    title: "PPT 大师在线制作",
    url: "https://ppt.example.com",
    description: "在线做 PPT 的演示文稿工具",
    note: "汇报必备，模板很多",
    tags: ["PPT", "演示"],
    createdAt: 3000,
  }),
  candidate({
    siteId: "slides",
    title: "免费幻灯片模板站",
    url: "https://slides.example.com/free",
    description: "PPT 模板与幻灯片素材下载",
    tags: ["PPT", "模板"],
    createdAt: 2000,
  }),
  candidate({
    siteId: "pics",
    title: "免费图片素材库",
    url: "https://pic.example.com/free",
    description: "免费图片素材与图标下载",
    tags: ["图片", "素材"],
    createdAt: 1000,
  }),
];

/** 关键词向量替身：含 PPT 的文本 → [1,0,0,0]，其余 → [0,1,0,0]。 */
function keywordEmbedder(): AskEmbedder {
  const vec = (text: string): Float32Array =>
    text.includes("PPT") || text.includes("ppt")
      ? new Float32Array([1, 0, 0, 0])
      : new Float32Array([0, 1, 0, 0]);
  return {
    encode: async (text: string) => vec(text),
    encodeBatch: async (texts: string[]) => texts.map(vec),
  };
}

describe("askRetrievalText：问答文本拼进备注/标签，全站 embedding 文本不动", () => {
  it("备注与标签拼进问答文本", () => {
    const text = askRetrievalText({
      title: "PPT 大师",
      description: "做 PPT",
      url: "https://ppt.example.com",
      note: "汇报必备",
      tags: ["PPT"],
    });
    expect(text).toContain("汇报必备");
    expect(text).toContain("PPT");
    expect(text).toContain("PPT 大师");
  });
});

describe("词法路：只在收藏子集里打分", () => {
  it("备注命中：问「汇报」召回备注里写了汇报的收藏", () => {
    const hits = lexicalAskCandidates("汇报", CORPUS);
    expect(hits.map((h) => h.siteId)).toContain("ppt");
  });

  it("标签命中：问「模板」召回打了模板标签的收藏", () => {
    const hits = lexicalAskCandidates("模板", CORPUS);
    expect(hits.map((h) => h.siteId)).toEqual(["slides", "ppt"]);
  });

  it("标题命中优先于描述命中", () => {
    const hits = lexicalAskCandidates("图片素材", CORPUS);
    expect(hits[0]?.siteId).toBe("pics");
  });

  it("收藏外的词 0 命中：问「看电影」不召回任何收藏", () => {
    expect(lexicalAskCandidates("看电影", CORPUS)).toEqual([]);
  });

  it("无空格中文查询靠二字 shingle 召回", () => {
    const hits = lexicalAskCandidates("免费做PPT的工具", CORPUS);
    expect(hits.map((h) => h.siteId)).toContain("ppt");
  });

  it("口语问法只命中一个强单元也算命中：「做 PPT 用什么」召回描述里含 PPT 的收藏", () => {
    // 「做」「用什么」是单字/口语噪音单元，不能要求「还差一个单元」；
    // 只命中强单元 PPT 的 slides（描述含 PPT）必须召回。
    const hits = lexicalAskCandidates("做 PPT 用什么", CORPUS);
    expect(hits.map((h) => h.siteId)).toContain("ppt");
    expect(hits.map((h) => h.siteId)).toContain("slides");
  });
});

describe("纠错：只在收藏子集词典上跑", () => {
  it("收藏里的词能纠回来：PPTT → PPT", () => {
    expect(correctQueryAgainstFavorites("PPTT 模板", CORPUS)).toBe("ppt 模板");
  });

  it("收藏外的词纠不出来：返回 null，不硬纠", () => {
    expect(correctQueryAgainstFavorites("zxqwvkj", CORPUS)).toBeNull();
  });
});

describe("语义路：只认收藏集内的向量", () => {
  it("相似度过阈值的收藏进候选，不过阈值的不要", async () => {
    const { candidates, available } = await semanticAskCandidates(
      keywordEmbedder(),
      "做PPT的工具",
      CORPUS,
      0.55,
    );
    expect(available).toBe(true);
    expect(candidates.map((c) => c.siteId).sort()).toEqual(["ppt", "slides"]);
    expect(candidates[0]?.similarity).toBeCloseTo(1);
  });

  it("纯语义阈值 0.55：0.4 的弱相似不进候选", async () => {
    const weak: AskEmbedder = {
      encode: async () => new Float32Array([1, 0, 0, 0]),
      encodeBatch: async (texts) =>
        texts.map(() => {
          // 与查询向量余弦 0.4：[0.4, sqrt(1-0.16), 0, 0]
          const v = new Float32Array([0.4, Math.sqrt(0.84), 0, 0]);
          return v;
        }),
    };
    const { candidates } = await semanticAskCandidates(weak, "做PPT", CORPUS, 0.55);
    expect(candidates).toEqual([]);
  });

  it("embedding 缺失/编码失败时静默降级，不抛错", async () => {
    const none = await semanticAskCandidates(null, "做PPT", CORPUS, 0.4);
    expect(none).toEqual({ candidates: [], available: false });
    const broken: AskEmbedder = {
      encode: async () => {
        throw new Error("模型没下载");
      },
      encodeBatch: async () => {
        throw new Error("模型没下载");
      },
    };
    const failed = await semanticAskCandidates(broken, "做PPT", CORPUS, 0.4);
    expect(failed).toEqual({ candidates: [], available: false });
  });

  it("cosineSimilarity：同向 1、正交 0", () => {
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([1, 0]))).toBeCloseTo(1);
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0);
  });
});

describe("合并：去重、词法优先、截断 12 条", () => {
  it("两路同一站点只留一条，词法分量与语义分量都保留", () => {
    const merged = mergeAskCandidates(
      [candidate({ siteId: "ppt", title: "PPT 大师", lexicalScore: 9 })],
      [
        candidate({ siteId: "ppt", title: "PPT 大师", similarity: 0.9 }),
        candidate({ siteId: "pics", title: "图片库", similarity: 0.8 }),
      ],
    );
    expect(merged.map((m) => m.siteId)).toEqual(["ppt", "pics"]);
    expect(merged[0]?.lexicalScore).toBe(9);
    expect(merged[0]?.similarity).toBe(0.9);
  });

  it("纯语义命中排在词法命中之后", () => {
    const merged = mergeAskCandidates(
      [candidate({ siteId: "pics", title: "图片库", lexicalScore: 3 })],
      [candidate({ siteId: "ppt", title: "PPT 大师", similarity: 0.99 })],
    );
    expect(merged.map((m) => m.siteId)).toEqual(["pics", "ppt"]);
  });

  it("超过 12 条截断", () => {
    const lexical = Array.from({ length: 15 }, (_, i) =>
      candidate({ siteId: `s${i}`, title: `站${i}`, lexicalScore: 15 - i }),
    );
    expect(mergeAskCandidates(lexical, [])).toHaveLength(12);
  });
});

describe("retrieveAskCandidates：端到端拼装", () => {
  const fakeCtx = {
    repo: {
      listFavorites: async () => [
        {
          siteId: "ppt",
          note: "汇报必备，模板很多",
          tags: ["PPT", "演示"],
          folderId: null,
          createdAt: 3000,
        },
        { siteId: "ghost-site", note: null, tags: null, folderId: null, createdAt: 4000 },
        { siteId: "pics", note: null, tags: ["图片"], folderId: null, createdAt: 1000 },
      ],
      getSitesByIds: async (ids: string[]) => {
        const all = new Map([
          ["ppt", { id: "ppt", title: "PPT 大师在线制作", url: "https://ppt.example.com", description: "在线做 PPT" }],
          ["pics", { id: "pics", title: "免费图片素材库", url: "https://pic.example.com/free", description: "免费图片素材" }],
        ]);
        return new Map(ids.filter((id) => all.has(id)).map((id) => [id, all.get(id)!]));
      },
    },
    embedding: null,
  } as never;

  it("站点已删的收藏行不进候选、也不计入总数", async () => {
    const corpus = await loadAskCorpus(fakeCtx, "user-1");
    expect(corpus.map((c) => c.siteId)).toEqual(["ppt", "pics"]);
    const r = await retrieveAskCandidates(fakeCtx, "user-1", "做PPT", { embed: keywordEmbedder() });
    expect(r.totalFavorites).toBe(2);
    expect(r.candidates.map((c) => c.siteId)).toContain("ppt");
  });

  it("0 命中：candidates 为空，closest 给最近 5 条作参考", async () => {
    // 查询向量与所有收藏向量正交：语义路也不应命中
    const orthogonal: AskEmbedder = {
      encode: async () => new Float32Array([0, 0, 1, 0]),
      encodeBatch: async (texts) =>
        texts.map((t) =>
          t.includes("PPT") ? new Float32Array([1, 0, 0, 0]) : new Float32Array([0, 1, 0, 0]),
        ),
    };
    const r = await retrieveAskCandidates(fakeCtx, "user-1", "zxqwvkj 看电影", {
      embed: orthogonal,
    });
    expect(r.candidates).toEqual([]);
    expect(r.lexicalCount).toBe(0);
    expect(r.semanticCount).toBe(0);
    expect(r.closest.map((c) => c.siteId)).toEqual(["ppt", "pics"]);
  });

  it("0 命中但纠错成功时用纠后的问题再召回，并如实报告 correction", async () => {
    const r = await retrieveAskCandidates(fakeCtx, "user-1", "PPTT", {
      embed: keywordEmbedder(),
    });
    expect(r.correction).toEqual({ from: "PPTT", to: "ppt" });
    expect(r.candidates.map((c) => c.siteId)).toContain("ppt");
  });

  it("没有收藏时直接返回空检索，不调 embedding", async () => {
    const emptyCtx = {
      repo: { listFavorites: async () => [], getSitesByIds: async () => new Map() },
      embedding: keywordEmbedder(),
    } as never;
    const r = await retrieveAskCandidates(emptyCtx, "user-1", "做PPT");
    expect(r).toMatchObject({ totalFavorites: 0, candidates: [], semanticAvailable: false });
  });
});
