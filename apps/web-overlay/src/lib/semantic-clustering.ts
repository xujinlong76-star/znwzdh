/**
 * 语义聚类与自适应类目生成引擎 (Semantic Clustering & Autonomous Taxonomy Generation)
 *
 * 核心设计目标：
 * 1. K-Means++ 高维向量聚类算法：解决导入海量书签或未分类站点的无序堆积
 * 2. 自动化类目命名 (Taxonomy Label Synthesis)：基于聚类内标题、标签与高频词特征，合成可解释的分类名称
 * 3. 凝聚度与轮廓度评估 (Cohesion & Quality Scoring)
 */

export interface ClusterableItem {
  id: string;
  title: string;
  url: string;
  tags?: string[];
  vector?: number[];
}

export interface GeneratedCluster {
  clusterId: string;
  suggestedName: string;
  itemCount: number;
  items: ClusterableItem[];
  cohesionScore: number; // 0 ~ 100
  centroid: number[];
}

export interface ClusteringResult {
  totalItems: number;
  clusterCount: number;
  clusters: GeneratedCluster[];
  averageCohesion: number;
}

/**
 * 计算两个向量之间的余弦相似度
 */
export function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const va = a[i]!;
    const vb = b[i]!;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return Math.max(-1, Math.min(1, dot / denom));
}

/**
 * 余弦距离 = 1 - 余弦相似度 (0 ~ 2)
 */
export function cosineDist(a: number[], b: number[]): number {
  return 1 - cosineSim(a, b);
}

/**
 * 从文本和标签中提取简易特征词袋向量 (当无预计算深度向量时作为轻量回退)
 */
export function extractBagOfWordsVector(
  item: ClusterableItem,
  vocabulary: string[]
): number[] {
  const text = `${item.title} ${item.tags?.join(' ') || ''}`.toLowerCase();
  return vocabulary.map((word) => (text.includes(word.toLowerCase()) ? 1.0 : 0.0));
}

/**
 * 构建常用技术词汇表
 */
export function buildVocabulary(items: ClusterableItem[]): string[] {
  const freq = new Map<string, number>();

  for (const item of items) {
    if (item.tags) {
      for (const t of item.tags) {
        const norm = t.trim().toLowerCase();
        if (norm) freq.set(norm, (freq.get(norm) || 0) + 3);
      }
    }
    const words = item.title.toLowerCase().split(/[\s,./_\\-]+/).filter((w) => w.length >= 2);
    for (const w of words) {
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }

  // 排序取出现频次最高的词汇
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 64)
    .map((e) => e[0]);
}

/**
 * K-Means++ 聚类算法实现
 */
export function kMeansPlusPlus(
  vectors: number[][],
  k: number,
  maxIterations = 25
): { centroids: number[][]; assignments: number[] } {
  const n = vectors.length;
  if (n === 0 || k <= 0) {
    return { centroids: [], assignments: [] };
  }
  const effectiveK = Math.min(k, n);
  const dim = vectors[0]!.length;

  // 1. K-Means++ 初始化质心
  const centroids: number[][] = [];
  centroids.push([...vectors[0]!]);

  while (centroids.length < effectiveK) {
    // 计算每个样本到最近已有质心的最短平方距离
    const distSq: number[] = [];
    let sumDistSq = 0;

    for (let i = 0; i < n; i++) {
      let minDist = Infinity;
      for (const c of centroids) {
        const d = cosineDist(vectors[i]!, c);
        if (d < minDist) minDist = d;
      }
      const d2 = minDist * minDist;
      distSq.push(d2);
      sumDistSq += d2;
    }

    // 轮盘赌概率选取下一个质心
    if (sumDistSq <= 0) {
      centroids.push([...vectors[centroids.length]!]);
      continue;
    }

    let target = Math.random() * sumDistSq;
    let chosenIndex = 0;
    for (let i = 0; i < n; i++) {
      target -= distSq[i]!;
      if (target <= 0) {
        chosenIndex = i;
        break;
      }
    }
    centroids.push([...vectors[chosenIndex]!]);
  }

  // 2. 迭代收敛
  const assignments = new Array<number>(n).fill(0);

  for (let it = 0; it < maxIterations; it++) {
    let changed = false;

    // 重新分配簇
    for (let i = 0; i < n; i++) {
      let bestCluster = 0;
      let minD = Infinity;
      for (let c = 0; c < effectiveK; c++) {
        const d = cosineDist(vectors[i]!, centroids[c]!);
        if (d < minD) {
          minD = d;
          bestCluster = c;
        }
      }
      if (assignments[i] !== bestCluster) {
        assignments[i] = bestCluster;
        changed = true;
      }
    }

    if (!changed && it > 0) break;

    // 重新计算质心均值
    const newCentroids: number[][] = Array.from({ length: effectiveK }, () => new Array(dim).fill(0));
    const counts = new Array<number>(effectiveK).fill(0);

    for (let i = 0; i < n; i++) {
      const c = assignments[i]!;
      const currentCount = counts[c] ?? 0;
      counts[c] = currentCount + 1;
      const targetCentroid = newCentroids[c];
      const sourceVec = vectors[i];
      if (targetCentroid && sourceVec) {
        for (let d = 0; d < dim; d++) {
          const prev = targetCentroid[d] ?? 0;
          const val = sourceVec[d] ?? 0;
          targetCentroid[d] = prev + val;
        }
      }
    }

    for (let c = 0; c < effectiveK; c++) {
      const cCount = counts[c] ?? 0;
      const targetCentroid = centroids[c];
      const sumCentroid = newCentroids[c];
      if (cCount > 0 && targetCentroid && sumCentroid) {
        for (let d = 0; d < dim; d++) {
          targetCentroid[d] = (sumCentroid[d] ?? 0) / cCount;
        }
      }
    }
  }

  return { centroids, assignments };
}

