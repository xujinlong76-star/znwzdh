/**
 * llm_usage 的 PostgreSQL 方言兼容回归。
 *
 * 背景缺陷（只会在 PG 部署上暴露，SQLite 测试永远绿）：
 *  1. 写入时把 ok/thinking 传成 1/0 —— PG 的列是 BOOLEAN，插入整数直接报
 *     `column "ok" is of type boolean but expression is of type integer`；
 *     而 recordLlmUsage 的 catch 是「观测不反噬业务」的静默兜底，于是面板永远没数据。
 *  2. 聚合里写 `CASE WHEN ok = 0` —— PG 抛 `operator does not exist: boolean = integer`。
 *
 * 这里用假 PG runner 捕获 SQL/参数，不需要真实数据库即可锁住这两条。
 */
import { describe, expect, it } from "vitest";
import { Repository } from "../src/repository.ts";
import type { Db } from "../src/driver.ts";

function fakePgRepo() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    dialect: "pg",
    orm: null,
    close: async () => undefined,
    pg: {
      query: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        return { rows: [], rowCount: 0 };
      },
    },
  } as unknown as Db;
  return { repo: new Repository(db), calls };
}

describe("llm_usage：PostgreSQL 布尔列", () => {
  it("写入时以原生布尔传参（由驱动保留给 BOOLEAN 列）", async () => {
    const { repo, calls } = fakePgRepo();
    await repo.recordLlmUsage({
      scenario: "enrich",
      source: "system",
      model: "m",
      ok: true,
      thinking: true,
    });

    const insert = calls.find((c) => c.sql.startsWith("INSERT INTO llm_usage"));
    expect(insert).toBeTruthy();
    // 参数顺序：id, scenario, source, model, identity, pt, ct, latency, ok, error_code, thinking, created_at
    expect(insert!.params[8]).toBe(true);
    expect(insert!.params[10]).toBe(true);
  });

  it("失败调用同样传布尔 false", async () => {
    const { repo, calls } = fakePgRepo();
    await repo.recordLlmUsage({
      scenario: "ai_chat",
      source: "user",
      model: "m",
      ok: false,
      thinking: false,
      errorCode: "auth",
    });

    const insert = calls.find((c) => c.sql.startsWith("INSERT INTO llm_usage"));
    expect(insert!.params[8]).toBe(false);
    expect(insert!.params[10]).toBe(false);
  });

  it("聚合 SQL 不与整数比较布尔列，并带 MIN(created_at)", async () => {
    const { repo, calls } = fakePgRepo();
    await repo.aggregateLlmUsage({ since: 0 });

    const grouped = calls.find((c) => c.sql.includes("GROUP BY scenario, source"));
    expect(grouped).toBeTruthy();
    expect(grouped!.sql).toContain("CASE WHEN ok THEN 0 ELSE 1 END");
    expect(grouped!.sql).toContain("CASE WHEN thinking THEN 1 ELSE 0 END");
    expect(grouped!.sql).not.toMatch(/ok\s*=\s*0/);
    expect(grouped!.sql).not.toMatch(/thinking\s*=\s*1/);
    expect(grouped!.sql).toContain("MIN(created_at)");
  });
});
