import { describe, expect, it } from "vitest";
import {
  // 1. Knowledge Graph & Pathfinding
  findShortestTechPath,
  computeGraphCentrality,
  analyzeStackCompatibility,
  PRESET_TECH_GRAPH,

  // 2. Visual Fingerprint
  hexToRgb,
  rgbToHex,
  rgbToHsl,
  calculateContrastRatio,
  analyzeVisualFingerprint,

  // 3. WebMCP Bridge
  WebMcpBridge,

  // 4. Federated Recommendation & LDP
  privatizeVector,
  aggregatePrivatizedContributions,
  computeCosineSimilarity,
  rankItemsWithPrivacy,
} from "../src/index.ts";

describe("Next-Gen 4.0: 1. 结构化技术栈知识图谱与多跳路径发现 (Knowledge Graph)", () => {
  it("计算两项技术间的最短协同演进路径 (Dijkstra Pathfinding)", () => {
    // React -> PostgreSQL: React -> Next.js -> Drizzle -> PostgreSQL
    const result = findShortestTechPath("react", "postgres");
    expect(result.found).toBe(true);
    expect(result.startId).toBe("react");
    expect(result.targetId).toBe("postgres");
    expect(result.distance).toBeGreaterThan(0);
    expect(result.nodeChain.length).toBeGreaterThanOrEqual(3);
    expect(result.nodeChain[0]?.id).toBe("react");
    expect(result.nodeChain[result.nodeChain.length - 1]?.id).toBe("postgres");
    expect(result.steps.length).toBe(result.nodeChain.length - 1);
  });

  it("相同技术寻路距离为 0 且节点链仅包含自身", () => {
    const result = findShortestTechPath("docker", "docker");
    expect(result.found).toBe(true);
    expect(result.distance).toBe(0);
    expect(result.nodeChain.length).toBe(1);
    expect(result.steps.length).toBe(0);
  });

  it("不存在节点时返回 found: false", () => {
    const result = findShortestTechPath("react", "non-existent-tech");
    expect(result.found).toBe(false);
    expect(result.distance).toBe(Infinity);
    expect(result.nodeChain.length).toBe(0);
  });

  it("计算 Kleinberg HITS 权威度与枢纽度 (Centrality)", () => {
    const { hubs, authorities } = computeGraphCentrality(PRESET_TECH_GRAPH, 10);
    expect(Object.keys(hubs).length).toBe(PRESET_TECH_GRAPH.nodes.length);
    expect(Object.keys(authorities).length).toBe(PRESET_TECH_GRAPH.nodes.length);

    // 验证归一化后权值都在合理范围
    for (const val of Object.values(authorities)) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1.0);
    }
  });

  it("分析技术栈兼容性与补齐缺失基础设施层", () => {
    // 仅选择了前端和 ORM
    const report = analyzeStackCompatibility(["react", "nextjs", "drizzle"]);
    expect(report.selectedTechIds).toContain("react");
    expect(report.coveredLayers).toContain("frontend");
    expect(report.coveredLayers).toContain("backend");
    expect(report.missingLayers).toContain("database");
    expect(report.missingLayers).toContain("devops");
    expect(report.synergies.length).toBeGreaterThan(0);
    expect(report.suggestedAdditions.some((s) => s.reason.includes("database"))).toBe(true);
  });
});

describe("Next-Gen 4.0: 2. 视觉指纹分析与色彩和谐度 (Visual Fingerprint)", () => {
  it("RGB、Hex、HSL 正确相互转换", () => {
    const hex = "#3b82f6";
    const rgb = hexToRgb(hex);
    expect(rgb.r).toBe(59);
    expect(rgb.g).toBe(130);
    expect(rgb.b).toBe(246);

    const backHex = rgbToHex(rgb);
    expect(backHex.toLowerCase()).toBe(hex.toLowerCase());

    const hsl = rgbToHsl(rgb);
    expect(hsl.h).toBeGreaterThanOrEqual(210);
    expect(hsl.h).toBeLessThanOrEqual(225);
    expect(hsl.s).toBeGreaterThan(80);
  });

  it("计算 WCAG 2.1 相对亮度与对比度", () => {
    const white = hexToRgb("#ffffff");
    const black = hexToRgb("#000000");
    const contrast = calculateContrastRatio(white, black);
    expect(contrast).toBeCloseTo(21.0, 1);

    // 相同颜色对比度为 1:1
    expect(calculateContrastRatio(white, white)).toBeCloseTo(1.0, 1);
  });

  it("评估调色板视觉指纹、情绪风格与合规级别", () => {
    // 霓虹青与霓虹品红组合 -> Cyberpunk
    const cyberpunkColors = ["#00ffff", "#ff00ff", "#1e1b4b"];
    const report = analyzeVisualFingerprint(cyberpunkColors, "#030712", "#f9fafb");

    expect(report.detectedMood).toBe("cyberpunk");
    expect(report.wcagContrastRatio).toBeGreaterThan(4.5);
    expect(report.wcagPassLevel === "AAA" || report.wcagPassLevel === "AA").toBe(true);
    expect(report.harmonyScore).toBeGreaterThanOrEqual(70);
  });
});

