import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { claimDueCrawlSources, deleteCrawlSource, listCrawlSources, settleCrawlSource, updateCrawlSource, upsertCrawlSource } from "../src/repository/crawl-sources.ts";

describe("持久化采集来源注册表", () => {
  let db: Db; let repo: Repository;
  beforeAll(async () => { db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" }); repo = new Repository(db); });
  afterAll(async () => { await db.close(); });
  it("规范 URL 幂等 upsert，并限制调度参数", async () => {
    const first = await upsertCrawlSource(repo, { url: "https://Example.com/map.xml#top", kind: "sitemap", intervalMs: 1, priority: 500 }, 1000);
    const second = await upsertCrawlSource(repo, { url: "https://example.com/map.xml", kind: "rss", enabled: false }, 2000);
    expect(second.id).toBe(first.id);
    expect(second.kind).toBe("rss"); expect(second.enabled).toBe(false);
    expect(second.intervalMs).toBe(5*60_000); expect(second.priority).toBe(0);
    expect(await listCrawlSources(repo)).toHaveLength(1);
  });
  it("仅认领到期且启用的来源，并通过 owner 租约结算", async () => {
    const due = await upsertCrawlSource(repo, { url: "https://due.example/sitemap.xml", kind: "sitemap" }, 10_000);
    await upsertCrawlSource(repo, { url: "https://later.example/feed.xml", kind: "rss", nextRunAt: 99_000 }, 10_000);
    const claimed = await claimDueCrawlSources(repo, "worker-a", { now: 10_000 });
    expect(claimed.map(x => x.id)).toEqual([due.id]);
    expect(await claimDueCrawlSources(repo, "worker-b", { now: 10_001 })).toEqual([]);
    expect(await settleCrawlSource(repo, { id: due.id, workerId: "worker-b", status: "ok", now: 11_000 })).toBe(false);
    expect(await settleCrawlSource(repo, { id: due.id, workerId: "worker-a", status: "ok", now: 11_000 })).toBe(true);
    const after = (await listCrawlSources(repo))[0];
    expect(after.lastStatus).toBe("ok"); expect(after.nextRunAt).toBe(11_000 + after.intervalMs);
  });
  it("更新、禁用与删除来源", async () => {
    const source = await upsertCrawlSource(repo, { url: "https://manage.example/", kind: "page" });
    const updated = await updateCrawlSource(repo, source.id, { enabled: false, priority: 9 });
    expect(updated?.enabled).toBe(false); expect(updated?.priority).toBe(9);
    expect(await claimDueCrawlSources(repo, "worker", { now: Date.now()+1 })).toEqual([]);
    expect(await deleteCrawlSource(repo, source.id)).toBe(true);
    expect(await updateCrawlSource(repo, source.id, { enabled: true })).toBeNull();
  });
  it("拒绝非 HTTP(S) 或带凭据来源", async () => {
    await expect(upsertCrawlSource(repo, { url: "file:///etc/passwd", kind: "page" })).rejects.toThrow();
    await expect(upsertCrawlSource(repo, { url: "https://user:pass@example.com/", kind: "page" })).rejects.toThrow();
  });
});
