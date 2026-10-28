/**
 * `data_retention` 任务建聚合表时的方言契约。
 *
 * 聚合表（events_daily / audit_daily）不在 schema 里，由 `runRollup` 首次
 * `apply:true` 时按方言建。`RollupOptions.dialect` 缺省是 "sqlite"，而存储层的
 * PG 标识是 "pg"（rollup 侧写 "postgres"）——曾经任务里根本没传这个参数，
 * PG 部署上任务会拿着 `INTEGER PRIMARY KEY AUTOINCREMENT` 建表并必然报错，
 * 结果明细永远聚不掉，而任务本身看起来"在跑"。
 *
 * 这里锁住调用点：任务必须显式按 ctx 的方言传参。SQLite 侧的真实聚合行为
 * 由 jobs.test.ts 的 data_retention 用例覆盖。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("../src/jobs.ts", import.meta.url), "utf8");

describe("data_retention 的 rollup 方言契约", () => {
  it("唯一的 runRollup 调用点显式传 dialect", () => {
    const call = src.slice(src.indexOf("await runRollup(adapter,"), src.indexOf("await runRollup(adapter,") + 700);
    expect(call).toContain("await runRollup(adapter,");
    // 前缀写成可选：任务类里可能直接持有 ctx（`ctx.db.dialect`），也可能通过
    // `this.ctx`（`this.ctx.db.dialect`）。这条断言要守的是「显式按 ctx 方言传参」，
    // 不该因为重构把 this.ctx 提成局部变量就红。
    expect(call).toMatch(/dialect:\s*(?:this\.)?ctx\.db\.dialect\s*===\s*"pg"\s*\?\s*"postgres"\s*:\s*"sqlite"/);
  });

  it("调用点只有一处（新增调用也必须带 dialect）", () => {
    const occurrences = src.split("runRollup(").length - 1;
    expect(occurrences).toBe(1);
  });
});
