import { afterAll, describe, expect, it, vi } from "vitest";
import { enrichUrl } from "@navhub/ai";
import { siteHandlers } from "../src/handlers/sites.ts";
import { pluginHandlers } from "../src/handlers/plugins.ts";
import { bind, ok, type HandlerDeps } from "../src/handlers/shared.ts";
import type { McpHostContext } from "../src/host-context.ts";
import type { ToolContext } from "../src/tools.ts";

vi.mock("@navhub/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@navhub/ai")>();
  return { ...actual, enrichUrl: vi.fn() };
});

// 跨文件 mock 兜底：复位模块注册表，避免 @navhub/ai 的替身泄漏到后续测试。
afterAll(() => {
  vi.resetModules();
});

const TC: ToolContext = {
  actor: "mcp:phase-test",
  scopes: ["read", "write"],
  has: (scope) => scope === "read" || scope === "write" || scope === "admin",
};

function harness(repo: Record<string, unknown>, ctxExtra: Record<string, unknown> = {}) {
  let inTransaction = false;
  const events: string[] = [];
  const withIdempotency: HandlerDeps["withIdempotency"] = async <T>(
    _key,
    compute,
    options,
  ) => {
    await options?.prepare?.();
    inTransaction = true;
    let result: T;
    try {
      result = await compute();
    } finally {
      inTransaction = false;
    }
    await options?.afterCommit?.(result);
    return ok(result);
  };
  const deps: HandlerDeps = {
    ctx: {
      repo,
      config: { fetch: {} },
      embedding: null,
      vectors: null,
      ...ctxExtra,
    } as unknown as McpHostContext,
    withIdempotency,
    indexSite: async () => {
      expect(inTransaction).toBe(false);
      events.push("index");
    },
  };
  return { deps, events, isInTransaction: () => inTransaction };
}

function manifest(version = "1.1.0") {
  return {
    manifestVersion: 1,
    kind: "site-pack",
    name: "阶段测试网址包",
    description: "验证插件索引副作用发生在事务提交后",
    version,
    payload: {
      categories: [{ title: "阶段测试" }],
      sites: [{ url: "https://phase-plugin.example.com", title: "阶段测试站", category: "阶段测试" }],
    },
  };
}

describe("MCP 幂等处理器的事务/网络/索引阶段边界", () => {
  it("create_site 的 enrich 在事务外，向量索引在事务提交后", async () => {
    const h = harness({
      findSiteByUrl: vi.fn(async () => null),
      listCategories: vi.fn(async () => []),
      ensureUncategorized: vi.fn(async () => "uncategorized"),
      createSite: vi.fn(async (input: Record<string, unknown>) => {
        expect(h.isInTransaction()).toBe(true);
        h.events.push("create");
        return { id: "site-phase", description: null, ...input };
      }),
      audit: vi.fn(async () => undefined),
    });
    vi.mocked(enrichUrl).mockImplementationOnce(async () => {
      expect(h.isInTransaction()).toBe(false);
      h.events.push("enrich");
      return {
        title: "富化标题",
        description: "富化描述",
        tags: ["phase"],
        suggestedCategory: null,
        provenance: "test",
      } as never;
    });

    const { create_site } = bind({ create_site: siteHandlers.create_site }, h.deps);
    const result = await create_site({
      url: "https://phase-site.example.com",
      enrich: true,
      idempotencyKey: "phase-create",
    }, TC);

    expect(result.isError).not.toBe(true);
    expect(h.events).toEqual(["enrich", "create", "index"]);
  });

  it("install_plugin 的批量向量索引在事务提交后", async () => {
    const indexSitesBatch = vi.fn(async () => {
      expect(h.isInTransaction()).toBe(false);
      h.events.push("plugin-index");
    });
    const h = harness({
      getPluginBySlug: vi.fn(async () => ({
        slug: "phase-pack", kind: "site-pack", name: "阶段包", version: "1.0.0", status: "published",
      })),
      installPlugin: vi.fn(async () => {
        expect(h.isInTransaction()).toBe(true);
        h.events.push("install");
        return { applied: { createdSiteIds: ["site-from-plugin"] } };
      }),
      getSitesByIds: vi.fn(async () => {
        expect(h.isInTransaction()).toBe(false);
        return new Map([["site-from-plugin", {
          id: "site-from-plugin", title: "插件站", description: null, url: "https://plugin-site.example.com",
        }]]);
      }),
    }, {
      pluginOps: { indexSitesBatch },
    });

    const { install_plugin } = bind({ install_plugin: pluginHandlers.install_plugin }, h.deps);
    const result = await install_plugin({
      slug: "phase-pack", idempotencyKey: "phase-install",
    }, TC);

    expect(result.isError).not.toBe(true);
    expect(h.events).toEqual(["install", "plugin-index"]);
    expect(indexSitesBatch).toHaveBeenCalledTimes(1);
  });

  it("update_plugin 的旧索引删除在事务提交后", async () => {
    const removePluginIndex = vi.fn(async () => {
      expect(h.isInTransaction()).toBe(false);
      h.events.push("remove-index");
    });
    const updated = {
      slug: "phase-pack",
      version: "1.0.0",
      pendingVersion: "1.1.0",
      pendingManifest: manifest(),
      manifest: manifest("1.0.0"),
      status: "pending",
    };
    let currentStatus = "pending";
    const h = harness({
      getPluginBySlug: vi.fn(async () => ({ ...updated, status: currentStatus, ownerIdentity: null })),
      submitPluginVersion: vi.fn(async () => {
        expect(h.isInTransaction()).toBe(true);
        h.events.push("submit");
        return updated;
      }),
    }, {
      pluginOps: { removePluginIndex },
    });

    const { update_plugin } = bind({ update_plugin: pluginHandlers.update_plugin }, h.deps);
    const result = await update_plugin({
      slug: "phase-pack", manifest: manifest(), idempotencyKey: "phase-update",
    }, TC);

    expect(result.isError).not.toBe(true);
    expect(h.events).toEqual(["submit", "remove-index"]);
    expect(removePluginIndex).toHaveBeenCalledWith("phase-pack");
  });

  it("update_plugin 重放时插件已发布，不得删除当前版本的索引", async () => {
    const removePluginIndex = vi.fn(async () => undefined);
    const updated = {
      slug: "phase-pack",
      version: "1.0.0",
      pendingVersion: "1.1.0",
      pendingManifest: manifest(),
      manifest: manifest("1.0.0"),
      status: "pending",
    };
    let currentStatus = "pending";
    const getPluginBySlug = vi.fn(async () => ({
      ...updated,
      status: currentStatus,
      ownerIdentity: null,
    }));
    const h = harness({
      getPluginBySlug,
      submitPluginVersion: vi.fn(async () => updated),
    }, {
      pluginOps: { removePluginIndex },
    });
    const { update_plugin } = bind({ update_plugin: pluginHandlers.update_plugin }, h.deps);
    const args = { slug: "phase-pack", manifest: manifest(), idempotencyKey: "phase-replay" };

    expect((await update_plugin(args, TC)).isError).not.toBe(true);
    expect(removePluginIndex).toHaveBeenCalledTimes(1);

    currentStatus = "published";
    removePluginIndex.mockClear();
    expect((await update_plugin(args, TC)).isError).not.toBe(true);
    expect(removePluginIndex).not.toHaveBeenCalled();
  });
});
