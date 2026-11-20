/**
 * 投稿流两处 LLM 调用的额度闸门守卫。
 *
 * prefill（public）与审核原因生成（admin）都直接调过 callLlm，绕开了全站
 * 统一的 reserve/settle：脚本循环打 prefill 就能烧穿系统 key，且额度面板
 * 看不到任何预留。本文件钉死两条：
 *  1. 任何一次模型调用都必须先拿到预留，且调用结束（含降级/异常）即结算；
 *  2. 额度到顶时不装成模型回答——prefill 标 aiSkipped=quota，审核回执标
 *     reasonSource=quota，且一条 llm_usage 都不多写。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FETCH_RESULT = {
  body: `<html lang="zh-CN"><head><title>额度测试站</title>
    <meta name="description" content="用于验证额度闸门的站点">
    </head><body>额度测试站是一款在线效率工具。</body></html>`,
  finalUrl: "https://quota-submit.example/",
  status: 200,
  headers: new Headers(),
};

vi.mock("@navhub/ai", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@navhub/ai")>();
  return { ...orig, guardedFetch: vi.fn(async () => FETCH_RESULT) };
});

let llmContent = "";
vi.mock("../src/llm-config.ts", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/llm-config.ts")>();
  return {
    ...orig,
    resolveLlm: vi.fn(async () => ({
      provider: { apiKey: "test-key", model: "test-model", baseUrl: "http://127.0.0.1:9/v1", provider: "openai" },
      fallbacks: [],
      source: "env",
    })),
  };
});

vi.mock("../src/llm-usage.ts", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/llm-usage.ts")>();
  return { ...orig, callLlm: vi.fn(async () => ({ content: llmContent, model: "test-model" })) };
});

import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig, type AppConfig } from "../src/config.ts";
import { callLlm } from "../src/llm-usage.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
let baseQuota: AppConfig["llmQuota"];

const CATS = [{ id: "cat-ai", title: "AI 工具", description: "AI 对话与编程助手" }];

function setQuota(patch: Partial<AppConfig["llmQuota"]>) {
  ctx.config.llmQuota = { ...baseQuota, ...patch };
}

async function seedUsage() {
  await ctx.repo.run(
    "INSERT INTO llm_usage (id, scenario, source, model, identity, prompt_tokens, completion_tokens, latency_ms, ok, error_code, thinking, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [crypto.randomUUID(), "system", "system", "test-model", null, 0, 0, 120, true, null, false, Date.now()],
  );
}

async function usageCount(): Promise<number> {
  return Number((await ctx.repo.raw("SELECT COUNT(*) AS c FROM llm_usage"))[0]!.c);
}

async function reservationCount(): Promise<number> {
  return Number((await ctx.repo.raw("SELECT COUNT(*) AS c FROM llm_quota_reservations"))[0]!.c);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-submission-quota-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "quota.db"),
    auth: { enabled: false },
    embedding: { enabled: false },
    llm: { baseUrl: "https://api.example.com", apiKey: "test-key", model: "test-model" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  baseQuota = { ...ctx.config.llmQuota };
  app = await buildServer(ctx);
  await app.ready();
  await ctx.repo.createCategory({ id: "cat-ai", title: "AI 工具" });
});

afterEach(async () => {
  setQuota({});
  llmContent = "";
  vi.mocked(callLlm).mockClear();
  await ctx.repo.run("DELETE FROM llm_usage");
  await ctx.repo.run("DELETE FROM llm_quota_reservations");
});

afterAll(async () => {
  await app?.close();
  await ctx?.close();
  rmSync(dir, { recursive: true, force: true });
});

// mock 卫生兜底：isolate:false 下同 worker 的后续文件会看到本文件留下的
// 跨模块 mock 与 process.env 改写，这里统一清掉。
afterAll(() => {
  vi.resetModules();
});

describe("POST /api/submissions/prefill 的额度闸门", () => {
  it("额度到顶：启发式降级 + aiSkipped=quota，不发起模型调用", async () => {
    setQuota({ systemDailyCalls: 1 });
    await seedUsage();
    const before = await usageCount();

    const res = await app.inject({
      method: "POST",
      url: "/api/submissions/prefill",
      payload: { url: "https://quota-submit.example/", categories: CATS },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.fallback).toBe(true);
    expect(body.aiSkipped).toBe("quota");
    expect(body.quota).toMatchObject({ scope: "system", metric: "calls", limit: 1, used: 1 });
    expect(body.prefill).toMatchObject({ category: "", confidence: 0, candidates: [] });
    expect(vi.mocked(callLlm)).not.toHaveBeenCalled();
    expect(await usageCount()).toBe(before);
    expect(await reservationCount()).toBe(0);
  });

  it("额度充足：模型调用正常落地，预留调用后即结算", async () => {
    setQuota({ systemDailyCalls: 1 });
    llmContent = JSON.stringify({
      title: "额度测试站", description: "在线效率工具", category: "cat-ai",
      subcategory: "", submitterNote: "#效率工具", confidence: 0.9, candidates: [],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/submissions/prefill",
      payload: { url: "https://quota-submit.example/", categories: CATS },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().prefill.category).toBe("cat-ai");
    expect(res.json().aiSkipped).toBeUndefined();
    expect(vi.mocked(callLlm)).toHaveBeenCalledTimes(1);
    expect(await reservationCount()).toBe(0);
    // 结算后名额立刻可用（不是靠 TTL 慢慢释放）
    expect((await ctx.repo.raw("SELECT COUNT(*) AS c FROM llm_quota_reservations"))[0]!.c).toBe(0);
  });
});

describe("PATCH /api/submissions/:id 原因生成的额度闸门", () => {
  async function submit(n: number) {
    const site = await ctx.repo.createSiteWithId({
      id: `quota-review-${n}`,
      url: `https://quota-review-${n}.example/`,
      title: `额度审核 ${n}`,
      description: "在线效率工具",
      categoryId: "cat-ai",
      status: "pending",
      source: "submission",
    });
    return site.id;
  }

  it("额度到顶：原因走模板，回执标 reasonSource=quota，不调模型", async () => {
    setQuota({ systemDailyCalls: 1 });
    await seedUsage();
    const siteId = await submit(1);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/submissions/${siteId}`,
      payload: { action: "reject", reason: "内部备注" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.reasonSource).toBe("quota");
    expect(body.reasonQuota).toMatchObject({ scope: "system", metric: "calls", limit: 1, used: 1 });
    expect(vi.mocked(callLlm)).not.toHaveBeenCalled();
    const rows = await ctx.repo.raw("SELECT reason FROM submission_reviews WHERE site_id = ?", [siteId]);
    expect(String(rows[0]!.reason)).toContain("暂未通过");
    // 被额度挡住不能留下未结算预留
    expect(await reservationCount()).toBe(0);
  });

  it("额度充足：AI 原因正常落库，预留结算且回执标来源", async () => {
    setQuota({ systemDailyCalls: 1 });
    llmContent = "内容与定位清晰，具有明确的实用价值，予以收录。";
    const siteId = await submit(2);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/submissions/${siteId}`,
      payload: { action: "approve" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().reasonSource).toBe("ai");
    expect(vi.mocked(callLlm)).toHaveBeenCalledTimes(1);
    const rows = await ctx.repo.raw("SELECT reason FROM submission_reviews WHERE site_id = ?", [siteId]);
    expect(String(rows[0]!.reason)).toContain("内容与定位清晰");
    expect(await reservationCount()).toBe(0);
  });
});
