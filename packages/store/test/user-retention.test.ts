import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";

/**
 * 用户自设的历史保留期（P0-1）。
 *
 * 回归背景：查询写成 `SELECT user_id ... FROM user_settings`，而该表主键是
 * `identity`。SQLite 直接抛 "no such column: user_id"，调用方（data_retention）
 * 把异常吞成 summary.error——用户的保留期选择从未生效。
 */
describe("listCustomHistoryRetention", () => {
  let db: Db;
  let repo: Repository;

  const insertSettings = async (identity: string, prefs: Record<string, unknown>) => {
    const now = Date.now();
    await repo.run(
      "INSERT INTO user_settings (identity, personalization_enabled, favorite_signal_cutoff, preferences_json, created_at, updated_at) VALUES (?,?,?,?,?,?)",
      [identity, 1, 0, JSON.stringify(prefs), now, now],
    );
  };

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
    await insertSettings("github:alice", { historyRetentionDays: 30 });
    await insertSettings("github:bob", { historyRetentionDays: 90 });
    await insertSettings("github:carol", { historyRetentionDays: 180 }); // 默认值：listCustomHistoryRetention 不列它（该函数只列显式非默认）；全量覆盖见下面的 listHistoryRetentionPolicies
    await insertSettings("github:dave", { historyRetentionDays: 0 }); // 非法值：跳过
    await insertSettings("github:erin", { cardDensity: "compact" }); // 没设保留期
  });

  afterAll(async () => {
    await db.close();
  });

  it("返回显式设置过保留期的用户（不含默认 180 与非法值）", async () => {
    const rows = await repo.listCustomHistoryRetention();
    expect(rows).toEqual([
      { identity: "github:alice", retentionDays: 30 },
      { identity: "github:bob", retentionDays: 90 },
    ]);
  });

  it("坏 JSON 不会中断整轮任务", async () => {
    await repo.run(
      "INSERT INTO user_settings (identity, personalization_enabled, favorite_signal_cutoff, preferences_json, created_at, updated_at) VALUES (?,?,?,?,?,?)",
      ["github:broken", 1, 0, "{not-json historyRetentionDays", Date.now(), Date.now()],
    );
    const rows = await repo.listCustomHistoryRetention();
    expect(rows.map((r) => r.identity)).not.toContain("github:broken");
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});

/**
 * 全量历史保留策略（U-373）。
 *
 * 旧口径（listCustomHistoryRetention）只列显式非默认保留期的用户，默认
 * 180 天的用户从未被清理过。本函数列「有数据要管」的全部身份：搜索历史
 * 或 click 信号里出现过的身份，各取其有效保留期（无设置行默认 180）。
 */
describe("listHistoryRetentionPolicies", () => {
  let db: Db;
  let repo: Repository;
  const DAY = 86_400_000;

  const insertHistory = async (userId: string, ageDays: number) => {
    await repo.run("INSERT INTO search_history (user_id, query, result_count, created_at) VALUES (?,?,1,?)", [
      userId,
      `u373-${userId}`,
      Date.now() - ageDays * DAY,
    ]);
  };

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
    const now = Date.now();
    await repo.run(
      "INSERT INTO user_settings (identity, personalization_enabled, favorite_signal_cutoff, preferences_json, created_at, updated_at) VALUES (?,?,?,?,?,?)",
      ["github:alice", 1, 0, JSON.stringify({ historyRetentionDays: 30 }), now, now],
    );
    await repo.run(
      "INSERT INTO user_settings (identity, personalization_enabled, favorite_signal_cutoff, preferences_json, created_at, updated_at) VALUES (?,?,?,?,?,?)",
      ["github:carol", 1, 0, JSON.stringify({ historyRetentionDays: 180 }), now, now],
    );
    await repo.run(
      "INSERT INTO user_settings (identity, personalization_enabled, favorite_signal_cutoff, preferences_json, created_at, updated_at) VALUES (?,?,?,?,?,?)",
      ["github:erin", 1, 0, JSON.stringify({ cardDensity: "compact" }), now, now],
    );
    // alice：显式 30 天，有历史；carol：显式 180 天，有历史；
    // frank：无设置行，有历史 → 默认 180；grace：无设置行，只有 click 信号 → 默认 180；
    // erin：有设置行但无任何数据 → 不进候选集。
    await insertHistory("github:alice", 5);
    await insertHistory("github:carol", 5);
    await insertHistory("github:frank", 5);
    await repo.recordEvent("click", { siteId: null, meta: { identity: "github:grace" } });
  });

  afterAll(async () => {
    await db.close();
  });

  it("列出全部有数据的身份，各取有效保留期（无设置行默认 180），按 identity 排序", async () => {
    const rows = await repo.listHistoryRetentionPolicies();
    expect(rows).toEqual([
      { identity: "github:alice", retentionDays: 30 },
      { identity: "github:carol", retentionDays: 180 },
      { identity: "github:frank", retentionDays: 180 },
      { identity: "github:grace", retentionDays: 180 },
    ]);
  });
});

