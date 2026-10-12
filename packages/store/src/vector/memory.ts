import type { VectorMatch, VectorRecord, VectorStore } from "./types.ts";
import { normalize } from "./types.ts";

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
    const q = normalize(query);
    const scored: VectorMatch[] = [];
    for (const [siteId, row] of this.rows) {
      let dot = 0;
      for (let i = 0; i < this.dim; i++) dot += q[i]! * row.vector[i]!;
      scored.push({ siteId, distance: 1 - dot });
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
