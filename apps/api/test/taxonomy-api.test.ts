import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-taxonomy-api-test-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    auth: { enabled: false },
    embedding: { enabled: false },
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);

  // 初始化基础数据
  const catDev = await ctx.repo.createCategory({
    title: "开发工具",
    altLabels: ["编程", "开发", "IDE"],
  });
  const catDesign = await ctx.repo.createCategory({
    title: "设计创意",
    altLabels: ["UI", "UX", "设计"],
  });

  await ctx.repo.createSite({
    url: "https://code.visualstudio.com",
    title: "Visual Studio Code",
    description: "代码编辑器与编程工具",
    categoryId: catDesign.id, // 故意归错类
  });

  await ctx.repo.recordEvent("zero_result", { query: "Docker" });
  await ctx.repo.recordEvent("zero_result", { query: "Docker" });

  await ctx.repo.upsertTag("react", "topic");
  await ctx.repo.upsertTag("React.js", "topic");
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("Taxonomy Phase 4: AI Taxonomy Governance API", () => {
  it("POST /api/taxonomy/audit 触发审计并生成治理提案", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/taxonomy/audit",
      payload: { dryRun: false },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.proposalsCount).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.proposals)).toBe(true);
  });

  it("GET /api/taxonomy/proposals 获取待审核提案列表", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/taxonomy/proposals",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items[0].status).toBe("pending");
  });

  it("POST /api/taxonomy/proposals/:id/apply 采纳单条提案", async () => {
    const listRes = await app.inject({
      method: "GET",
      url: "/api/taxonomy/proposals?status=pending",
    });
    const items = listRes.json().items;
    expect(items.length).toBeGreaterThan(0);

    const targetProposal = items[0];
    const applyRes = await app.inject({
      method: "POST",
      url: `/api/taxonomy/proposals/${encodeURIComponent(targetProposal.id)}/apply`,
    });

    expect(applyRes.statusCode).toBe(200);
    const body = applyRes.json();
    expect(body.ok).toBe(true);
    expect(body.proposal.status).toBe("applied");
  });

  it("POST /api/taxonomy/proposals/:id/dismiss 驳回单条提案", async () => {
    // 手动塞入一条待驳回提案
    await ctx.repo.saveTaxonomyProposals([
      {
        id: "prop-dismiss-api-test",
        kind: "zero_result_gap",
        targetId: "random-query",
        suggestedValue: "random-query",
        confidence: 0.5,
        reason: "低价值临时词",
        status: "pending",
        createdAt: Date.now(),
      },
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/api/taxonomy/proposals/prop-dismiss-api-test/dismiss",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.proposal.status).toBe("dismissed");
  });

  it("POST /api/taxonomy/proposals/batch 批量处理治理提案", async () => {
    await ctx.repo.saveTaxonomyProposals([
      {
        id: "batch-1",
        kind: "zero_result_gap",
        targetId: "batch-query-1",
        suggestedValue: "batch-query-1",
        confidence: 0.7,
        reason: "测试批量",
        status: "pending",
        createdAt: Date.now(),
      },
      {
        id: "batch-2",
        kind: "zero_result_gap",
        targetId: "batch-query-2",
        suggestedValue: "batch-query-2",
        confidence: 0.7,
        reason: "测试批量",
        status: "pending",
        createdAt: Date.now(),
      },
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/api/taxonomy/proposals/batch",
      payload: {
        ids: ["batch-1", "batch-2"],
        action: "dismiss",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.successCount).toBe(2);
    expect(body.failedCount).toBe(0);
  });
});
