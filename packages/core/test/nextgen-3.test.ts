import { describe, expect, it } from "vitest";
import {
  // 1. Edge-Vector RAG
  buildQuantizedVectorIndex,
  computeVectorNorm,
  cosineSimilarity,
  quantizeVector,
  searchVectorIndex,
  type VectorDocument,

  // 2. P2P Mesh Sync
  P2PMeshNode,
  CrdtStore,

  // 3. Speculative Pre-rendering
  compileSpeculationRules,
  isSafeForSpeculation,
  renderSpeculationRulesScript,
  generateFallbackLinkTags,

  // 4. Autonomous Healing Agent
  diagnoseBrokenCause,
  runAutonomousHealing,
} from "../src/index.ts";

describe("Next-Gen 3.0: 1. 端侧轻量级向量检索与标量量化 (Edge-Vector Search)", () => {
  it("计算向量 L2 模长与余弦相似度", () => {
    const v1 = [1, 0, 0];
    const v2 = [0, 1, 0];
    const v3 = [2, 0, 0];

    expect(computeVectorNorm(v1)).toBeCloseTo(1.0);
    expect(computeVectorNorm(v3)).toBeCloseTo(2.0);
    expect(cosineSimilarity(v1, v2)).toBeCloseTo(0.0);
    expect(cosineSimilarity(v1, v3)).toBeCloseTo(1.0);
  });

  it("Int8 标量量化压缩并保持几何相对距离", () => {
    const original = [0.15, -0.85, 0.42, 0.99, -0.3];
    const { quantized, scale, norm } = quantizeVector(original);

    expect(quantized.length).toBe(original.length);
    expect(quantized.byteLength).toBe(5); // 5 bytes instead of 20 bytes (4x reduction)
    expect(scale).toBeGreaterThan(0);
    expect(norm).toBeCloseTo(computeVectorNorm(original), 2);
  });

  it("构建端侧量化索引并执行精确 Top-K 召回", () => {
    const docs: VectorDocument[] = [
      { id: "1", title: "React 19", url: "https://react.dev", categoryId: "dev", tags: ["frontend"], vector: [0.9, 0.1, 0.0, 0.0] },
      { id: "2", title: "Vue 3", url: "https://vuejs.org", categoryId: "dev", tags: ["frontend"], vector: [0.85, 0.15, 0.0, 0.0] },
      { id: "3", title: "PyTorch", url: "https://pytorch.org", categoryId: "ai", tags: ["deep-learning"], vector: [0.0, 0.0, 0.95, 0.1] },
      { id: "4", title: "TensorFlow", url: "https://tensorflow.org", categoryId: "ai", tags: ["deep-learning"], vector: [0.0, 0.0, 0.9, 0.2] },
    ];

    const index = buildQuantizedVectorIndex(docs);
    expect(index.docs.length).toBe(4);
    expect(index.dim).toBe(4);

    // 查询前端工程化向量 [1, 0, 0, 0]
    const hits = searchVectorIndex(index, [1, 0, 0, 0], { topK: 2 });
    expect(hits.length).toBe(2);
    expect(hits[0]!.id).toBe("1"); // React 最相似
    expect(hits[1]!.id).toBe("2"); // Vue 次之
    expect(hits[0]!.score).toBeGreaterThan(0.9);

    // 筛选 categoryId="ai"
    const aiHits = searchVectorIndex(index, [0, 0, 1, 0], { topK: 2, categoryId: "ai" });
    expect(aiHits.length).toBe(2);
    expect(aiHits[0]!.id).toBe("3"); // PyTorch
  });
});

describe("Next-Gen 3.0: 2. WebRTC DataChannel 点对点分布式共识流 (P2P Mesh Sync)", () => {
  it("双节点 P2P 握手、时钟比对与 Delta 增量自动收敛", () => {
    const nodeA = new P2PMeshNode("node-alpha");
    const nodeB = new P2PMeshNode("node-beta");

    // A 创建一个站点
    nodeA.store.addSite({ url: "https://alpha.example.com", title: "Alpha Site", categoryId: "cat-1" });
    // B 创建另一个站点
    nodeB.store.addSite({ url: "https://beta.example.com", title: "Beta Site", categoryId: "cat-2" });

    // 1. A 主动发起连接向 B 发送 HELLO
    const helloFromA = nodeA.connectPeer("node-beta");
    expect(helloFromA.type).toBe("HELLO");

    // 2. B 接收并处理 HELLO
    const replyFromB = nodeB.handleIncomingMessage(helloFromA);
    expect(replyFromB).toBeTruthy();
    expect(replyFromB?.type).toBe("DELTA_BATCH"); // B 发现了时钟分叉，推送 B 的 Delta 并索要 A 的变更

    // 3. A 处理 B 的 DELTA_BATCH
    const replyFromA = nodeA.handleIncomingMessage(replyFromB!);
    expect(replyFromA).toBeTruthy(); // A 应用了 B 的变更，并把 A 的变更打包回传

    // 4. B 处理 A 的最终回传
    if (replyFromA) {
      nodeB.handleIncomingMessage(replyFromA);
    }

    // 此时双端 CRDT 达成完全确定性收敛！
    const sitesA = nodeA.store.getActiveSites().map((s) => s.url).sort();
    const sitesB = nodeB.store.getActiveSites().map((s) => s.url).sort();
    expect(sitesA).toEqual(["https://alpha.example.com", "https://beta.example.com"]);
    expect(sitesB).toEqual(["https://alpha.example.com", "https://beta.example.com"]);

    expect(nodeA.getPeer("node-beta")?.state).toBe("READY");
    expect(nodeB.getPeer("node-alpha")?.state).toBe("READY");
  });

  it("广播本地新增修改至所有已就绪 Peers", () => {
    const nodeA = new P2PMeshNode("node-alpha");
    const nodeB = new P2PMeshNode("node-beta");

    // 先建立就绪通道
    const hello = nodeA.connectPeer("node-beta");
    const replyB = nodeB.handleIncomingMessage(hello);
    if (replyB) nodeA.handleIncomingMessage(replyB);

    // A 本地再新增一个书签
    nodeA.store.addSite({ url: "https://gamma.example.com", title: "Gamma Site", categoryId: "cat-3" });
    const broadcasts = nodeA.broadcastLocalUpdate();
    expect(broadcasts.length).toBe(1);
    expect(broadcasts[0]!.type).toBe("DELTA_BATCH");

    // B 接收广播报文并应用
    nodeB.handleIncomingMessage(broadcasts[0]!);
    expect(nodeB.store.getSiteByUrl("https://gamma.example.com")?.title).toBe("Gamma Site");
  });
});

