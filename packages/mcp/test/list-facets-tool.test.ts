import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, type AppContext } from "@navhub/api";
import { loadConfig } from "@navhub/api";
import { createMcpServer } from "../src/mcp-server.ts";
import { ToolContext } from "../src/tools.ts";

let dir: string;
let ctx: AppContext;
let toolCtx: ToolContext;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-mcp-facets-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "mcp.db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);

  const cat = await ctx.repo.createCategory({ title: "开发工具" });
  const site = await ctx.repo.createSite({
    url: "https://example-oss.test",
    title: "示例开源库",
    categoryId: cat.id,
    tags: ["开源"],
    status: "active",
  });
  await ctx.repo.setSiteFacets(site.id, {
    pricing: ["open_source"],
    platform: ["web"],
  });

  toolCtx = {
    actor: "test",
    scopes: ["read", "write", "admin"],
    has: (scope) => true,
  };
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("MCP list_facets tool", () => {
  it("调用 list_facets 成功返回受控定义与取值分布", async () => {
    const server = createMcpServer(ctx, toolCtx);
    // Directly invoke handlers or callTool through MCP Server
    const { catalogHandlers } = await import("../src/handlers/catalog.ts");
    const res = await catalogHandlers.list_facets({ ctx, indexSite: async () => {}, withIdempotency: async () => {} }, {}, toolCtx);
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.definitions).toBeDefined();
    expect(data.facets).toBeDefined();

    const pricing = data.facets.find((f: { key: string }) => f.key === "pricing");
    expect(pricing).toBeDefined();
    const ossOption = pricing.options.find((o: { value: string }) => o.value === "open_source");
    expect(ossOption).toBeDefined();
    expect(ossOption.count).toBe(1);
  });
});
