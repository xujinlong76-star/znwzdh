/**
 * 搜索包 URL 健康探活任务（plugin_url_health，P1-4）。
 *
 * 覆盖：
 *  1. 种子 URL 提取：5 个 search-pack 全覆盖、去重、`{q}` 已替换；
 *  2. 探活执行（桩探活，不出网）：全健康 / 有坏链两种结局，坏链只记事件与审计、不抛错；
 *  3. 只标记不下架：坏链轮次只在 events 与 audit_logs 留痕，不动其它表；
 *  4. 排期登记：DEFAULT_CRON_SCHEDULES / DEFAULT_SCHEDULES / cron 别名一致；
 *  5. 定时器到点入队：startCronTimer 不依赖 tick 也能把本 kind 排进队列；
 *  6. 手动触发：POST /api/jobs 的入队校验接受本 kind（RunJobInput + validateJobPayload）。
 *
 * 真实出网探活不在单测里做（CI 不应依赖外网与对方站点的实时状态）；
 * 真实一轮的验证见任务模块头注释的手动触发方式，用临时库跑一次后查事件流。
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import {
  DEFAULT_CRON_SCHEDULES,
  DEFAULT_SCHEDULES,
  JobRunner,
  scheduleCronOf,
  type JobRunHandle,
} from "../src/jobs.ts";
import {
  collectSearchPackUrls,
  handlePluginUrlHealth,
  PLUGIN_URL_HEALTH_EVENT_KIND,
  type PluginUrlProbeResult,
} from "../src/jobs/tasks/plugin-url-health.task.ts";
import { RunJobInput, validateJobPayload } from "@navhub/core";

const dirs: string[] = [];
const contexts: AppContext[] = [];

async function makeCtx(): Promise<AppContext> {
  const dir = mkdtempSync(join(tmpdir(), "navhub-plugin-url-health-"));
  dirs.push(dir);
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "plugin-url-health.db"),
    embedding: {
      model: "Xenova/bge-small-zh-v1.5",
      endpoint: "https://hf-mirror.com",
      dtype: "q8",
      cacheDir: join(dir, "models"),
      dim: 512,
      enabled: false,
    },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  });
  const ctx = await createContext(config);
  contexts.push(ctx);
  return ctx;
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const fakeRun = { shouldStop: () => false } as unknown as JobRunHandle;

async function latestEventMeta(ctx: AppContext): Promise<Record<string, any> | null> {
  const rows = await ctx.repo.raw(
    "SELECT meta FROM events WHERE kind = ? ORDER BY id DESC LIMIT 1",
    [PLUGIN_URL_HEALTH_EVENT_KIND],
  );
  const meta = rows[0]?.meta;
  if (typeof meta !== "string") return null;
  try {
    return JSON.parse(meta) as Record<string, any>;
  } catch {
    return null;
  }
}

describe("collectSearchPackUrls", () => {
  it("覆盖全部 5 个 search-pack 种子，去重且 {q} 已替换", () => {
    const targets = collectSearchPackUrls();
    const packs = new Set(targets.map((t) => t.packSlug));
    expect([...packs].sort()).toEqual([
      "academic-search-arsenal",
      "ai-deep-search-pack",
      "cn-search-arsenal",
      "code-and-package-search-pack",
      "dev-search-arsenal",
    ]);
    // 5 个包共约 191 条（含跨包重复）；只钉下限，种子增补不应打碎本测试。
    expect(targets.length).toBeGreaterThan(100);
    const urls = targets.map((t) => t.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) {
      expect(url).not.toContain("{q}");
      expect(url.startsWith("https://")).toBe(true);
    }
    // 已知条目：小红书的 {q} 已换成固定测试词。
    expect(urls).toContain("https://www.xiaohongshu.com/search_result?keyword=navhub");
  });

  it("非 search-pack 与结构不合规的条目直接跳过", () => {
    const targets = collectSearchPackUrls([
      {
        slug: "theme-x",
        status: "published",
        manifest: { manifestVersion: 1, kind: "theme", name: "t", payload: {} },
      } as never,
      {
        slug: "broken-pack",
        status: "published",
        manifest: { manifestVersion: 1, kind: "search-pack", payload: { engines: [{ name: "坏", searchUrl: "" }, null, { name: "好", searchUrl: "https://example.com/s?q={q}" }] } },
      } as never,
    ]);
    expect(targets).toEqual([
      { packSlug: "broken-pack", engineName: "好", url: "https://example.com/s?q=navhub" },
    ]);
  });
});

describe("handlePluginUrlHealth", () => {
  it("全健康：汇总全对，事件留痕，无审计", async () => {
    const ctx = await makeCtx();
    const probe = async (url: string): Promise<PluginUrlProbeResult> => ({ url, ok: true, status: 200 });
    const summary = await handlePluginUrlHealth(ctx, fakeRun, { probeUrl: probe });
    expect(summary.total).toBeGreaterThan(100);
    expect(summary.packs).toBe(5);
    expect(summary.okCount).toBe(summary.total);
    expect(summary.failedCount).toBe(0);
    expect(summary.failed).toEqual([]);

    const meta = await latestEventMeta(ctx);
    expect(meta).not.toBeNull();
    expect(meta?.total).toBe(summary.total);
    expect(meta?.okCount).toBe(summary.total);
    expect(meta?.failedCount).toBe(0);
    const audits = await ctx.repo.listAuditLogs({ action: "plugin.url_health.failed" });
    expect(audits.items).toHaveLength(0);
  });

  it("有坏链：失败只进事件与审计，不抛错、不下架", async () => {
    const ctx = await makeCtx();
    const failing = new Set<string>();
    const targets = collectSearchPackUrls();
    // 头两条分别模拟「登录墙式 403」与「探活抛错（超时/断连）」。
    failing.add(targets[0]!.url);
    const throwingUrl = targets[1]!.url;
    const probe = async (url: string): Promise<PluginUrlProbeResult> => {
      if (url === throwingUrl) throw new Error("fetch timeout");
      if (failing.has(url)) return { url, ok: false, status: 403, error: "HTTP 403" };
      return { url, ok: true, status: 200 };
    };
    const summary = await handlePluginUrlHealth(ctx, fakeRun, { probeUrl: probe });
    expect(summary.failedCount).toBe(2);
    expect(summary.okCount).toBe(summary.total - 2);
    expect(summary.failed.map((f) => f.url).sort()).toEqual([targets[0]!.url, throwingUrl].sort());
    expect(summary.failed[0]?.packSlug).toBeTruthy();
    expect(summary.failed[0]?.engineName).toBeTruthy();

    const meta = await latestEventMeta(ctx);
    expect(meta?.failedCount).toBe(2);
    expect((meta?.failed as Array<{ url: string }>).map((f) => f.url).sort()).toEqual(
      [targets[0]!.url, throwingUrl].sort(),
    );
    const audits = await ctx.repo.listAuditLogs({ action: "plugin.url_health.failed" });
    expect(audits.items).toHaveLength(1);

    // 只标记不下架：本轮只在 events 与 audit_logs 留痕，其它表零写入。
    const events = await ctx.repo.raw("SELECT COUNT(*) AS c FROM events WHERE kind = ?", [PLUGIN_URL_HEALTH_EVENT_KIND]);
    expect(Number(events[0]?.c)).toBe(1);
    const healthRows = await ctx.repo.raw("SELECT COUNT(*) AS c FROM health_checks");
    expect(Number(healthRows[0]?.c)).toBe(0);
    const plugins = await ctx.repo.raw("SELECT COUNT(*) AS c FROM plugins");
    expect(Number(plugins[0]?.c)).toBe(0);
  });

  it("shouldStop 到点即停：未探的不计失败", async () => {
    const ctx = await makeCtx();
    let calls = 0;
    const stoppingRun = { shouldStop: () => calls >= 5 } as unknown as JobRunHandle;
    const probe = async (url: string): Promise<PluginUrlProbeResult> => {
      calls += 1;
      return { url, ok: true, status: 200 };
    };
    const summary = await handlePluginUrlHealth(ctx, stoppingRun, { probeUrl: probe });
    expect(summary.total).toBeGreaterThan(100);
    expect(summary.okCount).toBe(5);
    expect(summary.failedCount).toBe(0);
  });
});

describe("plugin_url_health 排期登记", () => {
  it("每天一轮：intervalMs 与 DAILY 别名一致", () => {
    const entry = DEFAULT_CRON_SCHEDULES.find((s) => s.kind === "plugin_url_health");
    expect(entry?.intervalMs).toBe(86_400_000);
    expect(DEFAULT_SCHEDULES.plugin_url_health.cron).toBe("DAILY");
    expect(DEFAULT_SCHEDULES.plugin_url_health.timeoutMs).toBe(300_000);
    expect(DEFAULT_SCHEDULES.plugin_url_health.maxConcurrency).toBe(1);
    expect(scheduleCronOf("plugin_url_health").split(" ").length).toBe(5);
  });

  it("定时器到点入队：不调用 tick() 也能排上", async () => {
    const ctx = await makeCtx();
    const runner = new JobRunner(ctx);
    runner.startCronTimer(10);
    try {
      await new Promise((r) => setTimeout(r, 400));
      const pending = await ctx.repo.pendingJobsByKind();
      expect(pending.get("plugin_url_health")).toBeGreaterThanOrEqual(1);
    } finally {
      runner.stop();
    }
  });

  it("手动触发入口接受本 kind：POST /api/jobs 校验通过", () => {
    expect(RunJobInput.safeParse({ kind: "plugin_url_health", payload: {} }).success).toBe(true);
    expect(validateJobPayload("plugin_url_health", {})).toEqual({ ok: true, payload: {} });
    expect(validateJobPayload("plugin_url_health", { extra: 1 }).ok).toBe(false);
  });
});
