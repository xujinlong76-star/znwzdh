/**
 * 次世代技术栈知识星图与多跳路径发现引擎 (Knowledge Graph & Tech Pathfinding)
 *
 * 核心设计目标：
 * 终结单点孤立的网址陈列。构建结构化技术知识拓扑图谱：
 * 1. 双向最短链路搜索 (Bi-directional Pathfinding)：查找任意两项技术之间的协同演进路径
 *    （如：React -> Next.js -> Drizzle -> PostgreSQL）
 * 2. 权威度与枢纽度分析 (Kleinberg HITS Algorithm)：计算技术生态中的基础权威组件与聚合枢纽
 * 3. 架构方案兼容性与补齐推断 (Stack Compatibility & Gap Inference)
 */

export interface GraphNode {
  id: string;
  name: string;
  category: string;
  layer: 'frontend' | 'backend' | 'database' | 'ai' | 'devops' | 'mobile';
  description?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: 'integrates_with' | 'compiles_to' | 'queries' | 'deploys_on' | 'extends';
  weight: number; // 0.1 ~ 1.0，越小代表结合越紧密、成本越低
}

export interface KnowledgeGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface PathStep {
  fromNode: GraphNode;
  toNode: GraphNode;
  relation: string;
}

export interface TechPathResult {
  found: boolean;
  startId: string;
  targetId: string;
  distance: number;
  steps: PathStep[];
  nodeChain: GraphNode[];
}

export interface StackCompatibilityReport {
  selectedTechIds: string[];
  coherenceScore: number; // 0 ~ 100
  coveredLayers: string[];
  missingLayers: string[];
  synergies: string[];
  suggestedAdditions: Array<{ id: string; name: string; reason: string }>;
}

export const PRESET_TECH_GRAPH: KnowledgeGraphData = {
  nodes: [
    { id: 'react', name: 'React', category: 'UI', layer: 'frontend' },
    { id: 'vue', name: 'Vue.js', category: 'UI', layer: 'frontend' },
    { id: 'nextjs', name: 'Next.js', category: 'Fullstack', layer: 'frontend' },
    { id: 'nuxt', name: 'Nuxt', category: 'Fullstack', layer: 'frontend' },
    { id: 'tailwind', name: 'Tailwind CSS', category: 'CSS', layer: 'frontend' },
    { id: 'typescript', name: 'TypeScript', category: 'Language', layer: 'frontend' },
    { id: 'fastify', name: 'Fastify', category: 'Server', layer: 'backend' },
    { id: 'hono', name: 'Hono', category: 'Edge Server', layer: 'backend' },
    { id: 'drizzle', name: 'Drizzle ORM', category: 'ORM', layer: 'backend' },
    { id: 'prisma', name: 'Prisma', category: 'ORM', layer: 'backend' },
    { id: 'postgres', name: 'PostgreSQL', category: 'RDBMS', layer: 'database' },
    { id: 'sqlite', name: 'SQLite', category: 'Embedded DB', layer: 'database' },
    { id: 'redis', name: 'Redis', category: 'Cache', layer: 'database' },
    { id: 'cloudflare', name: 'Cloudflare Workers', category: 'Hosting', layer: 'devops' },
    { id: 'docker', name: 'Docker', category: 'Container', layer: 'devops' },
    { id: 'ollama', name: 'Ollama', category: 'Local LLM', layer: 'ai' },
    { id: 'vllm', name: 'vLLM', category: 'Inference Engine', layer: 'ai' },
    { id: 'langchain', name: 'LangChain', category: 'LLM Framework', layer: 'ai' },
  ],
  edges: [
    { source: 'react', target: 'nextjs', relation: 'extends', weight: 0.1 },
    { source: 'nextjs', target: 'tailwind', relation: 'integrates_with', weight: 0.2 },
    { source: 'nextjs', target: 'typescript', relation: 'integrates_with', weight: 0.1 },
    { source: 'nextjs', target: 'drizzle', relation: 'integrates_with', weight: 0.3 },
    { source: 'nextjs', target: 'prisma', relation: 'integrates_with', weight: 0.3 },
    { source: 'nextjs', target: 'cloudflare', relation: 'deploys_on', weight: 0.4 },
    { source: 'vue', target: 'nuxt', relation: 'extends', weight: 0.1 },
    { source: 'nuxt', target: 'tailwind', relation: 'integrates_with', weight: 0.2 },
    { source: 'fastify', target: 'drizzle', relation: 'integrates_with', weight: 0.2 },
    { source: 'hono', target: 'cloudflare', relation: 'deploys_on', weight: 0.1 },
    { source: 'hono', target: 'drizzle', relation: 'integrates_with', weight: 0.2 },
    { source: 'drizzle', target: 'postgres', relation: 'queries', weight: 0.2 },
    { source: 'drizzle', target: 'sqlite', relation: 'queries', weight: 0.2 },
    { source: 'prisma', target: 'postgres', relation: 'queries', weight: 0.2 },
    { source: 'fastify', target: 'docker', relation: 'deploys_on', weight: 0.3 },
    { source: 'fastify', target: 'redis', relation: 'queries', weight: 0.3 },
    { source: 'langchain', target: 'ollama', relation: 'integrates_with', weight: 0.2 },
    { source: 'langchain', target: 'nextjs', relation: 'integrates_with', weight: 0.3 },
    { source: 'vllm', target: 'docker', relation: 'deploys_on', weight: 0.2 },
  ],
};

