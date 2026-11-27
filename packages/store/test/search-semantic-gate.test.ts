/**
 * 语义通道的相似度闸门（AI-5）。
 *
 * 改造前的行为：KNN 永远返回 top-N，哪怕最相近的向量余弦相似度只有 0.1，
 * 也会按名次进 RRF 融合——「写代码的AI」这类查询因此混进大量语义噪声。
 * 闸门默认关闭（0），由 API 层按 NAVHUB_SEMANTIC_MIN_SIMILARITY 注入。
 *
 * 本文件锁三件事：
 *   1. 闸门按 similarity 裁剪候选，并把剔除数量如实记进 channelTimings；
 *   2. 闸门认的是 similarity，不是各实现口径不同的 distance；
 *   3. early-exit 剪掉语义通道时 semanticFiltered 必须是 0（没跑就别说剔了东西）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { SearchEngine } from "../src/search.ts";
import { hashSiteId, MemoryVectorStore, type VectorStore } from "../src/vector/index.ts";

const DIM = 2;
/** 查询向量固定为 [1,0]，站点向量的第一分量就是它的余弦相似度 */
const QUERY_VEC = new Float32Array([1, 0]);

let db: Db;
let repo: Repository;
let vectors: MemoryVectorStore;
const siteIds: Record<string, string> = {};

beforeAll(async () => {
  db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
  repo = new Repository(db);
  const cat = await repo.createCategory({ title: "闸门测试" });
  vectors = new MemoryVectorStore(DIM);
  const seeds: Array<[string, string, number[]]> = [
    ["A", "闸门测试 A", [1, 0]], //    cos 1.00
    ["B", "闸门测试 B", [0.75, 0.6614378]], // cos 0.75（U-459 后须高于严格闸门默认 0.70，否则既有断言失效）
    ["C", "闸门测试 C", [0.1, 0.995]], // cos ≈0.10
    ["D", "闸门测试 D", [-0.2, 0.98]], // cos ≈-0.20
  ];
  for (const [id, title, vec] of seeds) {
    const site = await repo.createSite({ url: `https://gate-${id}.example.com`, title, categoryId: cat.id });
    siteIds[id] = site.id;
    await vectors.upsert([{ key: hashSiteId(site.id), siteId: site.id, vector: new Float32Array(vec) }]);
  }
});

afterAll(async () => {
  await db.close();
});

function engine(gate: number) {
  return new SearchEngine({
    db,
    repo,
    fts: null,
    vectors,
    embed: async () => QUERY_VEC,
  }, { semanticMinSimilarity: gate, earlyExitExactHits: 5 });
}

/** 命中集合（把 UUID 还原成 A/B/C/D） */
async function hitKeys(result: { hits: Array<{ siteId: string }> }): Promise<string[]> {
  const back = new Map(Object.entries(siteIds).map(([k, v]) => [v, k]));
  return result.hits.map((h) => back.get(h.siteId) ?? h.siteId).sort();
}

describe("语义相似度闸门", () => {
  it("默认关闭（0）：所有向量命中都进候选池，semanticFiltered = 0", async () => {
    const result = await engine(0).search({ q: "zzqx", limit: 10, disablePersonal: true });
    expect(await hitKeys(result)).toEqual(["A", "B", "C", "D"]);
    expect(result.channelTimings?.semanticFiltered).toBe(0);
  });

  it("阈值 0.5：只保留 A/B，剔掉 C/D 并计数", async () => {
    const result = await engine(0.5).search({ q: "zzqx", limit: 10, disablePersonal: true });
    expect(await hitKeys(result)).toEqual(["A", "B"]);
    expect(result.channelTimings?.semanticFiltered).toBe(2);
    expect(result.channelTimings?.skippedSemantic).toBe(false);
  });

  it("阈值裁剪后语义通道为空时，搜索仍然正常返回（不抛错）", async () => {
    const result = await engine(0.99).search({ q: "zzqx", limit: 10, disablePersonal: true });
    expect(await hitKeys(result)).toEqual(["A"]);
    expect(result.channelTimings?.semanticFiltered).toBe(3);
  });

  it("越界阈值被钳到 [0,1]：>1 等价于 1，负数等价于关闭", async () => {
    const strict = await engine(5).search({ q: "zzqx", limit: 10, disablePersonal: true });
    expect(await hitKeys(strict)).toEqual(["A"]);
    const loose = await engine(-3).search({ q: "zzqx", limit: 10, disablePersonal: true });
    expect(await hitKeys(loose)).toEqual(["A", "B", "C", "D"]);
  });

  it("闸门只认 similarity：distance 小但相似度低的命中会被剔除", async () => {
    const tricky: VectorStore = {
      kind: "memory",
      dim: DIM,
      async upsert() {},
      async remove() {},
      async count() { return 2; },
      async clear() {},
      async search() {
        return [
          // 余弦距离 0.1（看起来很近），但 similarity 只有 0.1
          { siteId: siteIds.C!, distance: 0.1, similarity: 0.1 },
          // L2 口径的 distance 很大，similarity 却很高
          { siteId: siteIds.B!, distance: 1.2, similarity: 0.9 },
        ];
      },
    };
    const e = new SearchEngine({ db, repo, fts: null, vectors: tricky, embed: async () => QUERY_VEC }, {
      semanticMinSimilarity: 0.5,
      earlyExitExactHits: 5,
    });
    const result = await e.search({ q: "zzqx", limit: 10, disablePersonal: true });
    expect(await hitKeys(result)).toEqual(["B"]);
    expect(result.channelTimings?.semanticFiltered).toBe(1);
  });

  it("early-exit 剪掉语义通道时 semanticFiltered 为 0（没跑就不报剔除）", async () => {
    const cat = await repo.createCategory({ title: "强精确命中" });
    for (let i = 0; i < 5; i++) {
      await repo.createSite({ url: `https://early-${i}.example.com`, title: `zzqx 强命中 ${i}`, categoryId: cat.id });
    }
    const result = await engine(0.5).search({ q: "zzqx", limit: 10, disablePersonal: true });
    expect(result.channelTimings?.skippedSemantic).toBe(true);
    expect(result.channelTimings?.semanticFiltered).toBe(0);
  });

  it("显式 disableSemantic 时 semanticFiltered 也是 0", async () => {
    const result = await engine(0.5).search({ q: "zzqx", limit: 10, disableSemantic: true, disablePersonal: true });
    expect(result.channelTimings?.skippedSemantic).toBe(true);
    expect(result.channelTimings?.semanticFiltered).toBe(0);
  });
});

