/**
 * 领域模块覆盖补足（P1）：此前缺乏直接单元测试的高价值纯函数。
 * 覆盖：autonomous-healing、knowledge-graph、semantic-clustering、
 * linucb、dynamic-tool-synthesizer（site_search）、speculative-intent、crdt-sync。
 */
import { describe, expect, it } from "vitest";
import {
  diagnoseBrokenCause,
  runAutonomousHealing,
} from "../src/autonomous-healing.ts";
import {
  PRESET_TECH_GRAPH,
  analyzeStackCompatibility,
  computeGraphCentrality,
  findShortestTechPath,
} from "../src/knowledge-graph.ts";
import {
  autoClusterSites,
  cosineDist,
  cosineSim,
  kMeansPlusPlus,
  synthesizeClusterName,
} from "../src/semantic-clustering.ts";
import {
  createLinUCBModel,
  deserializeLinUCB,
  extractContextFeatures,
  predictArmWeights,
  serializeLinUCB,
  updateArmReward,
} from "../src/linucb.ts";
import { synthesizeSiteSearchTool } from "../src/dynamic-tool-synthesizer.ts";
import { parseSpeculativeIntent } from "../src/speculative-intent.ts";
import {
  createCRDTOperation,
  mergeOperationLogs,
  reduceOperationsToState,
} from "../src/crdt-sync.ts";

describe("autonomous-healing：故障诊断分支", () => {
  it("按 HTTP 状态分类", () => {
    expect(diagnoseBrokenCause(404).cause).toBe("HTTP_NOT_FOUND");
    expect(diagnoseBrokenCause(410).cause).toBe("HTTP_GONE");
    expect(diagnoseBrokenCause(503).cause).toBe("HTTP_SERVER_ERROR");
  });
  it("按错误信息分类（DNS/证书/超时/未知）", () => {
    expect(diagnoseBrokenCause(null, "getaddrinfo ENOTFOUND x.com").cause).toBe("DNS_RESOLVE_FAIL");
    expect(diagnoseBrokenCause(null, "certificate has expired").cause).toBe("SSL_CERT_ERROR");
    expect(diagnoseBrokenCause(null, "connect ETIMEDOUT").cause).toBe("TIMEOUT");
    expect(diagnoseBrokenCause(null, "weird").cause).toBe("UNKNOWN");
    expect(diagnoseBrokenCause(undefined).cause).toBe("UNKNOWN");
  });
  it("runAutonomousHealing：排除自身、按分类/标签打分", () => {
    const report = runAutonomousHealing({
      siteId: "s1",
      url: "https://dead.example.com",
      title: "Dead",
      httpStatus: 404,
      categoryId: "c1",
      tags: ["AI", "搜索"],
      availablePeers: [
        { id: "s1", title: "Dead", url: "https://dead.example.com" },
        { id: "s2", title: "同类", url: "https://peer.example.com", categoryId: "c1", tags: ["AI"] },
        { id: "s3", title: "无关", url: "https://other.example.com", categoryId: "c9" },
      ],
    });
    expect(report.diagnosis.cause).toBe("HTTP_NOT_FOUND");
    expect(report.suggestedReplacements.some((c) => c.id === "s1")).toBe(false);
    expect(report.suggestedReplacements.some((c) => c.id === "s2")).toBe(true);
    expect(report.suggestedReplacements.some((c) => c.id === "s3")).toBe(false);
    expect(typeof report.waybackFallbackUrl).toBe("string");
  });
});

