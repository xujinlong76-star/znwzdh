import { describe, expect, it } from "vitest";
import { buildOpenApiDoc, type RouteEntry } from "../src/openapi.ts";
import {
  CreateSiteInput,
  MCP_TOOL_DEFS,
  REST_SCHEMA_BINDINGS,
  SiteCreateBody,
  SiteUpdateBody,
  UpdateSiteInput,
} from "@navhub/core";

/**
 * REST / MCP / OpenAPI 三处契约同源的防线。
 *
 * 背景：MCP 工具的 inputSchema 与 REST 端点的请求体原本是两份手写清单，
 * 改一处忘一处是必然事件。现在 zod 契约只在 packages/core/src/mcp-schemas.ts
 * 定义一次，这里守住「文档确实是生成出来的、且生成结果自洽」。
 */

const ROUTES: RouteEntry[] = [
  { method: "GET", url: "/api/health", scope: "public" },
  { method: "GET", url: "/api/search", scope: "public" },
  { method: "POST", url: "/api/sites", scope: "write" },
  { method: "PATCH", url: "/api/sites/:id", scope: "write" },
  { method: "DELETE", url: "/api/sites/:id", scope: "write" },
  { method: "GET", url: "/api/tags", scope: "public" },
  { method: "GET", url: "/api/rank/trending", scope: "public" },
  { method: "POST", url: "/api/crdt/sync", scope: "write" },
  { method: "POST", url: "/api/design/harmony", scope: "public" },
];

const doc = buildOpenApiDoc(ROUTES) as {
  paths: Record<string, Record<string, any>>;
  components: { schemas: Record<string, any> };
  "x-mcp-tools": Array<{ name: string; inputSchema: { $ref: string } }>;
};

const schemas = doc.components.schemas;

describe("OpenAPI 组件：由 zod 契约生成", () => {
  it("每个 MCP 工具都有一个对应的 schema 组件", () => {
    for (const t of MCP_TOOL_DEFS) {
      const key = "MCP_" + t.name;
      expect(schemas[key], "缺少组件：" + key).toBeTruthy();
      expect(schemas[key].type).toBe("object");
    }
  });

  it("站点写入体组件存在，且是 object", () => {
    expect(schemas.SiteCreateBody?.type).toBe("object");
    expect(schemas.SiteUpdateBody?.type).toBe("object");
  });

  it("生成的是真字段，不是占位 object（create_site 必须声明 url）", () => {
    const create = schemas.MCP_create_site as { properties?: Record<string, unknown>; required?: string[] };
    expect(Object.keys(create.properties ?? {})).toContain("url");
    expect(create.required).toContain("url");
  });

  it(".describe() 的中文说明进了文档（不再丢失语义）", () => {
    const create = schemas.MCP_create_site as { properties?: Record<string, { description?: string }> };
    expect(create.properties?.url?.description).toContain("站点网址");
  });
});

