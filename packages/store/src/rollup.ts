/**
 * 明细聚合（rollup）：把 `events` / `audit_logs` 里过期到期的明细行压成一行行日统计，
 * 再删掉明细 —— 回答的是"过期数据只能原样归档吗？能不能删明细、留统计"。
 *
 * 与同目录 {@link ./retention.ts} 的分工：
 *   - retention.ts：**保留原样**，把过期行逐条写冷归档再删（要能回溯到单行）。
 *   - rollup.ts：**舍明细保统计**，先把一天聚合完写进目标表，再删这一天的明细。
 *     归档文件会随时间变成纯粹的磁盘成本，而热度/趋势只关心"某天某类发生了多少次"。
 *   两者共用同一个 {@link RetentionAdapter} 端口，因此同样方言无关、同样可单测。
 *
 * 关键设计：
 *   - **按整天推进，不拆半天**：只汇总"整天都已过期"的日期。若某天里还有没到期的行，
 *     那这一天整轮跳过（留给下次），否则聚合值会被后续的重复运行反复覆盖、越算越小。
 *   - **先写聚合后删明细，且以天为单位**：某天的所有分组都 upsert 完之后才删这一天的行。
 *     中途崩溃最多是"明细还在、聚合已写好"，重跑会得到同样的结果（upsert 是覆盖语义）。
 *   - **upsert 用覆盖而非累加**：`ON CONFLICT DO UPDATE SET total = excluded.total`。
 *     累加语义下一次重跑就会翻倍；覆盖语义天然幂等。
 *   - **默认 dry-run**：不显式传 `dryRun: false` 只统计不落表不删行。
 *
 * 为什么只有"日"没有"月"：月长度不固定，无法像日那样用 `created_at - created_at % 86400000`
 * 一步算出桶起点（SQLite 与 PG 的日期函数各不相同，写两套会破坏方言无关）。
 * 日聚合本身已有约 30 倍压缩，月度口径从日聚合表再 GROUP BY 一次即可，不需要单独的物理表。
 */

import type { RetentionAdapter, RetentionRow, RetentionTable } from "./retention.ts";

const DAY_MS = 86_400_000;

/** 建表方言：只有这一处需要区分 —— 业务逻辑全是两库通用的 SQL。 */
export type RollupDialect = "sqlite" | "postgres";

/** 聚合维度。列名最终会拼进 SQL，只允许来自本文件内的常量（见 assertIdent）。 */
export interface RollupGroupColumn {
  /** 源表列名。 */
  column: string;
  /** 目标表列名。 */
  alias: string;
  /**
   * 是否把 NULL 归一化成空串。
   * 必须归一化才能建唯一约束：SQLite 与 PG 的 UNIQUE 都把多个 NULL 视为互不相等，
   * 若允许 NULL，同一天的同一个"无站点"分组会被反复 INSERT 出多行。
   */
  coalesce?: boolean;
}

export interface RollupSpec {
  /** 源表（复用保留策略的白名单）。 */
  table: RetentionTable;
  /** 目标聚合表名。 */
  dest: string;
  /** 分组维度，顺序决定唯一键顺序。 */
  groups: readonly RollupGroupColumn[];
  /** 额外统计的去重计数列（可选）。COUNT(DISTINCT) 在两种方言里都忽略 NULL。 */
  distinct?: { column: string; alias: string };
}

/** events → events_daily：按天 × 事件类型 × 站点，统计次数与去重身份数。 */
export const EVENT_DAILY_ROLLUP: RollupSpec = {
  table: "events",
  dest: "events_daily",
  groups: [
    { column: "kind", alias: "kind" },
    { column: "site_id", alias: "site_key", coalesce: true },
  ],
  distinct: { column: "identity", alias: "identities" },
};

