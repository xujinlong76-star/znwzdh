/**
 * LLM 用量明细（llm_usage）：表结构 + 写入 + 聚合语义。
 *
 * 为什么需要这层测试：观测面板之前会在「没有数据」时伪造 168 次调用与
 * 正弦曲线。修掉伪造之后，面板的全部数字都来自这里 —— 所以这里的每个
 * 语义（成功率 null、p50/p95、小时分桶、thinking 计数）都必须锁住，
 * 否则又会退回「看起来有数据、其实是编的」。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { callLlm } from "../src/llm-usage.ts";
import { llmProviderReady, type ResolvedLlm } from "../src/llm-config.ts";

let dir: string;
let ctx: AppContext;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-llm-usage-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    auth: { required: false },
    embedding: {
      model: "Xenova/bge-small-zh-v1.5",
      endpoint: "https://hf-mirror.com",
      dtype: "q8",
      cacheDir: join(dir, "models"),
      dim: 512,
      enabled: false,
    },
    llm: { baseUrl: "https://api.agnes-ai.cn/v1", apiKey: null, model: "agnes-3.0-flash", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("llm_usage 表与写入", () => {
  it("迁移建表成功，可写入并读回", async () => {
    await ctx.repo.recordLlmUsage({
      scenario: "enrich",
      source: "system",
      model: "agnes-3.0-flash",
      promptTokens: 120,
      completionTokens: 30,
      latencyMs: 800,
      ok: true,
      thinking: false,
    });
    const rows = await ctx.repo.raw("SELECT scenario, source, model, prompt_tokens, completion_tokens, ok FROM llm_usage");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      scenario: "enrich",
      source: "system",
      model: "agnes-3.0-flash",
      prompt_tokens: 120,
      completion_tokens: 30,
    });
  });

  it("失败调用也落库，并带 error_code", async () => {
    await ctx.repo.recordLlmUsage({
      scenario: "ai_chat",
      source: "user",
      model: "agnes-3.0-flash",
      latencyMs: 5000,
      ok: false,
      errorCode: "timeout",
    });
    const rows = await ctx.repo.raw("SELECT ok, error_code FROM llm_usage WHERE scenario = 'ai_chat'");
    expect(rows[0].ok).toBe(0);
    expect(rows[0].error_code).toBe("timeout");
  });
});

describe("aggregateLlmUsage 聚合语义", () => {
  it("空库时成功率为 null（不是 100%），延迟也为 null", async () => {
    const agg = await ctx.repo.aggregateLlmUsage({ since: Date.now() + 60_000 });
    expect(agg.totalCalls).toBe(0);
    expect(agg.successRate).toBeNull();
    expect(agg.avgLatencyMs).toBeNull();
    expect(agg.p50LatencyMs).toBeNull();
    expect(agg.p95LatencyMs).toBeNull();
    expect(agg.firstAt).toBeNull();
    expect(agg.byScenario).toEqual([]);
    expect(agg.hourly).toHaveLength(24);
    expect(agg.hourly.every((h) => h.calls === 0)).toBe(true);
  });

  it("总量 / 成功率 / token / 分场景 / 分来源 / thinking 计数", async () => {
    const since = Date.now() - 1000;
    // 清掉前面的用例数据，构造确定窗口
    await ctx.repo.run("DELETE FROM llm_usage");
    await ctx.repo.recordLlmUsage({ scenario: "enrich", source: "system", model: "m", promptTokens: 100, completionTokens: 20, latencyMs: 100, ok: true });
    await ctx.repo.recordLlmUsage({ scenario: "enrich", source: "system", model: "m", promptTokens: 100, completionTokens: 20, latencyMs: 300, ok: true });
    await ctx.repo.recordLlmUsage({ scenario: "ai_chat", source: "user", model: "m", promptTokens: 50, completionTokens: 10, latencyMs: 900, ok: false, errorCode: "auth", thinking: true });

    const agg = await ctx.repo.aggregateLlmUsage({ since });
    expect(agg.totalCalls).toBe(3);
    expect(agg.successCalls).toBe(2);
    expect(agg.errorCalls).toBe(1);
    expect(agg.successRate).toBeCloseTo(66.7, 1);
    expect(agg.totalTokens).toBe(100 + 20 + 100 + 20 + 50 + 10);
    expect(agg.thinkingCalls).toBe(1);
    expect(agg.firstAt).toBeGreaterThanOrEqual(since);

    const enrich = agg.byScenario.find((s) => s.scenario === "enrich")!;
    expect(enrich.count).toBe(2);
    expect(enrich.tokens).toBe(240);
    expect(enrich.avgLatencyMs).toBe(200);
    expect(enrich.errorCalls).toBe(0);

    const bySource = Object.fromEntries(agg.bySource.map((s) => [s.source, s.count]));
    expect(bySource).toEqual({ system: 2, user: 1 });
  });

  it("p50 / p95 取真实分位数，不做兜底假值", async () => {
    await ctx.repo.run("DELETE FROM llm_usage");
    const since = Date.now() - 1000;
    for (const lat of [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]) {
      await ctx.repo.recordLlmUsage({ scenario: "enrich", source: "system", model: "m", latencyMs: lat, ok: true });
    }
    const agg = await ctx.repo.aggregateLlmUsage({ since });
    expect(agg.p50LatencyMs).toBe(600); // floor(10 * 0.5) = 5 → 第 6 个（升序）
    expect(agg.p95LatencyMs).toBe(1000); // floor(10 * 0.95) = 9 → 最后一个
    expect(agg.avgLatencyMs).toBe(550);
  });

  it("小时分桶按本地时间，且没有调用的小时为 0", async () => {
    await ctx.repo.run("DELETE FROM llm_usage");
    const since = Date.now() - 1000;
    await ctx.repo.recordLlmUsage({ scenario: "enrich", source: "system", model: "m", latencyMs: 100, ok: true });
    const agg = await ctx.repo.aggregateLlmUsage({ since });
    const currentHour = new Date().getHours();
    expect(agg.hourly).toHaveLength(24);
    expect(agg.hourly[currentHour]!.calls).toBe(1);
    expect(agg.hourly.reduce((a, h) => a + h.calls, 0)).toBe(1);
  });

  it("pruneLlmUsage 删除窗口之前的行并返回条数", async () => {
    await ctx.repo.run("DELETE FROM llm_usage");
    await ctx.repo.recordLlmUsage({ scenario: "enrich", source: "system", model: "m", ok: true });
    const deleted = await ctx.repo.pruneLlmUsage(Date.now() + 60_000);
    expect(deleted).toBe(1);
    const left = await ctx.repo.raw("SELECT COUNT(*) AS c FROM llm_usage");
    expect(Number(left[0].c)).toBe(0);
  });

  it("listRecentLlmUsage 新→旧返回明细", async () => {
    await ctx.repo.run("DELETE FROM llm_usage");
    await ctx.repo.recordLlmUsage({ scenario: "a", source: "system", model: "m", ok: true });
    await new Promise((r) => setTimeout(r, 5));
    await ctx.repo.recordLlmUsage({ scenario: "b", source: "user", model: "m", ok: true, thinking: true });
    const rows = await ctx.repo.listRecentLlmUsage(10);
    expect(rows[0]!.scenario).toBe("b");
    expect(rows[0]!.thinking).toBe(true);
    expect(rows[1]!.scenario).toBe("a");
  });
});

/**
 * 本地自托管网关（Ollama 等）不需要 API 密钥。
 * 配置预设明确写着「可留空」，但旧实现只看 apiKey，导致这类 provider 永远被跳过。
 */
