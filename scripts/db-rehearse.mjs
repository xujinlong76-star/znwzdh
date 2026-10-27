#!/usr/bin/env node
/**
 * 恢复演练（数据生命周期 D6）：拿线上库的热备副本，在临时目录里真实走一遍
 * 「恢复 → 连续迁移两次 → 完整性与行数校验」，证明备份不只是「能打开」，而是能顶上去。
 *
 * 三条硬约束：
 *   - 源库只以 readonly 打开，只用于 better-sqlite3 backup() 生成副本；
 *     迁移跑在 os.tmpdir() 里的一次性副本上，**绝不写生产文件**（结束前对比源库大小/mtime）。
 *   - 迁移连跑两次，并**对比真实 schema 快照**判定幂等：第二次不得再增删任何
 *     表/列。不能只看 CLI 的「已添加列」输出——迁移实际发生在 openDb 里，
 *     显式那次 migrateColumns 只负责汇报，旧库上它也会打印「已是最新」。
 *     幂等性是可重放部署的前提，靠输出文案判定会得到假绿。
 *   - 迁移前后 integrity_check / foreign_key_check 必须干净，核心表行数不得回退。
 *
 * 默认清理临时目录；--keep 保留供人工排查。退出码：0 通过；1 失败。
 *
 * 用法：
 *   node scripts/db-rehearse.mjs [--db <path>] [--keep] [--json]
 * 未给 --db 时按 backup.mjs 的同一顺序解析：NAVHUB_SQLITE_PATH > NAVHUB_DB_PATH > data/navhub.db。
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATE = path.join(ROOT, "apps/api/src/migrate.ts");
const storeRequire = createRequire(path.join(ROOT, "packages/store/package.json"));

/** 与 db-backup-verify.mjs 保持同一份核心表清单 */
const CORE_TABLES = ["categories", "sites", "tags", "site_tags", "events", "llm_usage", "system_states"];

function parseArgs(argv) {
  const args = { db: null, keep: false, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--db") args.db = argv[++i];
    else if (a === "--keep") args.keep = true;
    else if (a === "--json") args.json = true;
    else if (a === "--help" || a === "-h") {
      console.log("用法: node scripts/db-rehearse.mjs [--db <path>] [--keep] [--json]");
      console.log("  --db     源库路径（默认 NAVHUB_SQLITE_PATH > NAVHUB_DB_PATH > data/navhub.db）");
      console.log("  --keep   保留临时副本目录，便于人工排查");
      process.exit(0);
    } else {
      console.error(`未知参数: ${a}（--help 查看用法）`);
      process.exit(1);
    }
  }
  return args;
}

const args = parseArgs(process.argv);
const dbPath = path.resolve(
  ROOT,
  args.db ?? process.env.NAVHUB_SQLITE_PATH ?? process.env.NAVHUB_DB_PATH ?? "data/navhub.db",
);

let Database;
let sqliteVec = null;
try {
  Database = storeRequire("better-sqlite3");
  // 真实库里可能有 vec0 虚拟表：不加载扩展时连 PRAGMA table_info 都会抛
  // "no such module: vec0"，schema 快照就会漏表。加载失败不致命（快照会跳过该表）。
  try {
    sqliteVec = storeRequire("sqlite-vec");
  } catch {
    // 未安装扩展：纯 SQLite 库仍可演练
  }
} catch (err) {
  console.error("无法加载 better-sqlite3（请先在仓库根执行 pnpm install）:", err.message);
  process.exit(1);
}

const failures = [];
const fail = (msg) => failures.push(msg);
const result = {
  ok: false,
  source: dbPath,
  copy: null,
  tempKept: args.keep,
  migrations: [],
  schemaAdded: { tables: [], columns: [] },
  secondRunIdempotent: null,
  countsBefore: {},
  countsAfter: {},
  checks: { integrity: null, foreignKeys: null, sourceUntouched: null },
  failures,
};

function countAll(db) {
  const counts = {};
  for (const table of CORE_TABLES) {
    try {
      counts[table] = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    } catch {
      counts[table] = null;
    }
  }
  return counts;
}

/** 只读打开副本；能加载 sqlite-vec 时一并加载，保证 vec0 虚拟表可被快照到 */
function openReadonly(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    sqliteVec?.load(db);
  } catch {
    // 扩展与 SQLite 版本不匹配：退化为跳过虚拟表
  }
  return db;
}

