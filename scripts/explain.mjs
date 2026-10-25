#!/usr/bin/env node
/**
 * SQL 查询计划与耗时快查。
 *
 * 起因：排查「加一个索引后 reindex 快 15 倍」时，手写了四个一次性脚本
 * （列索引 / EXPLAIN / 微基准 / 前后对照），下次还得再写一遍。这里把它固化下来。
 *
 * 用法：
 *   node scripts/explain.mjs data/navhub.db "SELECT * FROM sites WHERE id = ?" --params=abc
 *   node scripts/explain.mjs data/navhub.db "SELECT * FROM sites WHERE url = ?" --params=x --repeat=20
 *   node scripts/explain.mjs data/navhub.db "SELECT ... " --indexes=sites        # 顺带列出索引
 *   node scripts/explain.mjs data/navhub.db "SELECT ..." --try-index=sites(url)  # 试建索引再比一次（会改库！）
 *
 * `--try-index` 会在目标库上**真的建索引再删掉**（前缀 explore_ 便于识别）。
 * 只对副本或本地开发库用；跑完会 DROP 回去。
 *
 * 用内置 `node:sqlite`（Node 22+），不依赖 better-sqlite3 的解析位置——
 * 那个包只在 packages/store 下，从仓库根 import 不到。
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
function flag(name) {
  return process.argv.includes(`--${name}`);
}

const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const dbPath = positional[0];
const sql = positional[1];

if (!dbPath || !sql) {
  console.error("用法: node scripts/explain.mjs <db 路径> \"<SQL>\" [--params=a,b] [--repeat=10] [--indexes=表名] [--try-index=表(列)]");
  process.exit(2);
}
if (!existsSync(dbPath)) {
  console.error(`找不到数据库：${dbPath}`);
  process.exit(2);
}

const params = (arg("params", "") || "")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean)
  // 纯数字按 number 传，其它按字符串（node:sqlite 对类型比 better-sqlite3 更严格）
  .map((p) => (/^-?\d+(\.\d+)?$/.test(p) ? Number(p) : p));
const repeat = Math.max(1, Number(arg("repeat", "10")) || 10);
const indexesFor = arg("indexes", "");
const tryIndex = arg("try-index", "");

const db = new DatabaseSync(dbPath);

function plan() {
  const rows = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params);
  return rows.map((r) => String(r.detail ?? "")).join("\n");
}

function timeIt(label) {
  // 预热一次，避免把首次 prepare 的开销算进均值
  db.prepare(sql).all(...params);
  const samples = [];
  for (let i = 0; i < repeat; i += 1) {
    const t0 = process.hrtime.bigint();
    db.prepare(sql).all(...params);
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  samples.sort((a, b) => a - b);
  const avg = samples.reduce((n, x) => n + x, 0) / samples.length;
  console.log(
    `${label}: 平均 ${avg.toFixed(2)}ms  中位 ${samples[Math.floor(samples.length / 2)].toFixed(2)}ms  ` +
      `最小 ${samples[0].toFixed(2)}ms  最大 ${samples[samples.length - 1].toFixed(2)}ms  （${repeat} 次）`,
  );
  return avg;
}

function showIndexes(table) {
  const rows = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name=?").all(table);
  if (rows.length === 0) {
    console.log(`  （${table} 上没有任何索引）`);
    return;
  }
  for (const r of rows) console.log(`  ${r.name}: ${r.sql ?? "(自动索引)"}`);
}

console.log(`库：${dbPath}`);
console.log(`SQL：${sql}`);
if (params.length > 0) console.log(`参数：${JSON.stringify(params)}`);

if (indexesFor) {
  console.log(`\n索引（${indexesFor}）：`);
  showIndexes(indexesFor);
}

console.log("\n查询计划：");
console.log(
  plan()
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n"),
);

console.log("");
const base = timeIt("耗时");

if (tryIndex) {
  const m = /^([A-Za-z_][\w]*)\((.+)\)$/.exec(tryIndex.trim());
  if (!m) {
    console.error(`--try-index 格式应为 表(列[,列])，收到：${tryIndex}`);
    process.exit(2);
  }
  const [, table, cols] = m;
  const indexName = `explore_${table}_${cols.replace(/[^\w]+/g, "_")}_idx`;
  console.log(`\n—— 对照：建 ${indexName} ON ${table}(${cols}) 后再测 ——`);
  db.exec(`CREATE INDEX IF NOT EXISTS ${indexName} ON ${table}(${cols})`);
  try {
    console.log("查询计划（对照组）：");
    console.log(
      plan()
        .split("\n")
        .map((l) => `  ${l}`)
        .join("\n"),
    );
    const withIndex = timeIt("耗时（对照组）");
    const delta = base > 0 ? ((base - withIndex) / base) * 100 : 0;
    console.log(
      delta >= 0
        ? `结论：该索引带来约 ${delta.toFixed(0)}% 的提速（${base.toFixed(2)}ms → ${withIndex.toFixed(2)}ms）`
        : `结论：该索引反而慢了 ${(-delta).toFixed(0)}%（${base.toFixed(2)}ms → ${withIndex.toFixed(2)}ms）`,
    );
  } finally {
    db.exec(`DROP INDEX IF EXISTS ${indexName}`);
    console.log(`已删除临时索引 ${indexName}（库已恢复原状）`);
  }
}

db.close();
