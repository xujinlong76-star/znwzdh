import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Repository, type Db } from "../src/index.ts";

let dir: string;
let databases: Database.Database[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "navhub-runner-lease-"));
  databases = [];
});

afterEach(() => {
  for (const db of databases) {
    try { db.close(); } catch { /* 测试清理尽力而为 */ }
  }
  rmSync(dir, { recursive: true, force: true });
});

function repositoryFor(file: string): Repository {
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  databases.push(sqlite);
  const db: Db = {
    dialect: "sqlite",
    orm: {},
    sqlite,
    close: async () => { sqlite.close(); },
  };
  return new Repository(db);
}

describe("SQLite JobRunner 独立租约", () => {
  it("同一数据库的不同实例共享租约，过期接管后旧持有者不能续期或误删新锁", async () => {
    const file = join(dir, "shared.db");
    const first = repositoryFor(file);
    const second = repositoryFor(file);

    expect(await first.acquireJobRunnerLease("first", 100, 1_000)).toBe(true);
    expect(await second.acquireJobRunnerLease("second", 100, 1_100)).toBe(false);
    expect(await second.acquireJobRunnerLease("second", 100, 1_101)).toBe(true);

    expect(await first.renewJobRunnerLease("first", 1_200)).toBe(0);
    await first.releaseJobRunnerLease("first");
    expect(await second.getJobRunnerLease()).toEqual({ holder: "second", createdAt: 1_101 });
    await second.releaseJobRunnerLease("second");
    expect(await second.getJobRunnerLease()).toBeNull();
  });

  it("主库 BEGIN IMMEDIATE 长事务不会阻塞 sidecar 续期", async () => {
    const repo = repositoryFor(join(dir, "main.db"));
    repo.db.sqlite!.exec("CREATE TABLE idempotency (key TEXT PRIMARY KEY, response TEXT, created_at INTEGER NOT NULL)");
    expect(await repo.acquireJobRunnerLease("holder", 120_000, Date.now() - 1_000)).toBe(true);

    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const tx = repo.withTransaction(async () => {
      started();
      await gate;
    });
    await entered;

    try {
      const renewed = await Promise.race([
        repo.renewJobRunnerLease("holder").then((count) => count),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("续期被主库事务阻塞")), 500)),
      ]);
      expect(renewed).toBe(1);
      expect((await repo.getJobRunnerLease())?.createdAt).toBeGreaterThan(Date.now() - 1_000);
    } finally {
      release();
      await tx;
      await repo.releaseJobRunnerLease("holder");
    }
  });
});