describe("Next-Gen 4.0: 3. 浏览器端端侧 WebMCP 协议网桥 (WebMCP Bridge)", () => {
  it("初始化并列出内置工具", () => {
    const bridge = new WebMcpBridge();
    const tools = bridge.listTools();

    expect(tools.length).toBeGreaterThanOrEqual(2);
    expect(tools.some((t) => t.name === "navhub_echo")).toBe(true);
    expect(tools.some((t) => t.name === "navhub_system_info")).toBe(true);
  });

  it("处理标准 JSON-RPC 2.0 工具调用 (tools/call)", async () => {
    const bridge = new WebMcpBridge();
    const res = await bridge.handleRpc({
      jsonrpc: "2.0",
      id: "req-1",
      method: "tools/call",
      params: {
        name: "navhub_echo",
        arguments: { message: "Hello WebMCP!" },
      },
    });

    expect(res.jsonrpc).toBe("2.0");
    expect(res.id).toBe("req-1");
    expect(res.error).toBeUndefined();
    expect(res.result.content[0].type).toBe("text");
    expect(res.result.content[0].text).toContain("Hello WebMCP!");
  });

  it("支持动态注册自定义工具并调用", async () => {
    const bridge = new WebMcpBridge();
    bridge.registerTool(
      {
        name: "calculate_sum",
        description: "Adds two numbers",
        inputSchema: {
          type: "object",
          properties: { a: { type: "number" }, b: { type: "number" } },
        },
      },
      (args) => ({ sum: (args.a || 0) + (args.b || 0) })
    );

    const res = await bridge.handleRpc({
      jsonrpc: "2.0",
      id: 42,
      method: "tools/call",
      params: {
        name: "calculate_sum",
        arguments: { a: 15, b: 27 },
      },
    });

    expect(res.result.content[0].text).toContain('"sum": 42');
  });

  it("对于非法协议请求或未找到的方法返回标准化错误响应", async () => {
    const bridge = new WebMcpBridge();

    // 未知方法
    const unknownRes = await bridge.handleRpc({
      jsonrpc: "2.0",
      id: 99,
      method: "unknown_method",
    });
    expect(unknownRes.error?.code).toBe(-32601);

    // 未知工具
    const unknownToolRes = await bridge.handleRpc({
      jsonrpc: "2.0",
      id: 100,
      method: "tools/call",
      params: { name: "non_existent_tool" },
    });
    expect(unknownToolRes.error?.code).toBe(-32601);
  });
});

describe("Next-Gen 4.0: 4. 本地差分隐私协同推荐 (Federated LDP Recommendation)", () => {
  it("本地向量差分隐私加噪保持维度一致且具有噪声波动", () => {
    const raw = [10, 5, 2, 0, 8];
    const privatized = privatizeVector(raw, 1.0, 1.0);

    expect(privatized.length).toBe(raw.length);
    // 验证确实注入了非确定性噪声
    const differs = privatized.some((v, idx) => v !== raw[idx]);
    expect(differs).toBe(true);
  });

  it("多个客户端脱敏向量聚合消除零均值拉普拉斯噪声 (Unbiased Estimation)", () => {
    const base = [10, 20, 30];
    const contributions: number[][] = [];

    // 模拟 100 个客户端
    for (let i = 0; i < 100; i++) {
      contributions.push(privatizeVector(base, 1.0, 1.0));
    }

    const aggregated = aggregatePrivatizedContributions(contributions);
    expect(aggregated.length).toBe(3);
    // 均值应该非常接近原始值 (大数定律)
    expect(aggregated[0]).toBeGreaterThan(8);
    expect(aggregated[0]).toBeLessThan(12);
    expect(aggregated[1]).toBeGreaterThan(18);
    expect(aggregated[1]).toBeLessThan(22);
  });

  it("隐私混合加权打分对候选项目进行个性化与群体趋势排序", () => {
    const local = [1, 0, 0]; // 偏好 AI
    const globalTrend = [0.8, 0.5, 0.2]; // 全局流行 AI + 全栈
    const candidates = [
      { id: "pytorch", name: "PyTorch", featureVector: [1, 0, 0] },
      { id: "nextjs", name: "Next.js", featureVector: [0, 1, 0] },
      { id: "docker", name: "Docker", featureVector: [0, 0, 1] },
    ];

    const ranked = rankItemsWithPrivacy(local, globalTrend, candidates, 0.7);
    expect(ranked.length).toBe(3);
    // PyTorch 与本地偏好完全匹配，应排在首位
    expect(ranked[0]?.itemId).toBe("pytorch");
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
  });
});
