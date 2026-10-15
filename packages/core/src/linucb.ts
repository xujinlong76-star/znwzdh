/**
 * LinUCB (Contextual Multi-Armed Bandit) 自适应情境多通道融合引擎
 *
 * 核心设计目标：
 * 终结 RRF (Reciprocal Rank Fusion) 的静态常数超参缺陷。
 * 根据用户输入的当前特征向量（查询长度、CJK比例、拼音特征、数字比例等），
 * 在线自适应计算 5 大通道（exact, fts, pinyin, semantic, personal）的动态置信度上界权重。
 */

export type RetrievalChannel = 'exact' | 'fts' | 'pinyin' | 'semantic' | 'personal';

export const CHANNELS: RetrievalChannel[] = ['exact', 'fts', 'pinyin', 'semantic', 'personal'];

export const CONTEXT_DIM = 5;

export interface ContextVector {
  /** 长度归一化 [0, 1] */
  lengthNorm: number;
  /** CJK 中文字符占比 [0, 1] */
  cjkRatio: number;
  /** 纯英文字母占比 [0, 1] */
  alphaRatio: number;
  /** 拼音似然度（纯小写字母且无空格，典型拼音输入） [0, 1] */
  pinyinLikelihood: number;
  /** 数字占比 [0, 1] */
  digitRatio: number;
}

export interface LinUCBArmState {
  /** A 矩阵: d x d，初始化为单位矩阵 I */
  A: number[][];
  /** b 向量: d x 1，初始化为零向量 */
  b: number[];
}

export interface LinUCBModel {
  dimension: number;
  alpha: number; // 探索系数 (Exploration parameter)
  arms: Record<RetrievalChannel, LinUCBArmState>;
}

/**
 * 提取查询词的 5 维情境特征向量
 */
export function extractContextFeatures(query: string): number[] {
  const q = query.trim();
  const len = q.length;
  if (len === 0) return [0, 0, 0, 0, 0];

  const lengthNorm = Math.min(1.0, len / 30.0);

  // 统计字符类型
  let cjkCount = 0;
  let alphaCount = 0;
  let digitCount = 0;

  for (let i = 0; i < len; i++) {
    const code = q.charCodeAt(i);
    // CJK 口径与 cjk.ts 的 HAN 范围对齐：3400-4DBF / 4E00-9FFF / F900-FAFF
    if ((code >= 0x3400 && code <= 0x4dbf) || (code >= 0x4e00 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff)) {
      cjkCount++;
    } else if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
      alphaCount++;
    } else if (code >= 48 && code <= 57) {
      digitCount++;
    }
  }

  const cjkRatio = cjkCount / len;
  const alphaRatio = alphaCount / len;
  const digitRatio = digitCount / len;

  // 拼音特征：全由英文字母构成，无空格，且长度在 2 到 15 之间
  const isPinyinCandidate = /^[a-zA-Z]+$/.test(q) && len >= 2 && len <= 15;
  const pinyinLikelihood = isPinyinCandidate ? 1.0 : 0.0;

  return [lengthNorm, cjkRatio, alphaRatio, pinyinLikelihood, digitRatio];
}

/**
 * 创建全零向量与单位矩阵
 */
export function createIdentityMatrix(dim: number): number[][] {
  const mat: number[][] = [];
  for (let i = 0; i < dim; i++) {
    const row = new Array(dim).fill(0);
    row[i] = 1.0;
    mat.push(row);
  }
  return mat;
}

/**
 * 高斯-若尔当消元求逆矩阵（带部分主元选取，数值稳定）
 */
export function invertMatrix(matrix: number[][]): number[][] {
  const n = matrix.length;
  // 构建增广矩阵 [A | I]
  const augmented: number[][] = matrix.map((row, i) => [
    ...row,
    ...new Array(n).fill(0).map((_, j) => (i === j ? 1.0 : 0.0)),
  ]);

  for (let col = 0; col < n; col++) {
    // 寻找主元
    let maxRow = col;
    let maxVal = Math.abs(augmented[col]?.[col] ?? 0);
    for (let row = col + 1; row < n; row++) {
      const val = Math.abs(augmented[row]?.[col] ?? 0);
      if (val > maxVal) {
        maxVal = val;
        maxRow = row;
      }
    }

    if (maxVal < 1e-12) {
      // 奇异或接近奇异，加入 Tikhonov 正则项重新计算
      const regularized = matrix.map((r, ri) => r.map((val, ci) => (ri === ci ? val + 1e-4 : val)));
      return invertMatrix(regularized);
    }

    // 交换主元行
    if (maxRow !== col) {
      const temp = augmented[col]!;
      augmented[col] = augmented[maxRow]!;
      augmented[maxRow] = temp;
    }

    // 归一化当前行
    const pivot = augmented[col]?.[col] ?? 1.0;
    const colRow = augmented[col]!;
    for (let j = 0; j < 2 * n; j++) {
      colRow[j] = (colRow[j] ?? 0) / pivot;
    }

    // 消去其他行
    for (let row = 0; row < n; row++) {
      if (row !== col) {
        const factor = augmented[row]?.[col] ?? 0;
        const targetRow = augmented[row]!;
        for (let j = 0; j < 2 * n; j++) {
          targetRow[j] = (targetRow[j] ?? 0) - factor * (colRow[j] ?? 0);
        }
      }
    }
  }

  // 提取右侧逆矩阵
  return augmented.map((row) => row.slice(n));
}

