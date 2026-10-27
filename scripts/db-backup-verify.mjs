#!/usr/bin/env node
/**
 * 备份可恢复性校验（数据生命周期 D6，配合 scripts/backup.mjs）。
 *
 * 为什么需要它：backup.mjs 在写完后会跑一次 integrity_check，但那只能证明
 * 「刚写完那一刻」是好的。备份在磁盘上躺数周后是否还能打开、是否被截断、
 * 附属文件是否还在、是否早已滑出保留窗口——这些只有到恢复当天才发现就太晚了。
 * 本脚本把「这份备份能不能用」变成一条可 cron 化、可 CI 化的只读检查：
 *   - integrity_check / foreign_key_check：文件级损坏与悬空引用
 *   - 自包含：旁边不得有 -wal/-shm（单文件拷贝会漏掉它们，恢复出的数据会旧一截）
 *   - 必需表存在且可读：空库 / 半截传输在这里暴露
 *   - 新鲜度：默认 26 小时（--max-age-hours 0 关闭），过期备份不算通过
 *   - 可选 --baseline：对照线上库只输出行数差值，供人工判断新鲜度（不作判据）
 *
 * 全程只读打开，不做任何写入。退出码：0 通过；1 失败。
 *
 * 用法：
 *   node scripts/db-backup-verify.mjs [--file <path>] [--baseline <path>]
 *                                     [--max-age-hours <n>] [--json]
 * 未给 --file 时取 data/backups/ 下最新一份 navhub-*.db。
 */
import { createRequire } from "node:module";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const storeRequire = createRequire(path.join(ROOT, "packages/store/package.json"));

/** 导航核心面必需的表：缺任何一张都意味着这份备份恢复后站点/检索/统计是残的 */
const REQUIRED_TABLES = ["categories", "sites", "tags", "site_tags", "events", "llm_usage", "system_states"];
/** 对外报告行数的表（与 REQUIRED_TABLES 对齐，便于 --baseline 直接比值） */
const COUNT_TABLES = REQUIRED_TABLES;

function parseArgs(argv) {
  const args = { file: null, baseline: null, maxAgeHours: 26, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") args.file = argv[++i];
    else if (a === "--baseline") args.baseline = argv[++i];
    else if (a === "--max-age-hours") args.maxAgeHours = Math.max(0, Number(argv[++i]) || 0);
    else if (a === "--json") args.json = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        "用法: node scripts/db-backup-verify.mjs [--file <path>] [--baseline <path>] [--max-age-hours <n>] [--json]",
      );
      console.log("  --file           要校验的备份文件（默认 data/backups 下最新一份 navhub-*.db）");
      console.log("  --baseline       对照库（通常是在线库），仅输出行数差值，不作判据");
      console.log("  --max-age-hours  新鲜度上限，默认 26；传 0 关闭");
      process.exit(0);
    } else {
      console.error(`未知参数: ${a}（--help 查看用法）`);
      process.exit(1);
    }
  }
  return args;
}

