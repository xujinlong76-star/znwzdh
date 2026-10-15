import { describe, expect, it } from "vitest";
import {
  // 1. 语义聚类与自适应类目生成
  cosineSim,
  cosineDist,
  extractBagOfWordsVector,
  buildVocabulary,
  kMeansPlusPlus,
  synthesizeClusterName,
  autoClusterSites,
  type ClusterableItem,

  // 2. 动态工具合成与 SSRF 沙箱执行
  isSafeUrl,
  createGuardedApiExecutor,
  synthesizeRestTool,
  synthesizeSiteSearchTool,
  parseOpenApiToSpecs,
  type RestEndpointSpec,
  type MinimalOpenApiSpec,
} from "../src/index.ts";

describe("Next-Gen 5.0: 1. 语义聚类与自适应类目生成 (Semantic Clustering & Taxonomy)", () => {
  it("正确计算余弦相似度与余弦距离", () => {
    const v1 = [1, 0, 0];
    const v2 = [1, 0, 0];
    const v3 = [0, 1, 0];
    const v4 = [-1, 0, 0];

    // 同向向量
    expect(cosineSim(v1, v2)).toBeCloseTo(1.0);
    expect(cosineDist(v1, v2)).toBeCloseTo(0.0);

    // 正交向量
    expect(cosineSim(v1, v3)).toBeCloseTo(0.0);
    expect(cosineDist(v1, v3)).toBeCloseTo(1.0);

    // 反向向量
    expect(cosineSim(v1, v4)).toBeCloseTo(-1.0);
    expect(cosineDist(v1, v4)).toBeCloseTo(2.0);

    // 零向量边界保护
    expect(cosineSim([0, 0], [0, 0])).toBe(0);
    expect(cosineDist([0, 0], [0, 0])).toBe(1);
  });

  it("基于文本与标签提取词袋特征向量与词汇表", () => {
    const items: ClusterableItem[] = [
      { id: "1", title: "React Frontend Framework", url: "https://react.dev", tags: ["frontend", "ui"] },
      { id: "2", title: "Vue Reactive Frontend", url: "https://vuejs.org", tags: ["frontend", "javascript"] },
      { id: "3", title: "PostgreSQL Database", url: "https://postgresql.org", tags: ["database", "sql"] },
    ];

    const vocab = buildVocabulary(items);
    expect(vocab.length).toBeGreaterThan(0);
    expect(vocab).toContain("frontend");

    const vec1 = extractBagOfWordsVector(items[0]!, vocab);
    expect(vec1.length).toBe(vocab.length);
    expect(vec1.some((v) => v === 1)).toBe(true);
  });

  it("K-Means++ 能够清晰分离高维向量集群", () => {
    // 构造两个在方向上有明显余弦夹角差异的高维向量簇
    // 簇A偏向第一维度 [1, 0, 0]，簇B偏向第三维度 [0, 0, 1]
    const vectors = [
      [1.0, 0.1, 0.0],
      [0.95, 0.15, 0.0],
      [0.98, 0.05, 0.0],
      [0.0, 0.1, 1.0],
      [0.05, 0.05, 0.95],
      [0.0, 0.08, 0.99],
    ];

    const result = kMeansPlusPlus(vectors, 2, 20);
    expect(result.centroids.length).toBe(2);
    expect(result.assignments.length).toBe(6);

    // 前3个样本方向一致分配在同一个簇，后3个样本方向一致分配在另一个簇
    expect(result.assignments[0]).toBe(result.assignments[1]);
    expect(result.assignments[1]).toBe(result.assignments[2]);
    expect(result.assignments[3]).toBe(result.assignments[4]);
    expect(result.assignments[4]).toBe(result.assignments[5]);
    expect(result.assignments[0]).not.toBe(result.assignments[3]);
  });

  it("基于聚类条目合成可解释的分类名称与凝聚度评估", () => {
    const frontendItems: ClusterableItem[] = [
      { id: "1", title: "React", url: "https://react.dev", tags: ["frontend"] },
      { id: "2", title: "Vue", url: "https://vuejs.org", tags: ["frontend"] },
    ];
    const name = synthesizeClusterName(frontendItems);
    expect(name).toContain("FRONTEND");

    const testSites: ClusterableItem[] = [
      { id: "r", title: "React Documentation", url: "https://react.dev", tags: ["frontend"] },
      { id: "v", title: "Vue.js Guide", url: "https://vuejs.org", tags: ["frontend"] },
      { id: "p", title: "PostgreSQL Database Engine", url: "https://postgres.org", tags: ["database"] },
      { id: "m", title: "MongoDB NoSQL Store", url: "https://mongodb.com", tags: ["database"] },
    ];

    const clusterResult = autoClusterSites(testSites, 2);
    expect(clusterResult.totalItems).toBe(4);
    expect(clusterResult.clusterCount).toBeGreaterThanOrEqual(1);
    expect(clusterResult.averageCohesion).toBeGreaterThan(0);
    expect(clusterResult.clusters.length).toBe(clusterResult.clusterCount);
  });
});

