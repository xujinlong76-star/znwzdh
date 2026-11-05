/**
 * LLM 额度**原子预留**（`repository/llm-quota.ts`）的并发与账本正确性。
 *
 * 这一块要钉死的不是「算得准」，而是「同一瞬间的多个请求能不能互相看见」：
 *
 *  1. **判定与占位必须同事务**。老闸门是「先读窗口用量、再在 JS 里比上限」，
 *     两步之间隔着 await，20 个并发请求会同时看到「还没超」并全部放行——
 *     上限 5 实际放出去 20 次真实调用。所以核心用例是「20 并发抢 5 个名额，
 *     恰好 5 个成功」；把实现退回 check-then-act，这条立刻变红。
 *  2. **预留不能变成第二本账**。结算=删行，真实消耗以 llm_usage 为准；
 *     如果结算留下了行，同一次调用会被统计两次，额度只会越用越紧。
 *  3. **来不及结算必须能自愈**。进程被 kill / SSE 半路断开的残留行靠 TTL 回收，
 *     回收前后Retry-After 的口径也不同（等 TTL 是秒级，等窗口滚过是小时级）。
 *  4. **自己的预估不能把自己锁死**。上限小于单次预估时，第一次调用就该放行
 *     （预留量夹到剩余空间以内），否则闸门从「拦并发」退化成「拦死所有请求」。
 *
 * 这里只测存储原语；三档怎么从 config 摊开、拒绝后 HTTP 说什么，在
 * `apps/api/test/llm-quota.test.ts`。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import type { LlmQuotaTier } from "../src/repository/llm-quota.ts";

let dir: string;
let db: Db;
let repo: Repository;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 造一条已落账用量：可指定身份/来源/token/时间，用来摆出上限两侧 */
async function seedUsage(input: {
  identity?: string | null;
  source?: string;
  tokens?: number;
  createdAt?: number;
}) {
  await repo.run(
    "INSERT INTO llm_usage (id, scenario, source, model, identity, prompt_tokens, completion_tokens, latency_ms, ok, error_code, thinking, created_at) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      crypto.randomUUID(),
      "copilot",
      input.source ?? "system",
      "test-model",
      input.identity ?? null,
      input.tokens ?? 0,
      0,
      100,
      true,
      null,
      false,
      input.createdAt ?? Date.now(),
    ],
  );
}

/** 一份默认参数，用例只覆盖自己关心的那几个字段 */
function reserve(input: Partial<Parameters<Repository["reserveLlmQuota"]>[0]>) {
  return repo.reserveLlmQuota({
    identity: null,
    source: "system",
    reservedCalls: 1,
    reservedTokens: 0,
    windowMs: DAY_MS,
    ttlMs: 5 * 60 * 1000,
    tiers: [],
    ...input,
  });
}

const callsTier = (identity: string | null, maxCalls: number): LlmQuotaTier => ({
  scope: identity === null ? "anonymous" : "identity",
  identity,
  maxCalls,
  maxTokens: 0,
});

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-llm-quota-reserve-"));
  db = await openDb({ dialect: "sqlite", sqlitePath: join(dir, "test.db") });
  repo = new Repository(db);
});

afterAll(async () => {
  try {
    await db?.close();
  } catch {
    // Windows 上 SQLite 文件可能被短暂占用
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // 临时目录清理失败不影响结论
  }
});

async function clearAll() {
  await repo.run("DELETE FROM llm_quota_reservations");
  await repo.run("DELETE FROM llm_usage");
}