/** audit_logs → audit_daily：按天 × 动作 × 操作者类型，统计次数与去重操作者数。 */
export const AUDIT_DAILY_ROLLUP: RollupSpec = {
  table: "audit_logs",
  dest: "audit_daily",
  groups: [
    { column: "action", alias: "action" },
    { column: "actor_kind", alias: "actor_kind" },
  ],
  distinct: { column: "actor", alias: "actors" },
};

export interface RollupTarget {
  spec: RollupSpec;
  /** 保留天数：created_at 早于 `now - keepDays` 的整天才会被聚合。 */
  keepDays: number;
}

/** 默认策略与保留清理一致：行为事件 180 天、审计日志 365 天。 */
export const DEFAULT_ROLLUP_TARGETS: RollupTarget[] = [
  { spec: EVENT_DAILY_ROLLUP, keepDays: 180 },
  { spec: AUDIT_DAILY_ROLLUP, keepDays: 365 },
];

export interface RollupOptions {
  /** 要聚合的表与保留天数，默认 {@link DEFAULT_ROLLUP_TARGETS}。 */
  targets?: readonly RollupTarget[];
  /** 基准时间（毫秒），默认 Date.now()。测试里注入固定值。 */
  now?: number;
  /** 单表单轮最多处理多少天，默认 30。超出即收尾并标记 truncated，下一轮继续。 */
  maxDaysPerRun?: number;
  /**
   * 单天最多接受多少个分组，默认 5000。
   * 超出的**整天跳过**（不写聚合也不删行）——宁可留着明细，也不能写一半聚合就删明细。
   */
  maxGroupsPerDay?: number;
  /** 默认 true（只统计）。传 false 才写聚合表并删明细。 */
  dryRun?: boolean;
  /** 是否自动建目标表（默认仅 apply 时建，dry-run 不动 schema）。 */
  ensureTable?: boolean;
  /** 建表方言，默认 sqlite。 */
  dialect?: RollupDialect;
  /** 每天结束回调，用于打日志。 */
  onDay?: (info: {
    table: RetentionTable;
    dayStart: number;
    groups: number;
    rows: number;
    deleted: number;
    skipped?: string;
  }) => void;
}

export interface RollupTableResult {
  table: RetentionTable;
  dest: string;
  keepDays: number;
  /** 理论截止时间（毫秒）：严格小于它的行已过期。 */
  cutoff: number;
  /** 实际推进到的日边界：只有整天都早于它的日期会被聚合（见文件头"按整天推进"）。 */
  effectiveCutoff: number;
  /** 已处理的天数。 */
  days: number;
  /** 写入（dry-run 下为将要写入）的聚合行数。 */
  groups: number;
  /** 被聚合的明细行数（各分组 total 之和）。 */
  rows: number;
  /** 实际删除的明细行数。dry-run 恒为 0。 */
  deleted: number;
  /** 因超过 maxGroupsPerDay 被跳过的天数。 */
  skippedDays: number;
  /** 是否因达到 maxDaysPerRun 提前收尾（不表示已经没有更旧的数据了）。 */
  truncated: boolean;
}

export interface RollupResult {
  startedAt: number;
  dryRun: boolean;
  dialect: RollupDialect;
  tables: RollupTableResult[];
}

const IDENT = /^[a-z][a-z0-9_]*$/;

/** 聚合 SQL 里有表名/列名拼接；这一步是防注入的唯一闸门，任何外部构造的 spec 都过不了。 */
function assertIdent(name: string, what: string): void {
  if (!IDENT.test(name)) {
    throw new Error(`非法的${what}: ${name}（只允许小写字母、数字与下划线）`);
  }
}

function auditSpec(spec: RollupSpec): void {
  assertIdent(spec.table, "源表名");
  assertIdent(spec.dest, "聚合表名");
  if (!spec.groups.length) throw new Error(`${spec.dest}: 至少要有一个分组维度`);
  for (const g of spec.groups) {
    assertIdent(g.column, "源表列名");
    assertIdent(g.alias, "聚合表列名");
  }
  if (spec.distinct) {
    assertIdent(spec.distinct.column, "去重列名");
    assertIdent(spec.distinct.alias, "去重统计列名");
  }
}

