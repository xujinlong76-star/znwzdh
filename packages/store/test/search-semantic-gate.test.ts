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
    ["B", "闸门测试 B", [0.6, 0.8]], // cos 0.60
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