describe("reserveLlmQuota 的原子性", () => {
  it("20 个并发抢 5 个名额：恰好 5 个通过，其余被在途预留挡住", async () => {
    await clearAll();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => reserve({ identity: "burst", tiers: [callsTier("burst", 5)] })),
    );

    const passed = results.filter((r) => r.ok);
    expect(passed).toHaveLength(5);
    const blocked = results.filter((r) => !r.ok);
    expect(blocked).toHaveLength(15);
    // 库里没有一条真实用量：挡住 15 个的只能是彼此的预留
    for (const r of blocked) {
      if (r.ok) continue;
      expect(r.blocked.scope).toBe("identity");
      expect(r.blocked.metric).toBe("calls");
      expect(r.blocked.limit).toBe(5);
      expect(r.blocked.used).toBe(5);
      expect(r.blocked.blockedBy).toBe("reservation");
    }

    const rows = await repo.raw("SELECT reserved_calls FROM llm_quota_reservations");
    expect(rows).toHaveLength(5);
    for (const r of passed) {
      if (!r.ok) continue;
      expect(r.reservation.reservedCalls).toBe(1);
    }
  });

  it("被拒的请求不留下预留行：拒绝不能自己再占一格", async () => {
    await clearAll();
    const first = await reserve({ identity: "solo", tiers: [callsTier("solo", 1)] });
    expect(first.ok).toBe(true);
    const second = await reserve({ identity: "solo", tiers: [callsTier("solo", 1)] });
    expect(second.ok).toBe(false);
    expect(await repo.listLlmQuotaReservations(10)).toHaveLength(1);
  });

  it("结算立刻放开名额（不用等窗口滚过）", async () => {
    await clearAll();
    const holds = await Promise.all([
      reserve({ identity: "rel", tiers: [callsTier("rel", 2)] }),
      reserve({ identity: "rel", tiers: [callsTier("rel", 2)] }),
    ]);
    expect(holds.every((h) => h.ok)).toBe(true);
    expect((await reserve({ identity: "rel", tiers: [callsTier("rel", 2)] })).ok).toBe(false);

    if (!holds[0].ok) throw new Error("前置预留应当成功");
    expect(await repo.settleLlmQuotaReservation(holds[0].reservation.id)).toBe(true);
    expect((await reserve({ identity: "rel", tiers: [callsTier("rel", 2)] })).ok).toBe(true);
  });

  it("结算=删行：同一次调用不会在预留与用量里各记一遍", async () => {
    await clearAll();
    const hold = await reserve({ identity: "tw", tiers: [callsTier("tw", 3)] });
    if (!hold.ok) throw new Error("前置预留应当成功");
    expect(await repo.settleLlmQuotaReservation(hold.reservation.id)).toBe(true);
    expect(await repo.settleLlmQuotaReservation(hold.reservation.id)).toBe(false);
    expect((await repo.sumLlmQuotaReservations({ identity: "tw" })).calls).toBe(0);
  });

  it("已落账用量 + 在途预留合并计数（两个都不许单独放行）", async () => {
    await clearAll();
    await seedUsage({ identity: "mix", tokens: 10 });
    await seedUsage({ identity: "mix", tokens: 10 });
    // 上限 4：真实用量 2 + 预留 2 = 4，第 5 格已经没有了
    const a = await reserve({ identity: "mix", tiers: [callsTier("mix", 4)] });
    const b = await reserve({ identity: "mix", tiers: [callsTier("mix", 4)] });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    const c = await reserve({ identity: "mix", tiers: [callsTier("mix", 4)] });
    expect(c.ok).toBe(false);
    if (c.ok) return;
    expect(c.blocked.used).toBe(4);
    // 既有落账用量又有在途预留：观测上要能分出这一格是「混合」造成的
    expect(c.blocked.blockedBy).toBe("both");
  });

  it("无身份流量合池：NULL 身份共用一份 anonymous 额度", async () => {
    await clearAll();
    const tier: LlmQuotaTier[] = [{ scope: "anonymous", identity: null, maxCalls: 2, maxTokens: 0 }];
    const results = await Promise.all([
      reserve({ identity: null, tiers: tier }),
      reserve({ identity: null, tiers: tier }),
      reserve({ identity: null, tiers: tier }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(2);

    // 带身份的请求不吃匿名池，也不被匿名池挡住
    const named = await reserve({ identity: "other", tiers: [callsTier("other", 1)] });
    expect(named.ok).toBe(true);
  });

  it("系统档只数非用户自带 key：source='user' 的预留不占运维者预算", async () => {
    await clearAll();
    const systemTier: LlmQuotaTier[] = [{ scope: "system", excludeUserSource: true, maxCalls: 1, maxTokens: 0 }];

    // 两次用户自带 key 的并发：系统档一格都不该被占
    const userA = await reserve({ identity: "u1", source: "user", tiers: systemTier });
    const userB = await reserve({ identity: "u2", source: "user", tiers: systemTier });
    expect(userA.ok).toBe(true);
    expect(userB.ok).toBe(true);
    expect((await repo.sumLlmQuotaReservations({ excludeUserSource: true })).calls).toBe(0);

    // 占满系统档那唯一一格的是第一次系统 key 调用；第二次才该被拒，
    // 而用户自带 key 的始终不受系统档约束。
    const sys = await reserve({ identity: "s1", source: "system", tiers: systemTier });
    expect(sys.ok).toBe(true);
    const sys2 = await reserve({ identity: "s2", source: "system", tiers: systemTier });
    expect(sys2.ok).toBe(false);
    if (sys2.ok) return;
    expect(sys2.blocked.scope).toBe("system");
    expect(sys2.blocked.used).toBe(1);
    expect((await reserve({ identity: "u3", source: "user", tiers: systemTier })).ok).toBe(true);
  });

  it("窗口外的用量不参与判定：昨天的消耗不占今天的并发名额", async () => {
    await clearAll();
    await seedUsage({ identity: "win", createdAt: Date.now() - 25 * 60 * 60 * 1000 });
    const now = Date.now();
    const res = await reserve({
      identity: "win",
      tiers: [callsTier("win", 1)],
      now,
      windowMs: DAY_MS,
    });
    expect(res.ok).toBe(true);
  });
});

describe("token 预留与预估口径", () => {
  it("预估夹到剩余空间：上限小于单次预估时第一次调用仍能通过", async () => {
    await clearAll();
    const tier: LlmQuotaTier[] = [{ scope: "identity", identity: "tiny", maxCalls: 0, maxTokens: 60 }];
    const first = await reserve({ identity: "tiny", reservedTokens: 1500, tiers: tier });
    // 老写法的退化形态：1500 > 60 直接把第一次调用也判成超限 → 整档永久锁死
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.reservation.reservedTokens).toBe(60);

    const second = await reserve({ identity: "tiny", reservedTokens: 1500, tiers: tier });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.blocked.metric).toBe("tokens");
    expect(second.blocked.blockedBy).toBe("reservation");
  });

  it("reservedTokens=0 时预留不带 token 权重：token 档只看已落账用量", async () => {
    await clearAll();
    const tier: LlmQuotaTier[] = [{ scope: "identity", identity: "zero", maxCalls: 5, maxTokens: 10_000 }];
    const a = await reserve({ identity: "zero", reservedTokens: 0, tiers: tier });
    const b = await reserve({ identity: "zero", reservedTokens: 0, tiers: tier });
    expect(a.ok && b.ok).toBe(true);
    expect((await repo.sumLlmQuotaReservations({ identity: "zero" })).tokens).toBe(0);

    // 真实用量灌到上限：没有任何在途预留也照样拦（这一档不该被「预留=0」放空）。
    // 先结算掉 a/b，才能让 blockedBy 干净地报成 usage 而不是 both。
    if (a.ok) await repo.settleLlmQuotaReservation(a.reservation.id);
    if (b.ok) await repo.settleLlmQuotaReservation(b.reservation.id);
    await seedUsage({ identity: "zero", tokens: 10_000 });
    const c = await reserve({ identity: "zero", reservedTokens: 0, tiers: tier });
    expect(c.ok).toBe(false);
    if (c.ok) return;
    expect(c.blocked.metric).toBe("tokens");
    expect(c.blocked.blockedBy).toBe("usage");
  });

  it("真实用量已吃满 token 上限：即使没有预留也拒", async () => {
    await clearAll();
    await seedUsage({ identity: "full", tokens: 5_000 });
    const tier: LlmQuotaTier[] = [{ scope: "identity", identity: "full", maxCalls: 0, maxTokens: 5_000 }];
    const res = await reserve({ identity: "full", reservedTokens: 100, tiers: tier });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.blocked.used).toBe(5_000);
    expect(res.blocked.blockedBy).toBe("usage");
  });
});

