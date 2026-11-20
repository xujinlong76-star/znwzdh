/**
 * 收录汇报 AI 原因生成的安全守卫。
 *
 * 钉死两条外发隐私纪律（原因会进通知体与反馈页，都是外发出口）：
 *  1. 模型若逐字回显管理员内部备注 → 整段丢弃走模板（代码层兜底，
 *     不只依赖 prompt 的自然语言约束）；
 *  2. 模型输出裹的中英引号被对称剥除，不带引号进汇报。
 *
 * 通过 admin PATCH 审核触发 generateReviewReason（mock callLlm 控制返回），
 * 再读 submission_reviews 断言落库原因。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PRIVATE_NOTE = "预算不足，暂不收录，招呼也别发了";
let llmContent = "";

vi.mock("../src/llm-config.ts", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/llm-config.ts")>();
  return {
    ...orig,
    resolveLlm: vi.fn(async () => ({
      provider: { apiKey: "test-key", model: "test-model", baseUrl: "", provider: "openai" },
      fallbacks: [],
      source: "test",
    })),
  };
});

vi.mock("../src/llm-usage.ts", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/llm-usage.ts")>();
  return {
    ...orig,
    callLlm: vi.fn(async () => ({ content: llmContent, model: "test-model" })),
  };
});

import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { hashToken } from "../src/auth.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
const headers = { authorization: "Bearer reason-guard-admin" };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-reason-guard-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "reason.db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: "test-key", model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
    identitySecret: "test-secret",
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);
  await app.ready();
  await ctx.repo.createCategory({ id: "cat-ai", title: "AI 工具" });
  await ctx.repo.createApiToken({ name: "reason-guard-admin", tokenHash: hashToken("reason-guard-admin"), scopes: "admin" });
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

async function submit(n: number): Promise<string> {
  const site = await ctx.repo.createSite({
    url: `https://reason-guard-${n}.example/`, title: `测试站点 ${n}`,
    description: "AI 协作工具", categoryId: "cat-ai", status: "pending", source: "submission",
  });
  return site.id;
}

describe("AI 原因生成：外发隐私与输出清理", () => {
  it("模型逐字回显内部备注 → 丢弃整段、走模板（备注原文不落库）", async () => {
    llmContent = `抱歉，${PRIVATE_NOTE}，请改进后再来。`;
    const siteId = await submit(1);
    const res = await app.inject({
      method: "PATCH", url: `/api/submissions/${siteId}`, headers,
      payload: { action: "reject", reason: PRIVATE_NOTE },
    });
    expect(res.statusCode).toBe(200);
    const rows = await ctx.repo.raw("SELECT reason, reviewer_note FROM submission_reviews WHERE site_id = ?", [siteId]);
    expect(rows).toHaveLength(1);
    const reason = String(rows[0]!.reason);
    expect(reason).toContain("暂未通过"); // 模板降级文案
    expect(reason).not.toContain(PRIVATE_NOTE); // 内部备注绝不外发
    expect(reason).not.toContain("预算不足");
    expect(rows[0]!.reviewer_note).toBe(PRIVATE_NOTE); // 原始备注仍留库内（不外发出口）
  });

  it("模型去掉备注标点逐字复述 → 归一化后命中，仍走模板", async () => {
    const note = "预算不足，暂不收录";
    llmContent = `抱歉，预算不足暂不收录，请完善后再来。`;
    const siteId = await submit(3);
    const res = await app.inject({
      method: "PATCH", url: `/api/submissions/${siteId}`, headers,
      payload: { action: "reject", reason: note },
    });
    expect(res.statusCode).toBe(200);
    const rows = await ctx.repo.raw("SELECT reason FROM submission_reviews WHERE site_id = ?", [siteId]);
    const reason = String(rows[0]!.reason);
    expect(reason).toContain("暂未通过");
    expect(reason).not.toContain("预算不足");
  });

  it("极短备注被整段复述 → 丢弃（包含检测会误伤，整段相等仍拦）", async () => {
    const note = "刷屏";
    llmContent = "刷屏";
    const siteId = await submit(4);
    const res = await app.inject({
      method: "PATCH", url: `/api/submissions/${siteId}`, headers,
      payload: { action: "reject", reason: note },
    });
    expect(res.statusCode).toBe(200);
    const rows = await ctx.repo.raw("SELECT reason FROM submission_reviews WHERE site_id = ?", [siteId]);
    expect(String(rows[0]!.reason)).toContain("暂未通过");
    expect(String(rows[0]!.reason)).not.toContain("刷屏");
  });

  it("模型正常输出（不含备注）→ 对称剥引号后进汇报", async () => {
    llmContent = `"内容与定位清晰，具有明确的实用价值，予以收录。"`;
    const siteId = await submit(2);
    const res = await app.inject({
      method: "PATCH", url: `/api/submissions/${siteId}`, headers,
      payload: { action: "approve" },
    });
    expect(res.statusCode).toBe(200);
    const rows = await ctx.repo.raw("SELECT reason FROM submission_reviews WHERE site_id = ?", [siteId]);
    const reason = String(rows[0]!.reason);
    expect(reason).not.toMatch(/^["「"]|["」"]$/); // 首尾引号被剥除
    expect(reason).toContain("内容与定位清晰");
  });
});
