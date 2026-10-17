/**
 * 数据保留（TTL / 归档）：给 `events` 与 `audit_logs` 这两张只增不删的表做自动清理。
 *
 * 为什么单独抽一个模块：
 *   - 两张表的行为事件与管理审计日志会随时间线性增长，是磁盘增长的主要来源
 *     （运维手册 wiki/11 §6）；此前只能靠备份 + 人工归档。
 *   - driver 层已有 SQLite / PostgreSQL 两套方言，如果在这里写死 SQL 就要维护两份。
 *     改为由调用方注入 {@link RetentionAdapter}（占位符风格 + 执行方式），
 *     核心逻辑保持方言无关，也因此可以用假 adapter 做单测。
 *
 * 清理策略：
 *   - **先归档后删除**：每一行在被 DELETE 之前先交给 archive 回调落盘。
 *     归档抛错会中断整个流程，不会留下"已删未归档"的窗口。
 *   - **小批量删除**：每批 SELECT 出 N 行再按主键 `IN (...)` 删除。
 *     直接 `DELETE WHERE created_at < ?` 在百万行表上是一个长事务，SQLite 会锁库、
 *     PG 会让 autovacuum 追不上；分批把锁的粒度切碎。
 *   - **默认 dry-run**：不显式传 `dryRun: false` 只统计不删除，避免误操作删库。
 */

/** 支持保留策略的表。白名单也是 SQL 拼接的安全边界（见 assertTable）。 */
export type RetentionTable = "events" | "audit_logs";

const TABLES: readonly RetentionTable[] = ["events", "audit_logs"];

/** 行数据（列名 → 值），由 adapter 原样返回。 */
export type RetentionRow = Record<string, unknown>;

export interface RetentionAdapter {
  /**
   * 返回第 `i` 个（从 1 开始）参数的占位符。
   * SQLite 恒为 `?`，PostgreSQL 为 `$1` / `$2` ……
   */
  placeholder(i: number): string;
  /** 查询，返回行数组。 */
  select(sql: string, params: readonly unknown[]): RetentionRow[] | Promise<RetentionRow[]>;
  /** 执行写操作，返回受影响行数。 */
  execute(sql: string, params: readonly unknown[]): number | Promise<number>;
}

export interface RetentionTarget {
  table: RetentionTable;
  /** 保留天数：created_at 早于 `now - keepDays` 的行才会被清理。 */
  keepDays: number;
}

export interface RetentionOptions {
  /** 要处理的表与保留天数。 */
  targets: RetentionTarget[];
  /** 基准时间（毫秒），默认 Date.now()。测试里注入固定值。 */
  now?: number;
  /** 每批取多少行，默认 1000。 */
  batchSize?: number;
  /**
   * 单表最多扫描多少行后停手（不含删除），默认无限制。
   * dry-run 时扫全表可能很慢，用它做探测上限。
   */
  maxScan?: number;
  /** 默认 true（只统计不删除）。传 false 才真正删除。 */
  dryRun?: boolean;
  /** 归档回调：在删除之前对该行调用一次。 */
  archive?: (table: RetentionTable, row: RetentionRow) => void;
  /** 每批结束回调，用于打日志。 */
  onBatch?: (info: { table: RetentionTable; batch: number; scanned: number; deleted: number }) => void;
}

export interface RetentionTableResult {
  table: RetentionTable;
  keepDays: number;
  /** 实际使用的截止时间（毫秒）；严格小于它的行才清理。 */
  cutoff: number;
  scanned: number;
  deleted: number;
  archived: number;
  batches: number;
  /** 是否因达到 maxScan 提前收尾（不表示表里已经没有更旧的数据了）。 */
  truncated: boolean;
}

export interface RetentionResult {
  startedAt: number;
  dryRun: boolean;
  batchSize: number;
  tables: RetentionTableResult[];
}

const DAY_MS = 86_400_000;

function assertTable(table: string): asserts table is RetentionTable {
  // 表名会拼进 SQL，必须是白名单里的常量，绝不接受外部输入的其他值。
  if (!TABLES.includes(table as RetentionTable)) {
    throw new Error(`不支持的保留目标表: ${table}（仅支持 ${TABLES.join(" / ")}）`);
  }
}

/**
 * 按保留期清理/归档过期数据。
 *
 * @returns 每张表的扫描/删除/归档统计。dryRun 时 deleted 恒为 0，但 scanned 反映真实命中量。
 */
export async function runRetention(
  adapter: RetentionAdapter,
  options: RetentionOptions,
): Promise<RetentionResult> {
  const now = options.now ?? Date.now();
  const dryRun = options.dryRun ?? true;
  const batchSize = Math.max(1, Math.floor(options.batchSize ?? 1000));
  const maxScan = options.maxScan ?? Number.POSITIVE_INFINITY;
  const tables: RetentionTableResult[] = [];

  for (const target of options.targets) {
    assertTable(target.table);
    if (!(target.keepDays > 0)) {
      throw new Error(`保留天数必须为正数，收到 keepDays=${target.keepDays}（table=${target.table}）`);
    }
    const cutoff = now - target.keepDays * DAY_MS;

    const result: RetentionTableResult = {
      table: target.table,
      keepDays: target.keepDays,
      cutoff,
      scanned: 0,
      deleted: 0,
      archived: 0,
      batches: 0,
      truncated: false,
    };

    // 先主键排序再取，保证同一批的 id 连续可读、重复执行时行为稳定
    for (;;) {
      const remaining = maxScan - result.scanned;
      if (remaining <= 0) {
        result.truncated = true;
        break;
      }
      const take = Math.min(batchSize, remaining);
      const rows = await adapter.select(
        `SELECT * FROM ${target.table} WHERE created_at < ${adapter.placeholder(1)} ORDER BY id LIMIT ${take}`,
        [cutoff],
      );
      if (!rows.length) break;

      result.batches++;
      result.scanned += rows.length;

      for (const row of rows) {
        options.archive?.(target.table, row);
        result.archived++;
      }

      let deleted = 0;
      if (!dryRun) {
        const ids = rows.map((r) => r.id);
        deleted = await adapter.execute(
          `DELETE FROM ${target.table} WHERE id IN (${ids.map((_, i) => adapter.placeholder(i + 1)).join(", ")})`,
          ids,
        );
        result.deleted += deleted;
      }

      options.onBatch?.({ table: target.table, batch: result.batches, scanned: result.scanned, deleted });

      // 取不满一批说明已经没有更旧的行了（若只是刚好凑满 batchSize，下一轮返回空会终止）
      if (rows.length < take) break;
      // 归档回调不抛错、删除也没删掉任何行时立刻退出，避免在不变的数据上空转
      if (!dryRun && deleted === 0) break;
    }

    tables.push(result);
  }

  return { startedAt: now, dryRun, batchSize, tables };
}

/** 默认保留策略：行为事件 180 天、审计日志 365 天（审计要留得比行为事件久）。 */
export const DEFAULT_RETENTION_TARGETS: RetentionTarget[] = [
  { table: "events", keepDays: 180 },
  { table: "audit_logs", keepDays: 365 },
];
