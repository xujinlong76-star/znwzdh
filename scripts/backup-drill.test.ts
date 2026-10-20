/**
 * 备份演练（P4）：把「备份→校验」从口头流程变成 CI 可重复执行的测试。
 *
 * 覆盖两个最容易被误判的点：
 *  1. 服务在线、WAL 里还有未 checkpoint 的提交时，热备必须包含最新数据；
 *  2. 备份文件必须自包含（无 -wal/-shm 残留）且 integrity_check=ok。
 *
 * 用独立临时库 + 子进程跑真实 CLI，不 mock backup()，否则测不到脚本本身。
 */
import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts/backup.mjs");
const storeRequire = createRequire(join(ROOT, "packages/store/package.json"));

type SqliteDb = {
  pragma(sql: string, opts?: Record<string, unknown>): unknown;
  exec(sql: string): void;
  prepare(sql: string): { run(...args: unknown[]): unknown; get(...args: unknown[]): unknown };
  close(): void;
};

const Database = storeRequire("better-sqlite3") as new (path: string, opts?: Record<string, unknown>) => SqliteDb;

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "navhub-backup-"));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function runBackup(dbPath: string, outDir: string): string {
  return execFileSync(process.execPath, [SCRIPT, "--db", dbPath, "--out", outDir, "--no-rotate"], {
    encoding: "utf8",
  });
}

describe("备份演练（scripts/backup.mjs）", () => {
  it("WAL 未 checkpoint 时热备仍包含最新提交，备份自包含且 integrity_check=ok", () => {
    const dir = tempDir();
    const dbPath = join(dir, "navhub.db");
    const outDir = join(dir, "backups");

    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec("CREATE TABLE drill (id INTEGER PRIMARY KEY, note TEXT NOT NULL)");
    const insert = db.prepare("INSERT INTO drill (note) VALUES (?)");
    for (let i = 0; i < 50; i++) insert.run("row-" + i);

    try {
      // 不 close：模拟在线服务，最新提交还在 WAL 里未 checkpoint。
      const output = runBackup(dbPath, outDir);
      expect(output).toContain("integrity_check=ok");

      const files = readdirSync(outDir).filter((f) => f.endsWith(".db"));
      expect(files).toHaveLength(1);
      const backupPath = join(outDir, files[0]!);
      expect(existsSync(backupPath + "-wal")).toBe(false);
      expect(existsSync(backupPath + "-shm")).toBe(false);

      const restored = new Database(backupPath, { readonly: true, fileMustExist: true });
      try {
        expect(restored.pragma("integrity_check", { simple: true })).toBe("ok");
        const row = restored.prepare("SELECT COUNT(*) AS n FROM drill").get() as { n: number };
        expect(row.n).toBe(50);
      } finally {
        restored.close();
      }
    } finally {
      db.close();
    }
  });

  it("源库不存在时退出码 1，并给出可操作提示", () => {
    const dir = tempDir();
    try {
      execFileSync(
        process.execPath,
        [SCRIPT, "--db", join(dir, "missing.db"), "--out", join(dir, "backups"), "--no-rotate"],
        { encoding: "utf8", stdio: "pipe" },
      );
      throw new Error("源库不存在时备份不应成功");
    } catch (err) {
      const e = err as { status?: number; stderr?: string | Buffer };
      expect(e.status).toBe(1);
      expect(String(e.stderr)).toContain("数据库不存在");
    }
  });
});
