import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";

/**
 * JobRunner sidecar 租约接线回归（2026-11-29 02:22 轮 W9）。
 *
 * 根因：`repository/jobs.ts` 导出了 acquire/renew/release/getJobRunnerLease，
 * 但 `Repository` 类从未接线；`apps/api/src/jobs.ts:1143` 的
 * `this.ctx.repo.acquireJobRunnerLease(...)` 抛 TypeError，被 acquireLock()
 * 的 `catch { return false; }` 静默吞掉，JobRunner 自此不再消费任何任务。
 * 本用例直接在真实 Repository 上断言 4 个方法存在且语义正确。
 */
describe("JobRunner sidecar 租约接线", () => {
  let dir: string;
  let dbPath: string;
  let db: Db;
  let repo: Repository;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "navhub-lease-test-"));
    dbPath = join(dir, "test.db");
    db = await openDb({ dialect: "sqlite", sqlitePath: dbPath });
    repo = new Repository(db);
  });

  afterAll(async () => {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("acquire → 他人抢不到 → get 读回 holder → renew 不丢锁 → release 后可再抢", async () => {
    expect(await repo.acquireJobRunnerLease("h1", 120_000)).toBe(true);
    expect(await repo.acquireJobRunnerLease("h2", 120_000)).toBe(false);

    const lease = await repo.getJobRunnerLease();
    expect(lease?.holder).toBe("h1");
    expect(typeof lease?.createdAt).toBe("number");

    expect(await repo.renewJobRunnerLease("h1")).toBe(1);
    expect((await repo.getJobRunnerLease())?.holder).toBe("h1");
    expect(await repo.acquireJobRunnerLease("h2", 120_000)).toBe(false);

    await repo.releaseJobRunnerLease("h1");
    expect(await repo.getJobRunnerLease()).toBeNull();
    expect(await repo.acquireJobRunnerLease("h2", 120_000)).toBe(true);
    expect((await repo.getJobRunnerLease())?.holder).toBe("h2");
    await repo.releaseJobRunnerLease("h2");
    expect(await repo.getJobRunnerLease()).toBeNull();
  });

  it("非 holder 续期返回 0 且不夺锁；非 holder 释放删不掉别人的锁", async () => {
    expect(await repo.acquireJobRunnerLease("h1", 120_000)).toBe(true);
    expect(await repo.renewJobRunnerLease("h2")).toBe(0);
    expect((await repo.getJobRunnerLease())?.holder).toBe("h1");

    await repo.releaseJobRunnerLease("h2");
    expect((await repo.getJobRunnerLease())?.holder).toBe("h1");

    await repo.releaseJobRunnerLease("h1");
    expect(await repo.getJobRunnerLease()).toBeNull();
  });

  it("过期租约可被接管", async () => {
    const now = Date.now();
    expect(await repo.acquireJobRunnerLease("h1", 1_000, now - 2_000)).toBe(true);
    expect(await repo.acquireJobRunnerLease("h2", 1_000, now)).toBe(true);
    expect((await repo.getJobRunnerLease())?.holder).toBe("h2");
    await repo.releaseJobRunnerLease("h2");
  });
});
