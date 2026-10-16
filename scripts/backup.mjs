#!/usr/bin/env node
/**
 * NavHub SQLite 在线热备脚本（升级改造方案 P2-1）。
 *
 * 用法：
 *   node scripts/backup.mjs [--db <path>] [--out <dir>] [--keep <n>] [--no-rotate]
 *
 * 默认从仓库根运行；数据库路径解析顺序：--db > NAVHUB_SQLITE_PATH > NAVHUB_DB_PATH > ./data/navhub.db。
 *
 * 为什么用 better-sqlite3 的 backup() 而不是 cp：
 *   - SQLite 处于 WAL 模式（data/navhub.db-wal），直接 cp 主库文件会丢掉
 *     尚未 checkpoint 进主库的事务，拿到的是「旧快照」甚至损坏文件；
 *   - backup() 走 sqlite3_backup_init 在线备份 API：不需要停服务，
 *     读取过程与正常读写并发安全，且自动包含 WAL 中的最新提交；
 *   - 备份目标落独立文件，不干扰 -wal/-shm。
 *
 * 退出码：0 成功；1 失败（含完整性校验不过）。供 cron / CI / 人工使用。
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 从 packages/store 解析 better-sqlite3（pnpm workspace：它是 store 的依赖，root 未必直接可见） */
const storeRequire = createRequire(path.join(ROOT, "packages/store/package.json"));

function parseArgs(argv) {
  const args = { db: null, out: null, keep: 7, rotate: true };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--db") args.db = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--keep") args.keep = Math.max(1, Number(argv[++i]) || 7);
    else if (a === "--no-rotate") args.rotate = false;
    else if (a === "--help" || a === "-h") {
      console.log("用法: node scripts/backup.mjs [--db <path>] [--out <dir>] [--keep <n>] [--no-rotate]");
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
const outDir = path.resolve(ROOT, args.out ?? "data/backups");

if (!existsSync(dbPath)) {
  console.error(`数据库不存在: ${dbPath}`);
  console.error("（首次启动服务会自动建库；或用 --db 指定路径）");
  process.exit(1);
}

let Database;
try {
  Database = storeRequire("better-sqlite3");
} catch (err) {
  console.error("无法加载 better-sqlite3（请先在仓库根执行 pnpm install）:", err.message);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
const dest = path.join(outDir, `navhub-${stamp}.db`);

console.log(`源库:   ${dbPath}`);
console.log(`目标:   ${dest}`);

const t0 = Date.now();
/** readonly 打开：备份脚本绝不该有写源库的能力（最小权限） */
const src = new Database(dbPath, { readonly: true, fileMustExist: true });

try {
  // backup() 返回 Promise：内部走 sqlite3_backup_step 循环，WAL 中的已提交事务一并包含
  await src.backup(dest);
} catch (err) {
  console.error("备份失败:", err.message);
  process.exit(1);
} finally {
  src.close();
}

// 完整性校验：备份文件打不开或损坏时，备份等于没有
const verify = new Database(dest, { readonly: true, fileMustExist: true });
try {
  const row = verify.pragma("integrity_check", { simple: true });
  if (row !== "ok") {
    console.error(`完整性校验未通过: ${row}`);
    process.exit(1);
  }
} catch (err) {
  console.error("备份文件无法校验:", err.message);
  process.exit(1);
} finally {
  verify.close();
}

const size = statSync(dest).size;
console.log(`完成:   ${(size / 1024 / 1024).toFixed(2)} MB，耗时 ${Date.now() - t0} ms，integrity_check=ok`);

// 校验关闭时 WAL 已自动 checkpoint，附属的 -wal/-shm 可以安全删除，
// 让备份目录里每个 .db 都是自包含单文件（否则拷贝/传输时会漏掉附属文件）
for (const suffix of ["-wal", "-shm"]) {
  const sidecar = dest + suffix;
  if (existsSync(sidecar)) unlinkSync(sidecar);
}

// 轮换：只保留最近 keep 份，防止备份目录无限增长把磁盘写满
if (args.rotate) {
  const backups = readdirSync(outDir)
    .filter((f) => /^navhub-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.db$/.test(f))
    .map((f) => ({ f, mtime: statSync(path.join(outDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const stale of backups.slice(args.keep)) {
    unlinkSync(path.join(outDir, stale.f));
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = path.join(outDir, stale.f + suffix);
      if (existsSync(sidecar)) unlinkSync(sidecar);
    }
    console.log(`轮换删除: ${stale.f}`);
  }
  console.log(`保留最近 ${Math.min(args.keep, backups.length)} 份备份`);
}
