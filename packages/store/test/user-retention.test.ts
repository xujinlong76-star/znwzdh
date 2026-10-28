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
    await insertSettings("github:carol", { historyRetentionDays: 180 }); // 默认值：不参与自动清理
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
