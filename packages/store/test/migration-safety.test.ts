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

  it("目标较旧时用较新源覆盖，确认完整复制后才删源", async () => {
    await repo.run(
      "INSERT INTO user_workspace_blobs (user_id, payload, updated_at) VALUES (?,?,?)",
      ["workspaces:newer-source", "old-target", 100],
    );
    await repo.run(
      "INSERT INTO user_vault_sync (user_id, payload, version, updated_at) VALUES (?,?,?,?)",
      ["workspaces:newer-source", "new-source", 1, 200],
    );

    const result = await migrateWorkspaceBlobs(db);
    expect(result).toEqual({ copied: 1, skipped: false });
    const target = await repo.raw(
      "SELECT payload, updated_at FROM user_workspace_blobs WHERE user_id = ?",
      ["workspaces:newer-source"],
    );
    expect(target[0]).toMatchObject({ payload: "new-source", updated_at: 200 });
    expect(await repo.raw("SELECT user_id FROM user_vault_sync WHERE user_id = ?", ["workspaces:newer-source"])).toHaveLength(0);
  });

  it("目标与源内容冲突且目标较新时保留源行，重复执行仍不丢数据", async () => {
    await repo.run(
      "INSERT INTO user_workspace_blobs (user_id, payload, updated_at) VALUES (?,?,?)",
      ["workspaces:conflict", "newer-target", 300],
    );
    await repo.run(
      "INSERT INTO user_vault_sync (user_id, payload, version, updated_at) VALUES (?,?,?,?)",
      ["workspaces:conflict", "older-source", 1, 200],
    );

    expect(await migrateWorkspaceBlobs(db)).toEqual({ copied: 0, skipped: true });
    expect(await migrateWorkspaceBlobs(db)).toEqual({ copied: 0, skipped: true });

    const source = await repo.raw("SELECT payload FROM user_vault_sync WHERE user_id = ?", ["workspaces:conflict"]);
    const target = await repo.raw("SELECT payload FROM user_workspace_blobs WHERE user_id = ?", ["workspaces:conflict"]);
    expect(source[0]?.payload).toBe("older-source");
    expect(target[0]?.payload).toBe("newer-target");
    const failures = await repo.raw("SELECT step FROM migration_failures WHERE step = ?", ["workspace_blobs_v1_conflict"]);
    expect(failures).toHaveLength(1);

    await repo.run("DELETE FROM user_vault_sync WHERE user_id = ?", ["workspaces:conflict"]);
    await repo.run("DELETE FROM user_workspace_blobs WHERE user_id = ?", ["workspaces:conflict"]);
  });

  it("目标较新但内容相同时可安全清理源行", async () => {
    await repo.run(
      "INSERT INTO user_workspace_blobs (user_id, payload, updated_at) VALUES (?,?,?)",
      ["workspaces:same-payload", "same", 300],
    );
    await repo.run(
      "INSERT INTO user_vault_sync (user_id, payload, version, updated_at) VALUES (?,?,?,?)",
      ["workspaces:same-payload", "same", 1, 200],
    );

    expect(await migrateWorkspaceBlobs(db)).toEqual({ copied: 1, skipped: false });
    const target = await repo.raw("SELECT payload, updated_at FROM user_workspace_blobs WHERE user_id = ?", ["workspaces:same-payload"]);
    expect(target[0]).toMatchObject({ payload: "same", updated_at: 300 });
    expect(await repo.raw("SELECT user_id FROM user_vault_sync WHERE user_id = ?", ["workspaces:same-payload"])).toHaveLength(0);
  });

  it("INSERT 失败时一行都不删（EXISTS 守卫）", async () => {
    await insertVault("workspaces:carol", "must-survive");
    // 制造失败：目标表不存在 → INSERT 抛错；旧实现此时 DELETE 仍会执行
    await repo.run("DROP TABLE user_workspace_blobs");

    await expect(migrateWorkspaceBlobs(db)).rejects.toThrow("user_workspace_blobs");

    const rows = await repo.raw("SELECT user_id FROM user_vault_sync WHERE user_id = ?", ["workspaces:carol"]);
    expect(rows).toHaveLength(1);

    // 失败必须可查询，而不是只留一行 console
    const failures = await repo.raw("SELECT step, error FROM migration_failures");
    // 只挑本用例关心的那条：migration_failures 是全库共享的留痕表，
    // 建触发器/索引等其它步骤的失败也会落在这里，取 failures[0] 会随执行顺序漂移。
    const blobFailure = failures.find((r) => r.step === "workspace_blobs_v1");
    expect(blobFailure).toBeDefined();
    expect(String(blobFailure?.error ?? "")).toContain("user_workspace_blobs");
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

  it("CREATE 失败时旧索引仍在：先建后删必须是受控步骤", async () => {
    // 造出「旧索引在位、新索引不存在」的现场
    await repo.run("DROP INDEX IF EXISTS sites_url_uniq_v2");
    await repo.run("CREATE UNIQUE INDEX IF NOT EXISTS sites_url_idx ON sites(url) WHERE deleted_at IS NULL");

    // 只让 v2 的 CREATE 失败，后续 DROP/索引语句不得继续执行。
    const real = db.sqlite!;
    let dropAttempted = false;
    const sqlite = new Proxy(real, {
      get(target, prop) {
        if (prop === "exec") {
          return (sql: string) => {
            if (sql.includes("sites_url_uniq_v2")) throw new Error("injected create failure");
            if (sql.includes("DROP INDEX IF EXISTS sites_url_idx")) dropAttempted = true;
            return target.exec(sql);
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    await expect(migrateSiteIndexes({ dialect: db.dialect, sqlite } as never))
      .rejects.toThrow("injected create failure");

    const indexes = (await repo.raw("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'sites'")).map(
      (r) => String(r.name),
    );
    // 新索引建不上时，旧索引不能被删掉，否则 url 唯一性出现空窗
    expect(indexes).toContain("sites_url_idx");
    expect(indexes).not.toContain("sites_url_uniq_v2");
    expect(dropAttempted).toBe(false);
  });
});