describe("Next-Gen 3.0: 3. 自适应推测性预渲染 (Speculative Pre-rendering)", () => {
  it("安全过滤敏感路径与无效协议", () => {
    expect(isSafeForSpeculation("https://react.dev")).toBe(true);
    expect(isSafeForSpeculation("http://example.com/blog")).toBe(true);
    expect(isSafeForSpeculation("javascript:alert(1)")).toBe(false);
    expect(isSafeForSpeculation("https://example.com/logout")).toBe(false);
    expect(isSafeForSpeculation("https://example.com/admin/settings")).toBe(false);
  });

  it("根据 Kalman 置信度阈值编译 W3C Speculation Rules 规则负载", () => {
    const candidates = [
      { url: "https://react.dev", confidence: 0.92, predictedArrivalMs: 120 }, // 应该进入 prerender
      { url: "https://vuejs.org", confidence: 0.65, predictedArrivalMs: 280 }, // 应该进入 prefetch
      { url: "https://evil.com/logout", confidence: 0.99, predictedArrivalMs: 50 }, // 应该被安全规则拦截
      { url: "https://angular.io", confidence: 0.2, predictedArrivalMs: 800 }, // 置信度太低被过滤
    ];

    const rules = compileSpeculationRules(candidates);
    expect(rules).toBeTruthy();
    expect(rules?.prerender?.[0]?.urls).toEqual(["https://react.dev"]);
    expect(rules?.prerender?.[0]?.eagerness).toBe("immediate");
    expect(rules?.prefetch?.[0]?.urls).toEqual(["https://vuejs.org"]);
    expect(rules?.prefetch?.[0]?.eagerness).toBe("moderate");

    const scriptText = renderSpeculationRulesScript(rules!);
    expect(scriptText).toContain('"prerender"');
    expect(scriptText).toContain('"prefetch"');

    // 检查低版本浏览器 fallback
    const fallbacks = generateFallbackLinkTags(rules!);
    expect(fallbacks).toContain('<link rel="prerender" href="https://react.dev" />');
    expect(fallbacks).toContain('<link rel="prefetch" href="https://vuejs.org" />');
  });
});

describe("Next-Gen 3.0: 4. AI 自动嗅探与智能动态元数据守护自愈机制 (Autonomous Healing)", () => {
  it("推导 HTTP 404 / 410 / DNS 失败的诱因", () => {
    expect(diagnoseBrokenCause(404).cause).toBe("HTTP_NOT_FOUND");
    expect(diagnoseBrokenCause(410).cause).toBe("HTTP_GONE");
    expect(diagnoseBrokenCause(502).cause).toBe("HTTP_SERVER_ERROR");
    expect(diagnoseBrokenCause(null, "getaddrinfo ENOTFOUND fake.test").cause).toBe("DNS_RESOLVE_FAIL");
  });

  it("为已失效站点综合诊断并给出 Wayback 归档拯救与同图谱健康替代品", () => {
    const peers = [
      { id: "peer-1", title: "Claude AI", url: "https://claude.ai", categoryId: "cat-ai", tags: ["ai", "llm"] },
      { id: "peer-2", title: "DeepSeek", url: "https://deepseek.com", categoryId: "cat-ai", tags: ["ai", "llm", "chat"] },
      { id: "peer-3", title: "Figma", url: "https://figma.com", categoryId: "cat-design", tags: ["design"] },
    ];

    const report = runAutonomousHealing({
      siteId: "dead-site",
      url: "https://dead-ai-tool.com/app",
      title: "旧款 AI 助手",
      httpStatus: 410,
      categoryId: "cat-ai",
      tags: ["ai", "llm"],
      availablePeers: peers,
    });

    expect(report.siteId).toBe("dead-site");
    expect(report.diagnosis.cause).toBe("HTTP_GONE");
    expect(report.waybackFallbackUrl).toContain("web.archive.org/web");
    expect(report.suggestedReplacements.length).toBeGreaterThan(0);
    expect(report.suggestedReplacements[0]!.matchScore).toBeGreaterThanOrEqual(0.7);
    expect(report.recommendedAction).toBe("redirect_to_alternative");
    expect(report.autoResolvable).toBe(true);
  });
});
