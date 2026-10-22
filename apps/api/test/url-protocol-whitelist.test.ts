/**
 * 站点写入路径的 URL 协议白名单（HTTP 层）。
 *
 * packages/core/test/http-url-schema.test.ts 测的是契约本身；这里测的是
 * 「每条会把 url 落库的 HTTP 入口都真的接了这份契约」。差别很重要：
 *   - POST /api/sites 的 `enrich:true` 兼容分支根本不经过 SiteCreateBody；
 *   - /api/sites/auto 落库的是 `enriched.url`，而 enrichUrl 抓失败时**不抛异常**、
 *     原样回传入参（enrich.ts:205-214 的「任何失败都不抛给调用方」），
 *     于是 `javascript:` 会跳过抓取直接写进站点表；
 *   - 投稿与批量导入是另两份手写 schema。
 * 入库后的下游是 `<a href>`（站点详情/关联站）与书签导出，管理员点开即执行脚本。
 *
 * 非空性：把任一处换回 `z.string().url()`，对应用例的 400 变 201，本文件失败。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

const base = {
  mode: "lite" as const,
  embedding: {
    model: "Xenova/bge-small-zh-v1.5",
    endpoint: "https://hf-mirror.com",
    dtype: "q8",
    dim: 512,
    enabled: false,
  },
  llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
  fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
  corsOrigins: ["*"],
};

const BAD = "javascript:alert(document.domain)";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
let categoryId = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-urlproto-"));
  ctx = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "urlproto.db") }));
  app = await buildServer(ctx);
  await app.ready();
  const cat = await app.inject({ method: "POST", url: "/api/categories", payload: { title: "协议白名单类目" } });
  categoryId = (cat.json() as { id: string }).id;
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("每条写入入口都拒收伪协议", () => {
  it("POST /api/sites（走 SiteCreateBody）→ 400", async () => {
    const res = await app.inject({ method: "POST", url: "/api/sites", payload: { url: BAD, title: "x", categoryId } });
    expect(res.statusCode).toBe(400);
  });

  it("POST /api/sites 的 enrich 兼容分支（不走 SiteCreateBody）→ 400", async () => {
    const res = await app.inject({ method: "POST", url: "/api/sites", payload: { url: BAD, enrich: true } });
    expect(res.statusCode).toBe(400);
  });

  it("POST /api/sites/auto 不得把抓失败的伪协议原样落库 → 400", async () => {
    const res = await app.inject({ method: "POST", url: "/api/sites/auto", payload: { url: BAD, categoryId } });
    expect(res.statusCode).toBe(400);
  });

  it("POST /api/sites/batch 混合负载里的伪协议也拒（整单拒绝）→ 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/sites/batch",
      payload: { sites: [{ url: "https://batch-ok-urlproto.example/" }, { url: "data:text/html,<script>alert(1)</script>" }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /api/submissions（匿名投稿）→ 400，不给审核员留雷", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/submissions",
      payload: { title: "投稿", url: "file:///etc/passwd", categoryId },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /api/sites/:id 的关联站 targetUrl → 400（前端按 <a href> 渲染）", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/sites",
      payload: { url: "https://ok-urlproto.example/", title: "正常站点", categoryId },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string }).id;
    const res = await app.inject({
      method: "PATCH",
      url: `/api/sites/${id}`,
      payload: { relations: [{ targetTitle: "关联", targetUrl: BAD, relationType: "related" }] },
    });
    expect(res.statusCode).toBe(400);
    // 深链模板同理：拒绝写入，而不是等前端每个 sink 各自兜底
    const tpl = await app.inject({
      method: "PATCH",
      url: `/api/sites/${id}`,
      payload: { actions: [{ id: "a1", label: "搜索", urlTemplate: BAD }] },
    });
    expect(tpl.statusCode).toBe(400);
  });
});

describe("白名单不得误伤正常用法", () => {
  it("https 站点创建成功且带 {q} 深链模板可写入", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/sites",
      payload: { url: "https://good-urlproto.example/a?b=1", title: "正常", categoryId },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string }).id;
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/sites/${id}`,
      payload: {
        actions: [{ id: "gh", label: "搜仓库", urlTemplate: "https://github.com/search?q={q}&type=repositories" }],
        relations: [{ targetTitle: "官网", targetUrl: "https://good-urlproto.example", relationType: "mirror" }],
      },
    });
    expect(patched.statusCode).toBe(200);
  });

  it("整库扫一遍：没有任何站点的 url/targetUrl 落在非 http(s) 协议上", async () => {
    const sites = await ctx.repo.listSites({ limit: 500 });
    const bad = sites.filter((s) => {
      const urls = [s.url, ...(s.relations ?? []).map((r) => r.targetUrl), ...(s.actions ?? []).map((a) => a.urlTemplate)];
      return urls.some((u) => {
        if (!u) return false;
        try {
          const p = new URL(u).protocol;
          return p !== "http:" && p !== "https:";
        } catch {
          return false; // 相对地址由各自字段的 .url() 负责，这里只盯协议
        }
      });
    });
    expect(bad.map((s) => s.url)).toEqual([]);
  });
});
