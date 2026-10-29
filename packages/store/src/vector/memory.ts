import type { VectorMatch, VectorRecord, VectorStore } from "./types.ts";
import { clampSimilarity, normalize } from "./types.ts";
import { fitDimension } from "./codec.ts";

/** 内存实现：无 sqlite-vec / 无 pgvector 时的降级与单元测试基准 */
export class MemoryVectorStore implements VectorStore {
  readonly kind = "memory" as const;
  readonly dim: number;
  private rows = new Map<string, { key: number; vector: Float32Array }>();

  constructor(dim: number) {
    this.dim = dim;
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    for (const r of records) {
      if (r.vector.length !== this.dim) {
        throw new Error(`${r.siteId} 向量维度 ${r.vector.length} != ${this.dim}`);
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
