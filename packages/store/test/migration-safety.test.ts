import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { migrateSiteIndexes, migrateWorkspaceBlobs } from "../src/migrate.ts";
import { Repository } from "../src/repository.ts";

/**
 * 迁移安全（P0-2 / P1-7）。
 *
 * 两个旧行为的回归：
 *  1. 工作区搬迁是「INSERT 一句 + DELETE 一句」，各自 try/catch——INSERT 失败
 *     DELETE 照跑，明文永久丢失；
 *  2. 唯一索引先 DROP 后 CREATE——CREATE 失败时唯一性静默失效。
 */
describe("迁移安全", () => {
  let db: Db;
  let repo: Repository;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
  });

  afterAll(async () => {
    await db.close();
  });

  const insertVault = async (key: string, payload: string) => {
    await repo.run(
      "INSERT INTO user_vault_sync (user_id, payload, version, updated_at) VALUES (?,?,?,?)",
      [key, payload, 1, Date.now()],
    );
  };

  it("正常路径：复制进新表后才删除源行", async () => {
    await insertVault("workspaces:alice", "plain-a");
    await insertVault("ws_members:alice:bob", "plain-b");
    await insertVault("github:alice", "vault-cipher"); // 非工作区键：不得被搬走/删除

    const result = await migrateWorkspaceBlobs(db);
    expect(result.skipped).toBe(false);
    expect(result.copied).toBe(2);

    const blobs = await repo.raw("SELECT user_id, payload FROM user_workspace_blobs ORDER BY user_id");
    expect(blobs.map((r) => r.user_id)).toEqual(["workspaces:alice", "ws_members:alice:bob"]);
    const vault = await repo.raw("SELECT user_id FROM user_vault_sync ORDER BY user_id");
    expect(vault.map((r) => r.user_id)).toEqual(["github:alice"]);
  });

  it("INSERT 失败时一行都不删（EXISTS 守卫）", async () => {
    await insertVault("workspaces:carol", "must-survive");
    // 制造失败：目标表不存在 → INSERT 抛错；旧实现此时 DELETE 仍会执行
    await repo.run("DROP TABLE user_workspace_blobs");

    const result = await migrateWorkspaceBlobs(db);
    expect(result.skipped).toBe(true);
    expect(result.copied).toBe(0);

    const rows = await repo.raw("SELECT user_id FROM user_vault_sync WHERE user_id = ?", ["workspaces:carol"]);
    expect(rows).toHaveLength(1);

    // 失败必须可查询，而不是只留一行 console
    const failures = await repo.raw("SELECT step, error FROM migration_failures");
    expect(failures.some((r) => String(r.step).includes("workspace_blobs"))).toBe(true);
    expect(String(failures[0]?.error ?? "")).toContain("user_workspace_blobs");
  });

  it("唯一索引先建后删：新索引存在，旧索引被清掉", async () => {
    // 先把库恢复到可用状态（上一条用例 DROP 了目标表）
    await repo.run("CREATE TABLE IF NOT EXISTS user_workspace_blobs (user_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL)");
    await migrateSiteIndexes(db);

    const indexes = (await repo.raw("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'sites'")).map(
      (r) => String(r.name),
    );
    expect(indexes).toContain("sites_url_uniq_v2");
    expect(indexes).not.toContain("sites_url_idx");
  });
});
