#!/usr/bin/env node
/**
 * check-db-integrity.mjs —— 数据库引用完整性门禁（只读）。
 *
 * ## 为什么单独写
 *
 * 仓库已有 `check-navigation-health.mjs`（健康数据口径）与
 * `check-health-coverage.mjs`（探测覆盖 SLO），但都没有覆盖「关联表指向
 * 不存在的站点」这一类。2026-11-08 实测 dev 库发现：
 *   7 条 site_tags + 1 条 embeddings 指向 sites 表里**完全不存在**的 id，
 *   是早期删站路径未级联清理的历史残留。
 *
 * 检索层有 `deleted_at IS NULL` / JOIN 兜底，所以用户看不见错误；
 * 但这类脏数据会静默累积，且没有任何东西阻止它再次出现。
 *
 * ## 口径
 *
 * 只报「**孤儿引用**」：关联表里的 site_id 在 sites 表里连软删行都没有。
 * 软删站点留在 FTS / embeddings / site_tags 里是**设计如此**（回收站可恢复，
 * `purgeSite` 才物理清理），不算不一致，不能报红。
 *
 * 用法：
 *   node scripts/check-db-integrity.mjs              # 输出报告
 *   node scripts/check-db-integrity.mjs --check      # 有孤儿引用则退出码 1
 *   node scripts/check-db-integrity.mjs --db=路径
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const argv = process.argv.slice(2);
const dbArg = argv.find((a) => a.startsWith("--db="));
const dbPath = resolve(dbArg ? dbArg.slice("--db=".length) : "data/navhub.db");
const asCheck = argv.includes("--check");

if (!existsSync(dbPath)) {
  console.error("[db-integrity] 找不到数据库:", dbPath);
  process.exit(1);
}

const db = new DatabaseSync(dbPath, { readOnly: true });

/** 逐张关联表查「site_id 在 sites 里完全不存在」的行数 */
const CHECKS = [
  {
    name: "site_tags → sites",
    sql: "SELECT COUNT(*) c FROM site_tags t WHERE NOT EXISTS (SELECT 1 FROM sites s WHERE s.id=t.site_id)",
    detail: "SELECT site_id, tag_id FROM site_tags t WHERE NOT EXISTS (SELECT 1 FROM sites s WHERE s.id=t.site_id)",
  },
  {
    name: "site_facets → sites",
    sql: "SELECT COUNT(*) c FROM site_facets f WHERE NOT EXISTS (SELECT 1 FROM sites s WHERE s.id=f.site_id)",
  },
  {
    name: "embeddings → sites",
    sql: "SELECT COUNT(*) c FROM embeddings e WHERE NOT EXISTS (SELECT 1 FROM sites s WHERE s.id=e.site_id)",
    detail: "SELECT site_id, model FROM embeddings e WHERE NOT EXISTS (SELECT 1 FROM sites s WHERE s.id=e.site_id)",
  },
  {
    name: "favorites → sites",
    sql: "SELECT COUNT(*) c FROM favorites f WHERE NOT EXISTS (SELECT 1 FROM sites s WHERE s.id=f.site_id)",
  },
  {
    name: "collection_items → sites",
    sql: "SELECT COUNT(*) c FROM collection_items ci WHERE NOT EXISTS (SELECT 1 FROM sites s WHERE s.id=ci.site_id)",
  },
  {
    name: "site_relations 源 → sites",
    sql: "SELECT COUNT(*) c FROM site_relations r WHERE r.source_site_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sites s WHERE s.id=r.source_site_id)",
  },
  {
    name: "site_tags → tags",
    sql: "SELECT COUNT(*) c FROM site_tags t WHERE NOT EXISTS (SELECT 1 FROM tags g WHERE g.id=t.tag_id)",
  },
  {
    name: "categories.parent_id 悬空",
    sql: "SELECT COUNT(*) c FROM categories c WHERE c.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM categories p WHERE p.id=c.parent_id)",
  },
  {
    name: "sites.category_id 悬空（活跃站点）",
    sql: "SELECT COUNT(*) c FROM sites s WHERE s.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.id=s.category_id)",
  },
];

console.log("[db-integrity] db =", dbPath);
let orphans = 0;
for (const chk of CHECKS) {
  let count;
  try {
    count = db.prepare(chk.sql).get().c;
  } catch (err) {
    // 表不存在（比如老库还没迁移）不当成不一致，但要如实说明
    console.log("  SKIP  " + chk.name + "  (" + String(err.message).slice(0, 60) + ")");
    continue;
  }
  orphans += count;
  const flag = count === 0 ? "OK   " : "ORPHAN";
  console.log("  " + flag + "  " + chk.name.padEnd(34) + " = " + count);
  if (count > 0 && chk.detail && count <= 20) {
    const rows = db.prepare(chk.detail).all();
    for (const r of rows) console.log("           " + JSON.stringify(r));
  }
}


/* ------------------------------------------------------------------ *
 * 保留策略健康度（2026-11-10 补）
 *
 * 为什么加：`packages/store/src/retention.ts` 定义了 5 张表的保留期
 * （events 180 天 / audit_logs 365 天 / search_history 180 天 /
 * site_archives 365 天 / health_checks 180 天），也有 CLI 可清理
 * （`scripts/data-retention.mjs --apply`），但**没有任何门禁看着这件事**。
 * 长期不跑清理，库会静默膨胀 —— 这是"指标都在、没人看"的典型。
 *
 * 口径：只报**严重积压**（过期占比 > 50% 且绝对数 > 5000）才判红。
 * 不按"有任何过期行"判红：保留期允许自然滞后，刚过期的几行不是运维问题；
 * 但过半的库都是死数据时，就该有人处理了。
 * ------------------------------------------------------------------ */