/**
 * 1. 双向最短技术演进链路寻路算法 (Bi-directional Dijkstra)
 */
export function findShortestTechPath(
  startId: string,
  targetId: string,
  graph: KnowledgeGraphData = PRESET_TECH_GRAPH
): TechPathResult {
  const normStart = startId.trim().toLowerCase();
  const normTarget = targetId.trim().toLowerCase();

  const nodeMap = new Map(graph.nodes.map((n) => [n.id.toLowerCase(), n]));
  const startNode = nodeMap.get(normStart);
  const targetNode = nodeMap.get(normTarget);

  if (!startNode || !targetNode) {
    return {
      found: false,
      startId,
      targetId,
      distance: Infinity,
      steps: [],
      nodeChain: [],
    };
  }

  if (normStart === normTarget) {
    return {
      found: true,
      startId,
      targetId,
      distance: 0,
      steps: [],
      nodeChain: [startNode],
    };
  }

  // 构建无向加权邻接表
  interface AdjItem {
    nodeId: string;
    weight: number;
    relation: string;
  }
  const adj = new Map<string, AdjItem[]>();

  for (const n of graph.nodes) {
    adj.set(n.id.toLowerCase(), []);
  }

  for (const edge of graph.edges) {
    const s = edge.source.toLowerCase();
    const t = edge.target.toLowerCase();
    if (!adj.has(s)) adj.set(s, []);
    if (!adj.has(t)) adj.set(t, []);
    adj.get(s)!.push({ nodeId: t, weight: edge.weight, relation: edge.relation });
    adj.get(t)!.push({ nodeId: s, weight: edge.weight, relation: `connected_to (${edge.relation})` });
  }

  // Dijkstra 最短路
  const dist = new Map<string, number>();
  const prev = new Map<string, { from: string; relation: string }>();
  const visited = new Set<string>();

  for (const n of graph.nodes) {
    dist.set(n.id.toLowerCase(), Infinity);
  }
  dist.set(normStart, 0);

  while (visited.size < graph.nodes.length) {
    // 选取未访问且距离最小的节点
    let u: string | null = null;
    let minD = Infinity;
    for (const [id, d] of dist.entries()) {
      if (!visited.has(id) && d < minD) {
        minD = d;
        u = id;
      }
    }

    if (u === null || minD === Infinity) break;
    if (u === normTarget) break;

    visited.add(u);

    for (const edge of adj.get(u) || []) {
      if (visited.has(edge.nodeId)) continue;
      const alt = minD + edge.weight;
      if (alt < (dist.get(edge.nodeId) ?? Infinity)) {
        dist.set(edge.nodeId, alt);
        prev.set(edge.nodeId, { from: u, relation: edge.relation });
      }
    }
  }

  const finalDist = dist.get(normTarget);
  if (finalDist === undefined || finalDist === Infinity) {
    return {
      found: false,
      startId,
      targetId,
      distance: Infinity,
      steps: [],
      nodeChain: [],
    };
  }

  // 回溯还原链路
  const nodeChain: GraphNode[] = [];
  const steps: PathStep[] = [];
  let curr: string | undefined = normTarget;

  while (curr && curr !== normStart) {
    const p = prev.get(curr);
    if (!p) break;
    const fromNode = nodeMap.get(p.from)!;
    const toNode = nodeMap.get(curr)!;
    steps.unshift({
      fromNode,
      toNode,
      relation: p.relation,
    });
    nodeChain.unshift(toNode);
    curr = p.from;
  }
  nodeChain.unshift(startNode);

  return {
    found: true,
    startId,
    targetId,
    distance: Math.round(finalDist * 100) / 100,
    steps,
    nodeChain,
  };
}

