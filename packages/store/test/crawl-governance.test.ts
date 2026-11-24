import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import {
  claimCrawlTask,
  enqueueCrawlTask,
  findCrawlFingerprint,
  reapExpiredCrawlLeases,
  recordCrawlFingerprint,
  renewCrawlLease,
  settleCrawlTask,
} from "../src/repository/crawl-governance.ts";

describe("持久化采集治理队列", () => {
  let db: Db;
  let repo: Repository;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
  });

  beforeEach(async () => {
    await repo.run("DELETE FROM crawl_page_fingerprints");
    await repo.run("DELETE FROM crawl_domain_state");
    await repo.run("DELETE FROM crawl_tasks");
  });

  afterAll(async () => { await db.close(); });

  it("按规范 URL 幂等入队，保留首次任务身份", async () => {
    const first = await enqueueCrawlTask(repo, {
      url: "https://Example.com/path#section", source: "sitemap", priority: 2, now: 10_000,
    });
    const duplicate = await enqueueCrawlTask(repo, {
      url: "https://example.com/path", source: "rss", priority: 8, now: 11_000,
    });
    expect(duplicate.id).toBe(first.id);
    expect(duplicate.canonicalUrl).toBe("https://example.com/path");
    expect(duplicate.priority).toBe(8);
    expect(duplicate.status).toBe("queued");
  });

  it("周期性可信来源可重开 done 任务，但不会复活死信或人工挂起", async () => {
    const seed = await enqueueCrawlTask(repo, {
      url: "https://refresh.example/feed.xml", source: "rss_seed", now: 15_000,
    });
    const claimed = await claimCrawlTask(repo, "worker-refresh", { now: 15_000, minDomainIntervalMs: 0 });
    expect(claimed?.id).toBe(seed.id);
    expect(await settleCrawlTask(repo, {
      id: seed.id, workerId: "worker-refresh", outcome: "done", now: 15_100,
    })).toBe(true);
    const refreshed = await enqueueCrawlTask(repo, {
      url: "https://refresh.example/feed.xml", source: "rss_seed",
      requeueCompleted: true, now: 20_000,
    });
    expect(refreshed.status).toBe("queued");
    expect(refreshed.attempts).toBe(0);

    const second = await claimCrawlTask(repo, "worker-refresh", { now: 20_000, minDomainIntervalMs: 0 });
    expect(second?.id).toBe(seed.id);
    expect(await settleCrawlTask(repo, {
      id: seed.id, workerId: "worker-refresh", outcome: "dead_letter", now: 20_100,
    })).toBe(true);
    const deadLetter = await enqueueCrawlTask(repo, {
      url: "https://refresh.example/feed.xml", source: "rss_seed",
      requeueCompleted: true, now: 30_000,
    });
    expect(deadLetter.status).toBe("dead_letter");
  });

  it("域名频控阻止同 host 并发，但不会阻塞其他 host", async () => {
    await enqueueCrawlTask(repo, { url: "https://one.example/a", source: "seed", now: 20_000 });
    const first = await claimCrawlTask(repo, "worker-a", {
      now: 20_000, minDomainIntervalMs: 5_000, leaseMs: 30_000,
    });
    expect(first?.host).toBe("one.example");

    await enqueueCrawlTask(repo, { url: "https://one.example/b", source: "seed", now: 20_001 });
    expect(await claimCrawlTask(repo, "worker-b", {
      now: 20_002, minDomainIntervalMs: 5_000,
    })).toBeNull();

    await enqueueCrawlTask(repo, { url: "https://two.example/c", source: "seed", now: 20_003 });
    const otherHost = await claimCrawlTask(repo, "worker-b", {
      now: 20_003, minDomainIntervalMs: 5_000,
    });
    expect(otherHost?.host).toBe("two.example");
  });

  it("租约 owner CAS 阻止旧 worker 写回，并支持续租和正常结算", async () => {
    await enqueueCrawlTask(repo, { url: "https://lease.example/page", source: "rss", now: 30_000 });
    const task = await claimCrawlTask(repo, "worker-a", { now: 30_000, leaseMs: 10_000 });
    expect(task).not.toBeNull();

    expect(await settleCrawlTask(repo, {
      id: task!.id, workerId: "worker-b", outcome: "done", now: 30_100,
    })).toBe(false);
    expect(await renewCrawlLease(repo, {
      id: task!.id, workerId: "worker-a", now: 30_200, leaseMs: 20_000,
    })).toBe(true);
    expect(await settleCrawlTask(repo, {
      id: task!.id, workerId: "worker-a", outcome: "done", now: 30_300,
    })).toBe(true);
    const rows = await repo.raw("SELECT status, lease_owner FROM crawl_tasks WHERE id = ?", [task!.id]);
    expect(rows[0]?.status).toBe("done");
    expect(rows[0]?.lease_owner).toBeNull();
  });

  it("崩溃租约过期后有限重试，耗尽次数进入 dead_letter", async () => {
    await enqueueCrawlTask(repo, {
      url: "https://expired.example/page", source: "seed", maxAttempts: 1, now: 40_000,
    });
    const task = await claimCrawlTask(repo, "worker-crash", { now: 40_000, leaseMs: 5_000 });
    expect(task?.attempts).toBe(1);
    expect(await settleCrawlTask(repo, {
      id: task!.id, workerId: "worker-crash", outcome: "done", now: 45_001,
    })).toBe(false);
    expect(await renewCrawlLease(repo, {
      id: task!.id, workerId: "worker-crash", now: 45_001,
    })).toBe(false);
    const result = await reapExpiredCrawlLeases(repo, { now: 45_001 });
    expect(result).toEqual({ retried: 0, deadLettered: 1 });
    const rows = await repo.raw("SELECT status FROM crawl_tasks WHERE id = ?", [task!.id]);
    expect(rows[0]?.status).toBe("dead_letter");
  });

  it("持久化页面指纹并按规范 URL 读取", async () => {
    await recordCrawlFingerprint(repo, {
      canonicalUrl: "https://Fingerprint.example/a#top",
      contentHash: "sha256:abc", simhash64: "0123456789abcdef",
      language: "zh-CN", siteId: "site-1", fetchedAt: 50_000,
    });
    const record = await findCrawlFingerprint(repo, "https://fingerprint.example/a");
    expect(record).toMatchObject({
      canonicalUrl: "https://fingerprint.example/a",
      contentHash: "sha256:abc",
      simhash64: "0123456789abcdef",
      language: "zh-CN",
      siteId: "site-1",
      fetchedAt: 50_000,
    });
  });

  it("拒绝非 HTTP(S) 和带凭据的采集 URL", async () => {
    await expect(enqueueCrawlTask(repo, {
      url: "file:///etc/passwd", source: "bad",
    })).rejects.toThrow();
    await expect(enqueueCrawlTask(repo, {
      url: "https://user:pass@example.com/", source: "bad",
    })).rejects.toThrow();
  });
});
