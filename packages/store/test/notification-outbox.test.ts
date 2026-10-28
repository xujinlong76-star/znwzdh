import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { migrateSiteIndexes } from "../src/migrate.ts";
import { Repository } from "../src/repository.ts";

const NOW = 1_800_000_000_000;
const input = { identity: "user-a", idempotencyKey: "sync:one", kind: "sync", title: "Sync completed", body: "Safe summary" };

// 真实临时 SQLite（内存库），经 openDb 跑实际迁移；不使用环境连接串或实库。
describe("notification outbox / SQLite", () => {
  let db: Db;
  let repo: Repository;
  let clock: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
    clock = vi.spyOn(Date, "now").mockReturnValue(NOW);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db?.close();
  });

  it("迁移可重复执行，outbox 使用实际约束和索引", async () => {
    await repo.emitNotification(input);
    await migrateSiteIndexes(db);
    expect((await repo.listNotificationDeliveries()).items).toHaveLength(1);
    const columns = await repo.raw("PRAGMA table_info(notification_outbox)");
    expect(columns.map((row) => row.name)).toEqual([
      "id", "identity", "channel", "kind", "title", "body", "status", "attempts",
      "next_attempt_at", "last_error", "created_at", "delivered_at",
    ]);
    expect(columns.find((row) => row.name === "id")?.pk).toBe(1);
    const indexes = await repo.raw("PRAGMA index_list(notification_outbox)");
    expect(indexes.map((row) => row.name)).toEqual(expect.arrayContaining([
      "notification_outbox_due_idx", "notification_outbox_created_idx",
    ]));
    await expect(repo.run("UPDATE notification_outbox SET status = 'sent'")).rejects.toThrow();
    await expect(repo.run("UPDATE notification_outbox SET channel = 'sms'")).rejects.toThrow();
  });

  it("默认仅入队 inapp；并发重复 emit 使用稳定 SHA256 id，首次内容胜出", async () => {
    const first = await repo.emitNotification(input);
    expect(first.ids).toEqual([
      createHash("sha256").update(JSON.stringify([input.identity, input.idempotencyKey, "inapp"])).digest("hex"),
    ]);
    const duplicates = await Promise.all(Array.from({ length: 5 }, () =>
      repo.emitNotification({ ...input, title: "Do not overwrite", channels: ["inapp", "inapp"] }),
    ));
    expect(duplicates.every((value) => value.ids[0] === first.ids[0])).toBe(true);
    expect(await repo.raw("SELECT * FROM notifications")).toEqual([]);
    const rows = await repo.raw("SELECT * FROM notification_outbox");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: input.title, body: input.body, status: "pending", attempts: 0, next_attempt_at: NOW });
    expect(await repo.relayNotifications()).toEqual({ delivered: 1, failed: 0 });
    expect(await repo.emitNotification(input)).toEqual(first);
    expect(await repo.relayNotifications()).toEqual({ delivered: 0, failed: 0 });
    expect(await repo.countUnreadNotifications(input.identity)).toBe(1);
  });

  it("相同 key 不跨身份去重，元组边界也不碰撞", async () => {
    const ids = [];
    for (const value of [
      input,
      { ...input, identity: "user-b" },
      { ...input, idempotencyKey: "sync:two" },
      { ...input, identity: "ab", idempotencyKey: "c" },
      { ...input, identity: "a", idempotencyKey: "bc" },
    ]) ids.push(...(await repo.emitNotification(value)).ids);
    expect(new Set(ids).size).toBe(5);
    expect(await repo.relayNotifications()).toEqual({ delivered: 5, failed: 0 });
    expect(await repo.countUnreadNotifications("user-a")).toBe(2);
    expect(await repo.countUnreadNotifications("user-b")).toBe(1);
  });

  it("未投递的 outbox 也参与通知去重窗口，避免跨时间桶重复提醒", async () => {
    expect(await repo.hasRecentNotification(input.identity, input.kind, 60_000)).toBe(false);
    await repo.emitNotification(input);
    expect(await repo.hasRecentNotification(input.identity, input.kind, 60_000)).toBe(true);
    clock.mockReturnValue(NOW + 60_001);
    expect(await repo.hasRecentNotification(input.identity, input.kind, 60_000)).toBe(false);
  });

  it("业务事务回滚时不留下 outbox 或业务写入", async () => {
    await expect(repo.withTransaction(async () => {
      await repo.createNotification({ ...input, title: "Business write" });
      await repo.emitNotification({ ...input, channels: ["inapp", "email", "push"] });
      throw new Error("business rollback");
    })).rejects.toThrow("business rollback");
    expect((await repo.listNotificationDeliveries()).items).toEqual([]);
    expect(await repo.countUnreadNotifications(input.identity)).toBe(0);
  });

  it("emit 多渠道写入中途失败时全部回滚（spy 注入，不篡改 schema）", async () => {
    const run = repo.run.bind(repo);
    vi.spyOn(repo, "run").mockImplementation(async (sql, params = []) => {
      if (sql.startsWith("INSERT INTO notification_outbox") && params[2] === "push") throw new Error("injected");
      return run(sql, params);
    });
    await expect(repo.emitNotification({ ...input, channels: ["inapp", "push"] })).rejects.toThrow("injected");
    expect((await repo.listNotificationDeliveries()).items).toEqual([]);
  });

  it("email/push 保持 deferred，未配置说明明确，不计作交付或重试", async () => {
    const channels = ["inapp", "email", "push"] as const;
    const emitted = await repo.emitNotification({ ...input, channels: [...channels] });
    expect(new Set(emitted.ids).size).toBe(3);
    expect(await repo.emitNotification({ ...input, channels: [...channels] })).toEqual(emitted);
    expect(await repo.relayNotifications()).toEqual({ delivered: 1, failed: 0 });
    expect(await repo.relayNotifications()).toEqual({ delivered: 0, failed: 0 });
    const deferred = await repo.listNotificationDeliveries({ status: "deferred" });
    expect(deferred.items).toHaveLength(2);
    for (const row of deferred.items) {
      expect(row).toMatchObject({ attempts: 0, nextAttemptAt: null, deliveredAt: null, status: "deferred" });
      expect(row.lastError?.toLowerCase()).toBe(`${row.channel} sender is not configured`);
    }
    expect(await repo.countUnreadNotifications(input.identity)).toBe(1);
  });

  it("inbox 写成功但 outbox 更新失败时整体回滚，退避后仅投递一次", async () => {
    const { ids: [id] } = await repo.emitNotification(input);
    const run = repo.run.bind(repo);
    let fail = true;
    const spy = vi.spyOn(repo, "run").mockImplementation(async (sql, params = []) => {
      if (fail && sql.startsWith("UPDATE notification_outbox SET status = 'delivered'")) {
        fail = false;
        throw new Error("injected completion failure");
      }
      return run(sql, params);
    });
    expect(await repo.relayNotifications()).toEqual({ delivered: 0, failed: 1 });
    expect(await repo.countUnreadNotifications(input.identity)).toBe(0);
    expect((await repo.listNotificationDeliveries()).items[0]).toMatchObject({
      id, status: "pending", attempts: 1, nextAttemptAt: NOW + 60_000, deliveredAt: null,
    });
    clock.mockReturnValue(NOW + 60_000);
    expect(await repo.relayNotifications()).toEqual({ delivered: 1, failed: 0 });
    expect(await repo.relayNotifications()).toEqual({ delivered: 0, failed: 0 });
    expect(await repo.raw("SELECT id FROM notifications")).toEqual([{ id }]);
    expect((await repo.listNotificationDeliveries()).items[0]).toMatchObject({
      status: "delivered", attempts: 1, lastError: null, nextAttemptAt: null, deliveredAt: NOW + 60_000,
    });
    expect(spy.mock.calls.filter(([sql]) => sql.startsWith("INSERT INTO notifications"))).toHaveLength(2);
  });

  it("inbox 已有确定性 id 时重试不重复、不覆盖内容或已读状态", async () => {
    const { ids: [id] } = await repo.emitNotification(input);
    await repo.run(
      "INSERT INTO notifications (id, identity, kind, title, body, read_at, created_at) VALUES (?,?,?,?,?,?,?)",
      [id, input.identity, input.kind, "Original", "Original body", NOW - 1, NOW - 2],
    );
    expect(await repo.relayNotifications()).toEqual({ delivered: 1, failed: 0 });
    expect(await repo.raw("SELECT id, title, read_at, created_at FROM notifications")).toEqual([
      { id, title: "Original", read_at: NOW - 1, created_at: NOW - 2 },
    ]);
  });

  it("60s/120s 指数退避，三次失败耗尽；一轮不重复失败行，也不阻塞后续行", async () => {
    const { ids: [badId] } = await repo.emitNotification(input);
    clock.mockReturnValue(NOW + 1);
    await repo.emitNotification({ ...input, idempotencyKey: "healthy" });
    const run = repo.run.bind(repo);
    const spy = vi.spyOn(repo, "run").mockImplementation(async (sql, params = []) => {
      if (sql.startsWith("INSERT INTO notifications") && params[0] === badId) {
        throw new Error("postgres://credential-must-not-be-stored secret-token");
      }
      return run(sql, params);
    });
    expect(await repo.relayNotifications(100)).toEqual({ delivered: 1, failed: 1 });
    let row = (await repo.listNotificationDeliveries({ status: "pending" })).items[0];
    expect(row).toMatchObject({ attempts: 1, nextAttemptAt: NOW + 60_001 });
    expect(row.lastError).toBe("In-app notification delivery failed");
    clock.mockReturnValue(NOW + 60_000);
    expect(await repo.relayNotifications()).toEqual({ delivered: 0, failed: 0 });
    clock.mockReturnValue(NOW + 60_001);
    expect(await repo.relayNotifications(100)).toEqual({ delivered: 0, failed: 1 });
    row = (await repo.listNotificationDeliveries({ status: "pending" })).items[0];
    expect(row).toMatchObject({ attempts: 2, nextAttemptAt: NOW + 180_001 });
    clock.mockReturnValue(NOW + 180_000);
    expect(await repo.relayNotifications()).toEqual({ delivered: 0, failed: 0 });
    clock.mockReturnValue(NOW + 180_001);
    expect(await repo.relayNotifications()).toEqual({ delivered: 0, failed: 1 });
    expect((await repo.listNotificationDeliveries({ status: "failed" })).items[0]).toMatchObject({
      id: badId, attempts: 3, nextAttemptAt: null, deliveredAt: null,
    });
    clock.mockReturnValue(NOW + 999_999);
    expect(await repo.relayNotifications()).toEqual({ delivered: 0, failed: 0 });
    expect(spy.mock.calls.filter(([sql, params]) => sql.startsWith("INSERT INTO notifications") && params?.[0] === badId)).toHaveLength(3);
    expect(await repo.countUnreadNotifications(input.identity)).toBe(1);
  });

  it("时钟回拨导致退避时间仍到期时，同一轮仍显式排除失败行", async () => {
    await repo.emitNotification(input);
    const run = repo.run.bind(repo);
    let failures = 0;
    vi.spyOn(repo, "run").mockImplementation(async (sql, params = []) => {
      if (sql.startsWith("INSERT INTO notifications")) {
        failures++;
        clock.mockReturnValue(NOW - 120_000);
        throw new Error("injected");
      }
      return run(sql, params);
    });
    expect(await repo.relayNotifications(100)).toEqual({ delivered: 0, failed: 1 });
    expect(failures).toBe(1);
  });

  it("多个并发 relay 不重复投递或重复计数", async () => {
    await repo.withTransaction(async () => {
      for (let i = 0; i < 24; i++) await repo.emitNotification({ ...input, idempotencyKey: `parallel:${i}` });
    });
    const results = await Promise.all(Array.from({ length: 8 }, () => repo.relayNotifications(5)));
    expect(results.reduce((sum, result) => sum + result.delivered, 0)).toBe(24);
    expect(results.every((result) => result.failed === 0)).toBe(true);
    const rows = await repo.raw("SELECT id FROM notifications");
    expect(rows).toHaveLength(24);
    expect(new Set(rows.map((row) => row.id)).size).toBe(24);
    expect((await repo.listNotificationDeliveries({ status: "delivered" })).items).toHaveLength(24);
  });

  it("回滚与失败记账间已有其他 worker 投递时，CAS 不覆盖 delivered", async () => {
    const { ids: [id] } = await repo.emitNotification(input);
    const run = repo.run.bind(repo);
    const runCount = repo.runCount.bind(repo);
    vi.spyOn(repo, "run").mockImplementation(async (sql, params = []) => {
      if (sql.startsWith("INSERT INTO notifications")) throw new Error("injected");
      return run(sql, params);
    });
    vi.spyOn(repo, "runCount").mockImplementation(async (sql, params) => {
      // 在失败 CAS 执行前注入竞争实例的已提交状态；不改 schema。
      await run("INSERT INTO notifications (id, identity, kind, title, created_at) VALUES (?,?,?,?,?)",
        [id, input.identity, input.kind, input.title, NOW]);
      await run("UPDATE notification_outbox SET status = 'delivered', delivered_at = ?, next_attempt_at = NULL WHERE id = ?", [NOW, id]);
      return runCount(sql, params);
    });
    expect(await repo.relayNotifications()).toEqual({ delivered: 0, failed: 0 });
    expect((await repo.listNotificationDeliveries()).items[0]).toMatchObject({ status: "delivered", attempts: 0, lastError: null });
    expect(await repo.countUnreadNotifications(input.identity)).toBe(1);
  });

  it("relay 默认 50，显式批量上限 100；管理员分页有稳定 hasMore", async () => {
    await repo.withTransaction(async () => {
      for (let i = 0; i < 152; i++) await repo.emitNotification({ ...input, idempotencyKey: `batch:${i}` });
    });
    expect(await repo.relayNotifications()).toEqual({ delivered: 50, failed: 0 });
    expect(await repo.relayNotifications(10_000)).toEqual({ delivered: 100, failed: 0 });
    const first = await repo.listNotificationDeliveries({ limit: 10_000 });
    expect(first.items).toHaveLength(100);
    expect(first.hasMore).toBe(true);
    const rest = await repo.listNotificationDeliveries({ limit: 100, offset: 100 });
    expect(rest.items).toHaveLength(52);
    expect(rest.hasMore).toBe(false);
    expect(new Set([...first.items, ...rest.items].map((row) => row.id)).size).toBe(152);
    const pending = await repo.listNotificationDeliveries({ status: "pending", limit: 1 });
    expect(pending.items).toHaveLength(1);
    expect(pending.hasMore).toBe(true);
    expect(pending.items[0]).not.toHaveProperty("title");
    expect(pending.items[0]).not.toHaveProperty("body");
    expect(pending.items[0]).not.toHaveProperty("idempotencyKey");
    expect((await repo.listNotificationDeliveries({ limit: NaN, offset: NaN })).items).toHaveLength(50);
    expect(await repo.relayNotifications(NaN)).toEqual({ delivered: 2, failed: 0 });
  });

  it("拒绝空身份/key 和未知渠道/status，不执行部分写入", async () => {
    await expect(repo.emitNotification({ ...input, identity: " " })).rejects.toThrow("required");
    await expect(repo.emitNotification({ ...input, idempotencyKey: "" })).rejects.toThrow("required");
    // @ts-expect-error 模拟未经类型检查的调用方
    await expect(repo.emitNotification({ ...input, channels: ["inapp", "sms"] })).rejects.toThrow("Unsupported");
    // @ts-expect-error 模拟未知状态筛选
    await expect(repo.listNotificationDeliveries({ status: "anything" })).rejects.toThrow("Unsupported");
    expect(await repo.emitNotification({ ...input, channels: [] })).toEqual({ ids: [] });
    expect((await repo.listNotificationDeliveries()).items).toEqual([]);
  });

  it("relay 拒绝嵌套业务事务，保留 createNotification 原有直接写入行为", async () => {
    await expect(repo.withTransaction(() => repo.relayNotifications())).rejects.toThrow("outside a transaction");
    const first = await repo.createNotification(input);
    const second = await repo.createNotification(input);
    expect(first.id).not.toBe(second.id);
    expect(await repo.countUnreadNotifications(input.identity)).toBe(2);
    expect((await repo.listNotificationDeliveries()).items).toEqual([]);
  });
});

