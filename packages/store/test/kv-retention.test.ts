import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";

/**
 * KV 存储借住 jobs 表（`id='kv:<key>'`、`kind='kv'`、`status='done'`）。
 *
 * 这带来三条隐性耦合，本文件逐条锁住：
 * 1. `pruneJobs` 按 status 清理，会把低频写入的 KV 行当「已完成任务」删掉；
 * 2. `listJobs` 会把 KV 行展示成任务；
 * 3. `dashboard` 的成功任务数被 KV 写入量虚高。
 *
 * 判定口径统一为**显式语义字段** `kind <> 'kv'`，不依赖 id 前缀约定。
 */
describe("KV 行不参与任务生命周期", () => {
  let db: Db;
  let repo: Repository;

  const insertJob = async (id: string, kind: string, status: string, at: number) => {
    await repo.run(
      "INSERT INTO jobs (id, kind, payload, status, attempts, created_at, updated_at) VALUES (?,?,?,?,0,?,?)",
      [id, kind, kind === "kv" ? '{"brand":"NavHub"}' : null, status, at, at],
    );
  };

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it("pruneJobs 不删 kind='kv' 的旧行，且回执只计真实任务", async () => {
    const old = Date.now() - 10 * 86_400_000;
    await insertJob("kv:site-config", "kv", "done", old);
    await insertJob("job-old", "health_check", "done", old);

    const result = await repo.pruneJobs(7, ["done"]);
    expect(result.pruned).toBe(1);

    // KV 行必须还在：删了等于品牌配置/内容清单静默消失
    expect(await repo.raw("SELECT payload FROM jobs WHERE id = ?", ["kv:site-config"])).toHaveLength(1);
    expect(await repo.raw("SELECT id FROM jobs WHERE id = ?", ["job-old"])).toHaveLength(0);
  });

  it("listJobs 不把 KV 行当任务展示", async () => {
    const now = Date.now();
    await insertJob("kv:videos", "kv", "done", now);
    await insertJob("job-visible", "reindex", "done", now);

    const jobs = await repo.listJobs();
    const ids = jobs.map((j) => j.id);
    expect(ids).toContain("job-visible");
    expect(ids).not.toContain("kv:videos");
  });

  it("dashboard 的 24h 成功任务数不含 KV 行", async () => {
    const now = Date.now();
    await insertJob("kv:dashboard-noise", "kv", "done", now);
    await insertJob("job-counted", "health_check", "done", now);

    const overview = await repo.dashboardOverview();
    // 只应数到 job-old?（已删）/ job-visible / job-counted 中 24h 内的真实任务
    expect(overview.metrics24h.jobsCompleted).toBeGreaterThanOrEqual(1);
    const kvCount = Number(
      (await repo.raw("SELECT COUNT(*) AS c FROM jobs WHERE kind = 'kv' AND status = 'done' AND created_at >= ?", [
        now - 86_400_000,
      ]))[0]!.c,
    );
    expect(kvCount).toBeGreaterThan(0);
    const totalDone = Number(
      (await repo.raw("SELECT COUNT(*) AS c FROM jobs WHERE status = 'done' AND created_at >= ?", [now - 86_400_000]))[0]!
        .c,
    );
    // dashboard 的计数必须比「全表 done」少掉 KV 那部分
    expect(overview.metrics24h.jobsCompleted).toBe(totalDone - kvCount);
  });
});
