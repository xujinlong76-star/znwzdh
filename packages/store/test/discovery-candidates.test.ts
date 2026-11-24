import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import {
  countSiteDiscoveryCandidates, getSiteDiscoveryCandidate, getSiteDiscoveryCandidateForUpdate,
  listSiteDiscoveryCandidates, reviewSiteDiscoveryCandidate, upsertSiteDiscoveryCandidate, overrideAiApprovedCandidate,
} from "../src/repository/discovery-candidates.ts";

describe("站点发现候选仓储", () => {
  let db: Db;
  let repo: Repository;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
  });

  afterAll(async () => { await db.close(); });

  it("按规范 URL 去重，pending 候选更新证据但保留首次发现时间", async () => {
    const first = await upsertSiteDiscoveryCandidate(repo, {
      id: "candidate-a", url: "https://example.com", canonicalUrl: "https://example.com/",
      source: "sitemap", title: null, evidence: { pass: 1 }, now: 100,
    });
    const next = await upsertSiteDiscoveryCandidate(repo, {
      id: "candidate-b", url: "https://example.com/", canonicalUrl: "https://example.com/",
      source: "rss", title: "Example", evidence: { pass: 2 }, now: 200,
    });

    expect(next.id).toBe(first.id);
    expect(next.title).toBe("Example");
    expect(next.source).toBe("sitemap");
    expect(next.discoveredAt).toBe(100);
    expect(next.lastSeenAt).toBe(200);
    expect(next.evidence).toEqual({ pass: 2 });
  });

  it("审核后禁止重新打开或覆盖已审核内容", async () => {
    const candidate = await upsertSiteDiscoveryCandidate(repo, {
      id: "candidate-review", url: "https://review.example", canonicalUrl: "https://review.example/",
      source: "rss", title: "Original", evidence: { trusted: true }, now: 300,
    });
    const reviewed = await reviewSiteDiscoveryCandidate(repo, {
      id: candidate.id, status: "approved", reviewer: "admin:1", siteId: "site-1", now: 400,
    });
    expect(reviewed?.status).toBe("approved");
    expect(reviewed?.reviewedBy).toBe("admin:1");

    const repeated = await upsertSiteDiscoveryCandidate(repo, {
      id: "candidate-review-2", url: "https://review.example/", canonicalUrl: "https://review.example/",
      source: "new-source", title: "Overwritten", evidence: { trusted: false }, now: 500,
    });
    expect(repeated.status).toBe("approved");
    expect(repeated.title).toBe("Original");
    expect(repeated.source).toBe("rss");
    expect(repeated.evidence).toEqual({ trusted: true });
    expect(repeated.lastSeenAt).toBe(500);
  });

  it("AI 自动通过时在同一审核更新中持久化模型证据", async () => {
    const candidate = await upsertSiteDiscoveryCandidate(repo, {
      id: "candidate-ai-approved", url: "https://ai-approved.example",
      canonicalUrl: "https://ai-approved.example/", source: "sitemap", now: 350,
    });
    const reviewed = await reviewSiteDiscoveryCandidate(repo, {
      id: candidate.id, status: "approved", reviewer: "ai:model-x", siteId: null,
      evidence: { aiModeration: { mode: "auto_approve", action: "auto_approved", model: "model-x" } },
      now: 450,
    });
    expect(reviewed).toMatchObject({
      status: "approved",
      reviewedBy: "ai:model-x",
      evidence: { aiModeration: { mode: "auto_approve", action: "auto_approved", model: "model-x" } },
    });
  });

  it("人工可以将 AI 自动通过退回待审或驳回，但不能覆盖人工批准", async () => {
    const candidate = await upsertSiteDiscoveryCandidate(repo, {
      id: "candidate-ai-override", url: "https://ai-override.example",
      canonicalUrl: "https://ai-override.example/", source: "sitemap", now: 500,
    });
    await reviewSiteDiscoveryCandidate(repo, {
      id: candidate.id, status: "approved", reviewer: "ai:model-x",
      evidence: { aiModeration: { mode: "auto_approve", action: "auto_approved" } }, now: 600,
    });
    const reopened = await overrideAiApprovedCandidate(repo, {
      id: candidate.id, decision: "reopen", reviewer: "admin:1", reason: "人工抽查要求重新核验",
      evidence: { aiModeration: { mode: "auto_approve", action: "human_reopened" } }, now: 700,
    });
    expect(reopened).toMatchObject({ status: "pending", reviewedBy: null, evidence: { aiModeration: { action: "human_reopened" } } });

    const manuallyApproved = await upsertSiteDiscoveryCandidate(repo, {
      id: "candidate-human-approved", url: "https://human-approved.example",
      canonicalUrl: "https://human-approved.example/", source: "rss", now: 800,
    });
    await reviewSiteDiscoveryCandidate(repo, {
      id: manuallyApproved.id, status: "approved", reviewer: "admin:2", now: 900,
    });
    const untouched = await overrideAiApprovedCandidate(repo, {
      id: manuallyApproved.id, decision: "reject", reviewer: "admin:1", reason: "人工复核发现问题",
      now: 1000,
    });
    expect(untouched).toMatchObject({ status: "approved", reviewedBy: "admin:2" });
  });

  it("损坏的历史 JSON 不会让候选审核队列整体 500", async () => {
    await repo.run(
      "INSERT INTO site_discovery_candidates (id,url,canonical_url,tags_json,source,evidence_json,status,discovered_at,last_seen_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      ["candidate-corrupt", "https://corrupt.example/", "https://corrupt.example/", "{bad", "legacy", "{bad", "pending", 900, 900, 900],
    );
    const candidate = await getSiteDiscoveryCandidate(repo, "candidate-corrupt");
    expect(candidate?.tags).toEqual([]);
    expect(candidate?.evidence).toEqual({});
  });
  it("审核只允许 pending 状态，列表与计数按状态筛选", async () => {
    const candidate = await upsertSiteDiscoveryCandidate(repo, {
      id: "candidate-reject", url: "https://reject.example", canonicalUrl: "https://reject.example/",
      source: "page", now: 600,
    });
    await reviewSiteDiscoveryCandidate(repo, {
      id: candidate.id, status: "rejected", reviewer: "admin:2", rejectionReason: "低质量", now: 700,
    });
    expect(await reviewSiteDiscoveryCandidate(repo, {
      id: candidate.id, status: "approved", reviewer: "admin:3", now: 800,
    })).toMatchObject({ status: "rejected", reviewedBy: "admin:2" });
    expect(await countSiteDiscoveryCandidates(repo, "pending")).toBe(0);
    expect(await countSiteDiscoveryCandidates(repo, "rejected")).toBe(1);
    expect((await listSiteDiscoveryCandidates(repo, { status: "rejected" })).map(x => x.id)).toContain(candidate.id);
    expect(await getSiteDiscoveryCandidate(repo, candidate.id)).toMatchObject({ rejectionReason: "低质量" });
    expect(await repo.withTransaction(() => getSiteDiscoveryCandidateForUpdate(repo, candidate.id))).toMatchObject({ id: candidate.id });
  });
});
