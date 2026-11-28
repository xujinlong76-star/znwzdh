/**
 * MCP 审计/配额双写对账任务测试（ADR-0010 Accepted）。
 * 真 SQLite lite 上下文造数，验证：
 *  - 正常窗口 quota == audit → 无告警
 *  - quota 多 / audit 少 → mismatch=true + 去重占位 + 无 webhook 落 audit 留痕
 *  - 连续 2 日超阈值 → escalated=true
 *  - 过期 mcp:quota key 被清理（保留 8 天）
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, loadConfig, type AppContext } from "@navhub/api";
import { runMcpAuditReconciliation } from "../src/jobs/tasks/mcp-audit-reconciliation.task.ts";

let dir: string;
let ctx: AppContext;

// 固定测试窗口（UTC 整天边界），造数用
const WINDOW = 86_400_000;
const T2 = Math.floor(Date.now() / WINDOW) * WINDOW;
const T1 = T2 - WINDOW;

function quotaKey(actorHash: string, windowStart: number): string {
  return `mcp:quota:${actorHash}:${windowStart}`;
}

/** 往 quota 侧写一个窗口计数（模拟 egress-gates 的 bumpQuota 形态） */
async function seedQuota(count: number, actorHash = "a".repeat(64), windowStart = T1) {
  await ctx.repo.run(
    "INSERT INTO system_states (key, value, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    [quotaKey(actorHash, windowStart), String(count), Date.now()],
  );
}

/** 往 audit 侧写 N 条 mcp.tool.call（模拟 egress-gates 的 repo.audit）。target 唯一，便于 UPDATE 精确挪窗口。 */
async function seedAudit(count: number, createdAt: number, tag: string) {
  for (let i = 0; i < count; i += 1) {
    await ctx.repo.audit({
      actor: "mcp:seed", actorKind: "mcp", action: "mcp.tool.call", target: tag,
      diff: { count: 1 },
    });
  }
  // audit() 用 Date.now() 写 created_at；按唯一 target 精确挪进指定窗口，不碰其他用例的行。
  await ctx.repo.run(
    "UPDATE audit_logs SET created_at = ? WHERE action = 'mcp.tool.call' AND target = ?",
    [createdAt, tag],
  );
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-mcp-recon-"));
  ctx = await createContext(loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "recon.db"),
    embedding: { model: "x", endpoint: "x", dtype: "q8", cacheDir: join(dir, "m"), dim: 512, enabled: false },
  }));
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("MCP 对账任务（ADR-0010）", () => {
  it("窗口内 quota == audit → mismatch=false，不告警", async () => {
    await seedQuota(4, "b".repeat(64), T2); // 用下一个窗口做隔离
    await seedAudit(4, T2 + 1000, "equal-window");
    // 注意 seedAudit 把同窗口所有 audit 挪进 T2 窗口（含上面 4 条），
    // 这里用独立窗口 T2~T2+WINDOW 测，避免与后续用例串扰
    const r = await runMcpAuditReconciliation(ctx, { windowStart: T2, windowEnd: T2 + WINDOW });
    expect(r.quotaTotal).toBe(4);
    expect(r.auditCount).toBe(4);
    expect(r.diff).toBe(0);
    expect(r.mismatch).toBe(false);
    expect(r.alerted).toBe(false);
    // eslint-disable-next-line no-console
    console.log("@@RECON@@ EQUAL quota=4 audit=4 mismatch=false");
  });

  it("quota 多 / audit 少 → mismatch=true，去重占位 + 无 webhook 落 audit 留痕", async () => {
    const w = T2 + WINDOW;
    await seedQuota(20, "c".repeat(64), w);
    await seedAudit(2, w + 1000, "mismatch-window");
    const r = await runMcpAuditReconciliation(ctx, { windowStart: w, windowEnd: w + WINDOW });
    expect(r.quotaTotal).toBe(20);
    expect(r.auditCount).toBe(2);
    expect(r.diff).toBe(18);
    expect(r.threshold).toBe(5); // max(5, ceil(20*1%)=1)
    expect(r.mismatch).toBe(true);
    expect(r.alerted).toBe(true); // 无 webhook → audit 留痕也记 alerted
    // 去重占位存在
    const day = new Date(w).toISOString().slice(0, 10);
    const claimed = await ctx.repo.getSystemState("mcp:recon:" + day);
    expect(claimed).toBe(1);
    // 留痕 audit 存在
    const rows = await ctx.repo.raw(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE action='mcp.recon.mismatch' AND target = ?",
      ["mcp:recon:threshold:" + day],
    );
    expect(Number(rows[0]?.n ?? 0)).toBeGreaterThanOrEqual(1);
    // eslint-disable-next-line no-console
    console.log("@@RECON@@ MISMATCH quota=20 audit=2 diff=18 alerted=true");
  });

  it("连续 2 日超阈值 → escalated=true", async () => {
    // 先给前一日写超限标记，再造今日差异
    const dayBefore = new Date(T2).toISOString().slice(0, 10);
    await ctx.repo.setSystemState("mcp:recon:threshold:" + dayBefore, 1);
    const w = T2 + 2 * WINDOW;
    await seedQuota(20, "d".repeat(64), w);
    await seedAudit(2, w + 1000, "escalate-window");
    const r = await runMcpAuditReconciliation(ctx, { windowStart: w, windowEnd: w + WINDOW });
    // 连续标记查询取最近 2 条（按 updated_at DESC），今日 + 前一日都为 1
    expect(r.mismatch).toBe(true);
    expect(r.escalated).toBe(true);
    // eslint-disable-next-line no-console
    console.log("@@RECON@@ ESCALATED streak>=2 escalated=true");
  });

  it("过期 quota key（updated_at < now-8d）被清理", async () => {
    const oldKey = quotaKey("e".repeat(64), T1);
    await ctx.repo.run(
      "INSERT INTO system_states (key, value, updated_at) VALUES (?, ?, ?)",
      [oldKey, "99", Date.now() - 9 * WINDOW],
    );
    const r = await runMcpAuditReconciliation(ctx, { windowStart: T2 + 3 * WINDOW, windowEnd: T2 + 4 * WINDOW });
    expect(r.cleanedKeys).toBeGreaterThanOrEqual(1);
    const left = await ctx.repo.raw("SELECT key FROM system_states WHERE key = ?", [oldKey]);
    expect(left.length).toBe(0);
    // eslint-disable-next-line no-console
    console.log("@@RECON@@ CLEANUP deleted=" + r.cleanedKeys);
  });
});