// 仅模拟 PG runner 以验证 SQL、独占连接和 aborted transaction 恢复顺序；不连接 PostgreSQL。
function fakePg(failDelivery = false, failClaim = false) {
  const calls: Array<{ client: number; sql: string; params: unknown[] }> = [];
  let clientId = 0;
  let status = "pending";
  let attempts = 0;
  const pool = {
    query: vi.fn(async () => { throw new Error("must use dedicated client"); }),
    connect: vi.fn(async () => {
      const client = ++clientId;
      let aborted = false;
      return {
        query: async (sql: string, params: unknown[] = []) => {
          calls.push({ client, sql, params });
          if (sql === "ROLLBACK") aborted = false;
          if (aborted) throw new Error("SQL issued in aborted transaction");
          if (sql.startsWith("SELECT id, identity, kind")) {
            if (failClaim) { aborted = true; throw new Error("claim failed"); }
            const eligible = status === "pending" && attempts === 0 && !params.slice(2).includes("pg-row");
            return { rows: eligible ? [{ id: "pg-row", identity: "user-a", kind: "sync", title: "Safe summary",
              body: null, attempts: "0", next_attempt_at: String(NOW), created_at: String(NOW) }] : [], rowCount: eligible ? 1 : 0 };
          }
          if (sql.startsWith("INSERT INTO notifications") && failDelivery) {
            aborted = true;
            throw new Error("PG statement failed with private parameters");
          }
          if (sql.startsWith("UPDATE notification_outbox SET status = 'delivered'")) status = "delivered";
          if (sql.startsWith("UPDATE notification_outbox SET attempts")) attempts = Number(params[0]);
          return { rows: [], rowCount: 1 };
        },
        release: () => { calls.push({ client, sql: "RELEASE_CLIENT", params: [] }); },
      };
    }),
  };
  const db = { dialect: "pg", pg: pool, orm: null, close: async () => undefined } as unknown as Db;
  return { repo: new Repository(db), calls, pool };
}