/**
 * 第二档：语义独占的严格闸门。
 *
 * 真实缺陷：基础闸门 0.4 上线后，乱码查询（qdjb / zzzzqqqxyz）仍返回一批
 * 「最近的向量邻居」——离线实测这些噪声的余弦集中在 0.51~0.52，正好跨过 0.4。
 * 而有效查询的最近邻在 0.66~0.74。词法通道全线无命中时再卡一刀 0.55，
 * 就能把「没有真匹配」和「语义近邻确实很强」分开。
 *
 * U-459（2026-11-27）：0.55 也不够。全量 4824 站 + 真实 bge-small-zh-v1.5
 * 向量实测：乱码最近邻余弦 0.49~0.655，7/19 条越过 0.55 漏网（见下方回归
 * 语料）；默认严格闸门已提到 0.70（search.ts）。本块的 B 固定在 0.75，
 * 仍高于新默认，既有断言（A/B 保留、W 剔除）保持不变。
 */
describe("语义独占的严格闸门", () => {
  beforeAll(async () => {
    const cat = await repo.createCategory({ title: "严格闸门测试" });
    // 弱语义近邻：cos ≈ 0.52 —— 高于基础闸门 0.5，低于严格闸门 0.55
    const weak = await repo.createSite({
      url: "https://gate-W.example.com",
      title: "弱语义对照 W",
      categoryId: cat.id,
    });
    siteIds.W = weak.id;
    await vectors.upsert([
      { key: hashSiteId(weak.id), siteId: weak.id, vector: new Float32Array([0.52, 0.854166]) },
    ]);
    // 词法命中站（无向量）：证明「有词法命中时严格闸门不生效」
    const lex = await repo.createSite({
      url: "https://gate-L.example.com",
      title: "语义对照 lexonly",
      categoryId: cat.id,
    });
    siteIds.L = lex.id;
  });

  it("词法全线无命中：0.52 的弱语义被严格闸门剔除并计数", async () => {
    const result = await engine(0.5).search({ q: "qwzx", limit: 10, disablePersonal: true });
    expect(await hitKeys(result)).toEqual(["A", "B"]);
    // C/D 被基础闸门剔除（2），W 被严格闸门剔除（1）
    expect(result.channelTimings?.semanticFiltered).toBe(3);
  });

  it("有词法命中时不启用严格闸门：弱语义仍作为低权重补充参与融合", async () => {
    const e = new SearchEngine(
      { db, repo, fts: null, vectors, embed: async () => QUERY_VEC },
      { semanticMinSimilarity: 0.5, earlyExitExactHits: 0 }
    );
    const result = await e.search({ q: "lexonly", limit: 10, disablePersonal: true });
    expect(await hitKeys(result)).toEqual(["A", "B", "L", "W"]);
    // 只有基础闸门的 2 条，严格闸门没碰
    expect(result.channelTimings?.semanticFiltered).toBe(2);
  });

  it("基础闸门为 0（显式关闭）时严格闸门不生效，保持旧行为", async () => {
    const result = await engine(0).search({ q: "qwzx", limit: 10, disablePersonal: true });
    expect(await hitKeys(result)).toEqual(["A", "B", "C", "D", "W"]);
    expect(result.channelTimings?.semanticFiltered).toBe(0);
  });

  it("严格闸门可调：0.9 时只剩 1.0 的近邻", async () => {
    const e = new SearchEngine(
      { db, repo, fts: null, vectors, embed: async () => QUERY_VEC },
      { semanticMinSimilarity: 0.5, semanticOnlyMinSimilarity: 0.9, earlyExitExactHits: 5 }
    );
    const result = await e.search({ q: "qwzx", limit: 10, disablePersonal: true });
    expect(await hitKeys(result)).toEqual(["A"]);
    // 基础闸门剔 C/D（2），严格闸门剔 B/W（2）
    expect(result.channelTimings?.semanticFiltered).toBe(4);
  });
});

