/**
 * M12 keyset 分页 + M13 统一错误包络（HTTP 层）。
 *
 * 钉住的契约：
 *   - `?cursor=` 翻页拼接结果与不带游标的全量顺序一致；末页不再给 nextCursor
 *    （sites 是裸数组，下一页游标放 `X-Next-Cursor` 响应头）；
 *   - 非法游标 → 400 `{ ok: false, error: "INVALID_CURSOR", code, message }`；
 *   - 错误包络统一形：`{ ok: false, error: <CODE>, code: <CODE>, message, requestId? }`。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import type { TaxonomyProposal } from "@navhub/core";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-keyset-api-"));
  ctx = await createContext(
    loadConfig({
      mode: "lite",
      sqlitePath: join(dir, "api.db"),
      embedding: { model: "x", endpoint: "x", dtype: "q8", cacheDir: join(dir, "m"), dim: 512, enabled: false },
      corsOrigins: ["*"],
    }),
  );
  app = await buildServer(ctx);
  await app.ready();

  // ---- 种子：站点（带 sort / trend 并列，练多键游标）----
  const cat = await ctx.repo.createCategory({ title: "游标站点" });
  const sorts = [0, 0, 1, 1, 2];
  const trends = [5, 3, 9, 9, 0];
  for (let i = 0; i < 5; i++) {
    const site = await ctx.repo.createSite({
      url: `https://cursor-${i}.example.com`,
      title: `游标站 ${i}`,
      categoryId: cat.id,
      status: "active",
    });
    await ctx.repo.run("UPDATE sites SET sort = ?, trend_score = ? WHERE id = ?", [sorts[i], trends[i], site.id]);
  }
  // ---- 种子：收藏（同一 anon 身份 4 条）----
  const favCat = await ctx.repo.createCategory({ title: "游标收藏" });
  for (let i = 0; i < 4; i++) {
    const site = await ctx.repo.createSite({
      url: `https://cursor-fav-${i}.example.com`,
      title: `收藏站 ${i}`,
      categoryId: favCat.id,
      status: "active",
    });
    await ctx.repo.addFavorite({ userId: "cursor-anon", siteId: site.id });
  }
  // ---- 种子：任务 ----
  const now = Date.now();
  for (let i = 0; i < 5; i++) {
    await ctx.repo.run(
      "INSERT INTO jobs (id, kind, payload, status, attempts, error, created_at, updated_at, next_run_at, progress_done, progress_total) VALUES (?,?,?,?,?,NULL,?,?,NULL,0,0)",
      [`api-job-${i}`, "health_check", "{}", "done", 0, now - (i % 2) * 1000, now],
    );
  }
  // ---- 种子：治理提案 ----
  const proposals: TaxonomyProposal[] = [0, 1, 2, 3].map((i) => ({
    id: `api-prop-${i}`,
    kind: "tag_consolidation",
    targetId: `api-tag-${i}`,
    suggestedValue: `Api Tag ${i}`,
    confidence: i % 2 === 0 ? 0.9 : 0.8,
    reason: "测试",
    status: "pending",
    createdAt: now - i * 1000,
  }));
  await ctx.repo.saveTaxonomyProposals(proposals);
  // ---- 种子：审计日志 ----
  for (let i = 0; i < 4; i++) {
    await ctx.repo.audit({ actor: "admin", action: "test.keyset", target: `k-${i}` });
  }
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

async function drainJsonList(url: string): Promise<Array<{ id: string }>> {
  const out: Array<{ id: string }> = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 20; guard++) {
    const res = await app.inject({ method: "GET", url: cursor ? `${url}&cursor=${encodeURIComponent(cursor)}` : url });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ id: string }>; nextCursor: string | null };
    out.push(...body.items);
    if (!body.nextCursor) return out;
    cursor = body.nextCursor;
  }
  throw new Error("翻页超过 20 页，疑似死循环");
}

describe("GET /api/sites keyset（裸数组 + X-Next-Cursor 头）", () => {
  it("游标翻页拼接与全量顺序一致，末页不发头", async () => {
    const full = (await app.inject({ method: "GET", url: "/api/sites?limit=100" })).json() as Array<{ id: string }>;
    expect(full.length).toBeGreaterThanOrEqual(5);
    const out: Array<{ id: string }> = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 20; guard++) {
      const res = await app.inject({
        method: "GET",
        url: cursor ? `/api/sites?limit=2&cursor=${encodeURIComponent(cursor)}` : "/api/sites?limit=2",
      });
      expect(res.statusCode).toBe(200);
      const page = res.json() as Array<{ id: string }>;
      out.push(...page);
      const next = res.headers["x-next-cursor"];
      if (!next) break;
      expect(typeof next).toBe("string");
      cursor = next as string;
    }
    // 全量里含收藏种子站（同库），只比对游标页与全量的前 N 项顺序一致即可——
    // 更严格的是：游标页拼接 == 全量按同一 limit 切出的前 out.length 项。
    expect(out.map((s) => s.id)).toEqual(full.slice(0, out.length).map((s) => s.id));
    expect(out.length).toBe(full.length);
  });

  it("非法游标 → 400 INVALID_CURSOR 包络", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sites?cursor=garbage!!" });
    expect(res.statusCode).toBe(400);
    const body = res.json() as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.error).toBe("INVALID_CURSOR");
    expect(body.code).toBe("INVALID_CURSOR");
    expect(typeof body.message).toBe("string");
  });
});

describe("GET /api/categories/page keyset", () => {
  it("游标翻页拼接与全量一致", async () => {
    const full = (await app.inject({ method: "GET", url: "/api/categories/page?limit=100" })).json() as {
      items: Array<{ id: string }>;
    };
    const viaCursor = await drainJsonList("/api/categories/page?limit=2");
    expect(viaCursor.map((c) => c.id)).toEqual(full.items.map((c) => c.id));
  });
});

describe("GET /api/favorites keyset", () => {
  it("游标翻页拼接与全量一致", async () => {
    const full = (await app.inject({ method: "GET", url: "/api/favorites?anonId=cursor-anon&limit=100" })).json() as {
      items: Array<{ id: string }>;
    };
    expect(full.items).toHaveLength(4);
    const viaCursor = await drainJsonList("/api/favorites?anonId=cursor-anon&limit=2");
    expect(viaCursor.map((f) => f.id)).toEqual(full.items.map((f) => f.id));
  });

  it("缺身份 → 400 统一包络（error 是码，文案在 message）", async () => {
    const res = await app.inject({ method: "GET", url: "/api/favorites" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("BAD_REQUEST");
    expect(res.json().message).toContain("userId");
  });
});

describe("GET /api/jobs keyset", () => {
  it("游标翻页拼接与全量一致", async () => {
    const full = (await app.inject({ method: "GET", url: "/api/jobs?limit=100" })).json() as {
      items: Array<{ id: string }>;
    };
    const viaCursor = await drainJsonList("/api/jobs?limit=2");
    expect(viaCursor.map((j) => j.id)).toEqual(full.items.map((j) => j.id));
  });
});

describe("GET /api/taxonomy/proposals keyset", () => {
  it("游标翻页拼接与全量一致", async () => {
    const full = (await app.inject({ method: "GET", url: "/api/taxonomy/proposals?limit=100" })).json() as {
      items: Array<{ id: string }>;
    };
    expect(full.items.length).toBeGreaterThanOrEqual(4);
    const viaCursor = await drainJsonList("/api/taxonomy/proposals?limit=2");
    expect(viaCursor.map((p) => p.id)).toEqual(full.items.map((p) => p.id));
  });
});

describe("GET /api/admin/audit keyset", () => {
  it("游标翻页拼接与全量一致", async () => {
    const full = (await app.inject({ method: "GET", url: "/api/admin/audit?limit=100" })).json() as {
      items: Array<{ id: number }>;
    };
    expect(full.items.length).toBeGreaterThanOrEqual(4);
    const out: Array<{ id: number }> = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 20; guard++) {
      const res = await app.inject({
        method: "GET",
        url: cursor ? `/api/admin/audit?limit=2&cursor=${encodeURIComponent(cursor)}` : "/api/admin/audit?limit=2",
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ id: number }>; nextCursor: string | null };
      out.push(...body.items);
      if (!body.nextCursor) break;
      cursor = body.nextCursor;
    }
    expect(out.map((a) => a.id)).toEqual(full.items.map((a) => a.id));
  });
});

describe("M13 统一错误包络（全局处理器）", () => {
  it("未知路由 404：ok:false + error/code 都是 NOT_FOUND + message + requestId", async () => {
    const res = await app.inject({ method: "GET", url: "/api/definitely-not-a-route-xyz" });
    expect(res.statusCode).toBe(404);
    const body = res.json() as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.error).toBe("NOT_FOUND");
    expect(body.code).toBe("NOT_FOUND");
    expect(typeof body.message).toBe("string");
    expect(typeof body.requestId).toBe("string");
  });

  it("站点详情 404 走同一包络", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sites/not-a-real-site-id-xyz" });
    expect(res.statusCode).toBe(404);
    const body = res.json() as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.error).toBe("NOT_FOUND");
    expect(body.message).toBe("站点不存在");
  });
});