describe("notification outbox / PG SQL structure (no live PG)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("事务独占连接使用 FOR UPDATE SKIP LOCKED 与 PG 占位符，写入后同事务标记 delivered", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const { repo, calls, pool } = fakePg();
    expect(await repo.relayNotifications(1)).toEqual({ delivered: 1, failed: 0 });
    expect(pool.query).not.toHaveBeenCalled();
    expect(calls.map((call) => call.sql)).toEqual([
      "BEGIN", expect.stringContaining("LIMIT 1 FOR UPDATE SKIP LOCKED"),
      expect.stringContaining("INSERT INTO notifications"),
      expect.stringContaining("UPDATE notification_outbox SET status = 'delivered'"), "COMMIT", "RELEASE_CLIENT",
    ]);
    expect(new Set(calls.map((call) => call.client)).size).toBe(1);
    expect(calls[1].sql).toContain("attempts < $1 AND next_attempt_at <= $2");
    expect(calls[2].sql).toContain("ON CONFLICT(id) DO NOTHING");
    expect(calls[2].params).toEqual(["pg-row", "user-a", "sync", "Safe summary", null, NOW]);
  });

  it("PG SQL 失败后先 ROLLBACK/释放连接，再新事务 CAS 记录退避，无 aborted 事务 SQL", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const { repo, calls, pool } = fakePg(true);
    expect(await repo.relayNotifications()).toEqual({ delivered: 0, failed: 1 });
    expect(pool.query).not.toHaveBeenCalled();
    const insertion = calls.findIndex((call) => call.sql.startsWith("INSERT INTO notifications"));
    const recovery = calls.findIndex((call) => call.sql.startsWith("UPDATE notification_outbox SET attempts"));
    expect(calls.slice(insertion + 1, recovery).map((call) => call.sql)).toEqual(["ROLLBACK", "RELEASE_CLIENT", "BEGIN"]);
    expect(calls[recovery].client).not.toBe(calls[insertion].client);
    expect(calls[recovery].sql).toContain("status = 'pending' AND attempts = $6 AND next_attempt_at = $7");
    expect(calls[recovery].params).toEqual([1, "pending", NOW + 60_000, "In-app notification delivery failed", "pg-row", 0, NOW]);
    const claims = calls.filter((call) => call.sql.startsWith("SELECT id, identity, kind"));
    expect(claims).toHaveLength(2);
    expect(claims[1].sql).toContain("id NOT IN ($3)");
    expect(claims[1].params[2]).toBe("pg-row");
  });

  it("领取 SQL 失败只回滚并抛出，不给未知行记失败", async () => {
    const { repo, calls } = fakePg(false, true);
    await expect(repo.relayNotifications()).rejects.toThrow("claim failed");
    expect(calls.map((call) => call.sql)).toEqual([
      "BEGIN", expect.stringContaining("FOR UPDATE SKIP LOCKED"), "ROLLBACK", "RELEASE_CLIENT",
    ]);
  });

  it("PG emit 同样使用幂等 INSERT，邮件默认 deferred", async () => {
    const { repo, calls } = fakePg();
    await repo.emitNotification({ ...input, channels: ["email"] });
    const insert = calls.find((call) => call.sql.startsWith("INSERT INTO notification_outbox"))!;
    expect(insert.sql).toContain("ON CONFLICT(id) DO NOTHING");
    expect(insert.sql).not.toContain("?");
    expect(insert.params.slice(6, 9)).toEqual(["deferred", null, "Email sender is not configured"]);
  });

  it("PG 迁移发出 outbox BIGINT DDL、状态约束与领取索引", async () => {
    const sql: string[] = [];
    await migrateSiteIndexes({ dialect: "pg", pg: { query: async (text: string) => {
      sql.push(text);
      return { rows: [{ c: 0 }], rowCount: 0 };
    } } });
    expect(sql.find((text) => text.startsWith("CREATE TABLE IF NOT EXISTS notification_outbox"))).toEqual(
      expect.stringContaining("next_attempt_at BIGINT"),
    );
    expect(sql.find((text) => text.startsWith("CREATE TABLE IF NOT EXISTS notification_outbox"))).toContain(
      "status IN ('pending', 'delivered', 'deferred', 'failed')",
    );
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS notification_outbox_due_idx ON notification_outbox(next_attempt_at, created_at, id) WHERE status = 'pending' AND channel = 'inapp'");
  });
});
