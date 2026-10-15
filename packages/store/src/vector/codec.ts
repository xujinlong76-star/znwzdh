/**
 * 向量编解码的唯一收敛点（Seam Vector Codec）。
 *
 * 存在的理由：两个方言对同一份 Float32 向量的**物理表示完全不同**，
 * 而两侧都拒绝（或更糟：静默接受）非有限值。
 *
 *   - sqlite-vec：要求原始小端 Float32 的 BLOB
 *   - pgvector：要求 '[x1,x2,...]' 文本字面量，且只吃有限浮点数
 *
 * NaN / ±Infinity 的下游表现是不对称的：
 *   - PostgreSQL：抛 malformed array literal（显式失败，容易发现）
 *   - SQLite：BLOB 静默写入 NaN，之后 KNN 距离全为 NaN，
 *     排序退化成"按插入序返回垃圾"，且不报任何错——这是最难查的一类故障
 *
 * 因此规则只有一条：**任何进入驱动的向量必须先过 sanitizeFinite()**。
 * 本文件不依赖其它模块，避免与 types.ts 形成循环导入。
 */

/** 非有限值（NaN / ±Infinity）的统一替换值 */
export const VECTOR_NON_FINITE_FALLBACK = 0;

/**
 * 把任意数值序列收敛成"全有限值"的 Float32Array。
 *
 * 总是返回新数组：调用方可能持有共享的 ArrayBuffer，
 * 原地改写会污染其它视图（sqlite-vec 的 BLOB 就是这么丢数据的）。
 */
export function sanitizeFinite(vec: ArrayLike<number>): Float32Array {
  const n = vec.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = vec[i] as number;
    out[i] = Number.isFinite(v) ? v : VECTOR_NON_FINITE_FALLBACK;
  }
  return out;
}

/** 序列里是否含非有限值（用于上报，不用于修正） */
export function hasNonFinite(vec: ArrayLike<number>): boolean {
  for (let i = 0; i < vec.length; i++) {
    if (!Number.isFinite(vec[i] as number)) return true;
  }
  return false;
}

/**
 * 维度对齐：不足补 0，超出截断。
 *
 * 两个驱动的报错风格相反：sqlite-vec 抛"维度不符"（显式），
 * pgvector 会在 ::vector 转换时炸在 SQL 里（堆栈藏得很深）。
 * 与其让调用方猜，不如在进入驱动前就对齐到存储维度。
 */
export function fitDimension(vec: ArrayLike<number>, dim: number): Float32Array {
  const out = new Float32Array(dim);
  const n = Math.min(vec.length, dim);
  for (let i = 0; i < n; i++) {
    const v = vec[i] as number;
    out[i] = Number.isFinite(v) ? v : VECTOR_NON_FINITE_FALLBACK;
  }
  return out;
}

/** Float32Array -> SQLite BLOB（sqlite-vec 唯一接受的形式） */
export function toBlobParam(vec: ArrayLike<number>): Buffer {
  // 不能因为入参已经是 Float32Array 就跳过 sanitize —— 那正是最需要清洗的情况。
  // 免拷贝省下的一次 memcpy 远不如"NaN 静默落盘"的代价。
  const f32 = sanitizeFinite(vec);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

/**
 * Float32Array -> pgvector 文本字面量 '[x1,x2,...]'。
 *
 * 用 toFixed(6) 而非默认 toString：默认会输出 0.10000000149011612 这种
 * 17 位有效数字，既拖慢 SQL 文本，也让 PG 端 vector 解析多做一次舍入。
 */
export function toPostgresParam(vec: ArrayLike<number>): string {
  const f32 = sanitizeFinite(vec);
  let out = "[";
  for (let i = 0; i < f32.length; i++) {
    if (i > 0) out += ",";
    out += (f32[i] as number).toFixed(6);
  }
  return out + "]";
}

/** 向量方言 */
export type VectorDialect = "sqlite" | "postgres" | "memory";

/** 距离指标 */
export type VectorMetric = "l2" | "cosine" | "lorentz";

export class SeamVectorCodec {
  /**
   * 转成对应方言的驱动绑定参数。
   * 调用方永远不该自己拼 Buffer 或方括号字符串。
   */
  static toDriverParam(vec: ArrayLike<number>, dialect: VectorDialect): Buffer | string | Float32Array {
    if (dialect === "postgres") return toPostgresParam(vec);
    if (dialect === "memory") return sanitizeFinite(vec);
    return toBlobParam(vec);
  }

  /**
   * 把方言相关的"距离"归一化为 [0,1] 的单调递增相似度。
   *
   * 归一化向量的余弦距离域是 [0,2]（0=完全相同），所以 1 - d/2。
   * L2 与洛伦兹测地线距离无上界，用径向基衰减压到 (0,1]。
   * 非有限/负数一律按 0 处理——宁可给出"完全不相似"，也不要让 NaN
   * 流进排序（Array.sort 遇到 NaN 比较器会产出不确定顺序）。
   */
  static normalizeSimilarity(rawDistance: number, metric: VectorMetric = "cosine"): number {
    if (!Number.isFinite(rawDistance) || rawDistance < 0) return 0;
    if (metric === "cosine") return Math.max(0, Math.min(1, 1 - rawDistance / 2));
    return 1 / (1 + rawDistance);
  }
}
