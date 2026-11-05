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

  it("cancelJob 返回真实结果：可取消的返回结果值，终态返回 null", async () => {
    const now = Date.now();
    await insertJob("cancel-pending", "pending", 0, now);
    await insertJob("cancel-done", "done", 1, now);

    // pending 没有执行体可等，直接落 cancelled 终态（running 才会停在 cancelling）。
    expect(await repo.cancelJob("cancel-pending")).toBe("cancelled");
    expect(await statusOf("cancel-pending")).toBe("cancelled");

    // 终态不可取消：两条 UPDATE 都不命中，回 null 表示「无事可做」
    expect(await repo.cancelJob("cancel-done")).toBeNull();
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

  /* ---------------- P1-4：cancelling 过渡态 ---------------- */

  it("running 任务取消后停在 cancelling，执行体确认前不写 cancelled", async () => {
    await insertJob("cancel-running", "running", 1, Date.now());

    // running 有执行体在等：只能先落「已要求停手」，终态由执行体在分片边界自己收
    expect(await repo.cancelJob("cancel-running")).toBe("cancelling");
    expect(await statusOf("cancel-running")).toBe("cancelling");

    // 心跳必须能看清自己处在过渡态（Runner 靠这个在取消后主动停手）
    expect(await repo.heartbeatJob("cancel-running")).toBe("cancelling");

    // 过渡态既不可重试也不可被再次认领：否则就是「假取消 → 两个执行流」。
    // 这里不能用单次 claimNextJob 断言 null —— 同一内存库前面几个用例留下了
    // pending 任务，认领会先拿走它们；关键是**过渡态这一行**始终不在候选里。
    // retryJob 在未命中 CAS 时回的是「当前行」而不是 null（路由自己判状态），
    // 所以这里断言的是状态没被改回 pending。
    await repo.retryJob("cancel-running");
    expect(await statusOf("cancel-running")).toBe("cancelling");
    for (let i = 0; i < 20; i++) {
      const claimed = await repo.claimNextJob();
      if (!claimed) break;
      expect(claimed.id).not.toBe("cancel-running");
    }
    expect(await statusOf("cancel-running")).toBe("cancelling");
  });

  it("settleCancellingJob 只从 cancelling 收尾（CAS），迟到的收尾覆盖不了别人", async () => {
    await insertJob("settle-ok", "cancelling", 1, Date.now());
    await insertJob("settle-running", "running", 1, Date.now());
    await insertJob("settle-done", "done", 1, Date.now());

    expect(await repo.settleCancellingJob("settle-ok", "cancelled", { error: "已取消", durationMs: 12 })).toBe(true);
    const row = await rowOf("settle-ok");
    expect(String(row.status)).toBe("cancelled");
    expect(Number(row.duration_ms)).toBe(12);

    // 还在跑（没确认停手）或已是终态：都不能被「迟到的收尾」改写
    expect(await repo.settleCancellingJob("settle-running", "cancelled", {})).toBe(false);
    expect(await statusOf("settle-running")).toBe("running");
    expect(await repo.settleCancellingJob("settle-done", "failed", {})).toBe(false);
    expect(await statusOf("settle-done")).toBe("done");

    // 收尾后恢复心跳语义：终态不再续期
    expect(await repo.heartbeatJob("settle-ok")).toBeNull();
  });

  it("markJobCancelling 只作用于 running（预算到点的入口）", async () => {
    await insertJob("mark-running", "running", 1, Date.now());
    await insertJob("mark-done", "done", 1, Date.now());

    expect(await repo.markJobCancelling("mark-running", "超出单次预算")).toBe(true);
    expect(await statusOf("mark-running")).toBe("cancelling");
    const row = await rowOf("mark-running");
    expect(String(row.error)).toContain("超出单次预算");

    expect(await repo.markJobCancelling("mark-done", "不该写")).toBe(false);
    expect(await statusOf("mark-done")).toBe("done");
  });

  it("崩溃实例留下的孤儿 cancelling 会被 reaper 回收（否则永远卡在收尾）", async () => {
    const old = Date.now() - 10 * 60_000;
    await insertJob("orphan-retry", "cancelling", 1, old);
    await insertJob("orphan-dead", "cancelling", 3, old);

    const reaped = await repo.reapStaleJobs(60_000, 3);
    expect(reaped).toBe(2);
    expect(await statusOf("orphan-retry")).toBe("pending");
    expect(await statusOf("orphan-dead")).toBe("failed");
  });

  it("claimNextJob 支持按 kind 认领，并把长任务排到队尾", async () => {
    await repo.run("DELETE FROM jobs");
    const long = await repo.enqueueJob("reindex", {});
    const short = await repo.enqueueJob("health_check", {});

    // 短任务优先：即便 reindex 先入队，巡检也先被认领
    const first = await repo.claimNextJob({ deferKinds: ["reindex"] });
    expect(first?.id).toBe(short);

    // kind 过滤：lane 只认领自己那一类，别的 kind 不会被顺手拿走
    expect(await repo.claimNextJob({ kinds: ["backup_restore"] })).toBeNull();
    expect((await repo.claimNextJob({ kinds: ["reindex"] }))?.id).toBe(long);
  });

  it("enqueueJobIfAbsent：同 kind 有存活任务就不重复入队，跑完可再入队", async () => {
    // 用这两个 kind：前面的用例把 health_check 占成了 pending，dedupe 会命中它们
    const first = await repo.enqueueJobIfAbsent("token_audit", { expiringDays: 7 });
    expect(first).toBeTruthy();
    expect(await repo.enqueueJobIfAbsent("token_audit", { expiringDays: 7 })).toBeNull();

    // 同 kind 不再入队，但不相关的 kind 不受影响
    expect(await repo.enqueueJobIfAbsent("user_data_audit", {})).toBeTruthy();

    // pendingJobsByKind 只数 pending，且排除 kv 行
    const pending = await repo.pendingJobsByKind();
    expect(pending.get("token_audit")).toBe(1);
    expect(pending.get("user_data_audit")).toBe(1);

    // 跑完（终态）之后允许重新入队：排期定时器靠这一点才能「下一周期再来一次」
    await repo.run("UPDATE jobs SET status = 'done' WHERE id = ?", [String(first)]);
    expect(await repo.enqueueJobIfAbsent("token_audit", { expiringDays: 7 })).toBeTruthy();
  });
});
