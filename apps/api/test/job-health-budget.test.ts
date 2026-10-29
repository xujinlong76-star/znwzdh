/**
 * health_check 协作式预算：预算到点主动停手、剩余顺延，任务落 done 而不是 failed。
 *
 * 背景（真库只读 2026-10-29T08:0xZ）：jobs 里 4 条 failed 中有 2 条 health_check，
 * 分别是「超出单次执行预算（240000ms）」(2026-10-28) 与「执行超时或 Worker 异常中断」
 * (2026-10-18)；默认排期 payload 是 {limit:100}，而巡检串行抓取、单站最长 10s
 * ⇒ 结构上必然超预算。旧行为：超时 → failed + handler 仍在后台跑（幽灵执行）。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const hoisted = vi.hoisted(() => ({ delayMs: 0, calls: 0 }));

vi.mock("@navhub/ai", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return {
    ...mod,
    guardedFetch: async () => {
      hoisted.calls++;
      if (hoisted.delayMs > 0) await new Promise((r) => setTimeout(r, hoisted.delayMs));
      return {
        status: 200,
        body: "<html><head><title>正常页面</title></head><body>ok</body></html>",
        url: "mocked://health",
        redirects: [],
        headers: {},
        truncated: false,
      };
    },
  };
});

const { createContext } = await import("../src/context.ts");
const { loadConfig } = await import("../src/config.ts");
const { JobRunner, healthCheckDeadline, HEALTH_CHECK_SAFETY_MARGIN_MS } = await import("../src/jobs.ts");

let dir: string;
let ctx: Awaited<ReturnType<typeof createContext>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-health-budget-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "health.db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  // 预算钟从认领后开始，handler 内的 dynamic import("@navhub/ai") 也计入；
  // 先预热模块，避免首例把「冷加载」误算成巡检耗时导致偶发红。
  await import("@navhub/ai");
  await ctx.repo.createCategory({ id: "hb", title: "预算类目" });
  for (let i = 0; i < 12; i++) {
    await ctx.repo.createSite({ url: `https://health-budget.example/site-${i}`, title: `站点${i}`, categoryId: "hb" });
  }
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
  // isolate:false 卫生：本文件跨模块 mock 了 @navhub/ai，必须清掉模块缓存，
  // 否则同 worker 的后续测试文件会拿到假 guardedFetch。
  vi.resetModules();
});

function lastHealthEventMeta(): { planned: number; checked: number; ok: number; deferred: number } {
  const row = ctx.db.sqlite!
    .prepare("SELECT meta FROM events WHERE kind = 'health_check' ORDER BY id DESC LIMIT 1")
    .get() as { meta: string } | undefined;
  if (!row) throw new Error("没有 health_check 事件");
  return JSON.parse(row.meta);
}

describe("healthCheckDeadline", () => {
  it("默认余量 10s；生产余量按 fetch 超时兑现（10s+2s）；预算 0 不设截止；小预算按 1/4 缩小", () => {
    expect(HEALTH_CHECK_SAFETY_MARGIN_MS).toBe(10_000);
    expect(healthCheckDeadline(1_000, 240_000)).toBe(1_000 + 240_000 - 10_000);
    // 生产调用点传 fetch.timeoutMs + 2s：默认配置 10s ⇒ 12s 余量，覆盖最后一次抓取
    expect(healthCheckDeadline(1_000, 240_000, 12_000)).toBe(1_000 + 240_000 - 12_000);
    // 余量不得超过预算的 1/4，否则小预算下会算到起点之前
    expect(healthCheckDeadline(1_000, 40_000, 12_000)).toBe(1_000 + 40_000 - 10_000);
    expect(healthCheckDeadline(1_000, 0, 12_000)).toBe(0);
    expect(healthCheckDeadline(1_000, 20)).toBe(1_000 + 20 - 5);
  });
});

describe("health_check 协作式预算", () => {
  it("预算到点：只巡一部分、剩余顺延，任务落 done 且不再抓取剩余站点", async () => {
    hoisted.delayMs = 40;
    hoisted.calls = 0;
    const runner = new JobRunner(ctx, { budgetOverrides: { health_check: 400 } });

    await ctx.repo.enqueueJob("health_check", { limit: 12 });
    const result = await runner.tick();
    expect(result.processed).toBe(1);

    const meta = lastHealthEventMeta();
    expect(meta.planned).toBe(12);
    expect(meta.checked).toBeGreaterThan(0);
    // 预算 400ms - 100ms 余量，40ms/站 → 12 站（480ms）巡不完，必有顺延
    expect(meta.checked).toBeLessThan(12);
    expect(meta.deferred).toBe(12 - meta.checked);
    expect(hoisted.calls).toBe(meta.checked); // 顺延的站点一次都没抓

    const done = await ctx.repo.listJobs("done", 10);
    expect(done.some((j) => j.kind === "health_check")).toBe(true); // 不是 failed
    const failed = await ctx.repo.listJobs("failed", 10);
    expect(failed.some((j) => j.kind === "health_check")).toBe(false);
    hoisted.delayMs = 0;
  });

  it("不设预算（override 0）：整批巡完，deferred=0", async () => {
    hoisted.delayMs = 0;
    hoisted.calls = 0;
    const runner = new JobRunner(ctx, { budgetOverrides: { health_check: 0 } });

    await ctx.repo.enqueueJob("health_check", { limit: 12 });
    expect((await runner.tick()).processed).toBe(1);

    const meta = lastHealthEventMeta();
    expect(meta).toMatchObject({ planned: 12, checked: 12, deferred: 0 });
    expect(hoisted.calls).toBe(12);
  });
});
