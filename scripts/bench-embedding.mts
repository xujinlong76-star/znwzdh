/**
 * embedding 吞吐基准（只读，不写库）。
 *
 * 目的：决定「全量向量重建」是一次 `reindex {vectors:true}` 跑完，
 * 还是必须按 siteIds 分片入队（reindex 的单次预算 10 分钟，见 DEFAULT_SCHEDULES）。
 *
 * 用法（在 apps/api 目录下跑，模型缓存在 apps/api/data/models）：
 *   node ../../scripts/bench-embedding.mts
 */
import { createEmbeddingService, DEFAULT_EMBEDDING_CONFIG, siteEmbeddingText } from "../packages/ai/src/embedding.ts";

const N = Number(process.argv[2] || 96);

const svc = createEmbeddingService({ cacheDir: "./data/models" });
console.log("[bench] 模型:", DEFAULT_EMBEDDING_CONFIG.model, "| dim:", DEFAULT_EMBEDDING_CONFIG.dim, "| cacheDir: ./data/models");

const t0 = Date.now();
await svc.warmup();
const warmMs = Date.now() - t0;
console.log("[bench] warmup:", warmMs, "ms | ready =", svc.ready());

const texts = Array.from({ length: N }, (_, i) =>
  siteEmbeddingText({
    title: "示例站点 " + i + " Example Site",
    description: "这是一个用于吞吐基准的中文描述，包含若干技术关键词：向量检索、语义搜索、推荐排序、缓存穿透。",
    url: "https://example-" + i + ".com/",
  }),
);

const t1 = Date.now();
const vecs = await svc.encodeBatch(texts);
const batchMs = Date.now() - t1;
const per = batchMs / N;

console.log("[bench] encodeBatch(" + N + "):", batchMs, "ms | 单条", per.toFixed(2), "ms | 维度", vecs[0]?.length);
const total = 3900; // 当前缺口：4905 活跃站 - 1038 已建向量
console.log("[bench] 按此吞吐推算补全 " + total + " 条需要:", ((per * total) / 1000 / 60).toFixed(1), "分钟");
console.log("[bench] 分 32 条一批共", Math.ceil(total / 32), "批，每批约", ((per * 32) / 1000).toFixed(0), "秒（不含 updateSite/FTS 重建开销）");
process.exit(0);