/** 生成聚合表 DDL。两处差异：主键自增写法与整数类型名。 */
export function rollupDdl(spec: RollupSpec, dialect: RollupDialect = "sqlite"): string {
  auditSpec(spec);
  const pg = dialect === "postgres";
  const intType = pg ? "BIGINT" : "INTEGER";
  const pk = pg ? "id BIGSERIAL PRIMARY KEY" : "id INTEGER PRIMARY KEY AUTOINCREMENT";
  const cols = [
    pk,
    `day_start ${intType} NOT NULL`,
    ...spec.groups.map((g) => `${g.alias} TEXT NOT NULL DEFAULT ''`),
    `total ${intType} NOT NULL DEFAULT 0`,
    ...(spec.distinct ? [`${spec.distinct.alias} ${intType} NOT NULL DEFAULT 0`] : []),
    `updated_at ${intType} NOT NULL`,
    `UNIQUE(day_start, ${spec.groups.map((g) => g.alias).join(", ")})`,
  ];
  return `CREATE TABLE IF NOT EXISTS ${spec.dest} (\n  ${cols.join(",\n  ")}\n)`;
}

/** 分组表达式。COALESCE 归一化的列同时也是唯一键的一部分，见 {@link RollupGroupColumn.coalesce}。 */
function groupExpr(g: RollupGroupColumn): string {
  return g.coalesce ? `COALESCE(${g.column}, '') AS ${g.alias}` : `${g.column} AS ${g.alias}`;
}

/**
 * 按天聚合过期明细并删除已聚合的明细行。
 *
 * @returns 每张表的天数/分组数/明细行数/删除行数统计。dryRun 时 groups 与 rows 反映"将要发生什么"，deleted 恒为 0。
 */
