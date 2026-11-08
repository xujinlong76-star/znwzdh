/**
 * `scripts/check-health-coverage.mjs` 的守卫（2026-11-07 九维评审 4-2）。
 *
 * 为什么要这份测试：这个脚本是**运维侧**的 SLO 观测器，读的是真实库
 * `data/navhub.db`，而 CI 里没有那份 66 MB 的库。如果只交付脚本本身，
 * 它就会重演本报告归并的 R3 根因——「工具齐备、却不在主链自动执行」，
 * 连它自己的算法有没有写错都没人知道。所以用**夹具库**把三条 SLO 的
 * 计算与 `--check` / `--strict` 的判定方向钉进 CI。
 *
 * 夹具库只建脚本真正查询的列，不跑迁移：这样测试跑得快，也顺带证明
 * 脚本没有偷偷依赖别的表（一旦依赖，这里会直接报 no such column）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(REPO_ROOT, "scripts/check-health-coverage.mjs");
const requireFromRoot = createRequire(import.meta.url);

const Database = requireFromRoot(
  requireFromRoot.resolve("better-sqlite3", {
    paths: [REPO_ROOT, join(REPO_ROOT, "apps/api"), join(REPO_ROOT, "packages/store")],
  }),
);

const DAY = 86_400_000;
let dir: string;
let seq = 0;

/** 跑脚本；非零退出码是被断言的结果，不是异常 */
function run(args: string[], env: Record<string, string> = {}) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    return { status: 0, out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

interface SiteSeed {
  id: string;
  categoryId?: string;
  status?: string;
  /** null = 从未探测 */
  lastCheckedAt: number | null;
  /** undefined = 跟随 lastCheckedAt 推断 */
  healthOk?: number | null;
  /** 只给 broken 站点用：倒序写入的巡检历史（true=成功） */
  history?: boolean[];
}

function buildDb(sites: SiteSeed[]): string {
  const path = join(dir, `fixture-${++seq}.db`);
  const db = new Database(path);
  db.exec(`
    CREATE TABLE sites (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      category_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      enabled INTEGER NOT NULL DEFAULT 1,
      deleted_at INTEGER,
      last_checked_at INTEGER,
      health_ok INTEGER
    );
    CREATE TABLE health_checks (
      site_id TEXT NOT NULL,
      checked_at INTEGER NOT NULL,
      ok INTEGER NOT NULL
    );
  `);
  const insertSite = db.prepare(
    `INSERT INTO sites (id, url, category_id, status, enabled, deleted_at, last_checked_at, health_ok)
     VALUES (?, ?, ?, ?, 1, NULL, ?, ?)`,
  );
  const insertCheck = db.prepare("INSERT INTO health_checks (site_id, checked_at, ok) VALUES (?, ?, ?)");
  const now = Date.now();
  for (const s of sites) {
    const healthOk = s.healthOk !== undefined ? s.healthOk : s.lastCheckedAt === null ? null : 1;
    insertSite.run(
      s.id,
      `https://${s.id}.example.com`,
      s.categoryId ?? "cat-a",
      s.status ?? "active",
      s.lastCheckedAt,
      healthOk,
    );
    // history 按「最近在前」书写，写入时倒序转成时间递增
    if (s.history) {
      s.history.forEach((ok, i) => {
        insertCheck.run(s.id, now - i * 60_000, ok ? 1 : 0);
      });
    }
  }
  db.close();
  return path;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "navhub-coverage-script-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("check-health-coverage：SLO 计算", () => {
  it("干净夹具：覆盖率、新鲜度、类目占比三项可复算", () => {
    const now = Date.now();
    const sites: SiteSeed[] = [];
    // 一个类目 10 条：8 条 1 天内查过、2 条从未探测 ⇒ 未探测 20%（正好不超）
    for (let i = 0; i < 8; i++) sites.push({ id: `ok-${i}`, lastCheckedAt: now - DAY });
    for (let i = 0; i < 2; i++) sites.push({ id: `new-${i}`, lastCheckedAt: null });

    const db = buildDb(sites);
    const res = run([`--db=${db}`, "--json"]);
    expect(res.status).toBe(0);
    const j = JSON.parse(res.out);
    expect(j.metrics.total).toBe(10);
    expect(j.metrics.checked).toBe(8);
    expect(j.metrics.unchecked).toBe(2);
    expect(j.metrics.coveragePct).toBe(80);
    expect(j.metrics.untestedRatePct).toBe(20);
    expect(j.metrics.stale).toBe(0);
    expect(j.metrics.staleRatePct).toBe(0);
    expect(j.metrics.categories.maxUncheckedPct).toBe(20);
    expect(j.slo.problems).toEqual([]);
  });

  it("新鲜度按「已探测样本」为分母，不把未探测算成陈旧", () => {
    const now = Date.now();
    const sites: SiteSeed[] = [
      { id: "fresh", lastCheckedAt: now - 1 * DAY },
      { id: "stale", lastCheckedAt: now - 30 * DAY },
      // 未探测站点：既不算新鲜也不算陈旧，只进 untestedRate
      ...Array.from({ length: 8 }, (_, i) => ({ id: `new-${i}`, lastCheckedAt: null as null })),
    ];
    const j = JSON.parse(run([`--db=${buildDb(sites)}`, "--json"]).out);
    expect(j.metrics.checked).toBe(2);
    expect(j.metrics.stale).toBe(1);
    expect(j.metrics.staleRatePct).toBe(50);
    expect(j.metrics.untestedRatePct).toBe(80);
  });

  it("小类目（<5 条站点）不参与 20% 判定，但计入 small 计数", () => {
    const now = Date.now();
    const sites: SiteSeed[] = [
      // 大厂类目：5 条里 1 条未探测 = 20%
      ...Array.from({ length: 4 }, (_, i) => ({ id: `big-${i}`, categoryId: "cat-big", lastCheckedAt: now - DAY })),
      { id: "big-new", categoryId: "cat-big", lastCheckedAt: null },
      // 小类目：1 条未探测 = 100%，但只有 1 条站点
      { id: "tiny-new", categoryId: "cat-tiny", lastCheckedAt: null },
    ];
    const j = JSON.parse(run([`--db=${buildDb(sites)}`, "--json"]).out);
    expect(j.metrics.categories.counted).toBe(1);
    expect(j.metrics.categories.small).toBe(1);
    expect(j.metrics.categories.maxUncheckedPct).toBe(20);
    expect(j.slo.problems).toEqual([]);
  });

  it("预算投影自洽：日预算 = 补探 + 复核，且投影天数用向上取整", () => {
    const now = Date.now();
    const sites: SiteSeed[] = [
      ...Array.from({ length: 100 }, (_, i) => ({ id: `c-${i}`, lastCheckedAt: now - DAY })),
      ...Array.from({ length: 101 }, (_, i) => ({ id: `u-${i}`, lastCheckedAt: null as null })),
    ];
    const j = JSON.parse(run([`--db=${buildDb(sites)}`, "--json"]).out);
    const b = j.metrics.budget;
    expect(b.dailyLimit).toBe(100);
    expect(b.backfillPerDay + b.refreshPerDay).toBe(100);
    expect(b.daysToClearUnchecked).toBe(Math.ceil(101 / b.backfillPerDay));
    expect(b.daysToRefreshAll).toBe(Math.ceil(100 / b.refreshPerDay));
    // 两条 SLO 同时满足所需预算必须高于「只做复核」的下限
    expect(b.budgetForBothSlo).toBeGreaterThan(b.refreshNeededPerDay);
  });
});

