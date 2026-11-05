/**
 * LLM 额度**原子预留**在 PostgreSQL 方言下的形态回归（假驱动，不需要真实库）。
 *
 * 为什么单独一份：SQLite 那套（`llm-quota-reservation.test.ts`）验的是账目与并发语义，
 * 而 P0-3 真正要落的生产形态是多副本 PG。这边有三个只有 PG 才会踩的坑：
 *
 *  1. **事务必须待在一条独占连接上**。`pg.Pool.query()` 每次可能拿到不同连接，
 *     BEGIN 与 INSERT 落在两个连接上时，"原子判定 + 占位"就退化成两条独立语句，
 *     并发照样互相看不见——这正是 P0-3 要修的东西。所以这里断言预留事务期间
 *     **连接池一条语句都不许碰到**，并检查 `db.pg` 的临时换入换出。
 *  2. **跨进程锁必须在事务里、且绑在同一连接上**。`pg_advisory_xact_lock` 是
 *     事务级锁：在池连接上取锁，语句一结束锁就没了，等于没加。
 *  3. **占位符与布尔列**。`?` 要全部转成 `$n`；预留表用 `source <> 'user'` 而不是
 *     布尔列比较（PG 的 BOOLEAN 与整数比较直接报错，见 llm-usage-pg 的同款事故）。
 *
 * 「20 个并发抢 5 个名额」这类真实并发不在这里——假驱动没有真并发，
 * 那部分在 `llm-quota-reservation-pg.e2e.test.ts`（真 PG，CI 的 test-postgres job）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import type { LlmQuotaTier } from "../src/repository/llm-quota.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const TTL_MS = 5 * 60 * 1000;

/** 预留表的一行（列名按 PG 的裸表名，小写） */
interface ResRow {
  id: string;
  identity: string | null;
  source: string;
  reserved_calls: number;
  reserved_tokens: number;
  expires_at: number;
  created_at: number;
}

interface Stmt {
  /** pool = 连接池（事务外的普通语句）；client = 事务独占连接 */
  via: "pool" | "client";
  sql: string;
  params: unknown[];
}

