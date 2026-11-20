/**
 * 健康判定回归：从「一次失败即 broken」改为「连续 N 次失败才 broken」。
 *
 * 真实缺陷：2026-10-18 实测 50 个站点里 15 个被标 broken，其中
 * kubernetes.io / figma.com / npmjs.com 均可正常访问 —— 单次探测撞上
 * 403/429/超时就把健康站点打进冷宫，前台还会显示「已失效」。
 *
 * 这里锁两半：
 *   1. 纯函数 shouldMarkBroken 的阈值语义；
 *   2. recentHealthChecks 的排序（新→旧）与 limit —— 顺序错了会把
 *      「上次成功、这次失败」误判成连续失败。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { HEALTH_FAIL_THRESHOLD, shouldMarkBroken } from "../src/jobs.ts";
import { BOT_BLOCKED_ERROR_PREFIX } from "@navhub/core";

let dir: string;
let ctx: AppContext;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-health-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("shouldMarkBroken", () => {
  it("第一次失败不标 broken（阈值 3）", () => {
    expect(shouldMarkBroken(false, 0, 3)).toBe(false);
    expect(shouldMarkBroken(false, 1, 3)).toBe(false);
  });

  it("连续第 3 次失败才标 broken", () => {
    expect(shouldMarkBroken(false, 2, 3)).toBe(true);
  });

  it("成功永远不标 broken，即使之前连续失败很多次", () => {
    expect(shouldMarkBroken(true, 99, 3)).toBe(false);
  });

  it("阈值 1 = 退回旧行为（一次失败即 broken）", () => {
    expect(shouldMarkBroken(false, 0, 1)).toBe(true);
  });
});

describe("recentHealthChecks", () => {
  it("按时间新→旧返回，并遵守 limit", async () => {
    const cat = await ctx.repo.createCategory({ id: "cat-health", title: "健康测试分类", sort: 1, source: "api" } as never);
    const site = await ctx.repo.createSite({ url: "https://example.com/health", title: "健康测试", categoryId: cat.id } as never);

    const record = async (ok: boolean) =>
      ctx.repo.updateSiteHealth(site.id, {
        httpStatus: ok ? 200 : 503,
        ok,
        latencyMs: 10,
        redirectTo: null,
        error: ok ? null : "boom",
        markBroken: false,
      });

    await record(false);
    await new Promise((r) => setTimeout(r, 5));
    await record(false);
    await new Promise((r) => setTimeout(r, 5));
    await record(true);

    const recent = await ctx.repo.recentHealthChecks(site.id, 3);
    expect(recent).toHaveLength(3);
    // 最新一条是成功，说明排序是 DESC —— 若升序，这里会是 false
    expect(recent[0].ok).toBe(true);
    expect(recent[1].ok).toBe(false);

    const limited = await ctx.repo.recentHealthChecks(site.id, 1);
    expect(limited).toHaveLength(1);
    expect(limited[0].ok).toBe(true);
  });
});

describe("默认阈值统一为 2（03 §3.3 已裁决）", () => {
  it("HEALTH_FAIL_THRESHOLD 默认 2（环境变量未覆盖时）", () => {
    // 本测试假定运行环境未设置 NAVHUB_HEALTH_FAIL_THRESHOLD（CI 默认即如此）；
    // 运维仍可用该变量临时覆盖（§11 风险 5 的回退：阈值 2→3）。
    expect(HEALTH_FAIL_THRESHOLD).toBe(2);
  });

  it("默认阈值下：第 1 次失败不标 broken，第 2 次标 broken", () => {
    expect(shouldMarkBroken(false, 0)).toBe(false);
    expect(shouldMarkBroken(false, 1)).toBe(true);
  });
});

describe("sites.consecutive_failures 持久化（W1 §13 第 2 条 verdict ①）", () => {
  it("失败 +1、成功清零、bot-blocked 打断链；与 lastCheckedAt 同一次写入可见", async () => {
    const cat = await ctx.repo.createCategory({ id: "cat-counter", title: "计数测试分类", sort: 1, source: "api" } as never);
    const site = await ctx.repo.createSite({ url: "https://example.com/counter", title: "计数测试", categoryId: cat.id } as never);
    expect(await ctx.repo.getConsecutiveFailures(site.id)).toBe(0);

    const record = async (ok: boolean, error: string | null, httpStatus = ok ? 200 : 500) =>
      ctx.repo.updateSiteHealth(site.id, {
        httpStatus,
        ok,
        latencyMs: 10,
        redirectTo: null,
        error,
        markBroken: false,
      });

    await record(false, "boom");
    expect(await ctx.repo.getConsecutiveFailures(site.id)).toBe(1);
    // 同一次写入里 lastCheckedAt 已有值（计数与 health 写回同一事务）
    expect((await ctx.repo.getSite(site.id))!.health!.lastCheckedAt).toBeGreaterThan(0);

    await record(false, "boom");
    expect(await ctx.repo.getConsecutiveFailures(site.id)).toBe(2);

    // bot-blocked 行（ok=false 但带 BOT_BLOCKED 前缀）不清零就错：打断链回 0
    await record(false, `${BOT_BLOCKED_ERROR_PREFIX} 第 1 层 HTTP 403，第 2 层桌面 UA 仍 HTTP 403`, 403);
    expect(await ctx.repo.getConsecutiveFailures(site.id)).toBe(0);

    await record(false, "boom");
    expect(await ctx.repo.getConsecutiveFailures(site.id)).toBe(1);
    await record(true, null);
    expect(await ctx.repo.getConsecutiveFailures(site.id)).toBe(0);
  });

  it("未知站点计数为 0", async () => {
    expect(await ctx.repo.getConsecutiveFailures("no-such-site")).toBe(0);
  });
});
