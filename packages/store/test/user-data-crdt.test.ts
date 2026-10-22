import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { deleteUserData, exportUserData } from "../src/repository/user-data.ts";

/**
 * CRDT 编辑日志的数据主权（方案 2026-10-23 · P0-1）。
 *
 * 编辑日志单独一行 `user_vault_sync.user_id = 'crdt:<identity>'`，而导出与注销
 * 都只按 `identity` 精确匹配——于是它既不在导出包里，也不在删除清单里：
 * 用户换设备后自建分类消失，注销后日志永久残留。
 */
describe("CRDT 编辑日志进出数据主权范围", () => {
  let db: Db;
  let repo: Repository;
  const ID = "github:crdt-owner";

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it("导出包包含 crdt 行，而不是只有默认金库", async () => {
    await repo.saveUserVault(ID, '{"vault":1}');
    await repo.saveUserVault(
      "crdt:" + ID,
      JSON.stringify({ version: 1, operations: [{ id: "op-1", type: "UPSERT_CUSTOM_CATEGORY" }], state: {} }),
    );

    const exported = await exportUserData(repo, ID);
    expect(exported.vault.exists).toBe(true);
    expect(exported.crdt.exists).toBe(true);
    expect(exported.crdt.payload).toContain("UPSERT_CUSTOM_CATEGORY");
  });

  it("注销时删除 crdt 行，且回执的 vault 计数包含它", async () => {
    const counts = await deleteUserData(repo, ID);
    // 默认金库 + CRDT 编辑日志 = 2
    expect(counts.vault).toBe(2);

    const rows = await repo.raw("SELECT user_id FROM user_vault_sync WHERE user_id = ? OR user_id = ?", [
      ID,
      "crdt:" + ID,
    ]);
    expect(rows).toHaveLength(0);
  });

  it("注销后的导出里 crdt 为不存在，而不是静默漏字段", async () => {
    const exported = await exportUserData(repo, ID);
    expect(exported.crdt).toEqual({ exists: false, payload: null, updatedAt: 0 });
  });
});