/** 表 -> 排序列名；迁移的净效果必须能用它逐字对比出来 */
function snapshotSchema(db) {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => r.name)
    .sort();
  const snapshot = {};
  for (const table of tables) {
    try {
      snapshot[table] = db
        .prepare(`PRAGMA table_info("${table}")`)
        .all()
        .map((r) => r.name)
        .sort();
    } catch {
      // 缺少虚拟表模块：记为不可描述，仍参与「表是否存在」的比较
      snapshot[table] = null;
    }
  }
  return snapshot;
}

function diffSchema(before, after) {
  const addedTables = Object.keys(after).filter((t) => !(t in before));
  const addedColumns = [];
  const droppedColumns = [];
  for (const table of Object.keys(after)) {
    if (!(table in before)) continue;
    if (!Array.isArray(before[table]) || !Array.isArray(after[table])) continue;
    for (const column of after[table]) {
      if (!before[table].includes(column)) addedColumns.push(`${table}.${column}`);
    }
    for (const column of before[table]) {
      if (!after[table].includes(column)) droppedColumns.push(`${table}.${column}`);
    }
  }
  return { addedTables, addedColumns, droppedColumns };
}

function sameSchema(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function checkIntegrity(db, label) {
  const integrity = db.pragma("integrity_check", { simple: true });
  if (integrity !== "ok") fail(`${label} integrity_check 未通过: ${integrity}`);
  const fkViolations = db.pragma("foreign_key_check");
  const fkCount = Array.isArray(fkViolations) ? fkViolations.length : 0;
  if (fkCount > 0) fail(`${label} foreign_key_check 发现 ${fkCount} 处悬空引用`);
  return { integrity, fkCount };
}

function runMigrate(copyPath) {
  // 环境收紧：强制 lite + 临时库；关掉 embedding（避免模型下载）与任务开关。
  const env = {
    ...process.env,
    NAVHUB_MODE: "lite",
    NAVHUB_SQLITE_PATH: copyPath,
    NAVHUB_EMBEDDING_ENABLED: "0",
    NAVHUB_WORKER_EMBEDDING: "0",
    NAVHUB_JOBS_ENABLED: "0",
  };
  delete env.NAVHUB_DATABASE_URL;
  const r = spawnSync(process.execPath, [MIGRATE], { cwd: ROOT, env, encoding: "utf8", timeout: 180_000 });
  if (r.error) return { status: null, stdout: "", stderr: String(r.error.message) };
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** 用一个短命只读连接读 schema，避免长期持有文件句柄影响后续迁移/清理（Windows） */
function readSchema(copyPath) {
  const db = openReadonly(copyPath);
  try {
    return snapshotSchema(db);
  } finally {
    db.close();
  }
}

let tmpDir = null;
let schemaBefore = null;
const sourceStatBefore = existsSync(dbPath) ? statSync(dbPath) : null;
try {
  if (!sourceStatBefore) {
    fail(`数据库不存在: ${dbPath}`);
    throw new Error("missing");
  }

  tmpDir = mkdtempSync(path.join(os.tmpdir(), "navhub-rehearse-"));
  const copyPath = path.join(tmpDir, "navhub.db");
  result.copy = copyPath;

  // 1) 只读源库 + 在线备份 API 生成副本（WAL 中已提交事务一并包含）
  let src;
  try {
    src = new Database(dbPath, { readonly: true, fileMustExist: true });
    await src.backup(copyPath);
  } catch (err) {
    fail(`生成热备副本失败: ${err.message}`);
  } finally {
    src?.close();
  }

  if (failures.length === 0) {
    // 2) 迁移前基线：完整性 + 行数 + schema 快照
    let copyDb;
    try {
      copyDb = openReadonly(copyPath);
      const { integrity, fkCount } = checkIntegrity(copyDb, "迁移前");
      result.checks.integrity = integrity;
      result.checks.foreignKeys = fkCount;
      result.countsBefore = countAll(copyDb);
      schemaBefore = snapshotSchema(copyDb);
    } catch (err) {
      fail(`副本无法只读打开: ${err.message}`);
    } finally {
      copyDb?.close();
    }
  }

  if (failures.length === 0) {
    // 3) 连续迁移两次，用真实 schema 快照判定第一次补了什么、第二次是否幂等
    let prevSchema = schemaBefore;
    for (const round of [1, 2]) {
      const run = runMigrate(copyPath);
      const entry = { round, status: run.status, addedTables: [], addedColumns: [], droppedColumns: [] };
      result.migrations.push(entry);
      if (run.status !== 0) {
        const detail = (run.stderr || run.stdout).trim().split(/\r?\n/).slice(-3).join(" | ");
        fail(`第 ${round} 次迁移退出码 ${run.status}: ${detail}`);
        break;
      }
      const schemaNow = readSchema(copyPath);
      const diff = diffSchema(prevSchema, schemaNow);
      entry.addedTables = diff.addedTables;
      entry.addedColumns = diff.addedColumns;
      entry.droppedColumns = diff.droppedColumns;
      if (diff.droppedColumns.length > 0) {
        fail(`第 ${round} 次迁移删除了列: ${diff.droppedColumns.join(", ")}`);
      }
      if (round === 1) result.schemaAdded = { tables: diff.addedTables, columns: diff.addedColumns };
      if (round === 2) {
        result.secondRunIdempotent = sameSchema(prevSchema, schemaNow);
        if (!result.secondRunIdempotent) {
          fail("第二次迁移仍在改 schema（表/列与第一次后不一致），迁移不幂等");
        }
      }
      prevSchema = schemaNow;
    }

    // 4) 迁移后校验：完整性 + 核心表齐全 + 行数不回退
    let afterDb;
    try {
      afterDb = openReadonly(copyPath);
      const { integrity, fkCount } = checkIntegrity(afterDb, "迁移后");
      result.checks.integrity = integrity;
      result.checks.foreignKeys = fkCount;
      result.countsAfter = countAll(afterDb);
      for (const table of CORE_TABLES) {
        const before = result.countsBefore[table];
        const after = result.countsAfter[table];
        if (after === null) fail(`迁移后核心表 ${table} 不可读`);
        else if (typeof before === "number" && after < before) {
          fail(`迁移后 ${table} 行数回退（${before} → ${after}）`);
        }
      }
    } catch (err) {
      fail(`迁移后副本无法打开: ${err.message}`);
    } finally {
      afterDb?.close();
    }
  }

  // 5) 源库必须原封不动（readonly + backup() 不应产生任何写入）
  const sourceStatAfter = existsSync(dbPath) ? statSync(dbPath) : null;
  result.checks.sourceUntouched =
    Boolean(sourceStatAfter) &&
    sourceStatAfter.size === sourceStatBefore.size &&
    sourceStatAfter.mtimeMs === sourceStatBefore.mtimeMs;
  if (!result.checks.sourceUntouched) fail("源库在演练期间被修改（大小或 mtime 变化）");
} catch {
  // 失败原因已记录
} finally {
  if (tmpDir && !args.keep) {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch (err) {
      console.error(`[rehearse] 临时目录清理失败（可手动删除）: ${err.message}`);
    }
  }
}

result.ok = failures.length === 0;

if (args.json) {
  console.log(JSON.stringify(result));
} else {
  console.log(`[rehearse] 源库 ${dbPath}`);
  if (result.copy && args.keep) console.log(`[rehearse] 临时副本保留在 ${result.copy}`);
  for (const m of result.migrations) {
    const changes = [
      m.addedTables.length > 0 ? `新增表 ${m.addedTables.join(", ")}` : "",
      m.addedColumns.length > 0 ? `补齐列 ${m.addedColumns.join(", ")}` : "",
    ].filter(Boolean);
    const detail = changes.length > 0 ? changes.join("；") : "schema 无变化";
    console.log(`[rehearse] 第 ${m.round} 次迁移：退出码 ${m.status}，${detail}`);
  }
  if (result.secondRunIdempotent !== null) {
    console.log(`[rehearse] 幂等性：${result.secondRunIdempotent ? "通过（第二次未再改 schema）" : "失败"}`);
  }
  if (result.checks.integrity) {
    console.log(`[rehearse] integrity_check=${result.checks.integrity}，foreign_key_check ${result.checks.foreignKeys} 处违例`);
  }
  if (Object.keys(result.countsAfter).length > 0) {
    const counts = CORE_TABLES.map((t) => `${t}=${result.countsAfter[t] ?? "?"}`).join(" ");
    console.log(`[rehearse] 迁移后行数：${counts}`);
  }
  if (result.checks.sourceUntouched !== null) {
    console.log(`[rehearse] 源库未被修改：${result.checks.sourceUntouched ? "是" : "否"}`);
  }
  if (result.ok) {
    console.log("[rehearse] 通过");
  } else {
    for (const f of failures) console.error(`[rehearse] 失败: ${f}`);
  }
}

process.exit(result.ok ? 0 : 1);
