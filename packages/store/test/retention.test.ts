import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RETENTION_TARGETS,
  runRetention,
  type RetentionAdapter,
  type RetentionRow,
} from "../src/retention.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 17); // 2026-10-17T00:00:00Z，固定基准避免测试跨天抖动

/** 内存表 fixture：rows 按 created_at 升序，id 从 1 递增。 */
function makeTable(rows: RetentionRow[]) {
  let data = rows.map((r, i) => ({ id: (r.id as number) ?? i + 1, ...r }));
  return {
    get size() {
      return data.length;
    },
    select(cutoff: number, take: number, afterId: number | null = null) {
      return data
        .filter((r) => r.created_at < cutoff && (afterId === null || (r.id as number) > afterId))
        .sort((a, b) => a.id - b.id)
        .slice(0, take);
    },
    deleteIds(ids: unknown[]) {
      const set = new Set(ids);
      const before = data.length;
      data = data.filter((r) => !set.has(r.id));
      return before - data.length;
    },
  };
}

/**
 * 假 adapter：模拟 SQLite（?）或 PG（$n）的占位符风格，并记录执行过的 SQL。
 * `failingSql` 命中时抛错，用来验证"归档先于删除"的顺序保证。
 */
function makeAdapter(tables: Record<string, ReturnType<typeof makeTable>>, style: "sqlite" | "pg" = "sqlite") {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const adapter: RetentionAdapter = {
    placeholder: (i) => (style === "pg" ? `$${i}` : "?"),
    select(sql, params) {
      calls.push({ sql, params });
      const table = sql.match(/FROM (\w+)/)?.[1] ?? "";
      const limit = Number(sql.match(/LIMIT (\d+)/)?.[1] ?? 0);
      const cutoff = Number(params[0]);
      // 假 adapter 必须真的执行 id 游标：否则 dry-run「每轮取到同一批」这个缺陷
      // 在测试里根本表现不出来（真实 adapter 走的是同一句 SQL）
      const afterId = /AND id > /i.test(sql) ? Number(params[1]) : null;
      return tables[table].select(cutoff, limit, afterId);
    },
    execute(sql, params) {
      calls.push({ sql, params });
      const table = sql.match(/FROM (\w+)/)?.[1] ?? "";
      return tables[table].deleteIds(params as unknown[]);
    },
  };
  return { adapter, calls };
}

const row = (id: number, daysAgo: number, extra: RetentionRow = {}) => ({
  id,
  created_at: NOW - daysAgo * DAY,
  ...extra,
});

