import { describe, expect, it } from "vitest";
import {
  AUDIT_DAILY_ROLLUP,
  DEFAULT_ROLLUP_TARGETS,
  EVENT_DAILY_ROLLUP,
  rollupDdl,
  runRollup,
  type RollupSpec,
} from "../src/rollup.ts";
import type { RetentionAdapter, RetentionRow } from "../src/retention.ts";

const DAY = 86_400_000;
/** 固定基准：2026-10-17T00:00:00Z（正好落在日边界上，日切计算可预期） */
const NOW = Date.UTC(2026, 9, 17);

type Row = RetentionRow & { created_at: number };

/**
 * 假 adapter：按 SQL 形状分发。
 * 覆盖 rollup 会发出的四类语句 —— 建表、取日期桶、取当天分组、upsert、按窗口删明细。
 * 日期桶与分组都在内存里真算一遍，占位符风格按方言切换（SQLite `?` / PG `$n`）。
 */
function makeFake(options: {
  sources: Record<string, Row[]>;
  specs: RollupSpec[];
  style?: "sqlite" | "pg";
}) {
  const { sources, specs } = options;
  const style = options.style ?? "sqlite";
  const dests = new Map<string, RetentionRow[]>();
  const calls: { sql: string; params: readonly unknown[] }[] = [];

  const specOfDest = (dest: string) => specs.find((s) => s.dest === dest);
  const specOfTable = (table: string) => specs.find((s) => s.table === table);

  const daysOf = (table: string, before: number, limit: number) => {
    const buckets = new Set(
      sources[table].filter((r) => r.created_at < before).map((r) => r.created_at - (r.created_at % DAY)),
    );
    return [...buckets].sort((a, b) => a - b).slice(0, limit).map((day_start) => ({ day_start }));
  };

  const adapter: RetentionAdapter = {
    placeholder: (i) => (style === "pg" ? `$${i}` : "?"),
    select(sql, params) {
      calls.push({ sql, params });
      const table = sql.match(/FROM (\w+)/)?.[1] ?? "";

      if (/GROUP BY 1 ORDER BY 1/.test(sql)) {
        return daysOf(table, Number(params[0]), Number(params[1]));
      }

      const spec = specOfTable(table);
      if (!spec) throw new Error(`假 adapter 不认识的表: ${table}`);
      const [start, end] = [Number(params[0]), Number(params[1])];
      const rows = sources[table].filter((r) => r.created_at >= start && r.created_at < end);
      const groups = new Map<
        string,
        { values: Record<string, string>; total: number; identities: Set<string> }
      >();
      for (const r of rows) {
        const values: Record<string, string> = {};
        for (const g of spec.groups) {
          values[g.alias] = g.coalesce ? String(r[g.column] ?? "") : String(r[g.column] ?? "");
        }
        const key = spec.groups.map((g) => values[g.alias]).join("\u0000");
        const entry = groups.get(key) ?? { values, total: 0, identities: new Set<string>() };
        entry.total++;
        if (spec.distinct) {
          const v = r[spec.distinct.column];
          if (v !== null && v !== undefined && String(v) !== "") entry.identities.add(String(v));
        }
        groups.set(key, entry);
      }
      return [...groups.values()].map((g) => {
        const out: RetentionRow = { ...g.values, total: g.total };
        if (spec.distinct) out[spec.distinct.alias] = g.identities.size;
        return out;
      });
    },
    execute(sql, params) {
      calls.push({ sql, params });
      if (sql.startsWith("CREATE TABLE")) return 0;

      if (sql.startsWith("INSERT")) {
        const dest = sql.match(/INSERT INTO (\w+)/)?.[1] ?? "";
        const spec = specOfDest(dest);
        if (!spec) throw new Error(`假 adapter 不认识的聚合表: ${dest}`);
        const list = dests.get(dest) ?? [];
        const keyLen = 1 + spec.groups.length;
        const key = JSON.stringify(params.slice(0, keyLen));
        const row: RetentionRow = {
          day_start: params[0],
          total: Number(params[keyLen]),
          updated_at: params[params.length - 1],
        };
        spec.groups.forEach((g, i) => {
          row[g.alias] = params[1 + i];
        });
        if (spec.distinct) row[spec.distinct.alias] = Number(params[keyLen + 1]);
        const idx = list.findIndex((r) => JSON.stringify([r.day_start, ...spec.groups.map((g) => r[g.alias])]) === key);
        if (idx >= 0) list[idx] = row;
        else list.push(row);
        dests.set(dest, list);
        return 1;
      }

      if (sql.startsWith("DELETE")) {
        const table = sql.match(/DELETE FROM (\w+)/)?.[1] ?? "";
        const [start, end] = [Number(params[0]), Number(params[1])];
        const keep = sources[table].filter((r) => !(r.created_at >= start && r.created_at < end));
        const removed = sources[table].length - keep.length;
        sources[table] = keep;
        return removed;
      }

      throw new Error(`假 adapter 不支持的语句: ${sql.slice(0, 60)}`);
    },
  };

  return { adapter, calls, dests };
}