/**
 * 根据聚类内的条目特征，合成可解释的分类名称
 */
export function synthesizeClusterName(items: ClusterableItem[]): string {
  if (items.length === 0) return '未命名分组';

  // 1. 统计标签
  const tagFreq = new Map<string, number>();
  for (const item of items) {
    if (item.tags) {
      for (const t of item.tags) {
        tagFreq.set(t, (tagFreq.get(t) || 0) + 1);
      }
    }
  }

  if (tagFreq.size > 0) {
    const topTag = Array.from(tagFreq.entries()).sort((a, b) => b[1] - a[1])[0]!;
    return `${topTag[0].toUpperCase()} 生态体系`;
  }

  // 2. 统计标题关键词
  const wordFreq = new Map<string, number>();
  for (const item of items) {
    const words = item.title.split(/[\s,./_\\-]+/).filter((w) => w.length >= 2);
    for (const w of words) {
      wordFreq.set(w, (wordFreq.get(w) || 0) + 1);
    }
  }

  if (wordFreq.size > 0) {
    const topWord = Array.from(wordFreq.entries()).sort((a, b) => b[1] - a[1])[0]!;
    return `${topWord[0]} 相关工具`;
  }

  return '技术资源分类';
}

/**
 * 自适应语义聚类与分类生成主入口
 */
export function autoClusterSites(
  items: ClusterableItem[],
  targetK = 3
): ClusteringResult {
  if (items.length === 0) {
    return { totalItems: 0, clusterCount: 0, clusters: [], averageCohesion: 100 };
  }

  const k = Math.max(1, Math.min(targetK, items.length));

  // 准备向量空间（若存在外部嵌入向量则直接使用，否则用词袋向量）
  const hasVectors = items.every((it) => it.vector && it.vector.length > 0);
  let vectors: number[][];

  if (hasVectors) {
    vectors = items.map((it) => it.vector!);
  } else {
    const vocab = buildVocabulary(items);
    vectors = items.map((it) => extractBagOfWordsVector(it, vocab));
  }

  const { centroids, assignments } = kMeansPlusPlus(vectors, k);

  const clusterGroups = new Map<number, ClusterableItem[]>();
  const clusterVectors = new Map<number, number[][]>();

  for (let c = 0; c < centroids.length; c++) {
    clusterGroups.set(c, []);
    clusterVectors.set(c, []);
  }

  for (let i = 0; i < items.length; i++) {
    const c = assignments[i] ?? 0;
    clusterGroups.get(c)!.push(items[i]!);
    clusterVectors.get(c)!.push(vectors[i]!);
  }

  const generatedClusters: GeneratedCluster[] = [];
  let totalCohesion = 0;

  for (let c = 0; c < centroids.length; c++) {
    const groupItems = clusterGroups.get(c) || [];
    if (groupItems.length === 0) continue;

    const groupVecs = clusterVectors.get(c) || [];
    const centroid = centroids[c]!;

    // 计算内部凝聚度（样本与质心的平均余弦相似度）
    let simSum = 0;
    for (const v of groupVecs) {
      simSum += Math.max(0, cosineSim(v, centroid));
    }
    const cohesion = Math.round((simSum / groupVecs.length) * 100);
    totalCohesion += cohesion;

    generatedClusters.push({
      clusterId: `cluster-${c + 1}`,
      suggestedName: synthesizeClusterName(groupItems),
      itemCount: groupItems.length,
      items: groupItems,
      cohesionScore: cohesion,
      centroid,
    });
  }

  const avgCohesion = generatedClusters.length > 0
    ? Math.round(totalCohesion / generatedClusters.length)
    : 100;

  return {
    totalItems: items.length,
    clusterCount: generatedClusters.length,
    clusters: generatedClusters,
    averageCohesion: avgCohesion,
  };
}
