import type { Repository } from "../repository.ts";
import type {
  MaintenanceStatus,
} from "./records.ts";

export async function maintenanceCheck(repo: Repository): Promise<MaintenanceStatus> {
  let integrity = "ok";
  let pageCount: number | undefined;
  let pageSize: number | undefined;
  let freePages: number | undefined;

  if (repo.db.dialect === "sqlite" && repo.db.sqlite) {
    try {
      const check = repo.db.sqlite.prepare("PRAGMA integrity_check(1)").get() as any;
      integrity = String(check?.["integrity_check"] ?? "ok");
      pageCount = Number((repo.db.sqlite.prepare("PRAGMA page_count").get() as any)?.["page_count"] ?? 0);
      pageSize = Number((repo.db.sqlite.prepare("PRAGMA page_size").get() as any)?.["page_size"] ?? 4096);
      freePages = Number((repo.db.sqlite.prepare("PRAGMA freelist_count").get() as any)?.["freelist_count"] ?? 0);
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

export async function vacuumDatabase(repo: Repository): Promise<{ ok: boolean; tookMs: number; message: string }> {
  const t0 = Date.now();
  try {
    if (repo.db.dialect === "sqlite" && repo.db.sqlite) {
      repo.db.sqlite.exec("VACUUM");
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
    try {
      const hasFts = repo.db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sites_fts'").get();
      if (!hasFts) {
        return { ok: true, tookMs: Date.now() - t0, skipped: true };
      }
      repo.db.sqlite.exec("INSERT INTO sites_fts(sites_fts) VALUES('optimize')");
      return { ok: true, tookMs: Date.now() - t0 };
    } catch {
      return { ok: false, tookMs: Date.now() - t0 };
    }
  }
  return { ok: true, tookMs: Date.now() - t0 };
}

export async function checkpointWal(repo: Repository, mode: "passive" | "full" | "restart" | "truncate" = "passive"): Promise<{ ok: boolean; tookMs: number; logSize?: number }> {
  const t0 = Date.now();
  if (repo.db.dialect === "sqlite" && repo.db.sqlite) {
    try {
      const upper = mode.toUpperCase();
      const res = repo.db.sqlite.prepare("PRAGMA wal_checkpoint(" + upper + ")").get() as any;
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
