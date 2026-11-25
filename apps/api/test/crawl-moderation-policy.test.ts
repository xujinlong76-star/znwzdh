/**
 * AI 审核策略管理端点（GET/PUT /api/admin/crawl-moderation/policy）契约。
 *
 * 这是 hub 网关策略生成的来源：路径缺 config.scope:"admin" 时，
 * 管理台经 /api/hub 调用会被判 HUB_ROUTE_UNCLASSIFIED（403）。
 * 同时钉住 system_states 持久化 + zod 校验 + 审计留痕。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import {
  DEFAULT_CRAWL_MODERATION_POLICY,
  CRAWL_MODERATION_POLICY_KEY,
  loadCrawlAiModerationPolicy,
} from "../src/crawl-moderation-policy.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-crawl-policy-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    embedding: { model: "none", endpoint: "", dtype: "q8", dim: 512, cacheDir: join(dir, "models"), enabled: false },
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

const NEXT = {
  enabled: true,
  mode: "shadow" as const,
  autoApproveConfidence: 0.8,
  rejectConfidence: 0.95,
  minQualityScore: 65,
  maxExcerptChars: 4000,
  maxAiReviewsPerRun: 12,
  requireHttps: true,
};

describe("AI 审核策略管理端点（admin scope + system_states 持久化）", () => {
  it("GET 初始返回内置默认值", async () => {
    const res = await app.inject({ method: "GET", url: "/api/admin/crawl-moderation/policy" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, policy: DEFAULT_CRAWL_MODERATION_POLICY });
  });

  it("PUT 合法策略后 GET 与读取方均返回新值（持久化闭环）", async () => {
    const put = await app.inject({ method: "PUT", url: "/api/admin/crawl-moderation/policy", payload: NEXT });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ ok: true, policy: NEXT });
    const get = await app.inject({ method: "GET", url: "/api/admin/crawl-moderation/policy" });
    expect(get.json()).toEqual({ ok: true, policy: NEXT });
    // 自动评测入口（crawl-operations.ts:683）走同一个读取函数
    expect(await loadCrawlAiModerationPolicy(ctx)).toEqual(NEXT);
    // 审计留痕写入
    const raw = await ctx.repo.getSystemState(CRAWL_MODERATION_POLICY_KEY);
    expect(raw).toEqual(NEXT);
  });

  it("非法策略（缺字段 / 越界 / 未知键 / 阈值倒置）返回 400 且不覆盖已存值", async () => {
    const badBodies: unknown[] = [
      { ...NEXT, enabled: "yes" },                    // 类型错
      { ...NEXT, autoApproveConfidence: 1.5 },         // 越界
      { ...NEXT, unexpected: 1 },                      // 未知键
      { ...NEXT, rejectConfidence: 0.5 },              // 阈值倒置
      { enabled: true },                              // 缺字段
    ];
    for (const body of badBodies) {
      const res = await app.inject({ method: "PUT", url: "/api/admin/crawl-moderation/policy", payload: body });
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(await loadCrawlAiModerationPolicy(ctx)).toEqual(NEXT);
  });
});
