/**
 * 守卫：health_checks 巡检是否存在「误杀」——把活着但拒绝爬虫的站点标成 broken。
 *
 * 背景（2026-11-03 真实缺陷）：16 个 broken 站点里 13 个是 401/403 误杀
 * （Claude、ChatGPT、npm、CodePen 等全部实测可正常访问），真死链为 0。
 * 根因是巡检自己写了 `status >= 200 && status < 400`，绕过了
 * packages/core/src/probe-policy.ts 的统一判据。修复后本守卫应长期为绿。
 *
 * 用法（工作目录不限，可在仓库根直接跑）：
 *   node scripts/check-health-false-positive.mjs
 *   node scripts/check-health-false-positive.mjs --db=<path>
 *
 * 为什么用动态 import + 显式路径：better-sqlite3 是原生模块，只装在 apps/api 下。
 * ESM 的解析规则是「沿脚本自身位置向上找 node_modules」，不看运行时的 cwd，
 * 所以把脚本放在 scripts/ 就必须显式指向 apps/api/node_modules 的入口。
 */
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * 与 packages/core/src/probe-policy.ts 的 BOT_BLOCKED_STATUSES 严格一致。
 *
 * 这里刻意**不 import** 那个常量：守卫的价值在于用一份独立清单去交叉核对**库里的数据**。
 * 若两边同源，判据本身写错了守卫也会跟着错，等于没守。
 */
const BOT_BLOCKED = [401, 403, 405, 412, 418, 429];

const arg = process.argv.find((a) => a.startsWith("--db="));
const dbPath = arg ? resolve(arg.slice(5)) : resolve(REPO_ROOT, "data/navhub.db");

// 从 apps/api 解析 better-sqlite3（原生模块装在那里）
const req = createRequire(resolve(REPO_ROOT, "apps/api/package.json"));
let Database;
try {
  Database = req("better-sqlite3");
} catch (err) {
  console.error(`❌ 无法加载 better-sqlite3（它在 apps/api 下）：${err.message}`);
  console.error("   先跑 pnpm install，或确认 apps/api/node_modules/better-sqlite3 存在");
  process.exit(2);
}

let db;
try {
  db = new Database(dbPath, { readonly: true });
} catch (err) {
  console.error(`❌ 打不开库：${dbPath}\n   ${err.message}`);
  process.exit(2);
}

const rows = db
  .prepare(
    `SELECT title, http_status, health_error
     FROM sites
     WHERE status = 'broken' AND deleted_at IS NULL
       AND http_status IN (${BOT_BLOCKED.join(",")})`,
  )
  .all();

const summary = db
  .prepare(`SELECT status, COUNT(*) n FROM sites WHERE deleted_at IS NULL GROUP BY status ORDER BY n DESC`)
  .all();

const emptyReasons = db
  .prepare(
    `SELECT COUNT(*) n FROM sites
     WHERE status = 'broken' AND deleted_at IS NULL
       AND (health_error IS NULL OR TRIM(health_error) = '')`,
  )
  .get();

db.close();

console.log(`库：${dbPath}`);
console.log("\n=== 全站状态分布 ===");
console.table(summary);

if (rows.length > 0) {
  console.log(`\n❌ 误杀：${rows.length} 个站点是「活着但拒绝爬虫」却被标 broken`);
  console.table(rows);
  console.log("\n   修复方向：确认巡检走 packages/core 的 classifyProbeStatus，");
  console.log("   且 blocked 记录不参与 recentHealthChecks 的连续失败计数。");
  process.exit(1);
}

console.log("\n✅ 无误杀：没有「拒绝爬虫」类状态码的站点被标 broken（应为 0）");

// 「失败但无原因」是同一事故的另一半（曾有 55% 的失败记录 error 为空），
// 长期目标也是 0；但历史行不会自动回填，所以这里只告警不失败。
if (Number(emptyReasons.n) > 0) {
  console.log(`⚠️  另有 ${emptyReasons.n} 个 broken 站点无 health_error（历史遗留，新巡检会写明原因）`);
}
