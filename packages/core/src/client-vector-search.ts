/**
 * 端侧轻量级离线向量检索引擎 (Edge-Vector Search Engine)
 *
 * 核心设计目标：
 * 在离线、离网或未开启 Node.js 服务端 Embedding 模型的环境下，
 * 浏览器端利用 TypedArray 与 Int8 标量量化 (Scalar Quantization)，
 * 实现百毫秒级、低内存开销的高维向量余弦距离搜索与 Top-K 召回。
 */

export interface VectorDocument {
  id: string;
  title: string;
  url: string;
  categoryId?: string;
  tags?: string[];
  vector: number[] | Float32Array;
}

export interface QuantizedVectorDoc {
  id: string;
  title: string;
  url: string;
  categoryId?: string;
  tags?: string[];
  /** Int8 量化后的向量分量 [-128, 127] */
  quantized: Int8Array;
  /** 缩放因子：用于将 Int8 反量化计算近似点积 */
  scale: number;
  /** 向量模长 (Norm) */
  norm: number;
}

export interface QuantizedVectorIndex {
  dim: number;
  docs: QuantizedVectorDoc[];
  createdAt: number;
}

export interface VectorSearchOptions {
  topK?: number;
  minScore?: number;
  categoryId?: string;
  requiredTags?: string[];
}

export interface VectorSearchHit {
  id: string;
  title: string;
  url: string;
  score: number;
  categoryId?: string;
  tags?: string[];
}

/**
 * 1. 向量模长 (L2 Norm)
 */
export function computeVectorNorm(v: number[] | Float32Array): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    const val = v[i]!;
    sum += val * val;
  }
  return Math.sqrt(sum);
}

/**
 * 2. 余弦相似度 (Cosine Similarity)
 */
export function cosineSimilarity(
  a: number[] | Float32Array,
  b: number[] | Float32Array
): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const valA = a[i]!;
    const valB = b[i]!;
    dot += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator <= 1e-9) return 0;
  return dot / denominator;
}

/**
 * 3. 标量量化 (Scalar Quantization: Float32 -> Int8)
 * 将高维稠密浮点向量压缩为 1/4 内存占用的 Int8 向量，
 * 并保存 scale 因子以支持快速低精度内积加速。
 */
export function quantizeVector(v: number[] | Float32Array): {
  quantized: Int8Array;
  scale: number;
  norm: number;
} {
  const len = v.length;
  let maxAbs = 0;
  let normSq = 0;

  for (let i = 0; i < len; i++) {
    const val = v[i]!;
    const abs = Math.abs(val);
    if (abs > maxAbs) maxAbs = abs;
    normSq += val * val;
  }

  const scale = maxAbs > 0 ? maxAbs / 127.0 : 1.0;
  const invScale = 1.0 / scale;
  const quantized = new Int8Array(len);

  for (let i = 0; i < len; i++) {
    const clamped = Math.max(-127, Math.min(127, Math.round(v[i]! * invScale)));
    quantized[i] = clamped;
  }

  return {
    quantized,
    scale,
    norm: Math.sqrt(normSq),
  };
}

/**
 * 4. 量化向量点积近邻逼近
 */
export function quantizedCosineSimilarity(
  queryVector: number[] | Float32Array,
  queryNorm: number,
  doc: QuantizedVectorDoc
): number {
  if (queryNorm <= 1e-9 || doc.norm <= 1e-9) return 0;
  let dot = 0;
  const len = queryVector.length;
  const q = doc.quantized;

  for (let i = 0; i < len; i++) {
    dot += queryVector[i]! * q[i]!;
  }

  // 反量化还原近似点积
  const approximateDot = dot * doc.scale;
  return Math.max(-1.0, Math.min(1.0, approximateDot / (queryNorm * doc.norm)));
}

/**
 * 5. 构建端侧轻量向量索引
 */
export function buildQuantizedVectorIndex(docs: VectorDocument[]): QuantizedVectorIndex {
  const dim = docs[0]?.vector.length ?? 0;
  const quantizedDocs: QuantizedVectorDoc[] = docs.map((d) => {
    const { quantized, scale, norm } = quantizeVector(d.vector);
    return {
      id: d.id,
      title: d.title,
      url: d.url,
      categoryId: d.categoryId,
      tags: d.tags,
      quantized,
      scale,
      norm,
    };
  });

  return {
    dim,
    docs: quantizedDocs,
    createdAt: Date.now(),
  };
}

/**
 * 6. 执行端侧向量近邻 Top-K 检索
 */
export function searchVectorIndex(
  index: QuantizedVectorIndex,
  queryVector: number[] | Float32Array,
  options: VectorSearchOptions = {}
): VectorSearchHit[] {
  const { topK = 10, minScore = 0.1, categoryId, requiredTags } = options;
  if (!index.docs.length || queryVector.length !== index.dim) return [];

  const queryNorm = computeVectorNorm(queryVector);
  if (queryNorm <= 1e-9) return [];

  const candidates: VectorSearchHit[] = [];

  for (const doc of index.docs) {
    if (categoryId && doc.categoryId !== categoryId) continue;
    if (requiredTags && requiredTags.length > 0) {
      const docTags = new Set(doc.tags || []);
      const matched = requiredTags.every((t) => docTags.has(t));
      if (!matched) continue;
    }

    const score = quantizedCosineSimilarity(queryVector, queryNorm, doc);
    if (score >= minScore) {
      candidates.push({
        id: doc.id,
        title: doc.title,
        url: doc.url,
        score: Math.round(score * 10000) / 10000,
        categoryId: doc.categoryId,
        tags: doc.tags,
      });
    }
  }

  // 按相似度降序截取 Top-K
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, topK);
}
