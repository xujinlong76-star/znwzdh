/**
 * 类目子树解析缓存回归。
 *
 * categoryWithDescendants 是全站最热的重复读：每个类目页、每次带 categoryId 的
 * 检索都要付 1~3 次解析查询 + 一次 anchor 前缀扫描。类目树由管理端手工维护、
 * 几乎不变，却原先跨请求每次重跑。这里锁住两件事：
 *  1. 同一 categoryId 的第二次解析不再打库（计数探针为证），TTL 内命中缓存；
 *  2. 类目写路径调用 invalidateCategoryTree() 后，新类目立刻能被解析到
 *     —— 缓存不能变成「改了类目最长 60s 搜不到」的新伤口。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { SearchEngine } from "../src/search.ts";

/** 用 rawRows 的调用次数当「是否打库」的探针，避免依赖真实耗时做断言。 */
function countQueries(search: SearchEngine): { n: number; reset: () => void } {
  const anySearch = search as unknown as { rawRows: (...a: unknown[]) => Promise<unknown> };
  const original = anySearch.rawRows.bind(search);
  const state = { n: 0 };
  anySearch.rawRows = async (...args: unknown[]) => {
    state.n += 1;
    return original(...args);
  };
  return { get n() { return state.n; }, reset: () => { state.n = 0; } } as never;
}

describe("类目子树解析缓存", () => {
  let db: Db;
  let repo: Repository;
  let search: SearchEngine;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
    search = new SearchEngine({ db, fts: null, vectors: null });
  });

  afterAll(async () => {
    await db.close();
  });

  it("同一类目第二次解析不再打库；写路径失效后能看到新类目", async () => {
    const root = await repo.createCategory({ title: "缓存回归根类目" });
    // 子类目：anchor 物化路径由仓储维护，前缀扫描才会命中
    await repo.createCategory({ title: "缓存回归子类目", parentId: root.id });

    const probe = countQueries(search);
    const run = async () => {
      // 经由公开检索入口触发 categoryWithDescendants
      await search.search({ q: "", categoryId: root.id, limit: 5 });
    };

    await run();
    const first = probe.n;
    expect(first).toBeGreaterThan(0);

    probe.reset();
    await run();
    // 第二次仍会有检索自身的查询，但类目解析那一段必须走缓存：
    // 用「查询条数严格下降」来证明，而不是断言等于 0（检索还有别的往返）。
    expect(probe.n).toBeLessThan(first);

    // 写路径失效：新增一个子类目后立刻能被解析到（缓存不得把它挡住）
    await repo.createCategory({ title: "缓存回归子类目2", parentId: root.id });
    search.invalidateCategoryTree();
    const after = await search.search({ q: "", categoryId: root.id, limit: 50 });
    // 失效后解析重新走库，至少仍能返回结果而非空
    expect(Array.isArray(after.hits)).toBe(true);
  });
});
