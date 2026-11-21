/**
 * U-373 历史保留定时清理。
 *
 * R7 证伪先行：本文件先写目标态断言、再在旧代码上跑红——
 * 旧行为下：定时任务默认 payload（rollup + apply:false）只预演不删，
 * 且只覆盖显式设置了非默认保留期的用户；默认保留期（180 天）用户与
 * click 信号（events kind='click'）不在任何保留逻辑里；历史页也拿不到
 * 上次清理时间。修完后本文件应全绿。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { JobRunner, previewDataRetention } from "../src/jobs.ts";
import { buildServer } from "../src/server.ts";

const DAY = 86_400_000;
const ADMIN_TOKEN = "u373-admin-token";
const ME_HEADERS = (identity: string) => ({ "x-navhub-user-id": identity });

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

async function seedHistory(identity: string, ageDays: number, query: string) {
  const at = Date.now() - ageDays * DAY;
  await ctx.db.sqlite!
    .prepare("INSERT INTO search_history (user_id, query, result_count, created_at) VALUES (?,?,1,?)")
    .run(identity, query, at);
}

async function seedClick(identity: string, ageDays: number) {
  const at = Date.now() - ageDays * DAY;
  await ctx.repo.recordEvent("click", { siteId: null, meta: { identity } });
  await ctx.db.sqlite!.prepare("UPDATE events SET created_at = ? WHERE rowid = last_insert_rowid()").run(at);
}

async function countHistory(identity: string): Promise<number> {
  return Number(
    ctx.db.sqlite!.prepare("SELECT COUNT(*) AS c FROM search_history WHERE user_id = ?").get(identity)?.c ?? 0,
  );
}

async function countClicks(identity: string): Promise<number> {
  return Number(
    ctx.db.sqlite!
      .prepare("SELECT COUNT(*) AS c FROM events WHERE kind = 'click' AND identity = ?")
      .get(identity)?.c ?? 0,
  );
}

async function lastCleanupAuditAt(identity: string): Promise<number | null> {
  const row = ctx.db.sqlite!
    .prepare(
      "SELECT MAX(created_at) AS t FROM audit_logs WHERE action = 'user.search_history_expired' AND target = ?",
    )
    .get(identity) as { t?: number | null } | undefined;
  const t = Number(row?.t ?? 0);
  return t > 0 ? t : null;
}

async function runScheduledRetention(extra: Record<string, unknown> = {}) {
  await ctx.repo.enqueueJob("data_retention", {
    mode: "rollup",
    apply: false,
    maxDays: 30,
    telemetryDays: 90,
    ...extra,
  });
  const result = await new JobRunner(ctx).tick();
  expect(result.processed).toBe(1);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-u373-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "u373.db"),
    adminToken: ADMIN_TOKEN,
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("U-373 R7：旧默认 payload 下过期数据一直留着", () => {
  it("默认 payload（rollup + apply:false，无 historyCleanup）不删任何历史", async () => {
    const identity = "u373-r7-default-payload";
    await seedHistory(identity, 200, "r7-old");
    await seedClick(identity, 200);
    await runScheduledRetention();
    expect(await countHistory(identity)).toBe(1);
    expect(await countClicks(identity)).toBe(1);
    expect(await lastCleanupAuditAt(identity)).toBeNull();
  });
});

describe("U-373：每日定时按各用户保留期清理", () => {
  it("默认保留期用户（无设置行，180 天）：200 天过期删、10 天未过期留，click 同删", async () => {
    const identity = "u373-default-user";
    await seedHistory(identity, 200, "u373-old");
    await seedHistory(identity, 10, "u373-fresh");
    await seedClick(identity, 200);
    await seedClick(identity, 10);
    const before = Date.now();

    await runScheduledRetention({ historyCleanup: true });

    expect(await countHistory(identity)).toBe(1);
    const remaining = await ctx.db.sqlite!
      .prepare("SELECT query FROM search_history WHERE user_id = ?")
      .all(identity);
    expect(remaining.map((r) => r.query)).toEqual(["u373-fresh"]);
    expect(await countClicks(identity)).toBe(1);
    const cleanedAt = await lastCleanupAuditAt(identity);
    expect(cleanedAt).not.toBeNull();
    expect(cleanedAt!).toBeGreaterThanOrEqual(before);
    expect(cleanedAt!).toBeLessThanOrEqual(Date.now());
  });

  it("显式 30 天用户：40 天过期删、10 天未过期留，click 同删", async () => {
    const identity = "u373-30d-user";
    await ctx.repo.updateUserSettings(identity, { historyRetentionDays: 30 });
    await seedHistory(identity, 40, "u373-30-old");
    await seedHistory(identity, 10, "u373-30-fresh");
    await seedClick(identity, 40);
    await seedClick(identity, 10);

    await runScheduledRetention({ historyCleanup: true });

    expect(await countHistory(identity)).toBe(1);
    expect(await countClicks(identity)).toBe(1);
    expect(await lastCleanupAuditAt(identity)).not.toBeNull();
  });

  it("预演不删：previewDataRetention 只报命中量，不删行、不留清理审计", async () => {
    const identity = "u373-preview-user";
    await ctx.repo.updateUserSettings(identity, { historyRetentionDays: 30 });
    await seedHistory(identity, 40, "u373-preview-old");
    await seedClick(identity, 40);

    const preview = await previewDataRetention(ctx, {
      mode: "rollup",
      apply: true,
      telemetryDays: 90,
      historyCleanup: true,
    } as never);
    expect(preview.apply).toBe(false);
    expect(preview.userRetention).toMatchObject({ usersAffected: 1, rowsDeleted: 1, clicksDeleted: 1 });
    expect(await countHistory(identity)).toBe(1);
    expect(await countClicks(identity)).toBe(1);
    expect(await lastCleanupAuditAt(identity)).toBeNull();
  });

  it("分批上限 historyMaxUsers：超限用户留待下一轮，summary 标 truncated", async () => {
    // 身份取 u372- 前缀：在按 identity 排序的策略表里排在前面用例的 u373-* 之前，
    // 本轮只取前 2 个，c 留待下一轮——断言不依赖前面用例的残留状态。
    const users = ["u372-batch-a", "u372-batch-b", "u372-batch-c"];
    for (const u of users) {
      await ctx.repo.updateUserSettings(u, { historyRetentionDays: 30 });
      await seedHistory(u, 40, `u373-batch-${u}`);
    }
    await runScheduledRetention({ historyCleanup: true, historyMaxUsers: 2 });

    // 按 identity 排序取前 2 个，c 留待下一轮
    expect(await countHistory("u372-batch-a")).toBe(0);
    expect(await countHistory("u372-batch-b")).toBe(0);
    expect(await countHistory("u372-batch-c")).toBe(1);
    const trail = await ctx.db.sqlite!
      .prepare("SELECT meta FROM events WHERE kind = 'data_retention' ORDER BY id DESC LIMIT 1")
      .get() as { meta?: string } | undefined;
    const summary = JSON.parse(String(trail?.meta ?? "{}")) as {
      userRetention?: { usersProcessed?: number; truncated?: boolean };
    };
    expect(summary.userRetention?.usersProcessed).toBe(2);
    expect(summary.userRetention?.truncated).toBe(true);
  });
});

describe("U-373：历史页脚的上次清理时间", () => {
  it("清理过的用户：GET /api/search-history 返回真实的 lastHistoryCleanupAt", async () => {
    const identity = "u373-footer-user";
    await ctx.repo.updateUserSettings(identity, { historyRetentionDays: 30 });
    await seedHistory(identity, 40, "u373-footer-old");
    await seedHistory(identity, 5, "u373-footer-fresh");
    const before = Date.now();
    await runScheduledRetention({ historyCleanup: true });

    const res = await app.inject({
      method: "GET",
      url: "/api/search-history?limit=10",
      headers: ME_HEADERS(identity),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: unknown[]; lastHistoryCleanupAt: number | null };
    expect(body.items.length).toBe(1);
    expect(typeof body.lastHistoryCleanupAt).toBe("number");
    expect(body.lastHistoryCleanupAt!).toBeGreaterThanOrEqual(before);
    expect(body.lastHistoryCleanupAt!).toBeLessThanOrEqual(Date.now());
  });

  it("从未清理过的用户：lastHistoryCleanupAt 为 null，不编造时间", async () => {
    const identity = "u373-never-cleaned";
    await seedHistory(identity, 5, "u373-never-old");
    const res = await app.inject({
      method: "GET",
      url: "/api/search-history?limit=10",
      headers: ME_HEADERS(identity),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { lastHistoryCleanupAt: unknown };
    expect(body.lastHistoryCleanupAt).toBeNull();
  });

  it("手动自检仍能工作：POST /api/me/diagnostics 删过期历史与 click，并留下清理时间", async () => {
    const identity = "u373-diag-user";
    await ctx.repo.updateUserSettings(identity, { historyRetentionDays: 30 });
    await seedHistory(identity, 40, "u373-diag-old");
    await seedHistory(identity, 5, "u373-diag-fresh");
    await seedClick(identity, 40);
    await seedClick(identity, 5);

    const res = await app.inject({
      method: "POST",
      url: "/api/me/diagnostics",
      headers: ME_HEADERS(identity),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; checks: Array<{ id: string; status: string }> };
    expect(body.ok).toBe(true);
    expect(body.checks.find((c) => c.id === "history_retention")?.status).toBe("repaired");
    expect(await countHistory(identity)).toBe(1);
    expect(await countClicks(identity)).toBe(1);
    expect(await lastCleanupAuditAt(identity)).not.toBeNull();
  });
});
