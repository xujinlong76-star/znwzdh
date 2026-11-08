/**
 * 显式跑一次版本化迁移（含数据修复类），用于本地/运维在重启前即刻生效。
 *
 * 与运行时同一条代码路径（packages/store 的 openDb → runVersionedMigrations），
 * 不另写一套 SQL —— 否则「脚本跑过了」与「服务启动时会做什么」会分叉。
 *
 * 用法：node scripts/db-apply-migrations.mts [db路径]
 */
import { openDb } from "../packages/store/src/driver.ts";

const dbPath = process.argv[2] || process.env.NAVHUB_SQLITE_PATH || "data/navhub.db";

const db = await openDb({ dialect: "sqlite", sqlitePath: dbPath });
// 注意：\`raw()\` 在 Repository 上，不在 Db 上——这里直接用驱动句柄读台账。
const ledger =
  db.dialect === "pg" && db.pg
    ? (await db.pg.query("SELECT version, name, applied_at FROM _schema_migrations ORDER BY version ASC")).rows
    : db.sqlite.prepare("SELECT version, name, applied_at FROM _schema_migrations ORDER BY version ASC").all();
console.log("[migrate] 当前台账：");
for (const r of ledger) console.log("  " + r.version + "  " + r.name);
await db.close();