const RETENTION_TARGETS = [
  { table: "events", keepDays: 180, timeColumn: "created_at" },
  { table: "audit_logs", keepDays: 365, timeColumn: "created_at" },
  { table: "search_history", keepDays: 180, timeColumn: "created_at" },
  { table: "site_archives", keepDays: 365, timeColumn: "created_at" },
  { table: "health_checks", keepDays: 180, timeColumn: "checked_at" },
];
const RETENTION_RED_PCT = 50;
const RETENTION_RED_MIN = 5000;

let retentionCritical = 0;
console.log("");
console.log("[db-integrity] 保留策略积压：");
for (const t of RETENTION_TARGETS) {
  let total;
  let expired;
  try {
    total = db.prepare('SELECT COUNT(*) c FROM "' + t.table + '"').get().c;
    const cutoff = Date.now() - t.keepDays * 86_400_000;
    expired = db.prepare('SELECT COUNT(*) c FROM "' + t.table + '" WHERE ' + t.timeColumn + " < ?").get(cutoff).c;
  } catch (err) {
    console.log("  SKIP  " + t.table.padEnd(16) + "  (" + String(err.message).slice(0, 50) + ")");
    continue;
  }
  const pct = total > 0 ? (expired / total) * 100 : 0;
  const critical = pct > RETENTION_RED_PCT && expired > RETENTION_RED_MIN;
  if (critical) retentionCritical += 1;
  console.log(
    "  " + (critical ? "STALE" : "OK   ") + "  " + t.table.padEnd(16) +
    " keep=" + String(t.keepDays).padStart(3) + "d" +
    "  total=" + String(total).padStart(7) +
    "  expired=" + String(expired).padStart(7) +
    "  (" + pct.toFixed(0) + "%)",
  );
}
console.log("[db-integrity] 保留策略严重积压表 =", retentionCritical,
  "（判定线：过期占比 > " + RETENTION_RED_PCT + "% 且 > " + RETENTION_RED_MIN + " 行）");


/* ------------------------------------------------------------------ *
 * E2E 测试数据污染（2026-11-10 补）
 *
 * 为什么加：实测发现生产库 events 表里有 217 条 e2e 事件（13%），
 * 全部来自 2026-10-19 一次未隔离的 E2E 运行——对应插件早已从 plugins 表清理，
 * 只剩事件残影。后果不是"占空间"，而是**业务指标失真**：
 * 插件浏览从 339 被虚报成 535，浏览→安装转化率被算成 0.75%（真实 1.18%）。
 *
 * 现在 E2E 已有独立库（data/e2e/navhub-e2e.db），但这条门禁防的是
 * "隔离机制失效或有人绕过它"的复发。只统计、不自动删：清理由人决定。
 * ------------------------------------------------------------------ */
const E2E_POLLUTION_RED = 50;
let e2ePolluted = 0;
console.log("");
console.log("[db-integrity] E2E 数据污染：");
{
  const patterns = [
    { table: "events", column: "meta", like: "%e2e-%" },
    { table: "plugins", column: "slug", like: "e2e-%" },
    { table: "sites", column: "source", like: "%e2e%" },
  ];
  for (const p of patterns) {
    let c;
    try {
      c = db
        .prepare('SELECT COUNT(*) c FROM "' + p.table + '" WHERE ' + p.column + " LIKE ?")
        .get(p.like).c;
    } catch (err) {
      console.log("  SKIP  " + (p.table + "." + p.column).padEnd(22) + "(" + String(err.message).slice(0, 40) + ")");
      continue;
    }
    if (c > E2E_POLLUTION_RED) e2ePolluted += 1;
    console.log(
      "  " + (c > E2E_POLLUTION_RED ? "DIRTY" : "OK   ") + "  " +
      (p.table + "." + p.column).padEnd(22) + String(c).padStart(6) + " 行",
    );
  }
}
console.log("[db-integrity] E2E 污染超标列 =", e2ePolluted,
  "（判定线：单列 > " + E2E_POLLUTION_RED + " 行；只统计不自动删）");

// 参考指标（不判红，只是让报告可读）
const active = db.prepare("SELECT COUNT(*) c FROM sites WHERE deleted_at IS NULL").get().c;
const softDeleted = db.prepare("SELECT COUNT(*) c FROM sites WHERE deleted_at IS NOT NULL").get().c;
const ftsRows = db.prepare("SELECT COUNT(*) c FROM sites_fts").get().c;
console.log("");
console.log("[db-integrity] 活跃站点 =", active, "| 软删 =", softDeleted, "| FTS 行 =", ftsRows,
  "（FTS 含软删行属设计如此，不计入孤儿）");
console.log("[db-integrity] 孤儿引用合计 =", orphans);

db.close();
if (asCheck && (orphans > 0 || retentionCritical > 0 || e2ePolluted > 0)) {
  console.error("[db-integrity] --check 未通过：孤儿 " + orphans + " 条，保留积压 " + retentionCritical + " 表，E2E 污染 " + e2ePolluted + " 列");
  process.exit(1);
}