/**
 * U-459 乱码回归语料：严格闸门默认 0.70 必须把这批查询全部挡成零结果。
 *
 * 向量取值 = 全量 4824 站 + 真实 bge-small-zh-v1.5 向量上的实测最近邻余弦
 * （2026-11-27，/api/search 同款查询复现过相同漏网站点）：
 *   zzzzqqqxxyy12345→Zoho CRM 0.556、asdkfjalskdfj→JabRef 0.563、
 *   abcabcabcabcab→ABCmouse 0.655、aaaaaaaaaaaaaa→NOAA 0.582、
 *   kjasdhfkjashd123→Hookdeck 0.572、qwertyuiopasdfgh→Quip 0.555、
 *   fjdkalsjfkladsj→16Personalities 0.563。
 * 本文件不用真实模型：查询向量恒为 QUERY_VEC，站点向量的第一分量就是余弦。
 * 断言的是闸门行为本身，不是某条查询字符串——不设任何查询黑名单。
 */
describe("乱码查询回归语料（U-459）", () => {
  let garbledVectors: MemoryVectorStore;
  let strongVectors: MemoryVectorStore;
  const garbledIds: Record<string, string> = {};
  const strongIds: Record<string, string> = {};

  beforeAll(async () => {
    const cat = await repo.createCategory({ title: "乱码回归语料" });
    garbledVectors = new MemoryVectorStore(DIM);
    // 乱码近邻：全部低于新默认 0.70，最高 0.655（abcabcabcabcab 实测值）
    const garbled: Array<[string, string, number[]]> = [
      ["G655", "乱码近邻 0.655", [0.655, 0.7556289]],
      ["G582", "乱码近邻 0.582", [0.582, 0.8131888]],
      ["G572", "乱码近邻 0.572", [0.572, 0.8202536]],
      ["G563", "乱码近邻 0.563", [0.563, 0.8264569]],
      ["G556", "乱码近邻 0.556", [0.556, 0.8311823]],
      ["G541", "乱码近邻 0.541", [0.541, 0.8410226]],
    ];
    for (const [key, title, vec] of garbled) {
      const site = await repo.createSite({ url: `https://garbled-${key}.example.com`, title, categoryId: cat.id });
      garbledIds[key] = site.id;
      await garbledVectors.upsert([{ key: hashSiteId(site.id), siteId: site.id, vector: new Float32Array(vec) }]);
    }
    strongVectors = new MemoryVectorStore(DIM);
    // 边界对：0.69 必须被挡、0.72 必须放行，锁死默认阈值 0.70 的上下沿
    const strong: Array<[string, string, number[]]> = [
      ["S72", "强语义对照 0.72", [0.72, 0.6939741]],
      ["S69", "弱语义对照 0.69", [0.69, 0.7238094]],
    ];
    for (const [key, title, vec] of strong) {
      const site = await repo.createSite({ url: `https://strong-${key}.example.com`, title, categoryId: cat.id });
      strongIds[key] = site.id;
      await strongVectors.upsert([{ key: hashSiteId(site.id), siteId: site.id, vector: new Float32Array(vec) }]);
    }
  });

  function garbledEngine() {
    return new SearchEngine({ db, repo, fts: null, vectors: garbledVectors, embed: async () => QUERY_VEC }, {
      semanticMinSimilarity: 0.4, // 与 API 层 NAVHUB_SEMANTIC_MIN_SIMILARITY 默认一致
      earlyExitExactHits: 5,
    });
  }

  function strongEngine() {
    return new SearchEngine({ db, repo, fts: null, vectors: strongVectors, embed: async () => QUERY_VEC }, {
      semanticMinSimilarity: 0.4,
      earlyExitExactHits: 5,
    });
  }

  // 19 条乱码：随机字母、随机字母+数字、键盘乱敲、重复字符/重复模式
  const GARBLED_QUERIES = [
    "zzzzqqqxxyy12345",
    "asdkfjalskdfj",
    "xqzwkjlasdf0987",
    "blorpflibberty99",
    "qwertyuiopasdfgh",
    "zxcvbnmpoiuyt",
    "fjdkalsjfkladsj",
    "wjeoiwqejoiqwje",
    "kjasdhfkjashd123",
    "z9x8c7v6b5n4m3",
    "pqowieuryt12345",
    "asdfghjkl",
    "qazwsxedcrfvtgb",
    "1qaz2wsx3edc",
    "aaaaaaaaaaaaaa",
    "zzzzzzzzzzzzzz",
    "abcabcabcabcab",
    "xkxlyqwjzplm",
    "mnbvcxzlkjhgf",
  ];

  it.each(GARBLED_QUERIES)("乱码 %s：零结果（严格闸门默认 0.70）", async (q) => {
    const result = await garbledEngine().search({ q, limit: 10, disablePersonal: true });
    expect(result.hits).toEqual([]);
  });

  it("乱码的零结果是闸门拦的，不是库空的：semanticFiltered 如实计数", async () => {
    const result = await garbledEngine().search({ q: "abcabcabcabcab", limit: 10, disablePersonal: true });
    expect(result.hits).toEqual([]);
    // 基础闸门 0.4 不拦任何一个（6 个近邻全 >0.4），严格闸门 0.70 全拦
    expect(result.channelTimings?.semanticFiltered).toBe(6);
  });

  it("边界：0.69 被挡、0.72 放行，锁死默认阈值 0.70", async () => {
    const result = await strongEngine().search({ q: "qwzx", limit: 10, disablePersonal: true });
    const back = new Map(Object.entries(strongIds).map(([k, v]) => [v, k]));
    expect(result.hits.map((h) => back.get(h.siteId))).toEqual(["S72"]);
    expect(result.channelTimings?.semanticFiltered).toBe(1);
  });
});

