import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import {
  countSiteDiscoveryCandidates, getSiteDiscoveryCandidate, getSiteDiscoveryCandidateForUpdate,
  listSiteDiscoveryCandidates, reviewSiteDiscoveryCandidate, upsertSiteDiscoveryCandidate,
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
