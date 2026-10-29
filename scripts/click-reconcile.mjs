#!/usr/bin/env node
/**
 * NavHub 点击证据 ↔ `sites.visit_count` 只读对账。
 *
 * 背景：`visit_count` 是热度排序的次键，而本机实测 99.8% 的站点该列为 0
 * （查询日 2026-10-29，sites 全表）。同样是「0」，可以指「没人点」，也可以指
 * 「点了但证据/计数没落地」——只看计数永远分不出来。对账把两侧放在一起：
 *   - `visit_count > 0` 且零条 `kind=click`：计数早于证据链路，或证据被保留策略
 *     清掉，或某条写入路径绕过了 `/api/events`；
 *   - 有 `kind=click` 且 `visit_count = 0`：`bumpVisit` 没跑（重放被去重是预期），
 *     或写入失败。
 *
 * 输出纪律：每条读数都带行数与查询时刻——小样本里任何比率都只是线索，
 * 不是结论。本脚本**只执行 SELECT**（sqlite 以 readonly 打开），发现问题也只提示。
 *
 * 用法：
 *   node scripts/click-reconcile.mjs [--json] [--db <path>] [--url <postgres://>]
 *
 * 退出码：0 成功；1 查询失败/缺依赖；2 数据库文件不存在；3 只读连接打不开。
 * 只读连接打不开时**不降级为读写连接**，只打印原因并退出。
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { summarizeClickReconcile } from "../packages/store/src/click-reconcile.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** pnpm 严格布局下脚本层看不到 packages/store 的依赖（与 data-retention 同一约定） */
function loadDep(name) {
  const require = createRequire(import.meta.url);
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
  console.log(`用法: node scripts/click-reconcile.mjs [--json] [--db <path>] [--url <postgres://>]

  --json               输出机器可读 JSON（默认人类可读文本）
  --db <path>          显式指定 SQLite 文件（默认 NAVHUB_SQLITE_PATH，兜底 data/navhub.db）
  --url <postgres://>  显式指定 PostgreSQL（默认 NAVHUB_DATABASE_URL）

只读对账：sites.visit_count 与 events(kind='click') 的差值、click_delivery 漏斗。
不修改任何数据。退出码 0=成功、1=查询失败、2=库不存在、3=只读连接打不开。`);
}

