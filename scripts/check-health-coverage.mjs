#!/usr/bin/env node
/**
 * check-health-coverage —— 健康探测的「覆盖 / 新鲜度」SLO 校验（2026-11-07 九维评审 4-2）。
 *
 * 问题：收录刷新是**分钟级**（apps/web/src/app/sitemap.ts:41 `revalidate = 300`），
 * 而健康判定是**天级**（apps/api/src/jobs.ts 的 DEFAULT_CRON_SCHEDULES：
 * health_check 每 24h 一轮、每轮 limit=100）。实测库 4839 条活跃站点里
 * 4258 条 `last_checked_at IS NULL` —— 一个站点从失效到被移出收录，
 * 时延由「多久轮到它一次」决定，而这个时延此前没有任何指标、也没有上限。
 *
 * 本脚本**只读**，做三件事：
 *   1. 量三条 SLO（4-2 验收标准）：
 *      ① 已探测样本中 `lastCheckedAt` 超过 7×24h 的比例 ≤5%
 *      ② 单类目未探测占比 ≤20%
 *      ③ `status=active AND health_ok IS NULL` 的站点不得在证据不足时被降级
 *         （落成可判定的不变量：broken 必须有「最近 3 次巡检全失败」作为依据）
 *   2. 按当前日预算投影「清空未知状态还要多久」，把两条 SLO 抢同一个预算的
 *      算术摆出来（不再靠猜）；
 *   3. `--check` 只对**不变量**判红。SLO 差额是已知积压、不是代码缺陷，
 *      把它做成硬门禁会得到一条永远红的检查——那正是本报告批评的
 *      「必然绿灯的假门禁」的镜像版本。要按 SLO 判红用 `--strict`。
 *
 * 用法（在仓库根运行）：
 *   node scripts/check-health-coverage.mjs
 *   node scripts/check-health-coverage.mjs --json
 *   node scripts/check-health-coverage.mjs --check      # 只判不变量
 *   node scripts/check-health-coverage.mjs --check --strict  # 连 SLO 一起判
 *   node scripts/check-health-coverage.mjs --db=/path/to/navhub.db
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd());
const requireFromRoot = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const dbArg = argv.find((a) => a.startsWith("--db="));
const dbPath = dbArg ? resolve(dbArg.slice("--db=".length)) : resolve(ROOT, "data", "navhub.db");
const asJson = argv.includes("--json");
const asCheck = argv.includes("--check");
const asStrict = argv.includes("--strict");

/** 4-2 验收标准的三个阈值，集中在这里，改阈值必须连带改测试 */
const SLO = {
  /** 已探测样本中超过 7×24h 的比例上限（%） */
  staleRatePct: 5,
  /** 单类目未探测占比上限（%） */
  categoryUncheckedPct: 20,
  /** 新鲜度窗口（天） */
  freshnessWindowDays: 7,
  /**
   * 类目占比的噪声地板：1 条站点的类目，未探测 1 条就是 100%，
   * 这个粒度下「≤20%」没有意义。只对 ≥5 条站点的类目判 SLO，其余计入「小类目」单列。
   */
  minCategorySize: 5,
};

/** 与 apps/api/src/jobs.ts 的 DEFAULT_CRON_SCHEDULES 同源，允许 env 覆盖 */
const dailyBudget = (() => {
  const raw = Number(process.env.NAVHUB_HEALTH_LIMIT ?? 100);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 100;
})();
const backfillShare = (() => {
  const raw = Number(process.env.NAVHUB_HEALTH_BACKFILL_SHARE ?? 0.5);
  return Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0.5;
})();

if (!existsSync(dbPath)) {
  console.error(`[health-coverage] 找不到数据库：${dbPath}（用 --db=<path> 指定）`);
  process.exit(2);
}

let Database;
try {
  // pnpm workspace 不做根提升：better-sqlite3 挂在 apps/api 与 packages/store 下，
  // 从仓库根裸 resolve 会失败。显式给候选路径，而不是要求调用方先 cd。
  const entry = requireFromRoot.resolve("better-sqlite3", {
    paths: [ROOT, resolve(ROOT, "apps/api"), resolve(ROOT, "packages/store")],
  });
  Database = requireFromRoot(entry);
} catch {
  console.error("[health-coverage] 缺少 better-sqlite3（在仓库根运行，或在 apps/api 下执行）");
  process.exit(2);
}

