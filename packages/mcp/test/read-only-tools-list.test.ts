/**
 * 只读令牌的工具可见性契约（Batch 3 第 4 项）：
 *  - read token 的 tools/list 只返回 32 个只读工具，写/admin 全部不可见；
 *  - 经 CallTool 调被隐藏的写工具被拒（不是静默成功）；
 *  - list_facets 经 CallTool 可达（此前只差登记）；
 *  - search_favorites 经 CallTool 可达，用户域守卫在协议层同样生效。
 *
 * 用 SDK 的 InMemoryTransport 直连 Client 与 Server，不走 HTTP 端口——
 * 测的是 createMcpServer 的过滤与分发，不是传输层。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createContext, loadConfig, type AppContext } from "@navhub/api";
import { createMcpServer } from "../src/mcp-server.ts";
import type { McpScope, ToolContext } from "../src/tools.ts";

let dir: string;
let ctx: AppContext;

const ALICE = "user-alice";

function readOnlyUserToken(): ToolContext {
  const scopes: McpScope[] = ["read"];
  return { actor: "mcp:alice-token", scopes, ownerIdentity: ALICE, has: (s) => s === "read" };
}

function instanceToken(): ToolContext {
  const scopes: McpScope[] = ["read", "admin"];
  return { actor: "mcp:instance", scopes, ownerIdentity: null, has: () => true };
}

async function connectClient(toolCtx: ToolContext) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(ctx, toolCtx);
  await server.connect(serverTransport);
  const client = new Client({ name: "contract-test", version: "0.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

function textOf(res: any): string {
  return (res?.content ?? []).map((c: any) => c.text ?? "").join("");
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-mcp-readonly-list-"));
  const config = await loadConfig({
    sqlitePath: join(dir, "test.db"),
    dataDir: dir,
    // 语义路恒降级：本文件测的是清单与分发，模型加载不应拖慢或抖动它
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "m"), dim: 512, enabled: false },
  });
  ctx = await createContext(config);
  const site = await ctx.repo.createSite({
    title: "契约测试站",
    url: "https://contract.example.com",
    description: "只读清单契约夹具",
    categoryId: "dev",
  });
  await ctx.repo.addFavorite({ userId: ALICE, siteId: site.id, note: "契约备注", tags: ["契约"] });
  await ctx.repo.setSiteFacets(site.id, { pricing: ["free"] });
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("read token 的 tools/list", () => {
  it("只返回 32 个只读工具（28 现有 + 4 新增），写/admin 全部不可见", async () => {
    const client = await connectClient(readOnlyUserToken());
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toHaveLength(32);
      expect(names).toContain("search_favorites");
      expect(names).toContain("list_favorite_folders");
      expect(names).toContain("list_facets");
      expect(names).toContain("compare_sites");
      for (const hidden of [
        "create_site", "update_site", "set_status", "batch_import", "health_check",
        "delete_site", "refresh_site", "run_job", "heal_broken_site",
        "sync_crdt_operations", "install_plugin", "star_plugin", "update_plugin",
      ]) {
        expect(names).not.toContain(hidden);
      }
    } finally {
      await client.close();
    }
  });

  it("CallTool 调被隐藏的写工具被拒", async () => {
    const client = await connectClient(readOnlyUserToken());
    try {
      const res: any = await client.callTool({
        name: "create_site",
        arguments: { url: "https://should-not-exist.example.com", title: "不该建" },
      });
      expect(res.isError).toBe(true);
      expect(textOf(res)).toContain("权限");
      expect(await ctx.repo.findSiteByUrl("https://should-not-exist.example.com")).toBeNull();

      const adminRes: any = await client.callTool({
        name: "run_job",
        arguments: { kind: "reindex" },
      });
      expect(adminRes.isError).toBe(true);
      expect(textOf(adminRes)).toContain("权限");
    } finally {
      await client.close();
    }
  });

  it("list_facets 经 CallTool 可达", async () => {
    const client = await connectClient(readOnlyUserToken());
    try {
      const res: any = await client.callTool({ name: "list_facets", arguments: {} });
      expect(res.isError).toBeFalsy();
      const data = JSON.parse(textOf(res));
      expect(data.definitions).toBeDefined();
      expect(Array.isArray(data.facets)).toBe(true);
      const pricing = data.facets.find((f: { key: string }) => f.key === "pricing");
      expect(pricing).toBeDefined();
    } finally {
      await client.close();
    }
  });

  it("search_favorites 经 CallTool 可达；实例级令牌在协议层同样被拒", async () => {
    const client = await connectClient(readOnlyUserToken());
    try {
      const res: any = await client.callTool({ name: "search_favorites", arguments: { query: "契约备注" } });
      expect(res.isError).toBeFalsy();
      const data = JSON.parse(textOf(res));
      expect(data.results).toHaveLength(1);
      expect(data.results[0].title).toBe("契约测试站");
    } finally {
      await client.close();
    }

    const instance = await connectClient(instanceToken());
    try {
      const res: any = await instance.callTool({ name: "search_favorites", arguments: { query: "契约备注" } });
      expect(res.isError).toBe(true);
      expect(textOf(res)).toContain("个人令牌");
    } finally {
      await instance.close();
    }
  });
});