describe("cleanupExpiredUserHistory", () => {
  let db: Db;
  let repo: Repository;
  const DAY = 86_400_000;
  const identity = "github:henry";

  const seedClick = async (ageDays: number) => {
    await repo.recordEvent("click", { siteId: null, meta: { identity } });
    await db.sqlite!
      .prepare("UPDATE events SET created_at = ? WHERE rowid = last_insert_rowid()")
      .run(Date.now() - ageDays * DAY);
  };

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
    await repo.updateUserSettings(identity, { historyRetentionDays: 30 });
    await repo.run("INSERT INTO search_history (user_id, query, result_count, created_at) VALUES (?,?,1,?)", [
      identity,
      "u373-old",
      Date.now() - 40 * DAY,
    ]);
    await repo.run("INSERT INTO search_history (user_id, query, result_count, created_at) VALUES (?,?,1,?)", [
      identity,
      "u373-fresh",
      Date.now() - 5 * DAY,
    ]);
    await seedClick(40);
    await seedClick(5);
  });

  afterAll(async () => {
    await db.close();
  });

  it("删过期历史与 click、留未过期，并写清理审计；再跑一次无事可删", async () => {
    expect(await repo.getLastHistoryCleanupAt(identity)).toBeNull();
    const before = Date.now();
    const first = await repo.cleanupExpiredUserHistory(identity, {
      retentionDays: 30,
      actor: "system:data_retention",
      actorKind: "system",
    });
    expect(first.historyDeleted).toBe(1);
    expect(first.clicksDeleted).toBe(1);
    expect(first.cleanedAt).not.toBeNull();
    expect(first.cleanedAt!).toBeGreaterThanOrEqual(before);
    expect(await repo.countSearchHistory(identity)).toBe(1);
    expect(
      Number(
        db.sqlite!.prepare("SELECT COUNT(*) AS c FROM events WHERE kind = 'click' AND identity = ?").get(identity)
          ?.c ?? 0,
      ),
    ).toBe(1);
    const cleanedAt = await repo.getLastHistoryCleanupAt(identity);
    expect(cleanedAt).not.toBeNull();
    expect(cleanedAt!).toBeGreaterThanOrEqual(before);

    const second = await repo.cleanupExpiredUserHistory(identity, {
      retentionDays: 30,
      actor: "system:data_retention",
      actorKind: "system",
    });
    expect(second.historyDeleted).toBe(0);
    expect(second.clicksDeleted).toBe(0);
    expect(second.cleanedAt).toBeNull();
    expect(await repo.getLastHistoryCleanupAt(identity)).toBe(cleanedAt);
  });

  it("非法保留天数直接抛错（fail-closed，不静默按默认值删）", async () => {
    await expect(
      repo.cleanupExpiredUserHistory(identity, {
        retentionDays: 0,
        actor: "system:data_retention",
        actorKind: "system",
      }),
    ).rejects.toThrow("保留天数必须为正数");
  });
});