describe("knowledge-graph：寻路/中心性/兼容性", () => {
  it("未知节点返回 found=false", () => {
    const r = findShortestTechPath("nope-a", "nope-b");
    expect(r.found).toBe(false);
    expect(r.distance).toBe(Infinity);
    expect(r.steps).toEqual([]);
  });
  it("同节点距离为 0", () => {
    const r = findShortestTechPath("react", "React");
    expect(r.found).toBe(true);
    expect(r.distance).toBe(0);
    expect(r.nodeChain.length).toBe(1);
  });
  it("HITS 中心性覆盖全部节点且非负", () => {
    const { hubs, authorities } = computeGraphCentrality();
    const ids = PRESET_TECH_GRAPH.nodes.map((n) => n.id.toLowerCase());
    expect(Object.keys(hubs).sort()).toEqual([...ids].sort());
    for (const v of [...Object.values(hubs), ...Object.values(authorities)]) {
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });
  it("空选择缺全部四层；全栈选择覆盖多层", () => {
    const empty = analyzeStackCompatibility([]);
    expect(empty.missingLayers.sort()).toEqual(["backend", "database", "devops", "frontend"]);
    const full = analyzeStackCompatibility(["react", "fastify", "postgres", "redis"]);
    expect(full.coveredLayers.length).toBeGreaterThan(1);
    expect(full.coherenceScore).toBeGreaterThanOrEqual(0);
  });
});

describe("semantic-clustering：相似度/聚类", () => {
  it("cosineSim/cosineDist 基本性质", () => {
    expect(cosineSim([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineDist([1, 0], [1, 0])).toBeCloseTo(0);
  });
  it("kMeansPlusPlus：空输入与 k>n 收敛", () => {
    expect(kMeansPlusPlus([], 3)).toEqual({ centroids: [], assignments: [] });
    const r = kMeansPlusPlus([[1, 0], [0, 1], [1, 1]], 10);
    expect(r.assignments.length).toBe(3);
    expect(r.centroids.length).toBeLessThanOrEqual(3);
  });
  it("autoClusterSites：空输入与合成名", () => {
    expect(autoClusterSites([])).toEqual({ totalItems: 0, clusterCount: 0, clusters: [], averageCohesion: 100 });
    const items = [
      { id: "a", title: "AI 搜索工具", url: "https://a.example.com", tags: ["AI"] },
      { id: "b", title: "AI 绘画工具", url: "https://b.example.com", tags: ["AI"] },
      { id: "c", title: "天气预报", url: "https://c.example.com", tags: ["生活"] },
    ];
    const r = autoClusterSites(items, 2);
    expect(r.totalItems).toBe(3);
    expect(r.clusterCount).toBeLessThanOrEqual(2);
    expect(typeof synthesizeClusterName(items)).toBe("string");
  });
});

describe("linucb：建模/预测/更新/序列化", () => {
  it("上下文特征有限且预测覆盖五通道", () => {
    const x = extractContextFeatures("AI 搜索 github");
    expect(x.length).toBeGreaterThan(0);
    expect(x.every((v) => Number.isFinite(v))).toBe(true);
    const model = createLinUCBModel();
    const w = predictArmWeights(model, "AI 搜索 github");
    for (const ch of ["exact", "fts", "pinyin", "semantic", "personal"] as const) {
      expect(w[ch]).toBeGreaterThan(0);
    }
  });
  it("update 不抛错且序列化往返保持 arms", () => {
    const model = createLinUCBModel();
    updateArmReward(model, "fts", "AI 搜索", 1);
    updateArmReward(model, "exact", "", 0);
    const restored = deserializeLinUCB(serializeLinUCB(model));
    expect(Object.keys(restored.arms).sort()).toEqual(Object.keys(model.arms).sort());
  });
});

describe("dynamic-tool-synthesizer：site_search 合成", () => {
  it("工具名按 siteId 消毒，空 query 执行时拒绝", () => {
    const { definition, handler } = synthesizeSiteSearchTool({
      siteId: "mdn docs!",
      siteName: "MDN",
      searchUrlTemplate: "https://example.com/search?q={query}",
    });
    expect(definition.name).toBe("search_mdn_docs_");
    expect(() => handler({ query: "   " })).toThrow();
    const out = handler({ query: "fetch" }) as { navigableUrl: string };
    expect(out.navigableUrl).toContain(encodeURIComponent("fetch"));
  });
});

describe("speculative-intent：空输入与数学表达式", () => {
  it("空输入返回 null", () => {
    expect(parseSpeculativeIntent("")).toBeNull();
    expect(parseSpeculativeIntent("   ")).toBeNull();
  });
  it("数学表达式可识别", () => {
    expect(parseSpeculativeIntent("2+2*2")).not.toBeNull();
  });
});

describe("crdt-sync：操作创建/合并/折叠", () => {
  it("createCRDTOperation 形状正确", () => {
    const op = createCRDTOperation("UPSERT_CUSTOM_SITE", "e1", { a: 1 }, "c1", 123);
    expect(op.id.startsWith("op_")).toBe(true);
    expect(op.type).toBe("UPSERT_CUSTOM_SITE");
    expect(op.entityId).toBe("e1");
    expect(op.timestamp).toBe(123);
  });
  it("merge 幂等：重复合并同一操作不膨胀", () => {
    const a = createCRDTOperation("PIN_SITE_IN_CATEGORY", "e1", {}, "c1", 1);
    const once = mergeOperationLogs([], [a]);
    const twice = mergeOperationLogs(once, [a]);
    expect(twice.length).toBe(once.length);
  });
  it("reduce 空日志不抛错并返回对象", () => {
    expect(typeof reduceOperationsToState([])).toBe("object");
  });
});
