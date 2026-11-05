/**
 * LLM 额度原子预留的 **真实 PostgreSQL** 并发验收（CI 的 test-postgres job 注入连接串）。
 *
 * 这份文件存在的唯一理由是把假驱动测不到的东西跑一遍：
 *
 *  1. **跨连接/跨副本的并发**。单个 `Repository` 内部有写闸门（`DbAccessGate.write`），
 *     同进程同实例的预留本来就会被串行化——所以只开一个池跑「20 并发抢 5 个名额」
 *     并不能证明 `pg_advisory_xact_lock` 有用。这里刻意开 **3 个独立连接池**，
 *     让 3 个事务真的在数据库层面同时跑：没有那把 advisory 锁，两个事务会同时读到
 *     「还差 1 个名额」并双双插行，最终通过数 > 5。
 *  2. **建表与列型在 PG 上真的成立**。预留表用 `source TEXT` 而不是布尔列，
 *     时间戳用 BIGINT；`information_schema` 断言能挡住「SQLite 绿、PG 起不来」。
 *
 * 隔离方式：只认 `IDENTITY` 这个专属身份，每条用例前把该身份的预留与用量清空，
 * 用例之间不靠执行顺序传状态——同一个 `navhub_test` 库里还跑着别的 PG 套件。
 *
 * 未设置 `NAVHUB_TEST_DATABASE_URL`（或连不上）时整套 skip：本地无 PG 的开发机
 * 不该被这个文件弄红；CI 里必须连上并全绿（入口脚本 `scripts/run-pg-suite.mjs` 拒绝静默跳过）。
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import type { LlmQuotaTier } from "../src/repository/llm-quota.ts";

const DATABASE_URL = process.env.NAVHUB_TEST_DATABASE_URL;
const DAY_MS = 24 * 60 * 60 * 1000;
const TTL_MS = 5 * 60 * 1000;
/** 本套件独占的身份：所有播种与断言都按它过滤，用例前清空、结束即删，不碰别人的数据 */
const IDENTITY = "pg-quota-e2e";

let dbs: Db[] = [];
let repos: Repository[] = [];
let connectError: string | null = null;

if (DATABASE_URL) {
  try {
    // 3 个独立池 = 3 个「副本」：这是与多副本部署等价的最小并发形态
    for (let i = 0; i < 3; i++) dbs.push(await openDb({ dialect: "pg", databaseUrl: DATABASE_URL }));
    repos = dbs.map((db) => new Repository(db));
  } catch (err) {
    connectError = err instanceof Error ? err.message : String(err);
    for (const db of dbs) await db.close().catch(() => undefined);
    dbs = [];
    repos = [];
  }
}

/** 取一个可用的 Repository；空数组时说明连接失败（此时整套已 skip，不该走到这里） */
function repo(i = 0): Repository {
  const r = repos[i];
  if (!r) throw new Error("PG 连接池没建起来");
  return r;
}

/** 系统档口径：只看非用户自带 key 的消耗。身份限定到 IDENTITY，避免吃进同库其它套件的用量 */
const systemTiers = (): LlmQuotaTier[] => [
  { scope: "system", identity: IDENTITY, excludeUserSource: true, maxCalls: 2, maxTokens: 0 },
];

const burstTiers = (): LlmQuotaTier[] => [{ scope: "identity", identity: IDENTITY, maxCalls: 5, maxTokens: 0 }];

type ReserveArgs = { identity?: string; source?: string; reservedCalls?: number; reservedTokens?: number; ttlMs?: number; now?: number; tiers?: LlmQuotaTier[] };

function reserve(r: Repository, input: ReserveArgs = {}) {
  return r.reserveLlmQuota({
    identity: input.identity ?? IDENTITY,
    source: input.source ?? "system",
    reservedCalls: input.reservedCalls ?? 1,
    reservedTokens: input.reservedTokens ?? 0,
    windowMs: DAY_MS,
    ttlMs: input.ttlMs ?? TTL_MS,
    tiers: input.tiers ?? burstTiers(),
    ...(input.now !== undefined ? { now: input.now } : {}),
  });
}

/** 一次性把 count 个预留并发打出去，轮转分到 3 个池：回调同步返回 Promise，所以是真实同时发起 */
async function burst(count: number, input: ReserveArgs = {}) {
  return Promise.all(
    Array.from({ length: count }, (_, i) => reserve(repo(i % repos.length), input)),
  );
}

async function reservationIds(): Promise<string[]> {
  const rows = await repo().raw("SELECT id FROM llm_quota_reservations WHERE identity = ?", [IDENTITY]);
  return rows.map((r) => String(r.id));
}

async function clearSuiteData() {
  const r = repo();
  await r.run("DELETE FROM llm_quota_reservations WHERE identity = ?", [IDENTITY]);
  await r.run("DELETE FROM llm_usage WHERE identity = ?", [IDENTITY]);
}

afterAll(async () => {
  if (repos.length > 0) await clearSuiteData().catch(() => undefined);
  for (const db of dbs) await db.close().catch(() => undefined);
});

