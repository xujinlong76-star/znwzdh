import type { VectorMatch, VectorRecord, VectorStore } from "./types.ts";
import { clampSimilarity, normalize } from "./types.ts";
import { fitDimension } from "./codec.ts";

/**
 * 内存降级实现的默认容量上限。
 *
 * 为什么需要：它是 sqlite-vec / pgvector 都不可用时的兜底，而 `search()` 是
 * O(N×dim) 线性扫描。不设上限，大库（5 万站 × 1024 维）的每次语义检索都会变成
 * 全量点积——表现为"偶发卡顿"而不是明确失败。到顶后拒绝新向量并置 degraded，
 * 让检索代价有上界，且健康检查能看见降级事实。
 */
const DEFAULT_MAX_VECTORS = 50_000;

/** 内存实现：无 sqlite-vec / 无 pgvector 时的降级与单元测试基准 */
export class MemoryVectorStore implements VectorStore {
  readonly kind = "memory" as const;
  readonly dim: number;
  private rows = new Map<string, { key: number; vector: Float32Array }>();
  private readonly maxVectors: number;
  private degradedFlag = false;

  constructor(dim: number, options: { maxVectors?: number } = {}) {
    this.dim = dim;
    this.maxVectors = Math.max(1, options.maxVectors ?? DEFAULT_MAX_VECTORS);
  }

  /** 到达容量上限后为 true：检索仍可用，但召回不完整（见 types.ts 的 degraded） */
  get degraded(): boolean {
    return this.degradedFlag;
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    for (const r of records) {
      if (r.vector.length !== this.dim) {
        throw new Error(`${r.siteId} 向量维度 ${r.vector.length} != ${this.dim}`);
      }
      // 更新已有条目不占新额度；只有"新增且已到顶"才拒收并置降级
      if (!this.rows.has(r.siteId) && this.rows.size >= this.maxVectors) {
        this.degradedFlag = true;
        continue;
      }
      this.rows.set(r.siteId, { key: r.key, vector: normalize(r.vector) });
    }
  }

  async remove(siteIds: string[]): Promise<void> {
    for (const id of siteIds) this.rows.delete(id);
  }

  async search(query: Float32Array, limit: number): Promise<VectorMatch[]> {
    if (limit <= 0) return [];
    // 维度对齐放在最前：短向量会让 q[i] 取到 undefined，进而把距离算成 NaN
    const q = normalize(fitDimension(query, this.dim));
    const scored: VectorMatch[] = [];
    for (const [siteId, row] of this.rows) {
      let dot = 0;
      for (let i = 0; i < this.dim; i++) dot += q[i]! * row.vector[i]!;
      const distance = 1 - dot; // 余弦距离（向量已归一化）
      scored.push({ siteId, distance, similarity: clampSimilarity(1 - distance) });
    }
    scored.sort((a, b) => a.distance - b.distance || a.siteId.localeCompare(b.siteId));
    return scored.slice(0, limit);
  }

  async count(): Promise<number> {
    return this.rows.size;
  }

  async clear(): Promise<void> {
    this.rows.clear();
  }
}