function fakePg(initial: { usage?: { calls?: number; tokens?: number; firstAt?: number | null }; reservations?: ResRow[] } = {}) {
  const statements: Stmt[] = [];
  const reservations: ResRow[] = (initial.reservations ?? []).map((r) => ({ ...r }));
  const usage = {
    calls: initial.usage?.calls ?? 0,
    tokens: initial.usage?.tokens ?? 0,
    firstAt: initial.usage?.firstAt ?? null,
  };
  /** 语句命中该子串时抛错：用来验「中途失败不留半截预留」 */
  const fault = { sqlIncludes: null as string | null };
  const connections = { created: 0, released: 0 };

  function execute(via: "pool" | "client", sql: string, params: unknown[] = []) {
    statements.push({ via, sql, params });
    if (fault.sqlIncludes && sql.includes(fault.sqlIncludes)) {
      throw new Error(`假 PG：注入失败（命中 ${fault.sqlIncludes}）`);
    }
    const head = sql.trim().toUpperCase();
    if (head === "BEGIN" || head === "COMMIT" || head === "ROLLBACK") return { rows: [], rowCount: null };
    if (head.startsWith("SELECT PG_ADVISORY_XACT_LOCK")) return { rows: [{ lock: null }], rowCount: 1 };

    if (head.startsWith("INSERT INTO LLM_QUOTA_RESERVATIONS")) {
      const [id, identity, source, reservedCalls, reservedTokens, expiresAt, createdAt] = params as [
        string, string | null, string, number, number, number, number,
      ];
      reservations.push({
        id,
        identity: identity ?? null,
        source,
        reserved_calls: reservedCalls,
        reserved_tokens: reservedTokens,
        expires_at: expiresAt,
        created_at: createdAt,
      });
      return { rows: [], rowCount: 1 };
    }

    if (head.startsWith("DELETE FROM LLM_QUOTA_RESERVATIONS")) {
      if (sql.includes("expires_at <= $1")) {
        const cutoff = Number(params[0]);
        const before = reservations.length;
        splice(reservations, (r) => r.expires_at <= cutoff);
        return { rows: [], rowCount: before - reservations.length };
      }
      if (sql.includes("id = $1")) {
        const before = reservations.length;
        splice(reservations, (r) => r.id === params[0]);
        return { rows: [], rowCount: before - reservations.length };
      }
      throw new Error(`假 PG 不认这条 DELETE：${sql}`);
    }

    // sumLlmUsage：窗口内已落账用量
    if (head.startsWith("SELECT COUNT(*) AS CALLS")) {
      return { rows: [{ calls: usage.calls, tokens: usage.tokens, errs: 0, first_at: usage.firstAt }], rowCount: 1 };
    }

    // sumLlmQuotaReservations：在途预留合计（含身份/来源过滤，逐条按 SQL 谓词模拟）
    if (sql.includes("SUM(reserved_calls)") && sql.includes("FROM llm_quota_reservations")) {
      const now = Number(params[0]);
      let rows = reservations.filter((r) => r.expires_at > now);
      if (sql.includes("identity IS NULL")) rows = rows.filter((r) => r.identity === null);
      else if (/identity = \$\d+/.test(sql)) rows = rows.filter((r) => r.identity === params[1]);
      if (sql.includes("source <> 'user'")) rows = rows.filter((r) => r.source !== "user");
      const calls = rows.reduce((s, r) => s + r.reserved_calls, 0);
      const tokens = rows.reduce((s, r) => s + r.reserved_tokens, 0);
      const earliest = rows.length > 0 ? Math.min(...rows.map((r) => r.expires_at)) : null;
      return { rows: [{ calls, tokens, earliest_expiry: earliest }], rowCount: 1 };
    }

    throw new Error(`假 PG 驱动不认这条语句：${sql}`);
  }

  function splice(rows: ResRow[], drop: (r: ResRow) => boolean) {
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      if (row && drop(row)) rows.splice(i, 1);
    }
  }

  const pool = {
    query: async (sql: string, params: unknown[] = []) => execute("pool", sql, params),
    end: async () => undefined,
    connect: async () => {
      connections.created += 1;
      let open = true;
      return {
        query: async (sql: string, params: unknown[] = []) => {
          if (!open) throw new Error("假 PG：事务结束后仍在已归还的连接上执行语句");
          return execute("client", sql, params);
        },
        release: () => {
          open = false;
          connections.released += 1;
        },
      };
    },
  };

  const db = { dialect: "pg", orm: null, pg: pool, close: async () => undefined } as unknown as Db;
  const repo = new Repository(db);
  return { repo, db, pool, statements, reservations, usage, fault, connections };
}

function reserve(
  repo: Repository,
  input: Partial<Parameters<Repository["reserveLlmQuota"]>[0]>,
) {
  return repo.reserveLlmQuota({
    identity: null,
    source: "system",
    reservedCalls: 1,
    reservedTokens: 0,
    windowMs: DAY_MS,
    ttlMs: TTL_MS,
    tiers: [],
    ...input,
  });
}

const callsTier = (identity: string | null, maxCalls: number, extra: Partial<LlmQuotaTier> = {}): LlmQuotaTier => ({
  scope: identity === null ? "anonymous" : "identity",
  identity,
  maxCalls,
  maxTokens: 0,
  ...extra,
});

function heads(fake: ReturnType<typeof fakePg>, via: "pool" | "client"): string[] {
  return fake.statements.filter((s) => s.via === via).map((s) => s.sql.trim());
}

