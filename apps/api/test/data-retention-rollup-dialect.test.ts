/**
 * `data_retention` 任务建聚合表时的方言与事务契约。
 *
 * 聚合表（events_daily / audit_daily）不在 schema 里，由 `runRollup` 首次
 * apply 时按方言建。任务必须显式传 dialect，并把所有数据库访问经 Repository；
 * PostgreSQL 的按天事务还必须用 SERIALIZABLE，避免幻行在聚合后插入却被删除。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createRetentionAdapter } from "../src/jobs/tasks/data-retention.task.ts";
import type { AppContext } from "../src/context.ts";

const taskSrc = readFileSync(new URL("../src/jobs/tasks/data-retention.task.ts", import.meta.url), "utf8");
const runnerSrc = readFileSync(new URL("../src/jobs.ts", import.meta.url), "utf8");

describe("data_retention 的 rollup 方言与事务契约", () => {
  it("唯一的 runRollup 调用点显式传 dialect", () => {
    const call = taskSrc.slice(taskSrc.indexOf("await runRollup(adapter,"), taskSrc.indexOf("await runRollup(adapter,") + 700);
    expect(call).toContain("await runRollup(adapter,");
    expect(call).toMatch(/dialect:\s*ctx\.db\.dialect\s*===\s*"pg"\s*\?\s*"postgres"\s*:\s*"sqlite"/);
    expect(taskSrc.split("runRollup(").length - 1).toBe(1);
  });

  it("模块导出的 adapter 经 Repository，PG 事务使用 SERIALIZABLE", () => {
    const start = taskSrc.indexOf("function createRetentionAdapter");
    const end = taskSrc.indexOf("async function runRetentionMainPhase", start);
    const adapter = taskSrc.slice(start, end);
    expect(adapter).toContain("ctx.repo.raw(");
    expect(adapter).toContain("ctx.repo.runCount(");
    expect(adapter).toContain("ctx.repo.withTransaction(");
    expect(adapter).toContain("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    expect(adapter).not.toContain("db.sqlite");
    expect(adapter).not.toContain("db.pg");
  });

  it("JobRunner 复用模块实现，不再维护另一套直连 adapter", () => {
    expect(runnerSrc).toContain("runRetentionMainPhase,");
    expect(runnerSrc).toContain("previewDataRetention,");
    expect(runnerSrc).not.toContain("function createRetentionAdapter");
    expect(runnerSrc).not.toContain("await runRollup(");
  });

  it("PG adapter 在事务内先设置隔离级别，SQLite 不发 PG 语句", async () => {
    const run = vi.fn(async () => undefined);
    const withTransaction = vi.fn(async <T>(fn: () => Promise<T>) => fn());
    const ctx = {
      db: { dialect: "pg" },
      repo: { run, withTransaction },
    } as unknown as AppContext;

    const pgAdapter = createRetentionAdapter(ctx);
    await expect(pgAdapter.transaction!(async () => "ok")).resolves.toBe("ok");
    expect(withTransaction).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    run.mockClear();
    withTransaction.mockClear();
    const sqliteAdapter = createRetentionAdapter({
      db: { dialect: "sqlite" },
      repo: { run, withTransaction },
    } as unknown as AppContext);
    await sqliteAdapter.transaction!(async () => "ok");
    expect(run).not.toHaveBeenCalled();
  });

  it("PG 单日事务遇到 40001 时有界退避重试，成功后只返回一次统计", async () => {
    const run = vi.fn(async () => undefined);
    let attempts = 0;
    let computations = 0;
    const withTransaction = vi.fn(async <T>(fn: () => Promise<T>) => {
      attempts++;
      if (attempts < 3) throw Object.assign(new Error("could not serialize"), { code: "40001" });
      return fn();
    });
    const adapter = createRetentionAdapter({
      db: { dialect: "pg" },
      repo: { run, withTransaction },
    } as unknown as AppContext);

    await expect(adapter.transaction!(async () => {
      computations++;
      return "ok";
    })).resolves.toBe("ok");
    expect(attempts).toBe(3);
    expect(computations).toBe(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("PG 重试耗尽或非 40001 错误立即退出，SQLite 不重试", async () => {
    const run = vi.fn(async () => undefined);
    let attempts = 0;
    const exhausted = createRetentionAdapter({
      db: { dialect: "pg" },
      repo: {
        run,
        withTransaction: async () => {
          attempts++;
          throw Object.assign(new Error("serialization failure"), { code: "40001" });
        },
      },
    } as unknown as AppContext);
    await expect(exhausted.transaction!(async () => "never")).rejects.toMatchObject({ code: "40001" });
    expect(attempts).toBe(3);

    attempts = 0;
    const other = createRetentionAdapter({
      db: { dialect: "pg" },
      repo: {
        run,
        withTransaction: async () => {
          attempts++;
          throw Object.assign(new Error("unique violation"), { code: "23505" });
        },
      },
    } as unknown as AppContext);
    await expect(other.transaction!(async () => "never")).rejects.toMatchObject({ code: "23505" });
    expect(attempts).toBe(1);

    attempts = 0;
    const sqlite = createRetentionAdapter({
      db: { dialect: "sqlite" },
      repo: {
        run,
        withTransaction: async () => {
          attempts++;
          throw Object.assign(new Error("not a pg error"), { code: "40001" });
        },
      },
    } as unknown as AppContext);
    await expect(sqlite.transaction!(async () => "never")).rejects.toMatchObject({ code: "40001" });
    expect(attempts).toBe(1);
  });
});
