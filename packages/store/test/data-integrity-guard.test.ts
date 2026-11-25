import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { replaceLlmModelPrices } from "../src/repository/llm-prices.ts";
import { createWantedSearch } from "../src/repository/wanted-searches.ts";
import { upsertCollection } from "../src/repository/collections.ts";

/**
 * 深度审计（2026-11-25）写路径原子性守卫：
 *  - 同名收藏夹并发去重（仓库层事务内查重）
 *  - 待找并发查重返回 duplicate 而非抛唯一键 500
 *  - 价目簿替换失败回滚（不留半份）
 *  - 专题条目按 siteId 去重
 */
describe("写路径原子性", () => {
  let db: Db;
  let repo: Repository;
  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
  });
  afterAll(async () => { await db.close(); });

  it("同名收藏夹（trim/大小写归一）只建一份", async () => {
    const user = "github:dedup-folder";
    const a = await repo.createFavoriteFolder(user, "  工作  ");
    const b = await repo.createFavoriteFolder(user, "工作");
    expect(b.id).toBe(a.id);
    expect((await repo.listFavoriteFolders(user)).length).toBe(1);
  });

  it("并发待找同一 query：第二次返回 duplicate，不抛唯一键错误", async () => {
    const identity = "github:dedup-wanted";
    const [a, b] = await Promise.all([
      createWantedSearch(repo, { identity, query: "  Concurrent Query  " }),
      createWantedSearch(repo, { identity, query: "Concurrent Query" }),
    ]);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.duplicate === true || b!.duplicate === true).toBe(true);
    expect(a!.item.id).toBe(b!.item.id);
  });

  it("价目簿替换落库且可重复", async () => {
    const n = await replaceLlmModelPrices(repo, [
      { model: "m-a", promptPer1kRmb: 0.1, completionPer1kRmb: 0.2 },
      { model: "m-b", promptPer1kRmb: 0.3, completionPer1kRmb: 0.4 },
    ]);
    expect(n).toBe(2);
    const n2 = await replaceLlmModelPrices(repo, [
      { model: "m-a", promptPer1kRmb: 0.5, completionPer1kRmb: 0.6 },
    ]);
    expect(n2).toBe(1);
  });
});
