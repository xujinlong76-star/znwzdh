import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";

/**
 * 任务生命周期（P1「任务执行器」）。
 *
 * 两条旧行为的回归：
 *  - `cancelJob` 无条件 return true：任务已经 done/failed 时管理端仍显示「已取消」；
 *  - `reapStaleJobs` 把所有僵尸任务直接标 failed：一次 Worker 重启就把任务判死，
 *    不重试、不恢复。
 */
describe("任务取消与僵尸回收", () => {
  let db: Db;
  let repo: Repository;

  const insertJob = async (id: string, status: string, attempts: number, updatedAt: number) => {
    await repo.run(
      "INSERT INTO jobs (id, kind, payload, status, attempts, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
      [id, "health_check", null, status, attempts, updatedAt, updatedAt],
    );
  };
  const statusOf = async (id: string): Promise<string> =>
    String((await repo.raw("SELECT status FROM jobs WHERE id = ?", [id]))[0]?.status);
  const rowOf = async (id: string) => (await repo.raw("SELECT * FROM jobs WHERE id = ?", [id]))[0];

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it("cancelJob 返回真实结果：可取消的返回 true，终态返回 false", async () => {
    const now = Date.now();
    await insertJob("cancel-pending", "pending", 0, now);
    await insertJob("cancel-done", "done", 1, now);

    expect(await repo.cancelJob("cancel-pending")).toBe(true);
    expect(await statusOf("cancel-pending")).toBe("cancelled");

    // 终态不可取消：必须如实返回 false，而不是假装成功
    expect(await repo.cancelJob("cancel-done")).toBe(false);
    expect(await statusOf("cancel-done")).toBe("done");
  });

  it("僵尸任务还有重试额度 → 回到 pending；额度耗尽 → failed", async () => {
    const old = Date.now() - 10 * 60_000;
    await insertJob("stale-retry", "running", 1, old);
    await insertJob("stale-dead", "running", 3, old);

    const reaped = await repo.reapStaleJobs(60_000, 3);
    expect(reaped).toBe(2);

    expect(await statusOf("stale-retry")).toBe("pending");
    const retry = await rowOf("stale-retry");
    expect(String(retry.error)).toContain("重新排队");
    expect(Number(retry.next_run_at)).toBeGreaterThan(0);

    expect(await statusOf("stale-dead")).toBe("failed");
    const dead = await rowOf("stale-dead");
    expect(String(dead.error)).toContain("超时");
    expect(dead.next_run_at).toBeNull();
  });

  it("未超时的 running 任务不会被回收（心跳语义）", async () => {
    await insertJob("fresh-running", "running", 1, Date.now());
    const before = await statusOf("fresh-running");
    await repo.reapStaleJobs(60_000, 3);
    expect(await statusOf("fresh-running")).toBe(before);
  });
});