describe.skipIf(!repos.length)(
  `跨方言：LLM 额度预留在真实 PostgreSQL 上的并发形态${connectError ? `（连接失败：${connectError}）` : ""}`,
  () => {
    beforeEach(async () => {
      await clearSuiteData();
    });

    it("预留表在 PG 上建得起来，且用 TEXT/BIGINT 而不是布尔列", async () => {
      const cols = await repo().raw(
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'llm_quota_reservations'",
        [],
      );
      const byName = new Map(cols.map((c) => [String(c.column_name), String(c.data_type)]));
      expect([...byName.keys()].sort()).toEqual(
        ["created_at", "expires_at", "id", "identity", "reserved_calls", "reserved_tokens", "source"].sort(),
      );
      // source 若是 BOOLEAN，`source <> 'user'` 在 PG 直接报类型错误；SQLite 侧永远不会暴露这一点
      expect(byName.get("source")).toBe("text");
      expect(byName.get("expires_at")).toBe("bigint");
      expect(byName.get("created_at")).toBe("bigint");
      expect(byName.get("identity")).toBe("text");
    });

    it("20 个并发抢 5 个名额：恰好 5 个通过，其余被在途预留挡住，库里只有 5 行", async () => {
      const results = await burst(20);
      const granted = results.filter((r) => r.ok);
      const blocked = results.filter((r) => !r.ok);
      expect(granted).toHaveLength(5);
      expect(blocked).toHaveLength(15);
      for (const b of blocked) {
        if (b.ok) throw new Error("unreachable");
        expect(b.blocked).toMatchObject({ scope: "identity", metric: "calls", limit: 5, used: 5, blockedBy: "reservation" });
        // 被在途预留挡住时等的是那条预留的 TTL（秒级），不是 24h 窗口
        expect(b.blocked.retryAfterMs).toBeGreaterThan(0);
        expect(b.blocked.retryAfterMs).toBeLessThanOrEqual(TTL_MS);
      }
      const rows = await repo().raw(
        "SELECT reserved_calls FROM llm_quota_reservations WHERE identity = ? AND expires_at > ?",
        [IDENTITY, Date.now()],
      );
      expect(rows).toHaveLength(5);
      // PG 的 SUM/BIGINT 会回传成字符串，计数必须 Number() 过再比
      expect(rows.reduce((s, r) => s + Number(r.reserved_calls ?? 0), 0)).toBe(5);
    });

    it("结算立刻放开名额：占满后结算 3 条，再来 3 个并发全部通过", async () => {
      for (let i = 0; i < 5; i++) expect((await reserve(repo())).ok).toBe(true);
      expect(await reservationIds()).toHaveLength(5);
      const ids = await reservationIds();
      for (const id of ids.slice(0, 3)) await expect(repo().settleLlmQuotaReservation(id)).resolves.toBe(true);
      const again = await burst(3);
      expect(again.filter((r) => r.ok)).toHaveLength(3);
      for (const id of await reservationIds()) await repo().settleLlmQuotaReservation(id);
      expect(await reservationIds()).toHaveLength(0);
    });

    it("异常路径不泄漏预留：没人结算的死行由下一次预留回收，额度不被一次崩溃永久吃掉", async () => {
      const now = Date.now();
      // 模拟「进程被 kill / SSE 半路断开」：5 个名额被占满，但到期时间已在过去
      for (let i = 0; i < 5; i++) {
        await repo().run(
          "INSERT INTO llm_quota_reservations (id, identity, source, reserved_calls, reserved_tokens, expires_at, created_at) " +
            "VALUES (?,?,?,?,?,?,?)",
          [`ttl-${i}`, IDENTITY, "system", 1, 0, now - 1000, now - TTL_MS],
        );
      }
      // 在途口径只看未过期行：死行不该继续吃额度
      const active = await repo().raw(
        "SELECT id FROM llm_quota_reservations WHERE identity = ? AND expires_at > ?",
        [IDENTITY, now],
      );
      expect(active).toHaveLength(0);
      const res = await reserve(repo(), { now });
      expect(res.ok).toBe(true);
      const afterPrune = await reservationIds();
      expect(afterPrune).toHaveLength(1);
      if (res.ok) expect(await repo().settleLlmQuotaReservation(res.reservation.id)).toBe(true);
      expect(await reservationIds()).toHaveLength(0);
    });

    it("用户自带 key 不占系统档：系统额度吃满后仍能放行 source=user", async () => {
      const first = await reserve(repo(), { tiers: systemTiers() });
      if (!first.ok) throw new Error("空账本下系统档不该被拒");
      const second = await reserve(repo(), { tiers: systemTiers() });
      if (second.ok) throw new Error("unreachable");
      expect(second.blocked).toMatchObject({ scope: "system", metric: "calls", used: 1, blockedBy: "reservation" });
      // 别人把运维那把 key 用满了，不能连用户自己的 key 一起拦掉
      const mine = await reserve(repo(), { source: "user", tiers: systemTiers() });
      expect(mine.ok).toBe(true);
      await repo().settleLlmQuotaReservation(first.ok ? first.reservation.id : null);
      await repo().settleLlmQuotaReservation(mine.ok ? mine.reservation.id : null);
      expect(await reservationIds()).toHaveLength(0);
    });

    it("预留不参与成本账：结算删行后 llm_usage 仍是唯一台账", async () => {
      const res = await reserve(repo(), { reservedTokens: 2000, tiers: [] });
      if (!res.ok) throw new Error("unreachable");
      expect(res.reservation.reservedTokens).toBe(2000);
      // 生成结束后落账的真实用量（ok/thinking 必须传原生布尔，见 llm-usage-pg.test.ts）
      await repo().recordLlmUsage({
        scenario: "copilot",
        source: "system",
        model: "pg-e2e",
        identity: IDENTITY,
        ok: true,
        thinking: false,
        promptTokens: 800,
        completionTokens: 200,
      });
      await expect(repo().settleLlmQuotaReservation(res.reservation.id)).resolves.toBe(true);

      const totals = await repo().sumLlmUsage({ since: Date.now() - DAY_MS, identity: IDENTITY });
      expect(totals.calls).toBe(1);
      expect(totals.tokens).toBe(1000);
      // 结算后不留行：否则同一次调用会在「用量 + 预留」两本账里各算一遍，额度越用越紧
      expect(await reservationIds()).toHaveLength(0);
    });
  },
);
