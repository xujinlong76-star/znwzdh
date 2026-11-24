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
let siteId: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-site-quality-workbench-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "quality.db"),
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
  const category = await ctx.repo.createCategory({ title: "质量测试" });
  const site = await ctx.repo.createSite({
    title: "Quality Fixture",
    url: "https://quality-fixture.example",
    categoryId: category.id,
    status: "active",
    tags: ["quality"],
  });
  siteId = site.id;

  const dimensions: SiteQualityAssessments = {
    accessibility: { score: 90, evidence: ["two successful checks"] },
    contentCompleteness: { score: 80, evidence: ["catalog fields present"] },
    sourceTrust: { score: 70, evidence: ["curation provenance recorded"] },
    relevance: { score: null, evidence: ["semantic validation pending"] },
    uniqueness: { score: null, evidence: [] },
    freshness: { score: null, evidence: [] },
    risk: { score: null, evidence: [] },
  };
  await ctx.repo.saveSiteQualityAssessment(siteId, evaluateSiteQuality(dimensions, 1_800_000_000_000));
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("site quality governance API", () => {
  it("returns overview and evidence details without changing site status", async () => {
    const response = await app.inject({ method: "GET", url: "/api/admin/quality/report" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.summary.assessedSites).toBe(1);
    expect(body.summary.unassessedSites).toBe(0);
    expect(body.total).toBe(1);
    expect(body.items[0].siteId).toBe(siteId);
    expect(body.items[0].dimensions.accessibility.evidence[0]).toBe("two successful checks");
    expect((await ctx.repo.getSite(siteId))?.status).toBe("active");
  });

  it("excludes soft-deleted sites from the visible list and pagination total", async () => {
    const expectedVisibleCount = await ctx.repo.countSiteQualityAssessments();
    const category = await ctx.repo.createCategory({ title: "软删除质量测试" });
    const site = await ctx.repo.createSite({
      title: "Deleted Quality Fixture",
      url: "https://deleted-quality-fixture.example/",
      categoryId: category.id,
      status: "active",
      tags: ["quality"],
    });
    const dimensions: SiteQualityAssessments = {
      accessibility: { score: 80, evidence: ["verified health sample"] },
      contentCompleteness: { score: 80, evidence: ["catalog fields present"] },
      sourceTrust: { score: null, evidence: [] },
      relevance: { score: null, evidence: [] },
      uniqueness: { score: null, evidence: [] },
      freshness: { score: null, evidence: [] },
      risk: { score: null, evidence: [] },
    };
    await ctx.repo.saveSiteQualityAssessment(site.id, evaluateSiteQuality(dimensions));
    expect(await ctx.repo.deleteSite(site.id)).toBe(true);

    const response = await app.inject({ method: "GET", url: "/api/admin/quality/report" });
    expect(response.statusCode).toBe(200);
    expect(response.json().total).toBe(expectedVisibleCount);
    expect(response.json().items.map((item: { siteId: string }) => item.siteId)).not.toContain(site.id);
  });

  it("excludes archived sites from active quality totals", async () => {
    const expectedVisibleCount = await ctx.repo.countSiteQualityAssessments();
    const category = await ctx.repo.createCategory({ title: "归档质量测试" });
    const site = await ctx.repo.createSite({
      title: "Archived Quality Fixture",
      url: "https://archived-quality-fixture.example/",
      categoryId: category.id,
      status: "active",
      tags: ["quality"],
    });
    const dimensions: SiteQualityAssessments = {
      accessibility: { score: 80, evidence: ["verified health sample"] },
      contentCompleteness: { score: 80, evidence: ["catalog fields present"] },
      sourceTrust: { score: null, evidence: [] },
      relevance: { score: null, evidence: [] },
      uniqueness: { score: null, evidence: [] },
      freshness: { score: null, evidence: [] },
      risk: { score: null, evidence: [] },
    };
    await ctx.repo.saveSiteQualityAssessment(site.id, evaluateSiteQuality(dimensions));
    await ctx.repo.updateSite(site.id, { status: "archived" });

    const response = await app.inject({ method: "GET", url: "/api/admin/quality/report" });
    expect(response.statusCode).toBe(200);
    expect(response.json().total).toBe(expectedVisibleCount);
    expect(response.json().items.map((item: { siteId: string }) => item.siteId)).not.toContain(site.id);
  });

  it("filters by band and paginates with a stable total", async () => {
    const response = await app.inject({ method: "GET", url: "/api/admin/quality/report?band=high&limit=1&offset=0" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.band).toBe("high");
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
  });
});
