/**
 * 运维脚本：对存量库执行尚未记账的版本化迁移（与 API 启动同一入口，幂等）。
 *
 * 背景（2026-11-24）：/api/admin/site-reports 在存量 dev 库 500——site_reports /
 * submission_reviews 的 DDL 曾被追加进已记账的 20261015_site_indexes，永远不会执行；
 * 另有 20261124_crawl_* 两个新版本未跑。本脚本补齐台账，可重复执行。
 *
 * 用法（apps/api 下）：
 *   $env:NAVHUB_SQLITE_PATH='../../data/navhub.db'; node apply-pending-migrations.mts
 */
import { openDb, runVersionedMigrations } from "@navhub/store";

const path = process.env.NAVHUB_SQLITE_PATH ?? "../../data/navhub.db";
console.log("db:", path);
const db = await openDb({ dialect: "sqlite", sqlitePath: path });
const result = await runVersionedMigrations(db);
console.log("applied:", result.applied.join(", ") || "(none)");
console.log("skipped:", result.skipped.length, "个已记账版本");
await db.close?.();