describe("Next-Gen 5.0: 2. 动态工具合成与 SSRF 沙箱执行 (Dynamic Tool Synthesizer & SSRF Guard)", () => {
  it("严格防御 SSRF，阻断内网私有地址、云元数据和回环地址", () => {
    // 禁止的协议
    expect(isSafeUrl("ftp://example.com").safe).toBe(false);
    expect(isSafeUrl("file:///etc/passwd").safe).toBe(false);

    // 禁止的回环和本地域名
    expect(isSafeUrl("http://localhost:3000/api").safe).toBe(false);
    expect(isSafeUrl("http://127.0.0.1:8080/test").safe).toBe(false);
    expect(isSafeUrl("http://service.internal/status").safe).toBe(false);

    // 禁止的私有 IPv4 网段
    expect(isSafeUrl("http://10.0.0.1/admin").safe).toBe(false);
    expect(isSafeUrl("http://192.168.1.1/router").safe).toBe(false);
    expect(isSafeUrl("http://172.16.5.10/cluster").safe).toBe(false);

    // 禁止的云元数据服务 (169.254.169.254)
    expect(isSafeUrl("http://169.254.169.254/latest/meta-data/").safe).toBe(false);

    // 禁止的 IPv6 回环与链路本地
    expect(isSafeUrl("http://[::1]:8080/").safe).toBe(false);

    // 允许的公共外网地址
    expect(isSafeUrl("https://api.github.com/repos/facebook/react").safe).toBe(true);
    expect(isSafeUrl("https://www.example.com/api/v1/ping").safe).toBe(true);
  });

  it("createGuardedApiExecutor 阻断非法 SSRF 请求并执行安全网络请求", async () => {
    const executor = createGuardedApiExecutor();

    // 尝试请求内网，被 SSRF Guard 拦截
    await expect(executor("http://127.0.0.1:9999/secret")).rejects.toThrow("SSRF Guard Violation");

    // 安全模拟 fetch 测试
    const mockFetch = async () =>
      new Response(JSON.stringify({ status: "ok", data: [1, 2, 3] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const mockExecutor = createGuardedApiExecutor({
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const response = await mockExecutor("https://api.example.com/metrics");
    expect(response.status).toBe(200);
    expect(response.data).toEqual({ status: "ok", data: [1, 2, 3] });
  });

  it("将 RestEndpointSpec 合成为标准 WebMCP 工具并正确执行参数组装", async () => {
    const spec: RestEndpointSpec = {
      name: "fetch_repo_info",
      description: "获取指定代码仓库的基础元数据",
      url: "https://api.github.com/repos/{owner}/{repo}",
      method: "GET",
      parameters: [
        { name: "owner", type: "string", in: "path", required: true },
        { name: "repo", type: "string", in: "path", required: true },
        { name: "branch", type: "string", in: "query", required: false },
      ],
    };

    let requestedUrl = "";
    const mockFetch = async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ full_name: "facebook/react", stargazers_count: 220000 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const { definition, handler } = synthesizeRestTool(spec, {
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(definition.name).toBe("fetch_repo_info");
    expect(definition.inputSchema.properties).toHaveProperty("owner");
    expect(definition.inputSchema.properties).toHaveProperty("repo");
    expect(definition.inputSchema.required).toContain("owner");

    // 执行合成的 handler
    const result = (await handler({ owner: "facebook", repo: "react", branch: "main" })) as {
      status: number;
      data: { full_name: string };
      endpoint: string;
    };

    expect(result.status).toBe(200);
    expect(result.data.full_name).toBe("facebook/react");
    expect(requestedUrl).toBe("https://api.github.com/repos/facebook/react?branch=main");
  });

  it("将站点检索动作合成为 WebMCP 工具并正确生成跳转指令", async () => {
    const { definition, handler } = synthesizeSiteSearchTool({
      siteId: "github",
      siteName: "GitHub Code Search",
      searchUrlTemplate: "https://github.com/search?q={query}&type=repositories",
      category: "开发代码托管",
    });

    expect(definition.name).toBe("search_github");
    expect(definition.inputSchema.required).toContain("query");

    const res = (await handler({ query: "vitest monorepo" })) as {
      siteId: string;
      navigableUrl: string;
    };

    expect(res.siteId).toBe("github");
    expect(res.navigableUrl).toBe("https://github.com/search?q=vitest%20monorepo&type=repositories");
  });

  it("解析 OpenAPI 3.0 规范为 RestEndpointSpec 集合", () => {
    const openApiDoc: MinimalOpenApiSpec = {
      openapi: "3.0.0",
      info: { title: "Pet Store API" },
      servers: [{ url: "https://petstore.swagger.io/v2" }],
      paths: {
        "/pet/{petId}": {
          get: {
            operationId: "getPetById",
            summary: "Find pet by ID",
            parameters: [
              { name: "petId", in: "path", required: true, schema: { type: "integer" } },
            ],
          },
        },
        "/pet/findByStatus": {
          get: {
            operationId: "findPetsByStatus",
            summary: "Finds Pets by status",
            parameters: [
              { name: "status", in: "query", required: true, schema: { type: "string" } },
            ],
          },
        },
      },
    };

    const specs = parseOpenApiToSpecs(openApiDoc);
    expect(specs.length).toBe(2);
    expect(specs[0]?.name).toBe("getPetById");
    expect(specs[0]?.url).toBe("https://petstore.swagger.io/v2/pet/{petId}");
    expect(specs[0]?.parameters?.[0]?.type).toBe("number");
    expect(specs[1]?.name).toBe("findPetsByStatus");
    expect(specs[1]?.url).toBe("https://petstore.swagger.io/v2/pet/findByStatus");
  });
});
