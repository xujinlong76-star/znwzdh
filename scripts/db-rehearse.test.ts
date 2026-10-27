/**
 * 恢复演练（scripts/db-rehearse.mjs）的回归测试。
 *
 * 演练的价值在「迁移真跑过、幂等真成立」，所以测试用真实子进程跑迁移，
 * 而不是断言文案：
 *   - 旧库缺列 → 第一次迁移必须检测到补列，第二次 schema 必须一字不变；
 *   - 已最新库 → 两轮都无 schema 变化，且临时副本默认被清理；
 *   - 源库在演练期间一个字节都不能变（readonly + backup() 的承诺）；
 *   - 源库不存在 → 退出码 1。
 *
 * 全部使用临时目录里的临时库，不触碰 data/。
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts/db-rehearse.mjs");
const MIGRATE = join(ROOT, "apps/api/src/migrate.ts");
const storeRequire = createRequire(join(ROOT, "packages/store/package.json"));

type SqliteDb = { exec(sql: string): void; prepare(sql: string): { run(...args: unknown[]): unknown }; close(): void };
const Database = storeRequire("better-sqlite3") as new (path: string) => SqliteDb;

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "navhub-rehearse-test-"));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function migrateEnv(dbPath: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NAVHUB_MODE: "lite",
    NAVHUB_SQLITE_PATH: dbPath,
    NAVHUB_EMBEDDING_ENABLED: "0",
    NAVHUB_WORKER_EMBEDDING: "0",
    NAVHUB_JOBS_ENABLED: "0",
  };
  delete env.NAVHUB_DATABASE_URL;
  return env;
}

/** 用生产同款迁移入口建一份「当前 schema」的库 */
function createMigratedDb(dbPath: string): void {
  const r = spawnSync(process.execPath, [MIGRATE], { cwd: ROOT, env: migrateEnv(dbPath), encoding: "utf8" });
  expect(r.status, `建库失败: ${r.stderr || r.stdout}`).toBe(0);
}

function runRehearse(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

type RehearseOutput = {
  ok: boolean;
  copy: string;
  migrations: Array<{ round: number; status: number; addedTables: string[]; addedColumns: string[] }>;
  schemaAdded: { tables: string[]; columns: string[] };
  secondRunIdempotent: boolean;
  countsBefore: Record<string, number | null>;
  countsAfter: Record<string, number | null>;
  checks: { integrity: string; foreignKeys: number; sourceUntouched: boolean };
  failures: string[];
};

describe("恢复演练（scripts/db-rehearse.mjs）", () => {
  it("旧库缺列：第一次迁移补齐、第二次幂等，且源库字节不变", { timeout: 120_000 }, () => {
    const dir = tempDir();
    const dbPath = join(dir, "live.db");
    createMigratedDb(dbPath);

    // 模拟旧版本库：删掉一个后加的列，并写入数据证明迁移不动行
    const seed = new Database(dbPath);
    seed.exec("ALTER TABLE categories DROP COLUMN source");
    const now = Date.now();
    seed.prepare("INSERT INTO categories (id, anchor, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("c1", "tools", "工具", now, now);
    seed
      .prepare("INSERT INTO sites (id, url, title, category_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("s1", "https://example.com", "示例", "c1", now, now);
    seed.close();

    const bytesBefore = readFileSync(dbPath);
    const r = runRehearse(["--db", dbPath, "--json"]);
    expect(r.status, r.stderr).toBe(0);

    const out = JSON.parse(r.stdout) as RehearseOutput;
    expect(out.ok).toBe(true);
    expect(out.migrations).toHaveLength(2);
    expect(out.migrations[0]!.addedColumns).toContain("categories.source");
    expect(out.migrations[1]!.addedColumns).toEqual([]);
    expect(out.migrations[1]!.addedTables).toEqual([]);
    expect(out.secondRunIdempotent).toBe(true);
    expect(out.countsAfter.categories).toBe(1);
    expect(out.countsAfter.sites).toBe(1);
    expect(out.checks.integrity).toBe("ok");
    expect(out.checks.foreignKeys).toBe(0);
    expect(out.checks.sourceUntouched).toBe(true);
    // 演练必须只读源库：主文件一个字节都不该变
    expect(readFileSync(dbPath).equals(bytesBefore)).toBe(true);
    // 默认清理临时副本
    expect(existsSync(out.copy)).toBe(false);
  });

  it("已最新的库：两轮都无 schema 变化，仍判定幂等", { timeout: 120_000 }, () => {
    const dir = tempDir();
    const dbPath = join(dir, "live.db");
    createMigratedDb(dbPath);

    const r = runRehearse(["--db", dbPath, "--json"]);
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as RehearseOutput;
    expect(out.ok).toBe(true);
    expect(out.schemaAdded).toEqual({ tables: [], columns: [] });
    expect(out.migrations.every((m) => m.addedColumns.length === 0)).toBe(true);
    expect(out.secondRunIdempotent).toBe(true);
  });

  it("源库不存在：退出码 1 并给出路径", () => {
    const dir = tempDir();
    const r = runRehearse(["--db", join(dir, "missing.db")]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("数据库不存在");
    expect(r.stderr).toContain("missing.db");
  });
});
