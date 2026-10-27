/**
 * 任务告警去重：单副本靠进程内 Map，多副本靠 system_states 原子占坑。
 *
 * 真实风险：Runner 的单实例锁会在锁过期/重启/滚动发布时换副本，
 * 进程内去重随副本切换归零 —— 同一个持续故障会按副本数重复投递 webhook。
 * 这里同时锁：
 *   1. 窗口内同键只投一次、不同键照常投；
 *   2. **投递失败要释放占位**，否则「占坑没发货」会把后续告警一起吞掉；
 *   3. 两次独立的 deduper 实例（模拟两个副本）共享同一个库时只有第一个能投；
 *   4. claimSystemState 并发下只有一个成功，窗口过期后可再次占坑。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryAlertDeduper, sendWebhookAlert } from "../src/alerts.ts";
import { createStoreAlertDeduper } from "../src/alert-dedupe.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

let dir: string;
let ctx: AppContext;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-alert-dedupe-"));
  ctx = await createContext(
    loadConfig({ sqlitePath: join(dir, "alerts.db"), embedding: { enabled: false } } as never),
  );
});

afterAll(async () => {
  await ctx?.close();
  rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubWebhook(status = 200) {
  const calls: Array<{ url: string; body: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? "") });
      return new Response("ok", { status });
    }),
  );
  return calls;
}

const HOOK = "https://alert.example/hook";

describe("告警去重", () => {
  it("进程内 deduper：窗口内同键只投一次，不同键照常投", async () => {
    const calls = stubWebhook();
    const deduper = new MemoryAlertDeduper(60_000);
    const detail = { kind: "health_audit", attempts: 3, error: "boom" };

    expect(await sendWebhookAlert(HOOK, "任务失败", detail, 1000, deduper)).toBe(true);
    expect(await sendWebhookAlert(HOOK, "任务失败", detail, 1000, deduper)).toBe(true);
    expect(calls, "同键第二次不应再打 webhook").toHaveLength(1);

    expect(await sendWebhookAlert(HOOK, "另一个故障", detail, 1000, deduper)).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("投递失败释放占位：下一轮还能再试，而不是被永久吞掉", async () => {
    const calls = stubWebhook(500);
    const deduper = new MemoryAlertDeduper(60_000);
    const detail = { kind: "k", attempts: 1, error: "e" };

    expect(await sendWebhookAlert(HOOK, "失败告警", detail, 200, deduper)).toBe(false);
    expect(calls, "一次调用 = 3 次重试").toHaveLength(3);

    expect(await sendWebhookAlert(HOOK, "失败告警", detail, 200, deduper)).toBe(false);
    expect(calls, "占位已释放，应重新尝试").toHaveLength(6);
  });

  it("跨实例：两个 deduper 共享同一个库，同键只有第一个能投", async () => {
    const calls = stubWebhook();
    const instanceA = createStoreAlertDeduper(ctx.repo, 60_000);
    const instanceB = createStoreAlertDeduper(ctx.repo, 60_000);
    const detail = { kind: "ingest", attempts: 3, error: "ECONNRESET" };

    expect(await sendWebhookAlert(HOOK, "抓取任务连续失败", detail, 1000, instanceA)).toBe(true);
    expect(await sendWebhookAlert(HOOK, "抓取任务连续失败", detail, 1000, instanceB)).toBe(true);
    expect(calls, "第二个副本不应重复投递").toHaveLength(1);
  });

  it("claimSystemState：并发占坑只有一个成功", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => ctx.repo.claimSystemState("test:claim:concurrent", 1, 60_000)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("claimSystemState：窗口内拒绝，过期后放行", async () => {
    const t0 = Date.now();
    expect(await ctx.repo.claimSystemState("test:claim:window", 1, 1000, t0)).toBe(true);
    expect(await ctx.repo.claimSystemState("test:claim:window", 1, 1000, t0 + 500)).toBe(false);
    expect(await ctx.repo.claimSystemState("test:claim:window", 1, 1000, t0 + 1001)).toBe(true);
  });
});
