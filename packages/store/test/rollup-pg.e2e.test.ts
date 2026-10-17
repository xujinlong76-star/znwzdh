/**
 * rollup 的 PostgreSQL 方言端到端（**真实 PG**，CI 的 `test-postgres` job 注入连接串）。
 *
 * 为什么单独立一个文件，而不是并进 `pg-dialect.e2e.test.ts`：
 *   - 后者验的是 Repository 的同一批断言跨方言一致；rollup 不是 Repository 的方法，
 *     它是数据治理侧的独立模块，要验的东西不一样。
 *   - 这里真正想抓的是"同一套 SQL 在 PG 上真的能跑"：`$n` 占位符、`LIMIT $2`、
 *     `GROUP BY 1,2` 序号写法、`ON CONFLICT(目标列)`、`COUNT(DISTINCT)` 忽略 NULL、
 *     以及 PG 把 COUNT/BIGINT 回传成**字符串**这一点（`runRollup` 里全部 Number() 过一遍）。
 *
 * 隔离方式：vitest 用多 worker 并行跑文件，而同一个库里还跑着别的 PG 套件，
 * 所以本套件独占 `rollup_e2e` schema（`SET search_path` 后按裸表名写 SQL），
 * 结束即 `DROP SCHEMA ... CASCADE`，不留下任何公共 schema 的痕迹。
 *
 * 未设置 `NAVHUB_TEST_DATABASE_URL`（或连不上）时整套 skip —— 本地无 PG 的开发机
 * 不该被这个文件弄红。CI 里设了就必须连上并全绿。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { runRollup, EVENT_DAILY_ROLLUP, AUDIT_DAILY_ROLLUP, type RollupResult, type RollupTableResult } from "../src/rollup.ts";
import type { RetentionAdapter } from "../src/retention.ts";

const DATABASE_URL = process.env.NAVHUB_TEST_DATABASE_URL;
const SCHEMA = "rollup_e2e";
const DAY = 86_400_000;

const skip = DATABASE_URL ? false : "未设置 NAVHUB_TEST_DATABASE_URL（需真实 PostgreSQL；CI 的 test-postgres job 注入）";

let client: { query: (sql: string, params?: readonly unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>; end: () => Promise<void> } | null = null;
let connectError: string | null = null;

if (DATABASE_URL) {
  try {
    // pnpm 严格布局下 pg 是 packages/store 的依赖，从本文件位置回退解析
    const require = createRequire(import.meta.url);
    const pg = require(path.join(process.cwd(), "packages/store/node_modules/pg"));
    const raw = new pg.Client({ connectionString: DATABASE_URL });
    await raw.connect();
    client = raw;
  } catch (err) {
    connectError = err instanceof Error ? err.message : String(err);
  }
}

/** 固定基准日边界，避免测试跨天抖动（与 SQLite 套件同一个 NOW）。 */
const NOW = Date.UTC(2026, 9, 17);
const dayStart = (daysAgo: number) => NOW - daysAgo * DAY;

/** 取第 n 张表的统计（noUncheckedIndexedAccess 下下标访问要先判空）。 */
function tableAt(result: RollupResult, n: number): RollupTableResult {
  const t = result.tables[n];
  if (!t) throw new Error(`聚合结果里没有第 ${n} 张表的统计`);
  return t;
}