describe("TTL 回收（异常与断流路径）", () => {
  it("过期预留不再占额度，并在下一次预留时被清掉", async () => {
    await clearAll();
    const expired = await reserve({ identity: "ttl", ttlMs: 30, tiers: [callsTier("ttl", 1)] });
    expect(expired.ok).toBe(true);
    expect(await repo.listLlmQuotaReservations(10)).toHaveLength(1);

    await new Promise((r) => setTimeout(r, 45));
    const after = await reserve({ identity: "ttl", ttlMs: 30, tiers: [callsTier("ttl", 1)] });
    if (!after.ok) throw new Error("上一轮的死行应被这次预留顺手回收，不该继续占着名额");
    // 只留下一行：上一轮的死行被这次预留顺手回收了
    const rows = await repo.listLlmQuotaReservations(10);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(after.reservation.id);
  });

  it("被预留挡住时 Retry-After 说「等 TTL」而不是「等 24 小时」", async () => {
    await clearAll();
    const ttl = 4_000;
    const first = await reserve({ identity: "ra", ttlMs: ttl, tiers: [callsTier("ra", 1)] });
    expect(first.ok).toBe(true);
    const second = await reserve({ identity: "ra", ttlMs: ttl, tiers: [callsTier("ra", 1)] });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.blocked.retryAfterMs).toBeGreaterThan(0);
    expect(second.blocked.retryAfterMs).toBeLessThanOrEqual(ttl);
  });

  it("pruneLlmQuotaReservations 只删过期行", async () => {
    await clearAll();
    const alive = await reserve({ identity: "p1", ttlMs: 60_000, tiers: [callsTier("p1", 5)] });
    const dead = await reserve({ identity: "p2", ttlMs: 1, tiers: [callsTier("p2", 5)] });
    expect(alive.ok).toBe(true);
    expect(dead.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    const removed = await repo.pruneLlmQuotaReservations(Date.now());
    expect(removed).toBe(1);
    expect(await repo.listLlmQuotaReservations(10)).toHaveLength(1);
  });

  it("sumAllLlmQuotaReservations 只报在途行（metrics 的 active/reserved_tokens 口径）", async () => {
    await clearAll();
    const a = await reserve({ identity: "g1", reservedTokens: 200, ttlMs: 60_000, tiers: [callsTier("g1", 9)] });
    const b = await reserve({ identity: "g2", reservedTokens: 300, ttlMs: 60_000, tiers: [callsTier("g2", 9)] });
    expect(a.ok && b.ok).toBe(true);
    expect(await repo.sumAllLlmQuotaReservations()).toMatchObject({ active: 2, calls: 2, tokens: 500 });

    if (a.ok) await repo.settleLlmQuotaReservation(a.reservation.id);
    expect(await repo.sumAllLlmQuotaReservations()).toMatchObject({ active: 1, calls: 1, tokens: 300 });
  });

  it("结算不存在的预留返回 false，不抛（调用点在 finally 里）", async () => {
    expect(await repo.settleLlmQuotaReservation("no-such-id")).toBe(false);
    expect(await repo.settleLlmQuotaReservation(null)).toBe(false);
    expect(await repo.settleLlmQuotaReservation(undefined)).toBe(false);
  });
});