describe("llm_quota_reservations：PostgreSQL 事务与方言形态", () => {
  let fake: ReturnType<typeof fakePg>;

  beforeEach(() => {
    fake = fakePg();
  });

  it("整个「加锁 → 判定 → 插行」跑在同一条独占连接上，事务期间不碰连接池", async () => {
    const res = await reserve(fake.repo, { identity: "u1", tiers: [callsTier("u1", 5)] });
    expect(res.ok).toBe(true);

    const client = heads(fake, "client");
    expect(client[0]).toBe("BEGIN");
    expect(client[1]).toMatch(/^SELECT pg_advisory_xact_lock/);
    // 锁必须在过期回收与两次聚合读**之前**：先读后锁，读到的合计随时会被别的副本改掉
    expect(client[2]).toContain("DELETE FROM llm_quota_reservations");
    expect(client[client.length - 1]).toBe("COMMIT");
    expect(client.some((s) => s.startsWith("INSERT INTO llm_quota_reservations"))).toBe(true);

    // 连接池一条都不许参与：BEGIN/INSERT 分散到不同连接，原子性直接消失
    expect(heads(fake, "pool")).toEqual([]);
    expect(fake.connections).toEqual({ created: 1, released: 1 });
    // 临时把 db.pg 换成独占连接后必须还原，否则事务外的普通查询会留在该连接上
    expect(fake.repo.db.pg).toBe(fake.pool);
    expect(fake.reservations).toHaveLength(1);
  });

  it("跨进程锁用绑参的 hashtext，键固定为 navhub:llm-quota", async () => {
    await reserve(fake.repo, { identity: "u1", tiers: [callsTier("u1", 5)] });
    const lock = fake.statements.find((s) => s.sql.includes("pg_advisory_xact_lock"));
    expect(lock?.sql).toBe("SELECT pg_advisory_xact_lock(hashtext($1))");
    // 字面量拼进 SQL 会随锁键数量长出无数条语句计划；绑参 + 固定键才锁得住所有副本
    expect(lock?.params).toEqual(["navhub:llm-quota"]);
  });

  it("语句全部用 $n 占位符，且不与整数比较布尔列", async () => {
    await reserve(fake.repo, {
      identity: "u1",
      source: "system",
      reservedTokens: 1500,
      tiers: [{ scope: "system", identity: undefined, excludeUserSource: true, maxCalls: 5, maxTokens: 10000 }],
    });
    for (const stmt of fake.statements) {
      expect(stmt.sql).not.toContain("?");
      // PG 的 BOOLEAN 与整数比较直接报 operator does not exist（llm-usage 踩过的同款坑）
      expect(stmt.sql).not.toMatch(/\b(ok|thinking)\s*=\s*[01]\b/);
    }
    // 「谁的钱」用 source 文本判定：两侧方言写法一致，不引入布尔列
    const aggregates = fake.statements.filter((s) => s.sql.includes("source <> 'user'"));
    expect(aggregates).toHaveLength(2);
  });

  it("用户自带 key 不去查系统档：excludeUserSource 直接跳过，而不是查完再比", async () => {
    const res = await reserve(fake.repo, { identity: "u1", source: "user", tiers: [callsTier("u1", 5, { excludeUserSource: true })] });
    expect(res.ok).toBe(true);
    expect(fake.statements.filter((s) => s.sql.includes("FROM llm_usage"))).toHaveLength(0);
    expect(fake.reservations[0]?.source).toBe("user");
  });

  it("被上限挡住时不插预留行，但过期回收照常提交（不是回滚）", async () => {
    fake = fakePg({ usage: { calls: 5, tokens: 500, firstAt: Date.now() } });
    const res = await reserve(fake.repo, { identity: "u1", tiers: [callsTier("u1", 5)] });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.blocked).toMatchObject({ scope: "identity", metric: "calls", limit: 5, used: 5, blockedBy: "usage" });
    const client = heads(fake, "client");
    expect(client.some((s) => s.startsWith("INSERT"))).toBe(false);
    expect(client[client.length - 1]).toBe("COMMIT");
    expect(fake.connections.released).toBe(1);
  });

  it("聚合查询失败时回滚、归还连接、还原 db.pg，且一条预留都不留", async () => {
    fake.fault.sqlIncludes = "FROM llm_usage";
    await expect(reserve(fake.repo, { identity: "u1", tiers: [callsTier("u1", 5)] })).rejects.toThrow("注入失败");
    const client = heads(fake, "client");
    expect(client[client.length - 1]).toBe("ROLLBACK");
    expect(client.some((s) => s.startsWith("COMMIT"))).toBe(false);
    expect(fake.reservations).toEqual([]);
    expect(fake.connections).toEqual({ created: 1, released: 1 });
    expect(fake.repo.db.pg).toBe(fake.pool);
  });

  it("别的副本已占的名额对本次可见：预留不插行，直接被在途量挡住", async () => {
    const now = Date.now();
    fake = fakePg({
      reservations: [
        { id: "other", identity: "u1", source: "system", reserved_calls: 5, reserved_tokens: 0, expires_at: now + TTL_MS, created_at: now },
      ],
    });
    const res = await reserve(fake.repo, { identity: "u1", tiers: [callsTier("u1", 5)], now });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    // 没有真实用量、只有另一个进程的行 → 观测上必须区分「闸门在吃并发」和「额度真用完了」
    // Retry-After 等的是那条预留的 TTL（秒级），不是 24h 窗口
    expect(res.blocked).toMatchObject({ used: 5, blockedBy: "reservation", retryAfterMs: TTL_MS });
    expect(fake.statements.some((s) => s.sql.startsWith("INSERT INTO llm_quota_reservations"))).toBe(false);
    expect(fake.reservations.map((r) => r.id)).toEqual(["other"]);
  });

  it("过期预留由下一次预留顺手回收，只删 expires_at <= now 的行", async () => {
    const now = Date.now();
    fake = fakePg({
      reservations: [
        { id: "dead", identity: "u1", source: "system", reserved_calls: 1, reserved_tokens: 0, expires_at: now - 1, created_at: now - TTL_MS },
        { id: "live", identity: "u1", source: "system", reserved_calls: 1, reserved_tokens: 0, expires_at: now + TTL_MS, created_at: now },
      ],
    });
    const res = await reserve(fake.repo, { identity: "u1", tiers: [callsTier("u1", 5)], now });
    if (!res.ok) throw new Error("剩余 4/5 的名额，不该被拒");
    const prune = fake.statements.find((s) => s.sql.includes("DELETE FROM llm_quota_reservations WHERE expires_at <= $1"));
    expect(prune?.params).toEqual([now]);
    expect(fake.reservations.map((r) => r.id).sort()).toEqual(["live", res.reservation.id].sort());
  });

  it("结算走连接池的 DELETE by id：不开事务、不占独占连接", async () => {
    const now = Date.now();
    fake = fakePg({
      reservations: [{ id: "r1", identity: "u1", source: "system", reserved_calls: 1, reserved_tokens: 0, expires_at: now + TTL_MS, created_at: now }],
    });
    await expect(fake.repo.settleLlmQuotaReservation("r1")).resolves.toBe(true);
    const stmt = fake.statements[0];
    expect(stmt?.via).toBe("pool");
    expect(stmt?.sql).toBe("DELETE FROM llm_quota_reservations WHERE id = $1");
    expect(fake.connections.created).toBe(0);
    // 结算=删行：同一 id 第二次没有行可删（预留不参与成本账，留行等于双记）
    await expect(fake.repo.settleLlmQuotaReservation("r1")).resolves.toBe(false);
    expect(fake.reservations).toEqual([]);
  });

  it("预留行按 (id, identity, source, calls, tokens, expires_at, created_at) 绑参", async () => {
    const now = 1_700_000_000_000;
    const res = await reserve(fake.repo, {
      identity: "u1",
      source: "env",
      reservedCalls: 1,
      reservedTokens: 1500,
      tiers: [callsTier("u1", 5)],
      now,
    });
    if (!res.ok) throw new Error("空账本下不该被拒");
    const insert = fake.statements.find((s) => s.sql.startsWith("INSERT INTO llm_quota_reservations"));
    expect(insert?.params).toEqual([res.reservation.id, "u1", "env", 1, 1500, now + TTL_MS, now]);
  });
});
