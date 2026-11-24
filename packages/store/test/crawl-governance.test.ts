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
    await repo.run("DELETE FROM crawl_domain_circuit");
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

  it("仅显式 requeueCompleted 才重新排队已完成任务，且不复活死信", async () => {
    const first = await enqueueCrawlTask(repo, {
      url: "https://repeat.example/page", source: "seed", maxAttempts: 4, now: 15_000,
    });
    const leased = await claimCrawlTask(repo, "worker-repeat", { now: 15_000, minDomainIntervalMs: 0 });
    expect(leased?.id).toBe(first.id);
    expect(await settleCrawlTask(repo, {
      id: first.id, workerId: "worker-repeat", outcome: "done", now: 15_100,
    })).toBe(true);

    const unchanged = await enqueueCrawlTask(repo, {
      url: first.url, source: "seed", now: 16_000,
    });
    expect(unchanged.status).toBe("done");

    const requeued = await enqueueCrawlTask(repo, {
      url: first.url, source: "scheduled_source", maxAttempts: 5,
      requeueCompleted: true, now: 17_000,
    });
    expect(requeued.id).toBe(first.id);
    expect(requeued.status).toBe("queued");
    expect(requeued.attempts).toBe(0);
    expect(requeued.maxAttempts).toBe(5);
    expect(requeued.nextRunAt).toBe(17_000);

    const retryTask = await claimCrawlTask(repo, "worker-repeat-2", { now: 17_000, minDomainIntervalMs: 0 });
    expect(retryTask?.id).toBe(first.id);
    expect(await settleCrawlTask(repo, {
      id: first.id, workerId: "worker-repeat-2", outcome: "dead_letter", error: "terminal", now: 17_100,
    })).toBe(true);
    const terminal = await enqueueCrawlTask(repo, {
      url: first.url, source: "seed", requeueCompleted: true, now: 18_000,
    });
    expect(terminal.status).toBe("dead_letter");
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

  it("熔断域名的大量高优先级任务不会挤占扫描窗口或饿死健康域名", async () => {
    const now = 25_000;
    for (let index = 0; index < 35; index++) {
      await enqueueCrawlTask(repo, {
        url: `https://blocked.example/page-${index}`,
        source: "seed", priority: 100, now,
      });
    }
    await repo.run(
      "INSERT INTO crawl_domain_circuit (host, consecutive_failures, opened_until, last_failure_at, updated_at) VALUES (?, 5, ?, ?, ?)",
      ["blocked.example", now + 60_000, now, now],
    );
    const healthy = await enqueueCrawlTask(repo, {
      url: "https://healthy.example/important",
      source: "seed", priority: 1, now,
    });
    const claimed = await claimCrawlTask(repo, "worker-fairness", {
      now, minDomainIntervalMs: 0, scanLimit: 25,
    });
    expect(claimed?.id).toBe(healthy.id);
    expect(claimed?.host).toBe("healthy.example");
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

  it("连续五次失败触发持久化域名熔断，冷却后允许单任务探测并在成功后复位", async () => {
    const first = await enqueueCrawlTask(repo, {
      url: "https://flaky.example/page", source: "seed", maxAttempts: 10, now: 60_000,
    });
    for (let attempt = 0; attempt < 5; attempt++) {
      const task = await claimCrawlTask(repo, "worker-flaky-" + attempt, {
        now: 60_000 + attempt * 1_000, minDomainIntervalMs: 0,
      });
      expect(task?.id).toBe(first.id);
      expect(await settleCrawlTask(repo, {
        id: first.id, workerId: "worker-flaky-" + attempt, outcome: "retry",
        error: "temporary upstream failure", nextRunAt: 60_000 + (attempt + 1) * 1_000,
        now: 60_000 + attempt * 1_000,
      })).toBe(true);
    }

    await enqueueCrawlTask(repo, {
      url: "https://flaky.example/another", source: "seed", now: 66_000,
    });
    expect(await claimCrawlTask(repo, "worker-blocked", {
      now: 66_000, minDomainIntervalMs: 0,
    })).toBeNull();

    await enqueueCrawlTask(repo, {
      url: "https://healthy.example/page", source: "seed", now: 66_000,
    });
    const healthy = await claimCrawlTask(repo, "worker-healthy", {
      now: 66_000, minDomainIntervalMs: 0,
    });
    expect(healthy?.host).toBe("healthy.example");

    const probe = await claimCrawlTask(repo, "worker-probe", {
      now: 60_000 + 5 * 1_000 + 5 * 60_000 + 1, minDomainIntervalMs: 0,
    });
    expect(probe?.host).toBe("flaky.example");
    expect(await settleCrawlTask(repo, {
      id: probe!.id, workerId: "worker-probe", outcome: "done",
      now: 60_000 + 5 * 1_000 + 5 * 60_000 + 2,
    })).toBe(true);
    const state = await repo.raw(
      "SELECT consecutive_failures, opened_until FROM crawl_domain_circuit WHERE host = ?",
      ["flaky.example"],
    );
    expect(Number(state[0]?.consecutive_failures)).toBe(0);
    expect(Number(state[0]?.opened_until)).toBe(0);
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