describe("预留参数的兜底夹紧", () => {
  it("畸形输入（0/负数/NaN 的窗口与 TTL）落回默认值而不是拦死或永不过期", async () => {
    await clearAll();
    const res = await reserve({
      identity: "bad",
      ttlMs: 0,
      windowMs: Number.NaN,
      reservedCalls: 0,
      reservedTokens: -5,
      tiers: [callsTier("bad", 2)],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.reservation.reservedCalls).toBe(1);
    expect(res.reservation.reservedTokens).toBe(0);
    // TTL 落回 5 分钟：expires_at 应当明显在未来，而不是 <= now（那样等于没预留）
    expect(res.reservation.expiresAt).toBeGreaterThan(Date.now());
  });

  it("超长身份串按 64 字符裁剪（与 llm_usage 的写入侧同一道闸）", async () => {
    await clearAll();
    const long = "u".repeat(200);
    const res = await reserve({ identity: long, tiers: [{ scope: "identity", identity: long, maxCalls: 1, maxTokens: 0 }] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.reservation.identity).toHaveLength(64);
  });
});

describe("注销账号带走在途预留（清单登记要能真的删到）", () => {
  it("deleteUserData 删掉该身份的预留行，别人的预留不受影响", async () => {
    await clearAll();
    const mine = await reserve({ identity: "gone", tiers: [callsTier("gone", 5)] });
    const other = await reserve({ identity: "stay", tiers: [callsTier("stay", 5)] });
    if (!mine.ok || !other.ok) throw new Error("两条预留都应该成功，用例才有东西可清");

    await repo.deleteUserData("gone");

    const rows = await repo.listLlmQuotaReservations(10);
    expect(rows.map((r) => r.identity)).toEqual(["stay"]);
  });
});