/**
 * 2. 权威度与枢纽度分析 (Kleinberg HITS Algorithm)
 */
export function computeGraphCentrality(
  graph: KnowledgeGraphData = PRESET_TECH_GRAPH,
  iterations = 15
): { hubs: Record<string, number>; authorities: Record<string, number> } {
  const nodeIds = graph.nodes.map((n) => n.id.toLowerCase());
  const hubs: Record<string, number> = {};
  const authorities: Record<string, number> = {};

  for (const id of nodeIds) {
    hubs[id] = 1.0;
    authorities[id] = 1.0;
  }

  for (let it = 0; it < iterations; it++) {
    // 1. 更新 Authorities
    let normAuth = 0;
    for (const targetId of nodeIds) {
      let sum = 0;
      for (const edge of graph.edges) {
        if (edge.target.toLowerCase() === targetId) {
          sum += hubs[edge.source.toLowerCase()] ?? 0;
        }
      }
      authorities[targetId] = sum;
      normAuth += sum * sum;
    }
    normAuth = Math.sqrt(normAuth) || 1;
    for (const id of nodeIds) {
      authorities[id] = Math.round((authorities[id]! / normAuth) * 1000) / 1000;
    }

    // 2. 更新 Hubs
    let normHub = 0;
    for (const sourceId of nodeIds) {
      let sum = 0;
      for (const edge of graph.edges) {
        if (edge.source.toLowerCase() === sourceId) {
          sum += authorities[edge.target.toLowerCase()] ?? 0;
        }
      }
      hubs[sourceId] = sum;
      normHub += sum * sum;
    }
    normHub = Math.sqrt(normHub) || 1;
    for (const id of nodeIds) {
      hubs[id] = Math.round((hubs[id]! / normHub) * 1000) / 1000;
    }
  }

  return { hubs, authorities };
}

/**
 * 3. 架构方案兼容性诊断与补齐建议
 */
export function analyzeStackCompatibility(
  selectedTechIds: string[],
  graph: KnowledgeGraphData = PRESET_TECH_GRAPH
): StackCompatibilityReport {
  const normIds = new Set(selectedTechIds.map((id) => id.trim().toLowerCase()));
  const nodeMap = new Map(graph.nodes.map((n) => [n.id.toLowerCase(), n]));

  const validNodes = Array.from(normIds)
    .map((id) => nodeMap.get(id))
    .filter((n): n is GraphNode => Boolean(n));

  const layersCovered = new Set(validNodes.map((n) => n.layer));
  const allLayers = ['frontend', 'backend', 'database', 'devops'];
  const missingLayers = allLayers.filter((l) => !layersCovered.has(l as any));

  // 计算协同匹配度
  let connectedEdges = 0;
  const synergies: string[] = [];

  for (const edge of graph.edges) {
    const s = edge.source.toLowerCase();
    const t = edge.target.toLowerCase();
    if (normIds.has(s) && normIds.has(t)) {
      connectedEdges++;
      const sName = nodeMap.get(s)?.name || s;
      const tName = nodeMap.get(t)?.name || t;
      synergies.push(`${sName} 原生支持 ${tName} (${edge.relation})`);
    }
  }

  const baseScore = Math.min(100, Math.round((layersCovered.size / 4) * 50 + connectedEdges * 15));

  // 推荐补齐缺失层
  const suggestedAdditions: Array<{ id: string; name: string; reason: string }> = [];
  for (const missing of missingLayers) {
    const candidate = graph.nodes.find((n) => n.layer === missing);
    if (candidate) {
      suggestedAdditions.push({
        id: candidate.id,
        name: candidate.name,
        reason: `补齐缺失的 ${missing} 基础设施层`,
      });
    }
  }

  return {
    selectedTechIds: Array.from(normIds),
    coherenceScore: baseScore,
    coveredLayers: Array.from(layersCovered),
    missingLayers,
    synergies,
    suggestedAdditions,
  };
}
