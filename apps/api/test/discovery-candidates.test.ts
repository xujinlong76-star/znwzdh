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
  dir = mkdtempSync(join(tmpdir(), "navhub-discovery-candidates-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "discovery.db"),
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
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("staged discovery candidate pipeline", () => {
  it("deduplicates canonical URLs and keeps new candidates pending", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/discovery/candidates",
      payload: {
        url: "https://candidate-one.example/path",
        source: "ai",
        title: "Candidate One",
        tags: ["ai", "tool"],
        confidence: 0.82,
        evidence: { discoveredBy: "test-fixture", sourceUrl: "https://directory.example/list" },
      },
    });
    expect(first.statusCode).toBe(202);
    const firstBody = first.json();
    expect(firstBody.ok).toBe(true);
    expect(firstBody.candidate.status).toBe("pending");

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/discovery/candidates",
      payload: {
        url: "https://candidate-one.example/path#section",
        source: "ai",
        title: "Different model title",
        evidence: { discoveredBy: "second-pass" },
      },
    });
    expect(duplicate.statusCode).toBe(202);
    expect(duplicate.json().duplicate).toBe(true);
    expect(duplicate.json().candidate.id).toBe(firstBody.candidate.id);
    // 同一 pending URL 重复采集只更新证据，不生成第二条队列记录。
    const list = await app.inject({ method: "GET", url: "/api/admin/discovery/candidates?status=pending" });
    expect(list.statusCode).toBe(200);
    expect(list.json().total).toBe(1);
    expect(list.json().items).toHaveLength(1);
  });

  it("only publishes after explicit human approval", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/discovery/candidates",
      payload: {
        url: "https://candidate-approved.example/",
        source: "import",
        title: "Approved Candidate",
        description: "A reviewed test site",
        tags: ["reviewed"],
        evidence: { importBatch: "batch-1" },
      },
    });
    const candidateId = created.json().candidate.id;
    expect(await ctx.repo.findSiteByUrl("https://candidate-approved.example/")).toBeNull();

    const review = await app.inject({
      method: "POST",
      url: `/api/admin/discovery/candidates/${candidateId}/review`,
      payload: { action: "approve" },
    });
    expect(review.statusCode).toBe(200);
    expect(review.json().created).toBe(true);
    expect(review.json().site.status).toBe("active");
    expect(review.json().candidate.status).toBe("approved");
    expect(await ctx.repo.findSiteByUrl("https://candidate-approved.example/")).not.toBeNull();

    const repeat = await app.inject({
      method: "POST",
      url: `/api/admin/discovery/candidates/${candidateId}/review`,
      payload: { action: "approve" },
    });
    expect(repeat.statusCode).toBe(409);
  });

  it("serializes concurrent approval so only one request publishes the candidate", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/discovery/candidates",
      payload: {
        url: "https://candidate-concurrent.example/",
        source: "import",
        title: "Concurrent Candidate",
      },
    });
    const candidateId = created.json().candidate.id;
    const url = `/api/admin/discovery/candidates/${candidateId}/review`;
    const responses = await Promise.all([
      app.inject({ method: "POST", url, payload: { action: "approve" } }),
      app.inject({ method: "POST", url, payload: { action: "approve" } }),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const sites = await ctx.repo.findSiteByUrl("https://candidate-concurrent.example/");
    expect(sites).not.toBeNull();
    const candidate = await ctx.repo.getSiteDiscoveryCandidate(candidateId);
    expect(candidate?.status).toBe("approved");
    expect(candidate?.siteId).toBe(sites?.id);
  });

  it("records rejection without creating a site", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/discovery/candidates",
      payload: { url: "https://candidate-rejected.example/", source: "submission", title: "Reject Me" },
    });
    const candidateId = created.json().candidate.id;
    const review = await app.inject({
      method: "POST",
      url: `/api/admin/discovery/candidates/${candidateId}/review`,
      payload: { action: "reject", rejectionReason: "内容与目录定位不符" },
    });
    expect(review.statusCode).toBe(200);
    expect(review.json().candidate.status).toBe("rejected");
    expect(review.json().candidate.rejectionReason).toBe("内容与目录定位不符");
    expect(await ctx.repo.findSiteByUrl("https://candidate-rejected.example/")).toBeNull();
  });

  it("rejects evidence objects containing credential-like keys", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/discovery/candidates",
      payload: {
        url: "https://candidate-secret.example/",
        source: "api",
        evidence: { crawler: { apiKey: "must-not-be-stored" } },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("不能包含");
  });

  it("falls back to the uncategorized bucket when a suggested category is stale", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/discovery/candidates",
      payload: {
        url: "https://candidate-stale-category.example/",
        source: "ai",
        title: "Stale Category Candidate",
        categoryId: "category-no-longer-exists",
      },
    });
    const candidateId = created.json().candidate.id;
    const review = await app.inject({
      method: "POST",
      url: `/api/admin/discovery/candidates/${candidateId}/review`,
      payload: { action: "approve" },
    });
    expect(review.statusCode).toBe(200);
    expect(review.json().categoryFallback).toBe(true);
    expect(review.json().candidate.status).toBe("approved");
  });

  it("rejects oversized evidence payloads", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/discovery/candidates",
      payload: {
        url: "https://candidate-large.example/",
        source: "ai",
        evidence: { blob: "x".repeat(17_000) },
      },
    });
    expect(response.statusCode).toBe(413);
  });
});