describe.skipIf(!client)("跨方言：rollup 在 PostgreSQL 上与 SQLite 行为一致", () => {
  beforeAll(async () => {
    if (!client) return;
    // 上一轮若中途崩了，先清干净再建（schema 级隔离，不碰 public）
    await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await client.query(`CREATE SCHEMA ${SCHEMA}`);
    await client.query(`SET search_path TO ${SCHEMA}`);
    // 复用 driver 的真 PG DDL：events/audit_logs 的列与生产一致（含 identity）
    const { DDL } = await import(pathToFileURL(path.join(process.cwd(), "packages/store/src/driver.ts")).href);
    await client.query(DDL.pg);

    // 播种：3 个整天（400/399/398 天前）+ 1 个未到期的近期日
    for (const d of [400, 399, 398]) {
      for (const [kind, site, ident] of [
        ["visit", "s1", "u1"],
        ["visit", "s1", "u1"],
        ["search", null, "u2"],
        ["visit", "s2", "u3"],
      ] as const) {
        await client.query(
          "INSERT INTO events (kind, site_id, identity, created_at) VALUES ($1, $2, $3, $4)",
          [kind, site, ident, dayStart(d) + 3_600_000],
        );
      }
    }
    await client.query("INSERT INTO events (kind, site_id, identity, created_at) VALUES ('visit', 's1', 'u9', $1)", [
      dayStart(1),
    ]);
    await client.query("INSERT INTO audit_logs (actor, actor_kind, action, created_at) VALUES ('admin', 'user', 'site.update', $1)", [
      dayStart(400),
    ]);
    await client.query("INSERT INTO audit_logs (actor, actor_kind, action, created_at) VALUES ('ops', 'token', 'site.update', $1)", [
      dayStart(400),
    ]);
  }, 60_000);

  afterAll(async () => {
    if (!client) return;
    try {
      await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    } catch {
      /* 连不上时 close 也会失败，别让报错盖住真正的失败原因 */
    }
    await client.end();
  });

  it("连接串可用（连不上时说明 skip 判定漏了）", () => {
    expect(client).not.toBeNull();
    expect(connectError).toBeNull();
  });

  it("dry-run 只统计：不建聚合表、不删明细", async () => {
    const adapter = makeAdapter();
    const result = await runRollup(adapter, { targets: [{ spec: EVENT_DAILY_ROLLUP, keepDays: 180 }], now: NOW, dryRun: true });

    expect(tableAt(result, 0).rows).toBe(12); // 3 天 × 4 行
    expect(tableAt(result, 0).deleted).toBe(0);
    const left = await adapter.select("SELECT COUNT(*) AS c FROM events", []);
    expect(Number(left[0]?.c)).toBe(13); // 12 + 1 行近期
    const table = await adapter.select(
      "SELECT to_regclass($1) AS t",
      [`${SCHEMA}.events_daily`],
    );
    expect(table[0]?.t).toBeNull(); // dry-run 不建表
  });

  it("apply 后聚合值正确、明细只删已聚合的那几天", async () => {
    const adapter = makeAdapter();
    const result = await runRollup(adapter, {
      targets: [{ spec: EVENT_DAILY_ROLLUP, keepDays: 180 }, { spec: AUDIT_DAILY_ROLLUP, keepDays: 365 }],
      now: NOW,
      dryRun: false,
      dialect: "postgres",
    });

    expect(tableAt(result, 0).days).toBe(3);
    expect(tableAt(result, 0).deleted).toBe(12);
    expect(tableAt(result, 1).deleted).toBe(2);

    const events = await adapter.select(
      `SELECT day_start, kind, site_key, total, identities FROM ${SCHEMA}.events_daily ORDER BY day_start, kind, site_key`,
      [],
    );
    // 每天 4 行：visit/s1×2、search/''×1、visit/s2×1 —— 跨 3 天共 6 个分组
    expect(events).toHaveLength(6);
    const visit = events.filter((r: Record<string, unknown>) => r.kind === "visit" && r.site_key === "s1");
    expect(visit).toHaveLength(3); // 3 天各一条
    for (const row of visit) {
      expect(Number(row.total)).toBe(2);
      expect(Number(row.identities)).toBe(1); // 两天是 u1，一天是 u3 —— 每天各只有 1 个身份
    }
    const search = events.filter((r: Record<string, unknown>) => r.kind === "search");
    expect(search).toHaveLength(3);
    for (const row of search) {
      expect(row.site_key).toBe(""); // NULL 归一化成空串
      expect(Number(row.total)).toBe(1);
    }

    const audit = await adapter.select(
      `SELECT day_start, action, actor_kind, total, actors FROM ${SCHEMA}.audit_daily`,
      [],
    );
    expect(audit).toHaveLength(2);
    expect(audit.every((r: Record<string, unknown>) => Number(r.total) === 1 && Number(r.actors) === 1)).toBe(true);

    // 明细只剩未到期那一行
    const left = await adapter.select("SELECT COUNT(*) AS c FROM events", []);
    expect(Number(left[0]?.c)).toBe(1);
    const auditLeft = await adapter.select("SELECT COUNT(*) AS c FROM audit_logs", []);
    expect(Number(auditLeft[0]?.c)).toBe(0);
  });

  it("重跑幂等：第二次 0 天，聚合值不翻倍", async () => {
    const adapter = makeAdapter();
    const again = await runRollup(adapter, {
      targets: [{ spec: EVENT_DAILY_ROLLUP, keepDays: 180 }, { spec: AUDIT_DAILY_ROLLUP, keepDays: 365 }],
      now: NOW,
      dryRun: false,
      dialect: "postgres",
    });
    expect(tableAt(again, 0).days).toBe(0);
    expect(tableAt(again, 1).days).toBe(0);
    const rows = await adapter.select(`SELECT COUNT(*) AS c FROM ${SCHEMA}.events_daily`, []);
    expect(Number(rows[0]?.c)).toBe(6); // 没有被 upsert 追加
  });

  /** PG 适配器：`$n` 占位符 + rowCount 语义（与生产 openPg 一致）。 */
  function makeAdapter(): RetentionAdapter {
    return {
      placeholder: (i) => `$${i}`,
      select: async (sql, params) => (await client!.query(sql, params)).rows,
      execute: async (sql, params) => (await client!.query(sql, params)).rowCount ?? 0,
    };
  }
});
