#!/usr/bin/env node
/**
 * NavHub users.email 去重预演报告（只读）。
 *
 * 背景：`packages/store/src/migrate.ts` 的 `dedupeUserEmails` 在 openDb 启动期
 * （migrateSiteIndexes 之前）把重复 email 收敛到最早一行，其余行 email 置 NULL。
 * 这个动作**不可逆**（原值只留在日志/备份里），所以升级/启动前先用本脚本
 * 看清影响面：谁会保留、谁的 email 会被清空。
 *
 * 口径与 dedupeUserEmails 完全一致：
 *   - 只统计 email IS NOT NULL AND email <> '' 的行（NULL / 空串 = 没有邮箱）；
 *   - 每组保留 created_at 最早的一行，并列时取 id 字典序最小；
 *   - 其余行 email 会被置 NULL（行不删，挂着收藏/画像/凭据）。
 *
 * 用法：
 *   node scripts/users-email-dedupe-report.mjs [--json] [--db <path>] [--url <postgres://>]
 *
 *   --json               机器可读 JSON（默认人类可读文本）
 *   --db <path>          显式指定 SQLite 文件（默认读 NAVHUB_SQLITE_PATH，兜底 data/navhub.db）
 *   --url <postgres://>  显式指定 PG（默认读 NAVHUB_DATABASE_URL）
 *
 * 本脚本只执行 SELECT：sqlite 侧以 better-sqlite3 readonly 打开，没有任何写路径。
 *
 * 退出码：0 成功（含「无重复 email」）；1 失败（缺依赖 / 查询报错等）；2 数据库文件不存在。
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 依赖解析：pnpm 的严格布局下脚本层看不到 packages/store 的依赖，
 * 所以先按包名找，找不到再回到 packages/store/node_modules 下找
 * （与 scripts/data-retention.mjs 同一约定）。
 */
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
  console.log(`用法: node scripts/users-email-dedupe-report.mjs [--json] [--db <path>] [--url <postgres://>]
  --json               输出机器可读 JSON（默认人类可读文本）
  --db <path>          显式指定 SQLite 文件（默认 NAVHUB_SQLITE_PATH，兜底 data/navhub.db）
  --url <postgres://>  显式指定 PostgreSQL（默认 NAVHUB_DATABASE_URL）

本脚本只读：预演 dedupeUserEmails（packages/store/src/migrate.ts）会清空哪些
users.email，不会修改数据库。退出码 0=成功（含无重复）、1=失败、2=库不存在。`);
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

// ---------- 适配器（只读） ----------

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
  // readonly + fileMustExist：从驱动层面保证本脚本没有写库的能力
  const raw = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  raw.pragma("busy_timeout = 5000");
  return {
    kind: "sqlite",
    target: sqlitePath,
    close: () => raw.close(),
    select: (sql, params) => raw.prepare(sql).all(...params),
  };
}

function openPg() {
  const pg = loadDep("pg");
  if (!pg) fail("缺少 pg：请先 pnpm install（它位于 packages/store 的依赖里）");
  const pool = new pg.Pool({ connectionString: url });
  return {
    kind: "postgres",
    target: url.replace(/\/\/[^@/]*@/, "//***@"), // 连接串含口令，日志里打码
    close: () => pool.end(),
    select: async (sql, params) => (await pool.query(sql, params)).rows,
  };
}

const conn = isPg ? openPg() : openSqlite();

// ---------- 查询（与 dedupeUserEmails 同一口径） ----------

/** created_at 是 ms epoch INTEGER/BIGINT；PG 会把 bigint 回传成字符串，统一成 number。 */
function toMs(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtMs(ms) {
  return ms === null ? String(ms) : new Date(ms).toISOString();
}

let dupGroups;
let groupRows; // email -> rows（按 created_at ASC, id ASC）
try {
  // 分组 SQL 双方言相同；仅占位符不同（sqlite ? / pg $1）
  dupGroups = await conn.select(
    "SELECT email, COUNT(*) AS c, MIN(created_at) AS first FROM users WHERE email IS NOT NULL AND email <> '' GROUP BY email HAVING COUNT(*) > 1 ORDER BY first",
    [],
  );
  groupRows = new Map();
  for (const g of dupGroups) {
    const email = String(g.email);
    const rows = isPg
      ? await conn.select("SELECT id, username, created_at FROM users WHERE email = $1 ORDER BY created_at ASC, id ASC", [email])
      : await conn.select("SELECT id, username, created_at FROM users WHERE email = ? ORDER BY created_at ASC, id ASC", [email]);
    groupRows.set(email, rows);
  }
} catch (err) {
  await conn.close();
  fail(`查询失败: ${err instanceof Error ? err.message : err}\n  （users 表不存在？先启动一次服务建库，或检查 --db / --url 指向的库）`);
}
await conn.close();

const groups = dupGroups.map((g) => {
  const rows = (groupRows.get(String(g.email)) ?? []).map((r) => ({
    id: String(r.id),
    username: String(r.username ?? ""),
    createdAt: toMs(r.created_at),
  }));
  // 与 dedupeUserEmails 一致：rows 已按 created_at ASC, id ASC 排序，首行保留
  return {
    email: String(g.email),
    count: Number(g.c),
    firstCreatedAt: toMs(g.first),
    rows,
    keepId: rows.length > 0 ? rows[0].id : null,
    clearIds: rows.slice(1).map((r) => r.id),
  };
});
const summary = {
  groups: groups.length,
  rowsInvolved: groups.reduce((s, g) => s + g.count, 0),
  rowsToClear: groups.reduce((s, g) => s + g.clearIds.length, 0),
};

// ---------- 输出 ----------

if (args.json) {
  console.log(
    JSON.stringify(
      {
        dialect: conn.kind,
        database: conn.target,
        readOnly: true,
        generatedAt: new Date().toISOString(),
        groups,
        summary,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

console.log("NavHub users.email 去重预演（只读，不会修改任何数据）");
console.log(`方言:   ${conn.kind}`);
console.log(`数据库: ${conn.target}`);

if (groups.length === 0) {
  console.log("\n无重复 email。");
  console.log("（启动服务时 dedupeUserEmails 不会清空任何 email；users_email_unique_idx 可正常创建）");
  process.exit(0);
}

console.log(`\n重复 email 组 ${summary.groups} 个（按组内最早注册时间排序）：`);
groups.forEach((g, i) => {
  console.log(`\n[${i + 1}] ${g.email}（${g.count} 行，最早 ${fmtMs(g.firstCreatedAt)}）`);
  for (const r of g.rows) {
    const mark = r.id === g.keepId ? "保留" : "清空";
    const note = r.id === g.keepId
      ? "← 保留（dedupeUserEmails 口径：created_at 最早，并列取 id 最小）"
      : "→ email 将被置 NULL";
    console.log(`    ${mark}  ${r.id}  ${r.username || "(空)"}  ${fmtMs(r.createdAt)}  ${note}`);
  }
});

console.log(`
汇总：
  重复 email 组数:       ${summary.groups}
  涉及行数:             ${summary.rowsInvolved}
  将被清空 email 的行数: ${summary.rowsToClear}

以上是「若现在启动服务，dedupeUserEmails 会做什么」的预演；本脚本只执行 SELECT。
确认影响面后再启动服务触发迁移；恢复方法见 docs/wiki/11-operations.md「users.email 去重与恢复」。`);
process.exit(0);
