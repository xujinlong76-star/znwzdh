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
  it("失败按连续次数指数退避，成功后重置计数", async () => {
    const source = await upsertCrawlSource(repo, { url: "https://retry.example/sitemap.xml", kind: "sitemap" }, 1_000);
    const [claimed] = await claimDueCrawlSources(repo, "retry-worker", { now: 1_000 });
    expect(claimed?.id).toBe(source.id);
    expect(await settleCrawlSource(repo, { id: source.id, workerId: "retry-worker", status: "error", error: "temporary", now: 2_000 })).toBe(true);
    let current = (await listCrawlSources(repo))[0]!;
    expect(current.consecutiveFailures).toBe(1);
    expect(current.nextRunAt).toBe(2_000 + 5 * 60_000);

    const [retry] = await claimDueCrawlSources(repo, "retry-worker", { now: current.nextRunAt });
    expect(retry?.id).toBe(source.id);
    await settleCrawlSource(repo, { id: source.id, workerId: "retry-worker", status: "error", error: "still failing", now: current.nextRunAt + 1 });
    current = (await listCrawlSources(repo))[0]!;
    expect(current.consecutiveFailures).toBe(2);
    expect(current.nextRunAt).toBe(current.lastRunAt! + 10 * 60_000);

    const [lastRetry] = await claimDueCrawlSources(repo, "retry-worker", { now: current.nextRunAt });
    expect(lastRetry?.id).toBe(source.id);
    await settleCrawlSource(repo, { id: source.id, workerId: "retry-worker", status: "ok", now: current.nextRunAt + 1 });
    current = (await listCrawlSources(repo))[0]!;
    expect(current.consecutiveFailures).toBe(0);
    expect(current.nextRunAt).toBe(current.lastRunAt! + current.intervalMs);
  });
  it("跨实例共享域名租约并在释放后执行最小请求间隔", async () => {
    const { claimCrawlDomain, releaseCrawlDomain } = await import("../src/repository/crawl-sources.ts");
    expect(await claimCrawlDomain(repo, "Shared.Example", "source-a", { now: 10_000, leaseMs: 30_000 })).toBe(true);
    expect(await claimCrawlDomain(repo, "shared.example", "source-b", { now: 10_001, leaseMs: 30_000 })).toBe(false);
    expect(await releaseCrawlDomain(repo, "shared.example", "source-a", { now: 11_000, minIntervalMs: 15_000 })).toBe(true);
    expect(await claimCrawlDomain(repo, "shared.example", "source-b", { now: 20_000 })).toBe(false);
    expect(await claimCrawlDomain(repo, "shared.example", "source-b", { now: 26_000 })).toBe(true);
    expect(await releaseCrawlDomain(repo, "shared.example", "source-b", { now: 26_100 })).toBe(true);
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