/**
 * U-459 真实查询对照组：提高严格闸门不能杀死真实搜索。
 *
 * 严格闸门只在「词法通道全线无命中」时启用；真实查询几乎总有词法命中
 * （API 实测 34/34 条真实探针查询都带词法命中），这里锁三件事：
 *   1. 中文站名 / 英文产品名精确命中仍排首位；
 *   2. 拼音查询仍能命中（zhihu→知乎）；
 *   3. 无词法命中但语义确实强（0.72）的真实概念查询仍出结果。
 */
describe("真实查询对照组（U-459）", () => {
  beforeAll(async () => {
    const cat = await repo.createCategory({ title: "真实对照组" });
    for (const [title, url] of [
      ["知乎", "https://control-zhihu.example.com"],
      ["考研帮", "https://control-kaoyan.example.com"],
      ["ChatGPT", "https://control-chatgpt.example.com"],
      ["Kimi", "https://control-kimi.example.com"],
    ] as const) {
      await repo.createSite({ url, title, categoryId: cat.id });
    }
  });

  it("中文站名精确命中仍排首位", async () => {
    const result = await engine(0.4).search({ q: "知乎", limit: 10, disablePersonal: true });
    const titles = new Map<string, string>();
    for (const h of result.hits) {
      const row = await repo.getSite(h.siteId);
      if (row) titles.set(h.siteId, row.title);
    }
    expect(titles.get(result.hits[0]!.siteId)).toBe("知乎");
  });

  it("英文产品名精确命中仍排首位", async () => {
    const result = await engine(0.4).search({ q: "ChatGPT", limit: 10, disablePersonal: true });
    const first = await repo.getSite(result.hits[0]!.siteId);
    expect(first?.title).toBe("ChatGPT");
  });

  it("拼音查询仍能命中", async () => {
    const result = await engine(0.4).search({ q: "zhihu", limit: 10, disablePersonal: true });
    const titles = await Promise.all(result.hits.map((h) => repo.getSite(h.siteId).then((r) => r?.title)));
    expect(titles).toContain("知乎");
  });

  it("无词法命中但语义强（0.72）的真实概念查询仍出结果", async () => {
    // 强语义对照用独立向量库：库里只有 0.72 的 Cursor 近邻
    const strong = new MemoryVectorStore(DIM);
    const site = await repo.createSite({ url: "https://control-cursor.example.com", title: "Cursor", categoryId: (await repo.createCategory({ title: "真实对照组-概念" })).id });
    await strong.upsert([{ key: hashSiteId(site.id), siteId: site.id, vector: new Float32Array([0.72, 0.6939741]) }]);
    const se = new SearchEngine({ db, repo, fts: null, vectors: strong, embed: async () => QUERY_VEC }, {
      semanticMinSimilarity: 0.4,
      earlyExitExactHits: 5,
    });
    const result = await se.search({ q: "写代码的AI", limit: 10, disablePersonal: true });
    expect(result.hits.map((h) => h.siteId)).toEqual([site.id]);
  });
});
