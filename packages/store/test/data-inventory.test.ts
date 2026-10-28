import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { USER_DATA_DOMAINS, isRegisteredUserTable } from "../src/data-inventory.ts";

/**
 * 数据清单守卫（P1「数据主权」）。
 *
 * 注销/导出曾经是两份手写 SQL 清单，新增用户表时容易漏。这组用例遍历**真实库**
 * 的 sqlite_master：任何带用户归属列、却既没登记也没豁免的表，测试直接红。
 * 它不替代行为测试，但能保证「新增用户表」不会静默逃出数据主权范围。
 */
const OWNER_COLUMNS = ["user_id", "identity", "owner_identity", "alias", "canonical", "source", "target"];

/** FTS5 / vec0 的影子表与内部表不是业务实体，不参与归属检查 */
function isInternalTable(name: string): boolean {
  if (name.startsWith("sqlite_")) return true;
  if (name.endsWith("_data") || name.endsWith("_idx") || name.endsWith("_content") || name.endsWith("_docsize") || name.endsWith("_config")) return true;
  if (name.endsWith("_vec") || name.endsWith("_fts")) return true;
  return false;
}

describe("用户数据清单覆盖真实库", () => {
  let db: Db;
  let repo: Repository;
  let tables: string[];

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
    const rows = await repo.raw("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
    tables = rows.map((r) => String(r.name));
  });

  afterAll(async () => {
    await db.close();
  });

  it("每张带用户归属列的表都已登记或显式豁免", async () => {
    // 防空跑：迁移失败时 sqlite_master 只有系统表，下面的循环会「零命中通过」
    expect(tables.length).toBeGreaterThan(20);
    const unregistered: string[] = [];
    let ownedTables = 0;
    for (const table of tables) {
      if (isInternalTable(table) || !/^[a-z0-9_]+$/i.test(table)) continue;
      const cols = (await repo.raw("PRAGMA table_info(" + table + ")")).map((c) => String(c.name));
      const hasOwner = cols.some((c) => OWNER_COLUMNS.includes(c));
      if (!hasOwner) continue;
      ownedTables++;
      if (!isRegisteredUserTable(table)) unregistered.push(table + "(" + cols.filter((c) => OWNER_COLUMNS.includes(c)).join(",") + ")");
    }
    // 真实库至少有 15 张带归属列的表；数量骤降说明探测逻辑坏了
    expect(ownedTables).toBeGreaterThanOrEqual(15);
    expect(
      unregistered,
      "以下表带用户归属列但未登记到 data-inventory.ts（注销会漏删）：\n" + unregistered.join("\n"),
    ).toEqual([]);
  });

  it("清单里每张表/每个归属列都真实存在（防止拼写错误）", async () => {
    for (const domain of USER_DATA_DOMAINS) {
      expect(tables, "清单登记了不存在的表：" + domain.table).toContain(domain.table);
      const cols = (await repo.raw("PRAGMA table_info(" + domain.table + ")")).map((c) => String(c.name));
      for (const col of domain.ownerColumns) {
        expect(cols, domain.table + " 缺少归属列 " + col).toContain(col);
      }
    }
  });

  it("通用删除路径只包含单列归属的 delete 域", () => {
    // 双列归属（identity_aliases / identity_merges）必须走 custom，
    // 否则通用循环只会删其中一列，留下另一半。
    for (const domain of USER_DATA_DOMAINS) {
      if (domain.disposition === "delete") expect(domain.ownerColumns).toHaveLength(1);
      if (domain.ownerColumns.length > 1) expect(domain.disposition).toBe("custom");
    }
  });
});
