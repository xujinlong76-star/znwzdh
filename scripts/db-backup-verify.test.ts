/**
 * 备份可恢复性校验（scripts/db-backup-verify.mjs）的回归测试。
 *
 * 覆盖那些「只看 exit code 看不出问题」的判据：
 *   - 健康备份必须报告 integrity=ok、自包含、行数可读；
 *   - 缺核心表 / 带 -wal 附属文件 / 过期备份必须失败并指名原因；
 *   - --baseline 只输出差值，不改变结论；
 *   - 新鲜度阈值可以被显式关闭。
 *
 * 全部使用临时目录里的临时库，不触碰 data/。
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts/db-backup-verify.mjs");
const storeRequire = createRequire(join(ROOT, "packages/store/package.json"));

type SqliteDb = { exec(sql: string): void; prepare(sql: string): { run(...args: unknown[]): unknown }; close(): void };
const Database = storeRequire("better-sqlite3") as new (path: string) => SqliteDb;

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "navhub-backup-verify-"));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** 造一份「结构像导航库」的最小备份：核心表齐全，可按需跳过某张表来模拟残缺 */
function createNavDb(file: string, opts: { sites?: number; skip?: string[] } = {}): void {
  const skip = new Set(opts.skip ?? []);
  const db = new Database(file);
  const ddl: Record<string, string> = {
    categories: "CREATE TABLE categories (id TEXT PRIMARY KEY, anchor TEXT NOT NULL, title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
    sites: "CREATE TABLE sites (id TEXT PRIMARY KEY, url TEXT NOT NULL, title TEXT NOT NULL, category_id TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
    tags: "CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL, created_at INTEGER NOT NULL)",
    site_tags: "CREATE TABLE site_tags (site_id TEXT NOT NULL, tag_id TEXT NOT NULL)",
    events: "CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, created_at INTEGER NOT NULL)",
    llm_usage: "CREATE TABLE llm_usage (id TEXT PRIMARY KEY, scenario TEXT NOT NULL, source TEXT NOT NULL, model TEXT NOT NULL, ok INTEGER NOT NULL, created_at INTEGER NOT NULL)",
    system_states: "CREATE TABLE system_states (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)",
  };
  for (const [table, sql] of Object.entries(ddl)) {
    if (!skip.has(table)) db.exec(sql);
  }
  const now = Date.now();
  if (!skip.has("categories")) {
    db.prepare("INSERT INTO categories (id, anchor, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("c1", "tools", "工具", now, now);
  }
  if (!skip.has("sites")) {
    const insertSite = db.prepare("INSERT INTO sites (id, url, title, category_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
    for (let i = 0; i < (opts.sites ?? 3); i += 1) {
      insertSite.run(`s${i}`, `https://example.com/${i}`, `站点 ${i}`, "c1", now, now);
    }
  }
  if (!skip.has("tags")) {
    db.prepare("INSERT INTO tags (id, name, slug, created_at) VALUES (?, ?, ?, ?)").run("t1", "效率", "efficiency", now);
  }
  if (!skip.has("site_tags")) {
    db.prepare("INSERT INTO site_tags (site_id, tag_id) VALUES (?, ?)").run("s0", "t1");
  }
  if (!skip.has("events")) {
    db.prepare("INSERT INTO events (kind, created_at) VALUES (?, ?)").run("view", now);
  }
  if (!skip.has("llm_usage")) {
    db.prepare("INSERT INTO llm_usage (id, scenario, source, model, ok, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("u1", "search", "system", "m", 1, now);
  }
  if (!skip.has("system_states")) {
    db.prepare("INSERT INTO system_states (key, value, updated_at) VALUES (?, ?, ?)").run("k", "v", now);
  }
  db.close();
}

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const backupName = "navhub-2026-10-27_00-00-00.db";

describe("备份可恢复性校验（scripts/db-backup-verify.mjs）", () => {
  it("健康备份：--json 报告 integrity=ok、自包含、核心表行数", () => {
    const dir = tempDir();
    const file = join(dir, backupName);
    createNavDb(file, { sites: 4 });

    const r = run(["--file", file, "--json"]);
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as {
      ok: boolean;
      checks: { integrity: string; selfContained: boolean; fresh: boolean; requiredTables: string };
      counts: Record<string, number | null>;
    };
    expect(out.ok).toBe(true);
    expect(out.checks.integrity).toBe("ok");
    expect(out.checks.selfContained).toBe(true);
    expect(out.checks.fresh).toBe(true);
    expect(out.checks.requiredTables).toBe("7/7");
    expect(out.counts.sites).toBe(4);
    expect(out.counts.events).toBe(1);
  });

  it("缺少核心表：失败并指名 llm_usage", () => {
    const dir = tempDir();
    const file = join(dir, backupName);
    createNavDb(file, { skip: ["llm_usage"] });

    const r = run(["--file", file]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("缺少必需表");
    expect(r.stderr).toContain("llm_usage");
  });

  it("存在 -wal 附属文件：判为不自包含（单文件恢复会丢最新提交）", () => {
    const dir = tempDir();
    const file = join(dir, backupName);
    createNavDb(file);
    writeFileSync(file + "-wal", "");

    const r = run(["--file", file]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("不自包含");
  });

  it("过期备份默认失败，--max-age-hours 0 可显式关闭新鲜度判据", () => {
    const dir = tempDir();
    const file = join(dir, backupName);
    createNavDb(file);
    const old = new Date(Date.now() - 48 * 3_600_000);
    utimesSync(file, old, old);

    const stale = run(["--file", file]);
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain("48 小时未更新");

    const disabled = run(["--file", file, "--max-age-hours", "0"]);
    expect(disabled.status, disabled.stderr).toBe(0);
    expect(disabled.stdout).toContain("[verify] 通过");
  });

  it("--baseline 只输出行数差值，备份更旧也不判失败", () => {
    const dir = tempDir();
    const backupFile = join(dir, backupName);
    const baselineFile = join(dir, "live.db");
    createNavDb(backupFile, { sites: 3 });
    createNavDb(baselineFile, { sites: 5 });

    const r = run(["--file", backupFile, "--baseline", baselineFile, "--json"]);
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as { ok: boolean; baseline: { deltas: Record<string, number> } };
    expect(out.ok).toBe(true);
    expect(out.baseline.deltas.sites).toBe(-2);
  });

  it("文件不存在：退出码 1 并给出路径", () => {
    const dir = tempDir();
    const r = run(["--file", join(dir, "missing.db")]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("备份文件不存在");
    expect(r.stderr).toContain("missing.db");
  });
});