function newestBackup(dir) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => /^navhub-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.db$/.test(f))
    .map((f) => ({ f, mtime: statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files.length > 0 ? path.join(dir, files[0].f) : null;
}

const args = parseArgs(process.argv);

let Database;
try {
  Database = storeRequire("better-sqlite3");
} catch (err) {
  console.error("无法加载 better-sqlite3（请先在仓库根执行 pnpm install）:", err.message);
  process.exit(1);
}

const resolved = args.file ?? newestBackup(path.join(ROOT, "data/backups"));
const file = resolved ? path.resolve(ROOT, resolved) : "";
const failures = [];
const fail = (msg) => failures.push(msg);

const result = {
  ok: false,
  file,
  sizeBytes: 0,
  ageHours: null,
  checks: { integrity: null, foreignKeys: null, selfContained: null, requiredTables: null, fresh: null },
  counts: {},
  baseline: null,
  failures,
};

function countAll(db) {
  const counts = {};
  for (const table of COUNT_TABLES) {
    try {
      counts[table] = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    } catch (err) {
      counts[table] = null;
      fail(`表 ${table} 不可读: ${err.message}`);
    }
  }
  return counts;
}

try {
  if (!existsSync(file)) {
    fail(`备份文件不存在: ${file || "(data/backups 下没有 navhub-*.db)"}`);
    throw new Error("missing");
  }

  const stat = statSync(file);
  result.sizeBytes = stat.size;
  result.ageHours = Math.round(((Date.now() - stat.mtimeMs) / 3_600_000) * 10) / 10;

  // 自包含：备份脚本会在校验后删掉 -wal/-shm；它们还在 = 主文件可能缺最新提交，
  // 只拷 .db 恢复会静默丢数据。先查附属文件再打开，避免打开行为干扰判断。
  const sidecars = ["-wal", "-shm"].filter((s) => existsSync(file + s));
  result.checks.selfContained = sidecars.length === 0 && stat.size > 0;
  if (sidecars.length > 0) fail(`备份不自包含：存在 ${sidecars.map((s) => "…" + s).join(" / ")}`);
  if (stat.size === 0) fail("备份文件为空");

  if (args.maxAgeHours > 0 && result.ageHours > args.maxAgeHours) {
    result.checks.fresh = false;
    fail(`备份已 ${result.ageHours} 小时未更新（上限 ${args.maxAgeHours} 小时）`);
  } else {
    result.checks.fresh = true;
  }

  if (failures.length === 0) {
    let db;
    try {
      db = new Database(file, { readonly: true, fileMustExist: true });
    } catch (err) {
      fail(`备份无法以只读方式打开: ${err.message}`);
    }
    if (db) {
      try {
        const integrity = db.pragma("integrity_check", { simple: true });
        result.checks.integrity = integrity;
        if (integrity !== "ok") fail(`integrity_check 未通过: ${integrity}`);

        const fkViolations = db.pragma("foreign_key_check");
        result.checks.foreignKeys = Array.isArray(fkViolations) ? fkViolations.length : 0;
        if (result.checks.foreignKeys > 0) fail(`foreign_key_check 发现 ${result.checks.foreignKeys} 处悬空引用`);

        const present = new Set(
          db
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
            .all()
            .map((r) => r.name),
        );
        const missing = REQUIRED_TABLES.filter((t) => !present.has(t));
        result.checks.requiredTables = `${REQUIRED_TABLES.length - missing.length}/${REQUIRED_TABLES.length}`;
        if (missing.length > 0) fail(`缺少必需表: ${missing.join(", ")}`);

        result.counts = countAll(db);
      } catch (err) {
        fail(`备份校验异常: ${err.message}`);
      } finally {
        db.close();
      }
    }
  }

  if (args.baseline) {
    const baselineFile = path.resolve(ROOT, args.baseline);
    if (!existsSync(baselineFile)) {
      fail(`对照库不存在: ${baselineFile}`);
    } else {
      let baseDb;
      try {
        baseDb = new Database(baselineFile, { readonly: true, fileMustExist: true });
        const baseCounts = countAll(baseDb);
        const deltas = {};
        for (const table of COUNT_TABLES) {
          if (typeof result.counts[table] === "number" && typeof baseCounts[table] === "number") {
            deltas[table] = result.counts[table] - baseCounts[table];
          }
        }
        result.baseline = { file: baselineFile, counts: baseCounts, deltas };
      } catch (err) {
        fail(`对照库无法只读打开: ${err.message}`);
      } finally {
        baseDb?.close();
      }
    }
  }
} catch {
  // 失败原因已记录在 failures 里
}

result.ok = failures.length === 0;

if (args.json) {
  console.log(JSON.stringify(result));
} else {
  if (result.sizeBytes > 0) {
    console.log(`[verify] 备份 ${file}（${(result.sizeBytes / 1024 / 1024).toFixed(2)} MB，距今 ${result.ageHours} 小时）`);
  }
  if (result.checks.integrity) console.log(`[verify] integrity_check=${result.checks.integrity}`);
  if (result.checks.foreignKeys !== null) console.log(`[verify] foreign_key_check ${result.checks.foreignKeys} 处违例`);
  if (result.checks.requiredTables) {
    const counts = Object.entries(result.counts)
      .map(([t, n]) => `${t}=${n ?? "?"}`)
      .join(" ");
    console.log(`[verify] 必需表 ${result.checks.requiredTables}；${counts}`);
  }
  if (result.baseline) {
    const diffs = Object.entries(result.baseline.deltas)
      .map(([t, d]) => `${t} ${d >= 0 ? "+" : ""}${d}`)
      .join(" ");
    console.log(`[verify] 对照 ${result.baseline.file}：${diffs || "(无可比表)"}（仅参考，不作判据）`);
  }
  if (result.ok) {
    console.log("[verify] 通过");
  } else {
    for (const f of failures) console.error(`[verify] 失败: ${f}`);
  }
}

process.exit(result.ok ? 0 : 1);