describe("runRetention", () => {
  it("dry-run 默认只统计不删除，也不减少表行数", async () => {
    const events = makeTable([row(1, 400), row(2, 100), row(3, 1)]);
    const { adapter, calls } = makeAdapter({ events });

    const result = await runRetention(adapter, {
      targets: [{ table: "events", keepDays: 30 }],
      now: NOW,
    });

    expect(result.dryRun).toBe(true);
    expect(result.tables[0].scanned).toBe(2); // 400 天前 + 100 天前
    expect(result.tables[0].deleted).toBe(0);
    expect(events.size).toBe(3); // 一行没少
    // dry-run 不应该出现 DELETE
    expect(calls.some((c) => c.sql.startsWith("DELETE"))).toBe(false);
  });

  it("dry-run 命中量超过一批时用 id 游标推进，且不写任何归档", async () => {
    // 7 行全过期、batchSize=3 → 需要 3 轮才能走完
    const events = makeTable([row(1, 400), row(2, 399), row(3, 398), row(4, 397), row(5, 396), row(6, 395), row(7, 394)]);
    const archivedRows: unknown[] = [];
    const { adapter, calls } = makeAdapter({ events });

    const result = await runRetention(adapter, {
      targets: [{ table: "events", keepDays: 30 }],
      now: NOW,
      batchSize: 3,
      maxScan: 100_000,
      archive: (_t, r) => {
        archivedRows.push(r.id);
      },
    });

    const t = result.tables[0];
    expect(t.scanned).toBe(7); // 缺陷版：每轮取到同一批，直到撞上 maxScan 才停
    expect(t.archived).toBe(7); // dry-run 报的是"真跑会归档多少行"
    expect(t.truncated).toBe(false);
    expect(t.deleted).toBe(0);
    expect(events.size).toBe(7);
    // 预览阶段一次都不该调用 archive 回调（否则归档目录里是"没被删除的行"）
    expect(archivedRows.length).toBe(0);
    // 3 批：3 + 3 + 1（最后一批不满即到底）
    expect(t.batches).toBe(3);
    expect(calls.filter((c) => c.sql.startsWith("SELECT")).length).toBe(3);
    // 第 2、3 轮必须带游标，否则是在原地重复读同一批
    expect(calls.filter((c) => /AND id > /i.test(c.sql)).length).toBe(2);
  });

  it("apply 模式每行只归档一次（删除推进与归档不重复）", async () => {
    const events = makeTable([row(1, 400), row(2, 399), row(3, 398), row(4, 397), row(5, 396)]);
    const archivedRows: unknown[] = [];
    const { adapter } = makeAdapter({ events });

    const result = await runRetention(adapter, {
      targets: [{ table: "events", keepDays: 30 }],
      now: NOW,
      batchSize: 2,
      dryRun: false,
      archive: (_t, r) => {
        archivedRows.push(r.id);
      },
    });

    expect(result.tables[0].deleted).toBe(5);
    expect(archivedRows.sort((a, b) => Number(a) - Number(b))).toEqual([1, 2, 3, 4, 5]);
    expect(events.size).toBe(0);
  });

  it("apply 后只剩保留期内的数据，且截止时间是严格小于", async () => {
    const events = makeTable([row(1, 400), row(2, 100), row(3, 30), row(4, 29), row(5, 0)]);
    const { adapter } = makeAdapter({ events });

    const result = await runRetention(adapter, {
      targets: [{ table: "events", keepDays: 30 }],
      now: NOW,
      dryRun: false,
    });

    // keepDays=30 -> cutoff = NOW-30天；恰好 30 天前的行（created_at === cutoff）不算过期
    expect(result.tables[0].cutoff).toBe(NOW - 30 * DAY);
    expect(result.tables[0].deleted).toBe(2); // 只删 400 / 100 天前的两行
    expect(events.size).toBe(3);
  });

  it("按 batchSize 分批，多张表依次处理并各自计数", async () => {
    const events = makeTable([1, 2, 3, 4, 5].map((id) => row(id, 400)));
    const auditLogs = makeTable([row(1, 900), row(2, 1)]);
    const { adapter, calls } = makeAdapter({ events, audit_logs: auditLogs });

    const result = await runRetention(adapter, {
      targets: [
        { table: "events", keepDays: 30 },
        { table: "audit_logs", keepDays: 30 },
      ],
      now: NOW,
      batchSize: 2,
      dryRun: false,
    });

    expect(result.tables[0].batches).toBe(3); // 5 行 / 每批 2 -> 2+2+1
    expect(result.tables[0].deleted).toBe(5);
    expect(result.tables[1].deleted).toBe(1); // 只删 900 天前那条
    expect(auditLogs.size).toBe(1);
    // 每批一次 SELECT + 一次 DELETE
    const deleteBatches = calls.filter((c) => c.sql.startsWith("DELETE FROM events"));
    expect(deleteBatches).toHaveLength(3);
    expect(deleteBatches[0].params).toEqual([1, 2]);
  });

  it("maxScan 达到后收尾并标记 truncated（不表示已扫完）", async () => {
    const events = makeTable([1, 2, 3, 4, 5].map((id) => row(id, 400)));
    const { adapter } = makeAdapter({ events });

    const result = await runRetention(adapter, {
      targets: [{ table: "events", keepDays: 30 }],
      now: NOW,
      batchSize: 2,
      maxScan: 3,
    });

    expect(result.tables[0].scanned).toBe(3); // 停在上限，而不是 5
    expect(result.tables[0].truncated).toBe(true);
  });

  it("归档回调在删除之前对每一行调用；归档抛错会中断且不再删除", async () => {
    const events = makeTable([row(1, 400), row(2, 400)]);
    const { adapter, calls } = makeAdapter({ events });
    const seen: RetentionRow[] = [];
    const order: string[] = [];

    await runRetention(adapter, {
      targets: [{ table: "events", keepDays: 30 }],
      now: NOW,
      dryRun: false,
      archive: (table, r) => {
        order.push("archive");
        seen.push({ table, ...r });
      },
    });

    expect(seen.map((r) => r.id)).toEqual([1, 2]);
    expect(seen[0].table).toBe("events");
    expect(events.size).toBe(0);

    // 归档抛错：异常向外传播，DELETE 不会执行
    const events2 = makeTable([row(1, 400)]);
    const second = makeAdapter({ events: events2 });
    await expect(
      runRetention(second.adapter, {
        targets: [{ table: "events", keepDays: 30 }],
        now: NOW,
        dryRun: false,
        archive: () => {
          throw new Error("归档盘满了");
        },
      }),
    ).rejects.toThrow("归档盘满了");
    expect(events2.size).toBe(1); // 没删成，数据还在
    expect(second.calls.some((c) => c.sql.startsWith("DELETE"))).toBe(false);
    expect(order.length).toBeGreaterThan(0);
  });

  it("占位符风格随方言切换：PG 用 $n 且 OH 参数逐个展开", async () => {
    const events = makeTable([row(1, 400), row(2, 400)]);
    const { adapter, calls } = makeAdapter({ events }, "pg");

    await runRetention(adapter, {
      targets: [{ table: "events", keepDays: 30 }],
      now: NOW,
      dryRun: false,
    });

    const del = calls.find((c) => c.sql.startsWith("DELETE"))!;
    expect(del.sql).toContain("IN ($1, $2)"); // PG 风格，不是 "?"
    expect(del.params).toEqual([1, 2]);
    // SELECT 的 LIMIT 用派生 batchSize，且 cutoff 走占位符而非字符串拼接
    const sel = calls.find((c) => c.sql.startsWith("SELECT"))!;
    expect(sel.sql).toContain("created_at < $1");
    expect(sel.params).toEqual([NOW - 30 * DAY]);
  });

  it("onBatch 每批回调一次，累计 scanned 单调递增", async () => {
    const events = makeTable([1, 2, 3].map((id) => row(id, 400)));
    const { adapter } = makeAdapter({ events });
    const batches: number[] = [];

    await runRetention(adapter, {
      targets: [{ table: "events", keepDays: 30 }],
      now: NOW,
      batchSize: 1,
      dryRun: false,
      onBatch: (info) => batches.push(info.scanned),
    });

    expect(batches).toEqual([1, 2, 3]);
  });

  it("表名走白名单、保留天数必须为正 —— 拒绝 SQL 拼接被滥用", async () => {
    const events = makeTable([row(1, 400)]);
    const { adapter } = makeAdapter({ events });

    await expect(
      runRetention(adapter, {
        // @ts-expect-error 故意传入非白名单表名，验证运行时同样会拦
        targets: [{ table: "users; DROP TABLE events", keepDays: 30 }],
        now: NOW,
      }),
    ).rejects.toThrow(/不支持的保留目标表/);

    await expect(
      runRetention(adapter, {
        targets: [{ table: "events", keepDays: 0 }],
        now: NOW,
      }),
    ).rejects.toThrow(/保留天数必须为正数/);
  });

  it("默认策略：行为事件 180 天、审计日志 365 天（审计留得更久）", async () => {
    expect(DEFAULT_RETENTION_TARGETS).toEqual([
      { table: "events", keepDays: 180 },
      { table: "audit_logs", keepDays: 365 },
    ]);

    // 200 天前的审计日志在 365 天策略下要留下
    const auditLogs = makeTable([row(1, 200)]);
    const { adapter } = makeAdapter({ events: makeTable([]), audit_logs: auditLogs });
    const result = await runRetention(adapter, {
      targets: DEFAULT_RETENTION_TARGETS,
      now: NOW,
      dryRun: false,
    });
    expect(result.tables[1].deleted).toBe(0);
    expect(auditLogs.size).toBe(1);
  });

  it("表里没有过期数据时没有任何 SQL 写操作", async () => {
    const events = makeTable([row(1, 0), row(2, 1)]);
    const { adapter, calls } = makeAdapter({ events });
    const spy = vi.fn();

    const result = await runRetention(adapter, {
      targets: [{ table: "events", keepDays: 30 }],
      now: NOW,
      dryRun: false,
      archive: spy,
    });

    expect(result.tables[0].scanned).toBe(0);
    expect(result.tables[0].batches).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    expect(calls.some((c) => c.sql.startsWith("DELETE"))).toBe(false);
  });
});