describe("本地免密钥网关（allowPrivateNetwork）", () => {
  const stubCtx = {
    repo: { recordLlmUsage: async () => undefined },
  } as unknown as AppContext;

  function localResolved(allowPrivateNetwork = true): ResolvedLlm {
    return {
      provider: {
        name: "Ollama",
        baseUrl: "http://127.0.0.1:11434/v1",
        model: "llama3",
        apiKey: null,
        allowPrivateNetwork,
        thinking: false,
      },
      fallbacks: [],
      source: "system",
    } as ResolvedLlm;
  }

  const fakeFetch = async () =>
    new Response(
      JSON.stringify({
        model: "llama3",
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 3, completion_tokens: 1 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  it("llmProviderReady：有密钥或显式放行内网即可用", () => {
    expect(llmProviderReady({ apiKey: "sk-x" })).toBe(true);
    expect(llmProviderReady({ apiKey: "", allowPrivateNetwork: true })).toBe(true);
    expect(llmProviderReady({ apiKey: null, allowPrivateNetwork: false })).toBe(false);
    expect(llmProviderReady(null)).toBe(false);
  });

  it("无密钥但 allowPrivateNetwork=true 时能发起真实调用", async () => {
    const result = await callLlm(stubCtx, localResolved(), {
      scenario: "ai_config_test",
      messages: [{ role: "user", content: "ping" }],
      fetchImpl: fakeFetch as typeof fetch,
    });
    expect(result.content).toBe("ok");
    expect(result.model).toBe("llama3");
  });

  it("无密钥且未放行内网时保持拒调用", async () => {
    const resolved = localResolved(false);
    resolved.provider = { ...resolved.provider, baseUrl: "https://api.example.com/v1" };
    await expect(
      callLlm(stubCtx, resolved, {
        scenario: "ai_config_test",
        messages: [{ role: "user", content: "ping" }],
        fetchImpl: fakeFetch as typeof fetch,
      }),
    ).rejects.toThrow(/密钥/);
  });
});