export async function runRollup(adapter: RetentionAdapter, options: RollupOptions = {}): Promise<RollupResult> {
  const now = options.now ?? Date.now();
  const dryRun = options.dryRun ?? true;
  const dialect = options.dialect ?? "sqlite";
  const maxDays = Math.max(1, Math.floor(options.maxDaysPerRun ?? 30));
  const maxGroups = options.maxGroupsPerDay ?? 5000;
  const ensureTable = options.ensureTable ?? !dryRun;
  const targets = options.targets ?? DEFAULT_ROLLUP_TARGETS;
  const p = (i: number) => adapter.placeholder(i);
  const tables: RollupTableResult[] = [];

  for (const target of targets) {
    const { spec, keepDays } = target;
    auditSpec(spec);
    if (!(keepDays > 0)) {
      throw new Error(`保留天数必须为正数，收到 keepDays=${keepDays}（table=${spec.table}）`);
    }
    if (ensureTable) {
      await adapter.execute(rollupDdl(spec, dialect), []);
    }

    const cutoff = now - keepDays * DAY_MS;
    // 只对"整天都过期"的日做聚合：向下取整到日边界，保证这一天内不会再有新行到期。
    const effectiveCutoff = Math.floor(cutoff / DAY_MS) * DAY_MS;
    const result: RollupTableResult = {
      table: spec.table,
      dest: spec.dest,
      keepDays,
      cutoff,
      effectiveCutoff,
      days: 0,
      groups: 0,
      rows: 0,
      deleted: 0,
      skippedDays: 0,
      truncated: false,
    };

    const groupCols = spec.groups.map(groupExpr).join(", ");
    const groupBy = spec.groups.map((_, i) => String(i + 1)).join(", ");
    const distinctSql = spec.distinct ? `, COUNT(DISTINCT ${spec.distinct.column}) AS ${spec.distinct.alias}` : "";
    const destCols = ["day_start", ...spec.groups.map((g) => g.alias), "total", ...(spec.distinct ? [spec.distinct.alias] : []), "updated_at"];
    const conflictCols = ["day_start", ...spec.groups.map((g) => g.alias)];
    const updateCols = ["total = excluded.total", ...(spec.distinct ? [`${spec.distinct.alias} = excluded.${spec.distinct.alias}`] : []), "updated_at = excluded.updated_at"];
    const insertSql =
      `INSERT INTO ${spec.dest} (${destCols.join(", ")}) ` +
      `VALUES (${destCols.map((_, i) => p(i + 1)).join(", ")}) ` +
      `ON CONFLICT(${conflictCols.join(", ")}) DO UPDATE SET ${updateCols.join(", ")}`;

    const daysSql =
      `SELECT (created_at - (created_at % ${DAY_MS})) AS day_start ` +
      `FROM ${spec.table} WHERE created_at < ${p(1)} GROUP BY 1 ORDER BY 1 LIMIT ${p(2)}`;

    // 多趟推进：一趟最多处理剩余的 maxDays 天（多查 1 天用来判断"后面还有没有"）。
    // 跳过过的日期记进 seenSkipped：下一趟不再取它，否则明细没删、永远停在同一天。
    const seenSkipped = new Set<number>();

    for (;;) {
      const remaining = maxDays - result.days;
      if (remaining <= 0) {
        result.truncated = true;
        break;
      }
      const dayRows = await adapter.select(daysSql, [effectiveCutoff, remaining + 1]);
      const days = dayRows.filter((r) => !seenSkipped.has(Number(r.day_start))).slice(0, remaining);
      if (dayRows.length > remaining) result.truncated = true;
      if (!days.length) break;

      let processed = 0;

      for (const dayRow of days) {
        const dayStart = Number(dayRow.day_start);
        const dayEnd = dayStart + DAY_MS;
        const window = [dayStart, dayEnd] as const;

        const rows: RetentionRow[] = await adapter.select(
          `SELECT ${groupCols}, COUNT(*) AS total${distinctSql} ` +
            `FROM ${spec.table} WHERE created_at >= ${p(1)} AND created_at < ${p(2)} GROUP BY ${groupBy}`,
          [...window],
        );

        const skipped =
          maxGroups > 0 && rows.length > maxGroups
            ? `该日分组数 ${rows.length} 超过上限 ${maxGroups}，整轮跳过（明细保留，未被删除）`
            : undefined;

        if (skipped) {
          seenSkipped.add(dayStart);
          result.skippedDays++;
          options.onDay?.({ table: spec.table, dayStart, groups: rows.length, rows: 0, deleted: 0, skipped });
          continue;
        }

        let aggregated = 0;
        for (const r of rows) {
          aggregated += Number(r.total ?? 0);
          if (!dryRun) {
            await adapter.execute(insertSql, [
              dayStart,
              ...spec.groups.map((g) => String(r[g.alias] ?? "")),
              Number(r.total ?? 0),
              ...(spec.distinct ? [Number(r[spec.distinct.alias] ?? 0)] : []),
              now,
            ]);
          }
        }
        result.groups += rows.length;
        result.rows += aggregated;
        result.days++;
        processed++;

        let deleted = 0;
        if (!dryRun) {
          // 这一天的所有分组都已 upsert 完，才轮到删明细
          deleted = await adapter.execute(
            `DELETE FROM ${spec.table} WHERE created_at >= ${p(1)} AND created_at < ${p(2)}`,
            [...window],
          );
          result.deleted += deleted;
        }
        options.onDay?.({ table: spec.table, dayStart, groups: rows.length, rows: aggregated, deleted });
      }

      // dry-run 不删行，再查还是同一批日期；这一趟没有任何一天被写走时也必须停
      if (dryRun || processed === 0) break;
    }

    tables.push(result);
  }

  return { startedAt: now, dryRun, dialect, tables };
}
