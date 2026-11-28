import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";

/**
 * 任务 runToken 租约回归。
 *
 * 根因：379782c1 给 `repository/jobs.ts` 的 CAS 写操作引入 `runToken`，
 * 但 `packages/store/src/repository.ts` 的委托层未同步——
 * `updateJobProgress` / `heartbeatJob` / `markJobCancelling` 丢 runToken，
 * `completeJob` / `settleCancellingJob` 的 opts 类型漏 runToken；
 * 更严重的是租约三方法（acquire/renew/releaseJobRunnerLease）与
 * `getJobRunnerLease` 在 `repository/jobs.ts` 有导出、委托层根本没有对应
 * 方法，`JobRunner.acquireLock` 调 `undefined` 抛错被吞、tick 恒跳过，
 * 任何任务都跑不起来。
 *
 * 全部用真实 Repository + 临时文件库验证，不 mock 仓储；token 一律取
 * `claimNextJob` 返回的真实 runToken（与生产链路同一来源）。
 */
describe("任务 runToken 租约回归", () => {
  let db: Db;
  let repo: Repository;
  let dir: string;

  const rowOf = async (id: string) => (await repo.raw("SELECT * FROM jobs WHERE id = ?", [id]))[0];
  const statusOf = async (id: string): Promise<string> => String((await rowOf(id))?.status);

  /** 入队并认领，返回真实 runToken。 */
  const claimJob = async (kind = "lease_test") => {
    const id = await repo.enqueueJob(kind, {});
    const claimed = await repo.claimNextJob();
    expect(claimed?.id).toBe(id);
    expect(claimed?.status).toBe("running");
    const runToken = claimed!.runToken;
    expect(typeof runToken).toBe("string");
    expect(runToken.length).toBeGreaterThan(0);
    return { id, runToken };
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "navhub-job-lease-"));
    db = await openDb({ dialect: "sqlite", sqlitePath: join(dir, "job-lease.db") });
    repo = new Repository(db);
  });

  afterAll(async () => {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("updateJobProgress：正确 runToken 写进进度，错 token 写不进", async () => {
    const { id, runToken } = await claimJob();

    await repo.updateJobProgress(id, { done: 3, total: 10 }, runToken);
    let row = await rowOf(id);
    expect(Number(row.progress_done)).toBe(3);
    expect(Number(row.progress_total)).toBe(10);

    // 错 token 的 CAS 不命中：进度保持原值（不是被覆盖成 9/10）。
    await repo.updateJobProgress(id, { done: 9, total: 10 }, "wrong-token");
    row = await rowOf(id);
    expect(Number(row.progress_done)).toBe(3);
    expect(Number(row.progress_total)).toBe(10);
  });

  it("heartbeatJob：正确 runToken 返回 running，错 token 返回 null", async () => {
    const { id, runToken } = await claimJob();

    expect(await repo.heartbeatJob(id, runToken)).toBe("running");
    // 错 token 的心跳恒 null：生产上会被误判为“已离开执行态”而中止任务。
    expect(await repo.heartbeatJob(id, "wrong-token")).toBeNull();
    // 错 token 的心跳也不该续期 updated_at 之外的任何状态。
    expect(await statusOf(id)).toBe("running");
  });

  it("markJobCancelling：正确 runToken 置 cancelling，错 token 不动；心跳能看到 cancelling", async () => {
    const { id, runToken } = await claimJob();

    expect(await repo.markJobCancelling(id, "超出单次预算", "wrong-token")).toBe(false);
    expect(await statusOf(id)).toBe("running");

    expect(await repo.markJobCancelling(id, "超出单次预算", runToken)).toBe(true);
    expect(await statusOf(id)).toBe("cancelling");
    const row = await rowOf(id);
    expect(String(row.error)).toContain("超出单次预算");

    // 收尾期间心跳仍要回报 cancelling（否则 reaper 会把活任务当僵尸回收）。
    expect(await repo.heartbeatJob(id, runToken)).toBe("cancelling");
  });

  it("completeJob：opts 里的 runToken 走到 CAS，错 token 落不了终态", async () => {
    const { id, runToken } = await claimJob();

    expect(await repo.completeJob(id, null, { runToken: "wrong-token" })).toBe(false);
    expect(await statusOf(id)).toBe("running");

    expect(await repo.completeJob(id, null, { durationMs: 7, runToken })).toBe(true);
    const row = await rowOf(id);
    expect(String(row.status)).toBe("done");
    expect(Number(row.duration_ms)).toBe(7);
  });

  it("settleCancellingJob：正确 runToken 才能从 cancelling 收尾", async () => {
    const { id, runToken } = await claimJob();
    expect(await repo.markJobCancelling(id, "用户取消", runToken)).toBe(true);

    expect(
      await repo.settleCancellingJob(id, "cancelled", { error: "已取消", durationMs: 5, runToken: "wrong-token" }),
    ).toBe(false);
    expect(await statusOf(id)).toBe("cancelling");

    expect(
      await repo.settleCancellingJob(id, "cancelled", { error: "已取消", durationMs: 5, runToken }),
    ).toBe(true);
    expect(await statusOf(id)).toBe("cancelled");
  });

  it("reapStaleJobs：maxAttempts 透传到回收判定（不只是默认值 3）", async () => {
    const old = Date.now() - 10 * 60_000;
    await repo.run(
      "INSERT INTO jobs (id, kind, payload, status, attempts, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
      ["reap-a", "lease_test", null, "running", 1, old, old],
    );
    await repo.run(
      "INSERT INTO jobs (id, kind, payload, status, attempts, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
      ["reap-b", "lease_test", null, "running", 2, old, old],
    );

    // maxAttempts=2：attempts=1 回 pending，attempts=2 已耗尽落 failed。
    // 若委托丢 maxAttempts 而取默认 3，两行都会回 pending，本断言即失败。
    expect(await repo.reapStaleJobs(60_000, 2)).toBe(2);
    expect(await statusOf("reap-a")).toBe("pending");
    expect(await statusOf("reap-b")).toBe("failed");
  });

  it("JobRunner 租约：抢锁 / 续期 / 释放走通，第二 holder 抢不到未过期租约", async () => {
    expect(repo.acquireJobRunnerLease("holder-a", 120_000)).toBe(true);
    // 租约未过期：另一 holder 抢不到（否则两个 Runner 会双跑同一批任务）。
    expect(repo.acquireJobRunnerLease("holder-b", 120_000)).toBe(false);

    const lease = repo.getJobRunnerLease();
    expect(lease?.holder).toBe("holder-a");

    // 只有 holder 本人能续期；别人的续期返回 0 行。
    expect(repo.renewJobRunnerLease("holder-b")).toBe(0);
    expect(repo.renewJobRunnerLease("holder-a")).toBe(1);

    // 释放后另一 holder 能接管。
    repo.releaseJobRunnerLease("holder-a");
    expect(repo.getJobRunnerLease()).toBeNull();
    expect(repo.acquireJobRunnerLease("holder-b", 120_000)).toBe(true);
    repo.releaseJobRunnerLease("holder-b");
  });
});