describe("check-health-coverage：--check 只判不变量，--strict 才判 SLO", () => {
  it("SLO 超标但降级有证据 ⇒ --check 绿、--strict 红", () => {
    const now = Date.now();
    const sites: SiteSeed[] = [
      ...Array.from({ length: 5 }, (_, i) => ({ id: `ok-${i}`, lastCheckedAt: now - 1 * DAY })),
      ...Array.from({ length: 5 }, (_, i) => ({ id: `new-${i}`, lastCheckedAt: null as null })),
    ];
    const db = buildDb(sites);
    expect(run([`--db=${db}`, "--check"]).status, "不变量没破，--check 不该红").toBe(0);
    const strict = run([`--db=${db}`, "--check", "--strict"]);
    expect(strict.status, "SLO 50% > 20%，--strict 应判红").toBe(1);
    expect(strict.out).toContain("未探测占比 50%");
  });

  it("broken 缺「连续 3 次失败」证据 ⇒ --check 判红（这正是验收标准 3 的反面）", () => {
    const now = Date.now();
    const sites: SiteSeed[] = [
      { id: "demoted", status: "broken", lastCheckedAt: now - DAY, healthOk: 0, history: [false] },
    ];
    const res = run([`--db=${buildDb(sites)}`, "--check"]);
    expect(res.status).toBe(1);
    expect(res.out).toContain("缺「连续 3 次失败」证据");
    expect(res.out).toContain("demoted");
  });

  it("broken 有 3 次连续失败 ⇒ 不变量通过", () => {
    const now = Date.now();
    const sites: SiteSeed[] = [
      { id: "legit", status: "broken", lastCheckedAt: now - DAY, healthOk: 0, history: [false, false, false] },
    ];
    expect(run([`--db=${buildDb(sites)}`, "--check"]).status).toBe(0);
  });

  it("最近 3 次里有 1 次成功 ⇒ 仍判红（说明降级绕过了「连续」语义）", () => {
    const now = Date.now();
    const sites: SiteSeed[] = [
      { id: "flappy", status: "broken", lastCheckedAt: now - DAY, healthOk: 0, history: [false, false, true] },
    ];
    const res = run([`--db=${buildDb(sites)}`, "--check"]);
    expect(res.status).toBe(1);
    expect(res.out).toContain("flappy");
  });

  it("lastCheckedAt 有值但 health_ok 为 NULL ⇒ 判写路径不一致", () => {
    const sites: SiteSeed[] = [{ id: "half-written", lastCheckedAt: Date.now() - DAY, healthOk: null }];
    const res = run([`--db=${buildDb(sites)}`, "--check"]);
    expect(res.status).toBe(1);
    expect(res.out).toContain("写路径不一致");
  });

  it("手工 setStatus 置 broken（health_ok ≠ 0）不算违规：那条路径本来就不写 health_checks", () => {
    const now = Date.now();
    const sites: SiteSeed[] = [
      { id: "manual", status: "broken", lastCheckedAt: now - DAY, healthOk: 1, history: [] },
    ];
    const res = run([`--db=${buildDb(sites)}`, "--check", "--json"]);
    expect(res.status).toBe(0);
    const j = JSON.parse(res.out);
    expect(j.metrics.invariants.demotionViolations).toEqual([]);
    expect(j.metrics.invariants.manualBroken).toBe(1);
  });

  it("巡检历史超过 180 天被保留策略清空 ⇒ 单列 evidenceExpired，不判红", () => {
    const sites: SiteSeed[] = [
      { id: "old-broken", status: "broken", lastCheckedAt: Date.now() - 200 * DAY, healthOk: 0, history: [] },
    ];
    const res = run([`--db=${buildDb(sites)}`, "--check", "--json"]);
    expect(res.status).toBe(0);
    const j = JSON.parse(res.out);
    expect(j.metrics.invariants.demotionViolations).toEqual([]);
    expect(j.metrics.invariants.evidenceExpired).toEqual([{ id: "old-broken", lastCheckedAt: expect.any(Number) }]);
  });

  it("库不存在 ⇒ EXIT=2（不是把它当成绿灯）", () => {
    const res = run([`--db=${join(dir, "no-such.db")}`, "--check"]);
    expect(res.status).toBe(2);
    expect(res.out).toContain("找不到数据库");
  });
});
