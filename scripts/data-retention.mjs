#!/usr/bin/env node
/**
 * NavHub 数据保留：清理 / 归档 events 与 audit_logs 两张只增不删的表。
 *
 * 为什么需要它：scripts/backup-pg.mjs 解决"能恢复"，这个脚本解决"别长胖"。
 * 行为事件与管理审计日志随时间线性增长，是磁盘增长的主要来源
 * （运维手册 wiki/11 §6）。此前只能备份 + 人工归档。
 *
 * 用法：
 *   node scripts/data-retention.mjs [--apply] [--archive <dir>] [options]
 *
 *   --apply                真正删除（默认 dry-run，只统计）
 *   --archive <dir>        删除前把行写成 gzip NDJSON 冷归档，默认 data/archive
 *   --events-days <n>      events 保留天数，默认 180
 *   --audit-days <n>       audit_logs 保留天数，默认 365
 *   --batch <n>            每批取多少行，默认 1000
 *   --max-scan <n>         单表最多扫描多少行后收尾（dry-run 探测用），默认不限
 *   --url <postgres://>    显式指定 PG（默认读 NAVHUB_DATABASE_URL）
 *   --db <path>            显式指定 SQLite 文件（默认读 NAVHUB_SQLITE_PATH，兜底 data/navhub.db）
 *
 * 归档产物：<dir>/<table>-<时间戳>.ndjson.gz，一行一条 JSON（还没删就先落盘，
 * 归档写失败会直接中断，不会出现"删了没归档"）。
 *
 * 退出码：0 成功；1 失败。
 */
import { createRequire } from "node:module";
import { mkdirSync, existsSync } from "node:fs";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runRetention, DEFAULT_RETENTION_TARGETS } from "../packages/store/src/retention.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

/**
 * 依赖解析：pnpm 的严格布局下脚本层看不到 packages/store 的依赖，
 * 所以先按包名找，找不到再回到 packages/store/node_modules 下找。
 */
function loadDep(name) {
  for (const candidate of [name, path.join(ROOT, "packages", "store", "node_modules", name)]) {
    try {
      return require(candidate);
    } catch {
      /* 继续试下一个位置 */
    }
  }
  return null;
}

function usage() {
  console.log(`用法: node scripts/data-retention.mjs [--apply] [--archive <dir>] [options]
  --apply                真正删除（默认 dry-run，只统计）
  --archive <dir>        删除前 gzip NDJSON 冷归档（默认 data/archive）
  --events-days <n>      events 保留天数（默认 180）
  --audit-days <n>       audit_logs 保留天数（默认 365）
  --batch <n>            每批行数（默认 1000）
  --max-scan <n>         单表最多扫描行数（默认不限）
  --url <postgres://>    显式指定 PG（默认 NAVHUB_DATABASE_URL）
  --db <path>            显式指定 SQLite 文件（默认 NAVHUB_SQLITE_PATH）`);
}

function parseArgs(argv) {
  const args = {
    apply: false,
    archive: null,
    eventsDays: null,
    auditDays: null,
    batch: 1000,
    maxScan: null,
    url: null,
    db: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--archive") args.archive = argv[++i];
    else if (a === "--events-days") args.eventsDays = Number(argv[++i]);
    else if (a === "--audit-days") args.auditDays = Number(argv[++i]);
    else if (a === "--batch") args.batch = Number(argv[++i]) || 1000;
    else if (a === "--max-scan") args.maxScan = Number(argv[++i]);
    else if (a === "--url") args.url = argv[++i];
    else if (a === "--db") args.db = argv[++i];
    else if (a === "--help" || a === "-h") {
      usage();
      process.exit(0);
    } else {
      console.error(`未知参数: ${a}（--help 查看用法）`);
      process.exit(1);
    }
  }
  return args;
}

const args = parseArgs(process.argv);