let db;
try {
  db = new Database(dbPath, { readonly: true, fileMustExist: true });
} catch (err) {
  console.error(`[health-coverage] 打不开数据库：${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}

const tableExists = (name) =>
  Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name));
if (!tableExists("sites")) {
  console.error(`[health-coverage] ${dbPath} 里没有 sites 表，不像 NavHub 库`);
  process.exit(2);
}
const hasHealthChecks = tableExists("health_checks");

const one = (sql, params = []) => db.prepare(sql).get(...params) ?? {};
const all = (sql, params = []) => db.prepare(sql).all(...params);
const pct = (n, d) => (d > 0 ? Number(((n / d) * 100).toFixed(2)) : 0);

// ---------------------------------------------------------------- 基数
const base = one(
  `SELECT COUNT(*) AS total,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN status = 'broken' THEN 1 ELSE 0 END) AS broken,
          SUM(CASE WHEN last_checked_at IS NULL THEN 1 ELSE 0 END) AS unchecked,
          SUM(CASE WHEN last_checked_at IS NOT NULL THEN 1 ELSE 0 END) AS checked,
          SUM(CASE WHEN last_checked_at IS NOT NULL AND health_ok IS NULL THEN 1 ELSE 0 END) AS inconsistent
     FROM sites WHERE deleted_at IS NULL AND enabled = 1`,
);
const total = Number(base.total ?? 0);
const unchecked = Number(base.unchecked ?? 0);
const checked = Number(base.checked ?? 0);
const inconsistent = Number(base.inconsistent ?? 0);

// ---------------------------------------------------------- ① 新鲜度
const staleBefore = Date.now() - SLO.freshnessWindowDays * 86_400_000;
const stale = Number(
  one(
    `SELECT COUNT(*) AS n FROM sites
      WHERE deleted_at IS NULL AND enabled = 1
        AND last_checked_at IS NOT NULL AND last_checked_at < ?`,
    [staleBefore],
  ).n ?? 0,
);
const staleRatePct = pct(stale, checked);

// ---------------------------------------------------- ② 单类目未探测占比
const perCategory = all(
  `SELECT category_id,
          COUNT(*) AS total,
          SUM(CASE WHEN last_checked_at IS NULL THEN 1 ELSE 0 END) AS unchecked
     FROM sites
    WHERE deleted_at IS NULL AND enabled = 1 AND category_id IS NOT NULL
    GROUP BY category_id
    ORDER BY (CAST(SUM(CASE WHEN last_checked_at IS NULL THEN 1 ELSE 0 END) AS REAL) / COUNT(*)) DESC, category_id ASC`,
).map((r) => ({
  categoryId: String(r.category_id),
  total: Number(r.total),
  unchecked: Number(r.unchecked),
  uncheckedPct: pct(Number(r.unchecked), Number(r.total)),
}));
const bigCategories = perCategory.filter((c) => c.total >= SLO.minCategorySize);
const smallCategories = perCategory.filter((c) => c.total < SLO.minCategorySize);
const worstCategory = bigCategories[0] ?? null;
const maxCategoryUncheckedPct = worstCategory ? worstCategory.uncheckedPct : 0;
const categoriesOverSlo = bigCategories.filter((c) => c.uncheckedPct > SLO.categoryUncheckedPct);

// ------------------------------------------- ③ 降级必须有证据（不变量）
/**
 * 判定「broken 是否有连续失败作为依据」。
 *
 * 为什么这条等价于验收标准 ③：`updateSiteHealth` 只有在 `markBroken !== false`
 * 时才把 status 写成 broken，而 markBroken 来自 `shouldMarkBroken(false, 连续失败数, 阈值)`。
 * 所以经巡检降级的站点，最近 3 次巡检必须全是失败；否则说明降级绕过了阈值判定
 * （历史数据迁移、手工改库、或阈值逻辑回归）。
 *
 * 两个必须排除的合法情形，否则这条会变成误报机器：
 *   1. **手工降级**：`PATCH /api/sites/:id` 的 `setStatus` 允许直接把 status 改成
 *      broken（apps/api/src/routes/sites.ts:797,823），不写 health_checks。
 *      只判 `health_ok = 0` 的站点 —— 那是巡检路径留下的痕迹。
 *   2. **证据已被保留策略清理**：health_checks 只留 180 天
 *      （packages/store/src/retention.ts:247）。broken 站点若最后一次巡检早于
 *      该窗口，历史必然为空，这是策略使然而不是缺陷 —— 单列 evidenceExpired。
 */
const RETENTION_DAYS = 180; // 同源：packages/store/src/retention.ts:247 { table: "health_checks", keepDays: 180 }
const failThreshold = (() => {
  const raw = Number(process.env.NAVHUB_HEALTH_FAIL_THRESHOLD ?? 3);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 3;
})();
const retentionCutoff = Date.now() - RETENTION_DAYS * 86_400_000;
const demotionViolations = [];
const evidenceExpired = [];
let manualBroken = 0;
if (hasHealthChecks) {
  for (const row of all(
    `SELECT id, url, status, health_ok, last_checked_at
       FROM sites WHERE deleted_at IS NULL AND status = 'broken' ORDER BY id ASC`,
  )) {
    if (Number(row.health_ok) !== 0) {
      // health_ok 为 1/NULL 却被标 broken：只有手工 setStatus 会这样，不归本条判据管
      manualBroken += 1;
      continue;
    }
    const recent = all(
      "SELECT ok FROM health_checks WHERE site_id = ? ORDER BY checked_at DESC LIMIT ?",
      [row.id, failThreshold],
    );
    const failures = recent.filter((h) => Number(h.ok) === 0).length;
    if (recent.length >= failThreshold && failures >= failThreshold) continue;
    if (recent.length === 0 && row.last_checked_at !== null && Number(row.last_checked_at) < retentionCutoff) {
      evidenceExpired.push({ id: String(row.id), lastCheckedAt: Number(row.last_checked_at) });
      continue;
    }
    demotionViolations.push({
      id: String(row.id),
      url: String(row.url),
      runs: recent.length,
      consecutiveFailures: failures,
    });
  }
}

// ------------------------------------------------------------- 投影
const backfillPerDay = Math.max(1, Math.round(dailyBudget * backfillShare));
const refreshPerDay = Math.max(0, dailyBudget - backfillPerDay);
const daysToClearUnchecked = unchecked > 0 ? Math.ceil(unchecked / backfillPerDay) : 0;
const daysToRefreshAll = refreshPerDay > 0 ? Math.ceil(checked / refreshPerDay) : null;
const freshnessFeasible = daysToRefreshAll !== null && daysToRefreshAll <= SLO.freshnessWindowDays;
/** 要在一个新鲜度窗口内轮完全部已探测站点，需要的复核名额/天 */
const refreshNeededPerDay = checked > 0 ? Math.ceil(checked / SLO.freshnessWindowDays) : 0;
/** 同时满足「7 天内轮完已探测」与「X 天内清空未探测」所需的日预算 */
const budgetForBothSlo = refreshNeededPerDay + Math.ceil(unchecked / 90);

const metrics = {
  db: dbPath,
  total,
  active: Number(base.active ?? 0),
  broken: Number(base.broken ?? 0),
  checked,
  unchecked,
  coveragePct: pct(checked, total),
  untestedRatePct: pct(unchecked, total),
  stale,
  staleRatePct,
  categories: {
    counted: bigCategories.length,
    small: smallCategories.length,
    worst: worstCategory,
    overSlo: categoriesOverSlo.slice(0, 10),
    maxUncheckedPct: maxCategoryUncheckedPct,
  },
  invariants: {
    failThreshold,
    inconsistentHealth: inconsistent,
    demotionViolations,
    /** 手工 setStatus 置 broken（health_ok ≠ 0），不归阈值判据管 */
    manualBroken,
    /** broken 但巡检历史已被 180 天保留策略清空，无法复核 */
    evidenceExpired,
  },
  budget: {
    dailyLimit: dailyBudget,
    backfillShare,
    backfillPerDay,
    refreshPerDay,
    daysToClearUnchecked,
    daysToRefreshAll,
    refreshNeededPerDay,
    budgetForBothSlo,
    freshnessFeasible,
  },
};

const sloProblems = [];
if (checked > 0 && staleRatePct > SLO.staleRatePct) {
  sloProblems.push(
    `已探测样本里超过 ${SLO.freshnessWindowDays} 天的占 ${staleRatePct}% > ${SLO.staleRatePct}%（${stale}/${checked}）`,
  );
}
if (worstCategory && worstCategory.uncheckedPct > SLO.categoryUncheckedPct) {
  sloProblems.push(
    `类目 ${worstCategory.categoryId} 未探测占比 ${worstCategory.uncheckedPct}% > ${SLO.categoryUncheckedPct}%（${worstCategory.unchecked}/${worstCategory.total}），共 ${categoriesOverSlo.length} 个类目超标`,
  );
}

const invariantProblems = [];
if (inconsistent > 0) {
  invariantProblems.push(`${inconsistent} 条站点有 lastCheckedAt 但 health_ok 为 NULL：写路径不一致`);
}
if (demotionViolations.length > 0) {
  invariantProblems.push(
    `${demotionViolations.length} 条 broken 站点缺「连续 ${failThreshold} 次失败」证据：` +
      demotionViolations
        .slice(0, 5)
        .map((v) => `${v.id}(巡检 ${v.runs} 次/失败 ${v.consecutiveFailures} 次)`)
        .join("、"),
  );
}

if (asJson) {
  console.log(JSON.stringify({ metrics, slo: { targets: SLO, problems: sloProblems }, invariants: { problems: invariantProblems } }, null, 2));
} else {
  console.log(`[health-coverage] 库：${dbPath}`);
  console.log(
    `[health-coverage] 活跃站点 ${total}（active ${metrics.active} / broken ${metrics.broken}）｜已探测 ${checked}｜未探测 ${unchecked}`,
  );
  console.log(
    `[health-coverage] 覆盖率 ${metrics.coveragePct}%｜未探测占比 ${metrics.untestedRatePct}%`,
  );
  console.log(
    `[health-coverage] ① 新鲜度：超过 ${SLO.freshnessWindowDays} 天 ${stale}/${checked} = ${staleRatePct}%（目标 ≤${SLO.staleRatePct}%）`,
  );
  if (worstCategory) {
    console.log(
      `[health-coverage] ② 类目：最差 ${worstCategory.categoryId} 未探测 ${worstCategory.uncheckedPct}%（${worstCategory.unchecked}/${worstCategory.total}，目标 ≤${SLO.categoryUncheckedPct}%）｜超标 ${categoriesOverSlo.length}/${bigCategories.length} 个类目`,
    );
  } else {
    console.log(`[health-coverage] ② 类目：没有 ≥${SLO.minCategorySize} 条站点的类目，占比无统计意义`);
  }
  console.log(
    `[health-coverage] ③ 降级证据：broken ${metrics.broken} 条｜按巡检降级 ${metrics.broken - manualBroken} 条（无「连续 ${failThreshold} 次失败」证据 ${demotionViolations.length} / 历史超 ${RETENTION_DAYS} 天已清理 ${evidenceExpired.length}）｜手工置 broken ${manualBroken} 条｜写路径不一致 ${inconsistent} 条`,
  );
  console.log(
    `[health-coverage] 预算：日 ${dailyBudget} = 补探 ${backfillPerDay} + 复核 ${refreshPerDay}（share ${backfillShare}）`,
  );
  console.log(
    `[health-coverage] 投影：清空未探测 ${daysToClearUnchecked} 天｜已探测轮完一遍 ${daysToRefreshAll ?? "∞"} 天（需 ≤${SLO.freshnessWindowDays}）`,
  );
  console.log(
    `[health-coverage] 两条 SLO 同时满足需要 ≈${budgetForBothSlo}/天（复核 ${refreshNeededPerDay} + 补探 ${Math.ceil(unchecked / 90)}，后者按 90 天清空折算）`,
  );
  if (sloProblems.length) {
    for (const p of sloProblems) console.log(`[health-coverage] ⚠ SLO：${p}`);
  } else {
    console.log("[health-coverage] ✅ SLO：两项均在阈值内");
  }
  if (invariantProblems.length) {
    for (const p of invariantProblems) console.error(`[health-coverage] ❌ 不变量：${p}`);
  } else {
    console.log("[health-coverage] ✅ 不变量：降级都有证据、写路径一致");
  }
}

db.close();

if (!asCheck) process.exit(0);
if (invariantProblems.length > 0) process.exit(1);
if (asStrict && sloProblems.length > 0) process.exit(1);
process.exit(0);
