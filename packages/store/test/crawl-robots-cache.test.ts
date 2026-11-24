import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { getCrawlRobotsCache, upsertCrawlRobotsCache } from "../src/repository/crawl-robots-cache.ts";

describe("跨实例共享 robots.txt 缓存", () => {
  let db: Db;
  let repo: Repository;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
  });
  afterAll(async () => { await db.close(); });

  it("持久化并读取仍在 TTL 内的允许规则", async () => {
    await upsertCrawlRobotsCache(repo, {
      origin: "https://example.com", body: "User-agent: *\\nAllow: /",
      blocked: false, status: 200, etag: '"v1"', lastModified: "Tue, 24 Nov 2026 00:00:00 GMT",
      fetchedAt: 10_000, ttlMs: 120_000,
    });
    expect(await getCrawlRobotsCache(repo, "https://example.com", 20_000)).toMatchObject({
      origin: "https://example.com", body: "User-agent: *\\nAllow: /",
      blocked: false, status: 200, etag: '"v1"', fetchedAt: 10_000, expiresAt: 130_000,
    });
  });

  it("缓存拒绝策略并在过期后不再返回", async () => {
    await upsertCrawlRobotsCache(repo, {
      origin: "https://blocked.example", body: null, blocked: true, status: 403,
      fetchedAt: 50_000, ttlMs: 60_000,
    });
    expect(await getCrawlRobotsCache(repo, "https://blocked.example", 55_000)).toMatchObject({
      blocked: true, status: 403, body: null,
    });
    expect(await getCrawlRobotsCache(repo, "https://blocked.example", 110_000)).toBeNull();
  });

  it("限制缓存键、正文大小和 TTL 输入", async () => {
    await expect(getCrawlRobotsCache(repo, "https://example.com/path")).rejects.toThrow();
    await expect(upsertCrawlRobotsCache(repo, {
      origin: "https://example.com", body: "x".repeat(64 * 1024 + 1),
      blocked: false, status: 200,
    })).rejects.toThrow("64 KiB");
  });
});