/**
 * 矩阵乘向量：M * v
 */
export function matVecMul(M: number[][], v: number[]): number[] {
  return M.map((row) => row.reduce((sum, val, idx) => sum + val * (v[idx] ?? 0), 0));
}

/**
 * 向量内积：u · v
 */
export function dotProduct(u: number[], v: number[]): number {
  return u.reduce((sum, val, idx) => sum + val * (v[idx] ?? 0), 0);
}


/**
 * 初始化 LinUCB 模型
 */
export function createLinUCBModel(alpha = 0.25): LinUCBModel {
  const arms: Record<RetrievalChannel, LinUCBArmState> = {
    exact: { A: createIdentityMatrix(CONTEXT_DIM), b: new Array(CONTEXT_DIM).fill(0) },
    fts: { A: createIdentityMatrix(CONTEXT_DIM), b: new Array(CONTEXT_DIM).fill(0) },
    pinyin: { A: createIdentityMatrix(CONTEXT_DIM), b: new Array(CONTEXT_DIM).fill(0) },
    semantic: { A: createIdentityMatrix(CONTEXT_DIM), b: new Array(CONTEXT_DIM).fill(0) },
    personal: { A: createIdentityMatrix(CONTEXT_DIM), b: new Array(CONTEXT_DIM).fill(0) },
  };

  return {
    dimension: CONTEXT_DIM,
    alpha,
    arms,
  };
}

/**
 * 预测各通道在当前输入特征下的置信上界权重 (UCB Score)
 */
export function predictArmWeights(
  model: LinUCBModel,
  query: string,
  basePriors: Record<RetrievalChannel, number> = {
    exact: 1.4,
    fts: 1.0,
    pinyin: 0.9,
    semantic: 1.15,
    personal: 0.3,
  }
): Record<RetrievalChannel, number> {
  const x = extractContextFeatures(query);
  const weights: Record<RetrievalChannel, number> = {} as Record<RetrievalChannel, number>;

  for (const channel of CHANNELS) {
    const arm = model.arms[channel];
    const A_inv = invertMatrix(arm.A);
    const theta = matVecMul(A_inv, arm.b);

    // 均值收益期望：theta^T * x
    const mean = dotProduct(theta, x);

    // 置信区间半径：alpha * sqrt(x^T * A_inv * x)
    const A_inv_x = matVecMul(A_inv, x);
    const variance = Math.max(0, dotProduct(x, A_inv_x));
    const confidenceBound = model.alpha * Math.sqrt(variance);

    // 结合业务先验平滑与 UCB 增益
    const basePrior = basePriors[channel] ?? 1.0;
    const finalWeight = Math.max(0.1, basePrior + mean + confidenceBound);
    weights[channel] = Number(finalWeight.toFixed(4));
  }

  return weights;
}

/**
 * 在线强化学习反馈更新 (Update Bandit with observed reward)
 * @param reward 奖励值（如被采纳/点击则 reward = 1.0；跳出则 reward = 0.0）
 */
export function updateArmReward(
  model: LinUCBModel,
  channel: RetrievalChannel,
  query: string,
  reward: number
): void {
  const arm = model.arms[channel];
  if (!arm) return;

  const x = extractContextFeatures(query);
  const dim = model.dimension;

  // A_a = A_a + x * x^T
  for (let i = 0; i < dim; i++) {
    const row = arm.A[i];
    const xi = x[i] ?? 0;
    if (row) {
      for (let j = 0; j < dim; j++) {
        row[j] = (row[j] ?? 0) + xi * (x[j] ?? 0);
      }
    }
  }

  // b_a = b_a + reward * x
  for (let i = 0; i < dim; i++) {
    arm.b[i] = (arm.b[i] ?? 0) + reward * (x[i] ?? 0);
  }

}