const url = args.url ?? process.env.NAVHUB_DATABASE_URL;
const sqlitePath = args.db ?? process.env.NAVHUB_SQLITE_PATH ?? path.join(ROOT, "data", "navhub.db");
const isPg = Boolean(url && /^postgres(ql)?:\/\//.test(url));

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (isPg && existsSync(sqlitePath) && !args.db && !process.env.NAVHUB_SQLITE_PATH) {
  // 不是硬错误：两边都存在时以 NAVHUB_DATABASE_URL 为准（跑 standard 模式时 data/navhub.db 多为陈旧残留）
  console.warn(`[warn] 检测到 NAVHUB_DATABASE_URL，按 PostgreSQL 处理（忽略 ${sqlitePath}）`);
}

// ---------- 适配器：SQLite ----------
function openSqlite() {
  const Database = loadDep("better-sqlite3");
  if (!Database) fail("缺少 better-sqlite3：请先 pnpm install（它位于 packages/store 的依赖里）");
  if (!existsSync(sqlitePath)) fail(`SQLite 数据库不存在: ${sqlitePath}（用 --db 指定）`);
  const raw = new Database(sqlitePath);
  // 服务可能在跑：给 busy 一个宽限，避免清理一开始就撞锁退出
  raw.pragma("busy_timeout = 5000");
  return {
    kind: "sqlite",
    close: () => raw.close(),
    adapter: {
      placeholder: () => "?",
      select: (sql, params) => raw.prepare(sql).all(...params),
      execute: (sql, params) => raw.prepare(sql).run(...params).changes,
    },
  };
}

// ---------- 适配器：PostgreSQL ----------
function openPg() {
  const pg = loadDep("pg");
  if (!pg) fail("缺少 pg：请先 pnpm install（它位于 packages/store 的依赖里）");
  const pool = new pg.Pool({ connectionString: url });
  return {
    kind: "postgres",
    close: () => pool.end(),
    adapter: {
      placeholder: (i) => `$${i}`,
      select: async (sql, params) => (await pool.query(sql, params)).rows,
      execute: async (sql, params) => (await pool.query(sql, params)).rowCount ?? 0,
    },
  };
}

const conn = isPg ? openPg() : openSqlite();

// ---------- 目标表 ----------
const targets = DEFAULT_RETENTION_TARGETS.map((t) => {
  const override = t.table === "events" ? args.eventsDays : args.auditDays;
  return { table: t.table, keepDays: override && override > 0 ? override : t.keepDays };
});

// ---------- 归档：每表一个 gzip NDJSON ----------
const archiveDir = args.archive ? path.resolve(ROOT, args.archive) : path.join(ROOT, "data", "archive");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);

const writers = new Map();
/** 每表一个 gzip NDJSON writer，首次归档时惰性创建（0 行的表最后会被清掉，不留空文件）。 */
function getWriter(table) {
  if (writers.has(table)) return writers.get(table);
  mkdirSync(archiveDir, { recursive: true }); // 惰性建目录：没有过期数据时不在仓库里留空文件夹
  const dest = path.join(archiveDir, `${table}-${stamp}.ndjson.gz`);
  const gz = createGzip();
  const fileStream = createWriteStream(dest);
  // 归档失败必须让整个流程停下来：宁可不删，也不能删了没留底
  const done = pipeline(gz, fileStream).catch((e) => fail(`归档写入失败: ${e.message}`));
  const w = {
    dest,
    rows: 0,
    write(row) {
      w.rows++;
      gz.write(JSON.stringify(row) + "\n");
    },
    async finish() {
      gz.end();
      await done;
    },
  };
  writers.set(table, w);
  return w;
}

const t0 = Date.now();
console.log(`方言:   ${conn.kind}`);
console.log(`目标:   ${targets.map((t) => `${t.table} 保留 ${t.keepDays} 天`).join(" / ")}`);
console.log(`模式:   ${args.apply ? "APPLY（会真正删除）" : "DRY-RUN（只统计，加 --apply 才删）"}`);
console.log(`归档:   ${archiveDir}`);

let result;
try {
  result = await runRetention(conn.adapter, {
    targets,
    batchSize: args.batch,
    maxScan: args.maxScan ?? undefined,
    dryRun: !args.apply,
    archive: (table, row) => getWriter(table).write(row),
  });
} catch (e) {
  // 注意措辞要准确：每批 DELETE 各自落盘，所以排在前面的表可能已经删掉了数据。
  // 出错表在"当前批次"内不会有部分删除（先整批 SELECT + 归档，再一条 DELETE 语句删该批 id）。
  fail(
    `清理失败: ${e?.message ?? e}\n` +
      `  出错发生在当前表这一批上；排在它前面的表（若已输出统计）可能已经删过数据，可用归档文件核对。`,
  );
} finally {
  // dry-run 且没写任何行时不留空归档文件
  for (const w of writers.values()) {
    if (w.dest) {
      await w.finish();
      if (w.rows === 0) {
        try {
          (await import("node:fs")).unlinkSync(w.dest);
        } catch {
          /* 删不掉不影响主流程 */
        }
      }
    }
  }
  await conn.close();
}

console.log("");
for (const t of result.tables) {
  const cutoff = new Date(t.cutoff).toISOString();
  console.log(
    `${t.table}: 截止 ${cutoff}｜命中 ${t.scanned}${t.truncated ? "（已达 --max-scan，未扫完）" : ""}｜删除 ${t.deleted}｜归档 ${t.archived}｜${t.batches} 批`,
  );
}
const totalHit = result.tables.reduce((s, t) => s + t.scanned, 0);
const written = [...writers.values()].filter((w) => w.rows > 0);
if (written.length) {
  console.log("");
  for (const w of written) console.log(`归档产物: ${path.relative(ROOT, w.dest)}（${w.rows} 行）`);
}
console.log(`\n完成: 命中 ${totalHit} 行，${result.dryRun ? "未删除（dry-run）" : `已删除 ${result.tables.reduce((s, t) => s + t.deleted, 0)} 行`}，耗时 ${Date.now() - t0} ms`);
if (result.dryRun && totalHit > 0) {
  console.log("下一步: 确认无误后加 --apply 执行清理");
}