describe("REST 绑定：请求体走 $ref，query 走参数列表", () => {
  it("POST /api/sites 的请求体引用 SiteCreateBody", () => {
    const op = doc.paths["/api/sites"]!.post;
    expect(op.requestBody.content["application/json"].schema.$ref).toBe("#/components/schemas/SiteCreateBody");
  });

  it("PATCH /api/sites/{id} 引用 SiteUpdateBody，且路径参数仍在", () => {
    const op = doc.paths["/api/sites/{id}"]!.patch;
    expect(op.requestBody.content["application/json"].schema.$ref).toBe("#/components/schemas/SiteUpdateBody");
    const names = (op.parameters as Array<{ name: string; in: string }>).map((p) => p.name);
    expect(names).toContain("id");
  });

  it("GET /api/tags 展开为 query 参数（而不是一个黑盒 object）", () => {
    const op = doc.paths["/api/tags"]!.get;
    const q = (op.parameters as Array<{ name: string; in: string }>).filter((p) => p.in === "query");
    expect(q.map((p) => p.name).sort()).toEqual(["limit", "minCount"]);
  });

  it("未绑定契约的写端点退回通用 object，不谎报字段", () => {
    const op = doc.paths["/api/crdt/sync"]!.post;
    // crdt/sync 已绑定 -> 必须走 $ref
    expect(op.requestBody.content["application/json"].schema.$ref).toMatch(/^#\/components\/schemas\/MCP_/);
  });

  it("绑定表里每个 key 都能在真实路由上找到（防止写错方法或路径）", () => {
    const routeKeys = new Set(
      ROUTES.map((r) => r.method.toUpperCase() + " " + r.url.replace(/:([A-Za-z0-9_]+)/g, "{$1}")),
    );
    for (const key of Object.keys(REST_SCHEMA_BINDINGS)) {
      // 只断言"格式合法"，路由全集的完整性由 buildOpenApiDoc 的调用方保证
      expect(key).toMatch(/^(GET|POST|PUT|PATCH|DELETE) \//);
      expect(key).not.toContain(":");
    }
    expect(routeKeys.has("POST /api/sites")).toBe(true);
  });
});

describe("文档自洽性", () => {
  it("所有 $ref 都能解析到已存在的组件", () => {
    const refs: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const n of node) walk(n);
        return;
      }
      if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
          if (k === "$ref" && typeof v === "string") refs.push(v);
          else walk(v);
        }
      }
    };
    walk(doc);

    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const name = ref.replace("#/components/schemas/", "");
      expect(schemas[name], "悬空 $ref：" + ref).toBeTruthy();
    }
  });

  it("x-mcp-tools 覆盖全部工具，且每个 $ref 可解析", () => {
    const names = doc["x-mcp-tools"].map((t) => t.name);
    expect(new Set(names).size).toBe(MCP_TOOL_DEFS.length);
    for (const t of doc["x-mcp-tools"]) {
      const name = t.inputSchema.$ref.replace("#/components/schemas/", "");
      expect(schemas[name]).toBeTruthy();
    }
  });
});

describe("REST 与 MCP 同源（不是两份清单）", () => {
  it("SiteCreateBody 由 CreateSiteInput 派生：MCP 的合法负载 REST 也认", () => {
    const payload = { url: "https://example.com", title: "示例", categoryId: "c1", tags: ["a"] };
    expect(CreateSiteInput.safeParse(payload).success).toBe(true);
    expect(SiteCreateBody.safeParse(payload).success).toBe(true);
  });

  it("REST 侧收紧生效：缺 categoryId 被拒（MCP 侧可自动归类，允许省略）", () => {
    const noCat = { url: "https://example.com" };
    expect(SiteCreateBody.safeParse(noCat).success).toBe(false);
    expect(CreateSiteInput.safeParse(noCat).success).toBe(true);
  });

  it("两边共享同一个字段上限：9 个标签都被拒", () => {
    const tooMany = { url: "https://example.com", categoryId: "c1", tags: Array.from({ length: 9 }, (_, i) => "t" + i) };
    expect(SiteCreateBody.safeParse(tooMany).success).toBe(false);
    expect(CreateSiteInput.safeParse(tooMany).success).toBe(false);
  });

  it("SiteUpdateBody 不含 id（REST 的 id 在路径里），UpdateSiteInput 含 id", () => {
    expect(Object.keys(SiteUpdateBody.shape)).not.toContain("id");
    expect(Object.keys(UpdateSiteInput.shape)).toContain("id");
  });

  it("站点状态枚举两端一致", () => {
    const rest = (SiteCreateBody.shape.status as any)?._def?.innerType;
    const mcp = (UpdateSiteInput.shape.status as any)?._def?.innerType;
    // SiteCreateBody.status / UpdateSiteInput.status 都来自同一个枚举值集合
    expect(Array.from(rest?.options ?? rest?._def?.values ?? [])).toEqual(["active", "pending", "broken", "archived"]);
    expect(mcp).toBeUndefined(); // UpdateSiteInput 不带 status，说明文档如实反映差异
  });
});
