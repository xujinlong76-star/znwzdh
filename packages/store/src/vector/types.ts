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

import { sanitizeFinite, toBlobParam } from "./codec.ts";

export interface VectorRecord {
  /** 稳定整数主键（vec0 要求）；由 idToInt 映射得到 */
  key: number;
  siteId: string;
  vector: Float32Array;
}

export interface VectorMatch {
  siteId: string;
  /**
   * 存储层**自身**的度量距离（越小越接近）。
   * sqlite-vec 的 vec0 默认是 L2，其余实现是余弦距离——不要把这里的数值
   * 直接跨实现比较或当阈值用。
   */
  distance: number;
  /**
   * 余弦相似度（-1..1，越大越接近）。
   *
   * 各实现按自己的度量换算到同一把尺子（L2: `1 - d²/2`，余弦距离: `1 - d`，
   * 前提都是向量已归一化——upsert/search 两侧都做了 normalize）。语义通道的
   * 质量闸门只认这个字段：阈值不能建立在「distance 是什么度量」的默认假设上。
   */
  similarity: number;
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
/** 余弦相似度裁剪到 [-1, 1] 并吞掉非有限值（浮点误差可能越界 1e-7，NaN 视为 0=不相似也不相斥）。 */
export function clampSimilarity(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v > 1 ? 1 : v < -1 ? -1 : v;
}

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

/**
 * Float32Array <-> Buffer（SQLite BLOB 存储用）。
 *
 * 写侧强制过 sanitizeFinite：否则 NaN 会被静默写进 BLOB，
 * 之后 KNN 距离全是 NaN，排序退化成插入序且不报任何错。
 */
export function vectorToBlob(v: Float32Array): Buffer {
  return toBlobParam(v);
}

/* ------------------------------------------------------------------ *
 * 插件向量业务 id（与站点向量同构；冒号前缀让 KNN 结果无歧义映射回插件）
 * ------------------------------------------------------------------ */

/** 插件向量的业务 id 前缀：vec0 / pgvector 的 site_id 列对插件存 "plugin:<slug>" */
export const PLUGIN_VECTOR_PREFIX = "plugin:";

export function pluginVectorId(slug: string): string {
  return PLUGIN_VECTOR_PREFIX + slug;
}

/** 反向映射：非插件 id（站点 UUID）返回 null，调用方据此过滤 */
export function pluginSlugFromVectorId(id: string): string | null {
  return id.startsWith(PLUGIN_VECTOR_PREFIX) ? id.slice(PLUGIN_VECTOR_PREFIX.length) : null;
}

export function blobToVector(b: Buffer): Float32Array {
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
}

/**
 * L2 归一化：语义检索要求向量归一化，使余弦距离等价于点积。
 *
 * 零向量与含非有限值的向量都返回**零向量**：
 * 早期实现里 `n === 0` 时才提前返回，一旦 n 是 NaN（输入含 NaN）就会
 * 走到底把整条向量除成 NaN，污染整个 KNN 索引。
 */
export function normalize(v: Float32Array): Float32Array {
  const safe = sanitizeFinite(v);
  let n = 0;
  for (let i = 0; i < safe.length; i++) n += safe[i]! * safe[i]!;
  n = Math.sqrt(n);
  if (!Number.isFinite(n) || n === 0) return new Float32Array(safe.length);
  const out = new Float32Array(safe.length);
  for (let i = 0; i < safe.length; i++) out[i] = safe[i]! / n;
  return out;
}
