/**
 * 向量存储适配层。
 *
 * 两种实现必须对外行为一致，因此这里先固定一组**能力契约**与**查询形态约束**。
 *
 * 实测踩到的坑（都在本文件的实现里被规避，单元测试覆盖）：
 *  1. sqlite-vec 的 vec0 虚拟表主键**必须传 BigInt**。传 JS number 会报
 *     "Only integers are allows for primary key values"（原文如此，拼写错误来自上游）。
 *  2. vec0 的 KNN 查询**必须带 LIMIT 或 `k = ?` 约束**，否则 prepare 阶段直接抛错。
 *  3. 因此不能写 "join sites on ... where embedding match ? order by distance limit N" 之外的花样；
 *     CTE + 外层 join 是安全的（已验证），但把 LIMIT 放在外层 join 之后会失败。
 *
 * 这些约束被封装在实现内部，调用方只看到 `search(query, limit)`。
 */

export interface VectorRecord {
  /** 稳定整数主键（vec0 要求）；由 idToInt 映射得到 */
  key: number;
  siteId: string;
  vector: Float32Array;
}

export interface VectorMatch {
  siteId: string;
  /** 余弦距离（越小越接近；归一化向量下 0 = 完全相同） */
  distance: number;
}

export interface VectorStore {
  readonly kind: "sqlite-vec" | "pgvector" | "memory";
  readonly dim: number;
  /** 幂等 upsert */
  upsert(records: VectorRecord[]): Promise<void>;
  remove(siteIds: string[]): Promise<void>;
  /** KNN 检索；limit 必填（vec0 硬性要求） */
  search(query: Float32Array, limit: number): Promise<VectorMatch[]>;
  /** 已索引数量 */
  count(): Promise<number>;
  clear(): Promise<void>;
}

/**
 * siteId -> 稳定正整数。
 * vec0 主键是 INTEGER，而我们的 id 是业务字符串；用 FNV-1a 32 位哈希再消解冲突。
 * 用哈希而非自增，是为了保证「同一 siteId 在任何进程/任何时刻都映射到同一 key」——
 * 否则重建索引后 key 变化会污染 vec0 表。
 */
export function hashSiteId(siteId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < siteId.length; i++) {
    h ^= siteId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // 转成正数并避开 0（vec0 对 0 有特殊语义）
  const v = (h >>> 0) % 2147483646;
  return v + 1;
}

/** Float32Array <-> Buffer（SQLite BLOB 存储用） */
export function vectorToBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}
export function blobToVector(b: Buffer): Float32Array {
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
}

/** L2 归一化：语义检索要求向量归一化，使余弦距离等价于点积 */
export function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i]! * v[i]!;
  n = Math.sqrt(n);
  if (n === 0) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / n;
  return out;
}
