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

// 参考指标（不判红，只是让报告可读）
const active = db.prepare("SELECT COUNT(*) c FROM sites WHERE deleted_at IS NULL").get().c;
const softDeleted = db.prepare("SELECT COUNT(*) c FROM sites WHERE deleted_at IS NOT NULL").get().c;
const ftsRows = db.prepare("SELECT COUNT(*) c FROM sites_fts").get().c;
console.log("");
console.log("[db-integrity] 活跃站点 =", active, "| 软删 =", softDeleted, "| FTS 行 =", ftsRows,
  "（FTS 含软删行属设计如此，不计入孤儿）");
console.log("[db-integrity] 孤儿引用合计 =", orphans);

db.close();
if (asCheck && orphans > 0) {
  console.error("[db-integrity] --check 未通过：存在 " + orphans + " 条孤儿引用");
  process.exit(1);
}
