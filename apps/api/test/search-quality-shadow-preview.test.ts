import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateSiteQuality, type SiteQualityAssessments } from "@navhub/core";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-search-quality-shadow-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "search-shadow.db"),
    embedding: { enabled: false, cacheDir: join(dir, "models") },
    fetch: {
      timeoutMs: 2000,
      maxBytes: 262144,
      maxRedirects: 2,
      allowPrivateNetworks: false,
      userAgent: "NavHubTest/0.1",
    },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);

  const category = await ctx.repo.createCategory({ title: "影子搜索测试" });
  const site = await ctx.repo.createSite({
    title: "Quality Shadow Preview Fixture",
    url: "https://quality-shadow-preview-fixture.example/",
    description: "A deterministic fixture for the admin quality shadow preview",
    categoryId: category.id,
    status: "active",
    tags: ["quality", "shadow", "preview"],
  });
  const dimensions: SiteQualityAssessments = {
    accessibility: { score: 90, evidence: ["two successful health checks"] },
    contentCompleteness: { score: 90, evidence: ["title and description are present"] },
    sourceTrust: { score: 90, evidence: ["test fixture has explicit source provenance"] },
    relevance: { score: null, evidence: [] },
    uniqueness: { score: null, evidence: [] },
    freshness: { score: null, evidence: [] },
    risk: { score: null, evidence: [] },
  };
  await ctx.repo.saveSiteQualityAssessment(site.id, evaluateSiteQuality(dimensions));
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("admin search quality shadow preview", () => {
  it("returns a shadow order for real search hits without changing the production search response", async () => {
    const preview = await app.inject({
      method: "GET",
      url: "/api/admin/search/quality-shadow-preview?q=quality%20shadow%20preview%20fixture&limit=10",
    });
    expect(preview.statusCode).toBe(200);
    const body = preview.json();
    expect(body.ok).toBe(true);
    expect(body.baseline.length).toBeGreaterThan(0);
    expect(body.shadow[0].siteId).toBe(body.baseline[0].siteId);
    expect(body.shadow[0].qualityScore).toBe(90);
    expect(body.shadow[0].applied).toBe(true);
    expect(body.productionOrderChanged).toBe(false);

    const production = await app.inject({
      method: "GET",
      url: "/api/search?q=quality%20shadow%20preview%20fixture&limit=10",
    });
    expect(production.statusCode).toBe(200);
    expect(production.json().hits[0].site.id).toBe(body.baseline[0].siteId);
  });

  it("rejects empty or overlong preview queries", async () => {
    const empty = await app.inject({
      method: "GET",
      url: "/api/admin/search/quality-shadow-preview?q=",
    });
    expect(empty.statusCode).toBe(400);
  });
});