/**
 * 序列化与反序列化
 */
export function serializeLinUCB(model: LinUCBModel): string {
  return JSON.stringify(model);
}

export function deserializeLinUCB(jsonStr: string): LinUCBModel {
  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed || typeof parsed !== "object" || !parsed.arms || typeof parsed.dimension !== "number") throw new Error("bad shape");
    const dim = parsed.dimension;
    if (!Number.isInteger(dim) || dim <= 0 || dim > 64) throw new Error("bad dimension");
    for (const ch of CHANNELS) {
      const arm = (parsed.arms as Record<string, LinUCBArmState>)[ch];
      if (!arm || !Array.isArray(arm.A) || !Array.isArray(arm.b)) throw new Error("bad arm " + ch);
      if (arm.A.length !== dim || arm.b.length !== dim) throw new Error("dim mismatch " + ch);
      for (const row of arm.A) {
        if (!Array.isArray(row) || row.length !== dim || row.some((v) => typeof v !== "number" || !Number.isFinite(v))) throw new Error("bad matrix " + ch);
      }
      if (arm.b.some((v) => typeof v !== "number" || !Number.isFinite(v))) throw new Error("bad vector " + ch);
    }
    if (typeof parsed.alpha !== "number" || !Number.isFinite(parsed.alpha)) parsed.alpha = 0.25;
    return parsed as LinUCBModel;
  } catch {
    // fallback
  }
  return createLinUCBModel();
}


/**
 * 带时序衰减因子的在线强化学习更新 (Discounted-LinUCB Update)
 * 引入衰减因子 gamma (默认 0.98)，自适应抑制历史远期数据钝化，快速捕捉近期技术偏好漂移。
 * 公式：
 *   A_a = gamma * A_a + (1 - gamma) * I + x * x^T
 *   b_a = gamma * b_a + reward * x
 */
export function updateDiscountedArmReward(
  model: LinUCBModel,
  channel: RetrievalChannel,
  query: string,
  reward: number,
  gamma = 0.98
): void {
  const arm = model.arms[channel];
  if (!arm) return;

  const x = extractContextFeatures(query);
  const dim = model.dimension;
  const safeGamma = Math.min(1.0, Math.max(0.8, gamma));

  // 1) 协方差矩阵时序折扣更新：gamma * A + (1 - gamma) * I + x * x^T
  for (let i = 0; i < dim; i++) {
    const row = arm.A[i];
    const xi = x[i] ?? 0;
    if (row) {
      for (let j = 0; j < dim; j++) {
        const curVal = row[j] ?? 0;
        const identityDelta = i === j ? (1.0 - safeGamma) : 0;
        row[j] = safeGamma * curVal + identityDelta + xi * (x[j] ?? 0);
      }
    }
  }

  // 2) 累积奖励偏置时序折扣更新：gamma * b + reward * x
  for (let i = 0; i < dim; i++) {
    arm.b[i] = safeGamma * (arm.b[i] ?? 0) + reward * (x[i] ?? 0);
  }
}

/**
 * 驻留时长与交互行为双重隐式奖励模型 (Dwell-Time Implicit Feedback)
 * @param dwellSeconds 用户在目标卡片/站点的驻留观察时长（秒）
 * @param interactionType 交互行为（click / copy / bounce）
 * @returns 连续归一化奖励得分 [-1.0, 2.0]
 */
export function computeDwellTimeReward(
  dwellSeconds: number,
  interactionType: 'click' | 'copy' | 'bounce' = 'click'
): number {
  if (interactionType === 'copy') {
    // 触发有效复制或书签操作：极强正反馈（必须先判，否则短驻留 copy 被误判为 bounce）
    return 2.0;
  }
  if (interactionType === 'bounce' || dwellSeconds < 1.5) {
    // 快速回退跳出：给予负向惩罚
    return -0.5;
  }
  // 驻留 1.5s ~ 30s 按照饱和对数曲线平滑映射 [0.2, 1.5]
  const logScore = Math.log(dwellSeconds + 1) / Math.log(31);
  return Number((Math.min(1.5, Math.max(0.2, logScore * 1.5))).toFixed(2));
}

/**
 * 二阶多项式特征交叉投影 (Poly2 Feature Expansion)
 * 将基础线性特征升维至包含成对交互项的高阶空间，捕捉非线性意图关联。
 */
export function expandPoly2Features(features: number[]): number[] {
  const expanded = [...features];
  const n = features.length;
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      expanded.push(Number(((features[i] ?? 0) * (features[j] ?? 0)).toFixed(4)));
    }
  }
  return expanded;
}