/** 造一行 events：daysAgo 天前（可给小数天制造"半天的日"） */
const ev = (daysAgo: number, extra: RetentionRow = {}) => ({
  kind: "visit",
  site_id: "s1",
  identity: "u1",
  created_at: NOW - daysAgo * DAY,
  ...extra,
});

describe("runRollup", () => {
  it("dry-run 只统计：不写聚合表、不删明细、也不建表", async () => {
    const sources = { events: [ev(400), ev(400, { kind: "search" }), ev(1)] };
    const { adapter, calls, dests } = makeFake({ sources, specs: [EVENT_DAILY_ROLLUP] });

    const result = await runRollup(adapter, {
      targets: [{ spec: EVENT_DAILY_ROLLUP, keepDays: 180 }],
      now: NOW,
    });

    expect(result.dryRun).toBe(true);
    expect(result.tables[0].rows).toBe(2); // 400 天前那 2 行会被聚合
    expect(result.tables[0].deleted).toBe(0);
    expect(sources.events).toHaveLength(3); // 一行没少
    expect(dests.get("events_daily")).toBeUndefined(); // 没建表也没写行
    expect(calls.some((c) => c.sql.startsWith("CREATE TABLE"))).toBe(false);
    expect(calls.some((c) => c.sql.startsWith("INSERT"))).toBe(false);
    expect(calls.some((c) => c.sql.startsWith("DELETE"))).toBe(false);
  });

  it("apply 后按 天 × kind × site 聚合，明细被删且聒合值正确", async () => {
    const day = 400;
    const sources = {
      events: [
        ev(day),
        ev(day),
        ev(day, { kind: "search", identity: "u2" }),
        ev(day, { site_id: null, identity: "u3" }),
        ev(1),
      ],
    };
    const { adapter, dests } = makeFake({ sources, specs: [EVENT_DAILY_ROLLUP] });

    const result = await runRollup(adapter, {
      targets: [{ spec: EVENT_DAILY_ROLLUP, keepDays: 180 }],
      now: NOW,
      dryRun: false,
    });

    expect(result.tables[0].days).toBe(1);
    expect(result.tables[0].rows).toBe(4);
    expect(result.tables[0].deleted).toBe(4);
    expect(sources.events).toHaveLength(1); // 只剩 1 天前的那行

    const rows = dests.get("events_daily") ?? [];
    const visit = rows.find((r) => r.kind === "visit" && r.site_key === "s1")!;
    expect(visit.total).toBe(2);
    expect(visit.identities).toBe(1); // 两条都是 u1
    const search = rows.find((r) => r.kind === "search")!;
    expect(search.total).toBe(1);
    expect(search.identities).toBe(1);
    // site_id 为 NULL 的分组归一化成空串，而不是保持 NULL（否则唯一约束拦不住重复行）
    const noSite = rows.find((r) => r.site_key === "")!;
    expect(noSite.total).toBe(1);
    expect(visit.day_start).toBe(NOW - day * DAY - ((NOW - day * DAY) % DAY));
  });

  it("只推进整天过期的日期：某天里还有未到期行时，那一天整轮不动", async () => {
    // cutoff = NOW - 2.5 天，落在"2 天前"那一天的中午：那天的上午已过期、下午还没
    const halfCut = NOW - 2.5 * DAY;
    const day = Math.floor(halfCut / DAY) * DAY; // 2 天前的日边界
    const sources = {
      events: [
        { ...ev(0), created_at: day - DAY }, // 3 天前整天 -> 过期
        { ...ev(0), created_at: day }, // 过期那一半
        { ...ev(0), created_at: day + DAY - 1000 }, // 同一天末 -> 还没过期
      ],
    };
    const { adapter } = makeFake({ sources, specs: [EVENT_DAILY_ROLLUP] });

    const result = await runRollup(adapter, {
      targets: [{ spec: EVENT_DAILY_ROLLUP, keepDays: 2.5 }],
      now: NOW,
      dryRun: false,
    });

    expect(result.tables[0].effectiveCutoff).toBe(day);
    expect(result.tables[0].days).toBe(1); // 只处理了 3 天前那一整天
    expect(result.tables[0].deleted).toBe(1);
    expect(sources.events).toHaveLength(2); // 半天过期的那天一行未删
  });

  it("audit_logs 按 action × actor_kind 分组落到 audit_daily", async () => {
    const sources = {
      audit_logs: [
        { action: "site.update", actor_kind: "user", actor: "a", created_at: NOW - 400 * DAY },
        { action: "site.update", actor_kind: "user", actor: "b", created_at: NOW - 400 * DAY },
        { action: "site.update", actor_kind: "token", actor: "c", created_at: NOW - 400 * DAY },
      ],
    };
    const { adapter, dests } = makeFake({ sources, specs: [AUDIT_DAILY_ROLLUP] });

    const result = await runRollup(adapter, {
      targets: [{ spec: AUDIT_DAILY_ROLLUP, keepDays: 365 }],
      now: NOW,
      dryRun: false,
    });

    const rows = dests.get("audit_daily") ?? [];
    expect(rows).toHaveLength(2);
    const user = rows.find((r) => r.actor_kind === "user")!;
    expect(user.total).toBe(2);
    expect(user.actors).toBe(2); // a / b 两个操作者
    expect(rows.find((r) => r.actor_kind === "token")!.actors).toBe(1);
    expect(result.tables[0].deleted).toBe(3);
  });

  it("重跑幂等：第二次什么都不做，且聚合值不翻倍", async () => {
    const sources = { events: [ev(400), ev(400)] };
    const { adapter, dests } = makeFake({ sources, specs: [EVENT_DAILY_ROLLUP] });
    const opts = { targets: [{ spec: EVENT_DAILY_ROLLUP, keepDays: 180 }], now: NOW, dryRun: false } as const;

    await runRollup(adapter, opts);
    const first = (dests.get("events_daily") ?? [])[0].total;
    const second = await runRollup(adapter, opts);

    expect(first).toBe(2);
    expect(second.tables[0].days).toBe(0); // 明线已删，没有到期数据了
    expect((dests.get("events_daily") ?? [])[0].total).toBe(2); // 覆盖语义，不是累加
  });

  it("每个分组写完整天才删明细（ INSERT 全在 DELETE 之前）", async () => {
    const sources = { events: [ev(400), ev(400, { kind: "search" }), ev(399)] };
    const { adapter, calls } = makeFake({ sources, specs: [EVENT_DAILY_ROLLUP] });

    await runRollup(adapter, { targets: [{ spec: EVENT_DAILY_ROLLUP, keepDays: 180 }], now: NOW, dryRun: false });

    const kinds = calls.filter((c) => /^(INSERT|DELETE)/.test(c.sql)).map((c) => c.sql.slice(0, 6));
    const firstDelete = kinds.indexOf("DELETE");
    expect(kinds.slice(0, firstDelete).every((k) => k === "INSERT")).toBe(true);
    // upsert 是幂等的冲突更新写法
    const insert = calls.find((c) => c.sql.startsWith("INSERT"))!;
    expect(insert.sql).toContain("ON CONFLICT(day_start, kind, site_key) DO UPDATE SET total = excluded.total");
  });

  it("maxDaysPerRun 生效并被标记 truncated", async () => {
    const sources = { events: [ev(400), ev(399), ev(398), ev(397)] };
    const { adapter } = makeFake({ sources, specs: [EVENT_DAILY_ROLLUP] });

    const result = await runRollup(adapter, {
      targets: [{ spec: EVENT_DAILY_ROLLUP, keepDays: 180 }],
      now: NOW,
      maxDaysPerRun: 2,
      dryRun: false,
    });

    expect(result.tables[0].days).toBe(2);
    expect(result.tables[0].truncated).toBe(true);
    expect(sources.events).toHaveLength(2); // 只聚合删除了最旧的两天
  });

  it("分组数超上限的那一天整天跳过：不写聚合也不删明细", async () => {
    const sources = { events: [ev(400), ev(400, { kind: "search" }), ev(400, { kind: "share" })] };
    const { adapter, dests } = makeFake({ sources, specs: [EVENT_DAILY_ROLLUP] });
    const skipped: { day: number; msg?: string }[] = [];

    const result = await runRollup(adapter, {
      targets: [{ spec: EVENT_DAILY_ROLLUP, keepDays: 180 }],
      now: NOW,
      maxGroupsPerDay: 2,
      dryRun: false,
      onDay: (info) => {
        if (info.skipped) skipped.push({ day: info.dayStart, msg: info.skipped });
      },
    });

    expect(result.tables[0].skippedDays).toBe(1);
    expect(result.tables[0].deleted).toBe(0);
    expect(sources.events).toHaveLength(3); // 明细一条没删 —— 宁留明细不写半份聚合
    expect(dests.get("events_daily")).toBeUndefined();
    expect(skipped[0].msg).toContain("超过上限 2");
  });

  it("占位符随方言切换为 PG 的 $n", async () => {
    const sources = { events: [ev(400)] };
    const { adapter, calls } = makeFake({ sources, specs: [EVENT_DAILY_ROLLUP], style: "pg" });

    await runRollup(adapter, {
      targets: [{ spec: EVENT_DAILY_ROLLUP, keepDays: 180 }],
      now: NOW,
      dialect: "postgres",
      dryRun: false,
    });

    const insert = calls.find((c) => c.sql.startsWith("INSERT"))!;
    expect(insert.sql).toContain("VALUES ($1, $2, $3, $4, $5, $6)");
    const del = calls.find((c) => c.sql.startsWith("DELETE"))!;
    expect(del.sql).toContain("created_at >= $1 AND created_at < $2");
    const ddl = calls.find((c) => c.sql.startsWith("CREATE TABLE"))!;
    expect(ddl.sql).toContain("id BIGSERIAL PRIMARY KEY");
    expect(ddl.sql).toContain("day_start BIGINT NOT NULL");
  });

  it("默认策略与保留清理一致，且 dry-run 不建表、apply 会幂等建表", async () => {
    expect(DEFAULT_ROLLUP_TARGETS.map((t) => [t.spec.dest, t.keepDays])).toEqual([
      ["events_daily", 180],
      ["audit_daily", 365],
    ]);

    const sources = { events: [ev(400)], audit_logs: [{ action: "a", actor_kind: "user", actor: "u", created_at: NOW - 400 * DAY }] };
    const applyCalls = makeFake({ sources, specs: [EVENT_DAILY_ROLLUP, AUDIT_DAILY_ROLLUP] });
    await runRollup(applyCalls.adapter, { now: NOW, dryRun: false });
    const creates = applyCalls.calls.filter((c) => c.sql.startsWith("CREATE TABLE"));
    expect(creates).toHaveLength(2);
    expect(creates[0].sql).toContain("CREATE TABLE IF NOT EXISTS events_daily");
    expect(creates[0].sql).toContain("UNIQUE(day_start, kind, site_key)");
  });

  it("表名/列名必须过白名单，非法标识符直接拒绝", async () => {
    const sources = { events: [ev(400)] };
    const { adapter } = makeFake({ sources, specs: [EVENT_DAILY_ROLLUP] });

    await expect(
      runRollup(adapter, {
        targets: [{ spec: { ...EVENT_DAILY_ROLLUP, dest: "events_daily; DROP TABLE events" }, keepDays: 180 }],
        now: NOW,
        dryRun: false,
      }),
    ).rejects.toThrow(/非法的聚合表名/);

    await expect(
      runRollup(adapter, {
        targets: [
          {
            spec: { ...EVENT_DAILY_ROLLUP, groups: [{ column: "kind) FROM events; --", alias: "kind" }] },
            keepDays: 180,
          },
        ],
        now: NOW,
      }),
    ).rejects.toThrow(/非法的源表列名/);

    await expect(
      runRollup(adapter, {
        targets: [{ spec: EVENT_DAILY_ROLLUP, keepDays: 0 }],
        now: NOW,
      }),
    ).rejects.toThrow(/保留天数必须为正数/);

    expect(() => rollupDdl({ ...EVENT_DAILY_ROLLUP, groups: [] })).toThrow(/至少要有一个分组维度/);
  });

  it("表里没有到期数据时既不写也不删", async () => {
    const sources = { events: [ev(1), ev(0)] };
    const { adapter, calls } = makeFake({ sources, specs: [EVENT_DAILY_ROLLUP] });

    const result = await runRollup(adapter, {
      targets: [{ spec: EVENT_DAILY_ROLLUP, keepDays: 180 }],
      now: NOW,
      dryRun: false,
    });

    expect(result.tables[0].days).toBe(0);
    expect(result.tables[0].groups).toBe(0);
    expect(sources.events).toHaveLength(2);
    expect(calls.some((c) => c.sql.startsWith("DELETE"))).toBe(false);
    expect(calls.some((c) => c.sql.startsWith("INSERT"))).toBe(false);
  });
});
