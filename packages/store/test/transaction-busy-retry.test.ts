import { describe, expect, it } from "vitest";
import { Repository } from "../src/repository.ts";

function busyDb(options: { beginBusy?: number; commitBusy?: number } = {}) {
  const calls: string[] = [];
  let beginBusy = options.beginBusy ?? 0;
  let commitBusy = options.commitBusy ?? 0;
  const sqlite = {
    exec(sql: string) {
      if (sql === "PRAGMA busy_timeout = 5000") return;
      calls.push(sql);
      if (sql === "BEGIN IMMEDIATE" && beginBusy-- > 0) throw new Error("SQLITE_BUSY at BEGIN");
      if (sql === "COMMIT" && commitBusy-- > 0) throw new Error("SQLITE_BUSY at COMMIT");
    },
    prepare() { throw new Error("测试只需事务控制语句"); },
    close() {},
  };
  const db = { dialect: "sqlite", orm: null, sqlite, close: async () => {} } as never;
  return { db, calls };
}

describe("SQLite BUSY/LOCKED 安全重试边界", () => {
  it("BEGIN BUSY 可重试，但 action 只执行一次", async () => {
    const { db, calls } = busyDb({ beginBusy: 2 });
    const repo = new Repository(db);
    let executions = 0;

    await expect(repo.withTransaction(async () => {
      executions++;
      return "ok";
    })).resolves.toBe("ok");

    expect(executions).toBe(1);
    expect(calls).toEqual(["BEGIN IMMEDIATE", "BEGIN IMMEDIATE", "BEGIN IMMEDIATE", "COMMIT"]);
  });

  it("COMMIT BUSY 只重试 COMMIT，不重跑已产生副作用的 action", async () => {
    const { db, calls } = busyDb({ commitBusy: 2 });
    const repo = new Repository(db);
    let externalSideEffects = 0;

    await expect(repo.withTransaction(async () => {
      externalSideEffects++;
      return "committed";
    })).resolves.toBe("committed");

    expect(externalSideEffects).toBe(1);
    expect(calls).toEqual(["BEGIN IMMEDIATE", "COMMIT", "COMMIT", "COMMIT"]);
    expect(calls).not.toContain("ROLLBACK");
  });

  it("action 自己抛 BUSY 时不得重试整个 action", async () => {
    const { db, calls } = busyDb();
    const repo = new Repository(db);
    let executions = 0;

    await expect(repo.withTransaction(async () => {
      executions++;
      throw new Error("SQLITE_BUSY from action side effect");
    })).rejects.toThrow("SQLITE_BUSY from action side effect");

    expect(executions).toBe(1);
    expect(calls).toEqual(["BEGIN IMMEDIATE", "ROLLBACK"]);
  });
});
