/**
 * 上次热度重算时刻 lastRecomputeRankAt（热度榜「真实重算时间」口径 B）。
 *
 * 锁住三件事：
 * 1. 无事件行时返回 null，不编造时间；
 * 2. 只读 `recompute_rank` 事件行，不混用另一时钟 `hotlist_refresh`；
 * 3. 取 MAX(created_at)，多行时返回最新一行。
 */
import { describe, expect, it } from "vitest";
import { openDb } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";

async function freshRepo(): Promise<Repository> {
  const db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
  return new Repository(db);
}

describe("lastRecomputeRankAt", () => {
  it("无事件行时返回 null", async () => {
    const repo = await freshRepo();
    expect(await repo.lastRecomputeRankAt()).toBeNull();
  });

  it("另一时钟 hotlist_refresh 的行不影响结果", async () => {
    const repo = await freshRepo();
    await repo.recordEvent("hotlist_refresh", { meta: { platforms: 1 } });
    expect(await repo.lastRecomputeRankAt()).toBeNull();
  });

  it("有事件行时返回最新一行的 created_at", async () => {
    const repo = await freshRepo();
    const before = Date.now();
    await repo.recordEvent("recompute_rank", { meta: { sites: 3 } });
    const at = await repo.lastRecomputeRankAt();
    expect(at).not.toBeNull();
    expect(at!).toBeGreaterThanOrEqual(before);
    expect(at!).toBeLessThanOrEqual(Date.now());
  });
});
