import type { Repository } from "../repository.ts";
import { readWithDbGate, writeWithDbGate } from "../db-access.ts";
import type {
  MaintenanceStatus,
} from "./records.ts";

export async function maintenanceCheck(repo: Repository): Promise<MaintenanceStatus> {
  let integrity = "ok";
  let pageCount: number | undefined;
  let pageSize: number | undefined;
  let freePages: number | undefined;

  if (repo.db.dialect === "sqlite" && repo.db.sqlite) {
    const sqlite = repo.db.sqlite;
    try {
      const metrics = await readWithDbGate(repo.db, () => {
        const check = sqlite.prepare("PRAGMA integrity_check(1)").get() as any;
        return {
          integrity: String(check?.["integrity_check"] ?? "ok"),
          pageCount: Number((sqlite.prepare("PRAGMA page_count").get() as any)?.["page_count"] ?? 0),
          pageSize: Number((sqlite.prepare("PRAGMA page_size").get() as any)?.["page_size"] ?? 4096),
          freePages: Number((sqlite.prepare("PRAGMA freelist_count").get() as any)?.["freelist_count"] ?? 0),
        };
      });
      integrity = metrics.integrity;
      pageCount = metrics.pageCount;
      pageSize = metrics.pageSize;
      freePages = metrics.freePages;
    } catch (err) {
      integrity = "error: " + (err instanceof Error ? err.message : String(err));
    }
  } else if (repo.db.dialect === "pg" && repo.db.pg) {
    try {
      const res = await repo.raw("SELECT 1 AS ok", []);
      integrity = res[0]?.ok === 1 ? "ok" : "unknown";
    } catch (err) {
      integrity = "error: " + (err instanceof Error ? err.message : String(err));
    }
  }

  const storage = await repo.dbStorageMetrics();

  return {
    ok: integrity === "ok",
    dialect: repo.db.dialect,
    integrity,
    dbSizeBytes: storage.dbSizeBytes,
    pageCount,
    pageSize,
    freePages,
    tableCounts: storage.tableCounts,
  };
}

async function execSqlite(sqlite: NonNullable<Repository["db"]["sqlite"]>, sql: string): Promise<void> {
  const maybe = sqlite.exec(sql);
  if (maybe && typeof (maybe as Promise<unknown>).then === "function") await maybe;
}

/** 在共享写门禁内执行维护；FTS optimize 再包一层独立事务。 */
async function withSqliteMaintenance<T>(
  repo: Repository,
  action: () => T | Promise<T>,
  independentTransaction = false,
): Promise<T> {
  const sqlite = repo.db.sqlite!;
  return writeWithDbGate(repo.db, async () => {
    // txContext 只覆盖 Repository 开启的事务；直接 BEGIN 的连接同样必须 fail-closed。
    if ((sqlite as unknown as { inTransaction?: boolean }).inTransaction === true) {
      throw new Error("SQLite 维护写操作不能在其他事务内执行");
    }
    if (!independentTransaction) return action();

    await execSqlite(sqlite, "BEGIN IMMEDIATE");
    try {
      const result = await action();
      await execSqlite(sqlite, "COMMIT");
      return result;
    } catch (err) {
      try { await execSqlite(sqlite, "ROLLBACK"); } catch { /* preserve maintenance error */ }
      throw err;
    }
  });
}

export async function vacuumDatabase(repo: Repository): Promise<{ ok: boolean; tookMs: number; message: string }> {
  const t0 = Date.now();
  try {
    if (repo.db.dialect === "sqlite" && repo.db.sqlite) {
      await withSqliteMaintenance(repo, () => execSqlite(repo.db.sqlite!, "VACUUM"));
      return { ok: true, tookMs: Date.now() - t0, message: "SQLite VACUUM 整理完毕，已回收物理碎片" };
    } else if (repo.db.dialect === "pg" && repo.db.pg) {
      await repo.db.pg.query("ANALYZE");
      return { ok: true, tookMs: Date.now() - t0, message: "PostgreSQL ANALYZE 完成" };
    }
    return { ok: true, tookMs: Date.now() - t0, message: "无需整理" };
  } catch (err) {
    return { ok: false, tookMs: Date.now() - t0, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function optimizeFts(repo: Repository): Promise<{ ok: boolean; tookMs: number; skipped?: boolean }> {
  const t0 = Date.now();
  if (repo.db.dialect === "sqlite" && repo.db.sqlite) {
    const sqlite = repo.db.sqlite;
    try {
      return await withSqliteMaintenance(repo, async () => {
        const hasFts = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sites_fts'").get();
        if (!hasFts) return { ok: true, tookMs: Date.now() - t0, skipped: true };
        await execSqlite(sqlite, "INSERT INTO sites_fts(sites_fts) VALUES('optimize')");
        return { ok: true, tookMs: Date.now() - t0 };
      }, true);
    } catch {
      return { ok: false, tookMs: Date.now() - t0 };
    }
  }
  return { ok: true, tookMs: Date.now() - t0 };
}

export async function checkpointWal(repo: Repository, mode: "passive" | "full" | "restart" | "truncate" = "passive"): Promise<{ ok: boolean; tookMs: number; logSize?: number }> {
  const t0 = Date.now();
  if (repo.db.dialect === "sqlite" && repo.db.sqlite) {
    const sqlite = repo.db.sqlite;
    try {
      const upper = mode.toUpperCase();
      const res = await withSqliteMaintenance(repo, () =>
        sqlite.prepare("PRAGMA wal_checkpoint(" + upper + ")").get() as any,
      );
      return {
        ok: true,
        tookMs: Date.now() - t0,
        logSize: Number(res?.["log"] ?? 0),
      };
    } catch {
      return { ok: false, tookMs: Date.now() - t0 };
    }
  }
  return { ok: true, tookMs: Date.now() - t0 };
}