function parseArgs(argv) {
  const args = { json: false, db: null, url: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") args.json = true;
    else if (a === "--db") args.db = argv[++i];
    else if (a === "--url") args.url = argv[++i];
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
const url = args.url ?? process.env.NAVHUB_DATABASE_URL ?? null;
const sqlitePath = args.db ?? process.env.NAVHUB_SQLITE_PATH ?? path.join(ROOT, "data", "navhub.db");
const isPg = Boolean(url && /^postgres(ql)?:\/\//.test(url));

function fail(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function openSqlite() {
  const Database = loadDep("better-sqlite3");
  if (!Database) fail("缺少 better-sqlite3：请先 pnpm install（它位于 packages/store 的依赖里）");
  if (!existsSync(sqlitePath)) {
    fail(
      `SQLite 数据库不存在: ${sqlitePath}\n` +
        `  用 --db <path> 指定文件，或设置 NAVHUB_SQLITE_PATH（缺省时取 data/navhub.db）。`,
      2,
    );
  }
  let raw;
  try {
    // readonly + fileMustExist：从驱动层面保证本脚本没有写库的能力
    raw = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  } catch (err) {
    fail(
      `只读连接打不开（不降级为读写）: ${err instanceof Error ? err.message : err}\n` +
        `  WAL 的 -shm/-wal 可能被另一个进程独占；停掉它或复制一份库再跑。`,
      3,
    );
  }
  raw.pragma("busy_timeout = 5000");
  return {
    kind: "sqlite",
    target: sqlitePath,
    close: () => raw.close(),
    select: (sql, params = []) => raw.prepare(sql).all(...params),
  };
}

function openPg() {
  const pg = loadDep("pg");
  if (!pg) fail("缺少 pg：请先 pnpm install（它位于 packages/store 的依赖里）");
  const pool = new pg.Pool({ connectionString: url });
  return {
    kind: "postgres",
    target: url.replace(/\/\/[^@/]*@/, "//***@"),
    close: () => pool.end(),
    select: async (sql, params = []) => (await pool.query(sql, params)).rows,
  };
}

const conn = isPg ? openPg() : openSqlite();
const queriedAt = Date.now();

let siteRows;
let clickRows;
let deliveryRows;
try {
  siteRows = await conn.select("SELECT id, title, visit_count FROM sites");
  clickRows = await conn.select(
    "SELECT site_id, COUNT(*) AS c FROM events WHERE kind = 'click' AND site_id IS NOT NULL GROUP BY site_id",
  );
  // outcome/code 在 meta JSON 里（events 没有这两列），与 copilotEventSummary 同一口径：
  // 取回后内存解析。行数只有「差点丢了」的那些，量级很小；仍设上限以便如实申报截断。
  deliveryRows = await conn.select("SELECT meta FROM events WHERE kind = 'click_delivery' LIMIT 50001");
} catch (err) {
  await conn.close();
  fail(
    `查询失败: ${err instanceof Error ? err.message : err}\n` +
      `  （events 表不存在？先启动一次服务建库，或检查 --db / --url 指向的库）`,
  );
}
await conn.close();

const DELIVERY_READ_CAP = 50000;
const deliveryTruncated = deliveryRows.length > DELIVERY_READ_CAP;
const deliveryTally = new Map();
for (const row of deliveryTruncated ? deliveryRows.slice(0, DELIVERY_READ_CAP) : deliveryRows) {
  let outcome = "";
  let code = "";
  try {
    const meta = typeof row.meta === "string" && row.meta ? JSON.parse(row.meta) : null;
    if (meta && typeof meta === "object") {
      outcome = meta.outcome == null ? "" : String(meta.outcome);
      code = meta.code == null ? "" : String(meta.code);
    }
  } catch {
    // 脏行归入空桶：读数宁少不假
  }
  const key = `${outcome}\u0000${code}`;
  deliveryTally.set(key, (deliveryTally.get(key) ?? 0) + 1);
}
deliveryRows = [...deliveryTally.entries()].map(([key, count]) => {
  const [outcome, code] = key.split("\u0000");
  return { outcome, code, count };
});

const clickBySite = new Map();
let orphanClickRows = 0;
for (const row of clickRows) {
  const siteId = String(row.site_id);
  const count = Number(row.c);
  clickBySite.set(siteId, count);
}
const knownSites = new Set(siteRows.map((row) => String(row.id)));
for (const [siteId, count] of clickBySite) {
  if (!knownSites.has(siteId)) orphanClickRows += count;
}

const sites = siteRows.map((row) => ({
  siteId: String(row.id),
  title: row.title === null || row.title === undefined ? null : String(row.title),
  visitCount: Number(row.visit_count ?? 0),
  clickEvents: clickBySite.get(String(row.id)) ?? 0,
}));

const summary = summarizeClickReconcile(
  sites,
  deliveryRows.map((row) => ({ outcome: String(row.outcome ?? ""), code: String(row.code ?? ""), count: Number(row.c) })),
);

const counts = {
  siteRows: siteRows.length,
  clickEventRows: clickRows.reduce((sum, row) => sum + Number(row.c), 0),
  clickEventSites: clickRows.length,
  deliveryRows: deliveryRows.reduce((sum, row) => sum + Number(row.count), 0),
  deliveryTruncated,
  orphanClickRows,
  queriedAt,
};

if (args.json) {
  console.log(
    JSON.stringify(
      {
        dialect: conn.kind,
        database: conn.target,
        readOnly: true,
        queriedAt: new Date(queriedAt).toISOString(),
        counts,
        summary,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const pct = (part, total) => (total > 0 ? `${((part / total) * 100).toFixed(1)}%` : "—");
const when = new Date(queriedAt).toISOString();

console.log("NavHub 点击证据 ↔ visit_count 对账（只读，不改任何数据）");
console.log(`方言:     ${conn.kind}`);
console.log(`数据库:   ${conn.target}`);
console.log(`查询时刻: ${when}`);
console.log(
  `行数:     sites ${counts.siteRows}；kind=click ${counts.clickEventRows} 行 / ${counts.clickEventSites} 站；` +
    `click_delivery ${counts.deliveryRows} 行${counts.deliveryTruncated ? `（已按 ${DELIVERY_READ_CAP} 行截断）` : ""}`,
);
if (counts.orphanClickRows > 0) {
  console.log(`         其中 ${counts.orphanClickRows} 条 click 的 site_id 在 sites 里找不到（站点被硬删过？）`);
}
console.log("");
console.log(`有 visit_count 的站点: ${summary.sitesWithVisitCount} / ${summary.sitesScanned}（${pct(summary.sitesWithVisitCount, summary.sitesScanned)}）`);
console.log(`有点击证据的站点:      ${summary.sitesWithClickEvidence} / ${summary.sitesScanned}（${pct(summary.sitesWithClickEvidence, summary.sitesScanned)}）`);
console.log(`计数总和 ${summary.totalVisitCount}；点击证据总和 ${summary.totalClickEvents}`);
console.log("");
console.log(`有计数但零点击证据: ${summary.visitedWithoutEvidence} 站（计数早于证据链路 / 证据被清理 / 写入绕过 /api/events）`);
console.log(`有证据但 visit_count=0: ${summary.clicksWithoutVisitCount} 站（重放被去重属预期；否则是 bumpVisit 失败）`);
console.log(`两侧都非零但数值不同: ${summary.mismatchedBothSides} 站`);

if (summary.topGaps.length > 0) {
  console.log("\n差值最大的站点（|visit_count − click 证据| 倒序，仅列有差值的）：");
  for (const gap of summary.topGaps) {
    const title = gap.title ? gap.title.slice(0, 40) : "(无标题)";
    console.log(`  ${gap.siteId.padEnd(24)} ${title.padEnd(42)} visit=${gap.visitCount} click=${gap.clickEvents} Δ=${gap.gap}`);
  }
}

if (summary.delivery.length > 0) {
  console.log("\n点击投递漏斗（kind=click_delivery）：");
  for (const row of summary.delivery) {
    console.log(`  ${row.outcome || "(空)"} / ${row.code || "(空)"}: ${row.count}`);
  }
} else {
  console.log("\n点击投递漏斗（kind=click_delivery）：暂无信号（可能没有丢过，也可能客户端还没升级到会发它的版本）");
}

console.log("\n提示（线索，不是结论）：本机样本量小，且两侧时间窗不同（visit_count 是终身累计、");
console.log("事件按保留策略滚动清理）；引用任何数字时请连同上面的行数与查询时刻一起给出。");
