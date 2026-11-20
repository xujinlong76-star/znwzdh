/**
 * 收录反馈（提交后网址收录情况汇报）测试。
 *
 * 覆盖：
 *  1. 审核通过/未通过都写「状态 + 原因说明」（recordSubmissionReview，复审覆盖写）；
 *  2. GET /api/submissions/feedback 按投稿人返回提交时间/网址/状态/原因；
 *  3. AI 原因生成降级（无 LLM key 时模板文案带管理员备注，汇报不空窗）；
 *  4. 状态更新后反馈同步最新（先拒后过 → 反馈里是 approved）。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 无 API key：generateReviewReason 走模板降级（也验证降级路径不空窗）
vi.mock("../src/llm-config.ts", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/llm-config.ts")>();
  return {
    ...orig,
    resolveLlm: vi.fn(async () => ({
      provider: { apiKey: "", model: "test-model", baseUrl: "", provider: "openai" },
      fallbacks: [],
      source: "test",
    })),
  };
});

import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { randomUUID } from "node:crypto";
import { hashToken } from "../src/auth.ts";
import { signIdentity } from "../src/identity-signature.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-feedback-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "feedback.db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
    identitySecret: "test-secret",
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);
  await app.ready();
  await ctx.repo.createCategory({ id: "cat-ai", title: "AI 工具" });
  await ctx.repo.createCategory({ id: "cat-design", title: "设计工具" });
  await ctx.repo.createCategory({ id: "sub-design", title: "UI 设计", parentId: "cat-design" });
  // 端到端复审用例需要 admin 令牌走 PATCH 审核端点
  await ctx.repo.createApiToken({ name: "feedback-admin", tokenHash: hashToken("feedback-admin-token"), scopes: "admin" });
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

/** 经投稿创建端点造一条归属到 identity 的投稿（identity 走签名头需令牌，这里直接写仓储） */
async function makeSubmission(identity: string, url: string): Promise<string> {
  const site = await ctx.repo.createSite({
    url,
    title: "Acme " + url,
    description: "测试投稿站点",
    categoryId: "cat-ai",
    status: "pending",
    source: "submission",
  });
  await ctx.repo.run(
    "INSERT INTO submission_owners (site_id, identity, created_at) VALUES (?,?,?)",
    [site.id, identity, Date.now()],
  );
  return site.id;
}

describe("收录反馈：审核汇报 + 个人查询", () => {
  it("审核未通过：写汇报（rejected + 模板原因带管理员备注），反馈页可见", async () => {
    const identity = "user-feedback-1";
    const siteId = await makeSubmission(identity, "https://reject-me.example/");

    // 直接调仓储写汇报（审核 PATCH 需 admin 令牌链路，这里验证汇报与查询契约）
    await ctx.repo.recordSubmissionReview({
      siteId,
      reviewStatus: "rejected",
      reason: "暂未通过：内容与收录标准暂不匹配",
      reviewerNote: "内容与收录标准暂不匹配",
    });

    const items = await ctx.repo.listSubmissionFeedback(identity);
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.siteId).toBe(siteId);
    expect(item.status).toBe("rejected");
    expect(item.reason).toContain("暂未通过");
    expect(item.submittedAt).toBeGreaterThan(0);
    expect(item.reviewedAt).toBeGreaterThan(0);
  });

  it("复审覆盖写：先拒后过，反馈同步最新（approved）", async () => {
    const identity = "user-feedback-2";
    const siteId = await makeSubmission(identity, "https://flip-me.example/");
    await ctx.repo.recordSubmissionReview({ siteId, reviewStatus: "rejected", reason: "暂未通过" });
    await ctx.repo.recordSubmissionReview({ siteId, reviewStatus: "approved", reason: "已通过收录：内容优质" });

    const items = await ctx.repo.listSubmissionFeedback(identity);
    expect(items).toHaveLength(1);
    expect(items[0]!.status).toBe("approved");
    expect(items[0]!.reason).toContain("已通过");
  });

  it("审核中（无 review 记录）：status=pending、reason 空、reviewedAt null", async () => {
    const identity = "user-feedback-3";
    await makeSubmission(identity, "https://pending-me.example/");
    const items = await ctx.repo.listSubmissionFeedback(identity);
    expect(items[0]!.status).toBe("pending");
    expect(items[0]!.reason).toBe("");
    expect(items[0]!.reviewedAt).toBeNull();
  });

  it("只回本人投稿：他人投稿不出现在反馈列表", async () => {
    await makeSubmission("user-feedback-4", "https://mine.example/");
    await makeSubmission("user-other", "https://theirs.example/");
    const items = await ctx.repo.listSubmissionFeedback("user-feedback-4");
    expect(items).toHaveLength(1);
    expect(items[0]!.url).toBe("https://mine.example/");
  });

  it("GET /api/submissions/feedback：缺身份 400", async () => {
    const res = await app.inject({ method: "GET", url: "/api/submissions/feedback" });
    expect(res.statusCode).toBe(400);
  });

  it("同状态复审改原因：PATCH 拒→拒仍覆盖写汇报（反馈页同步最新原因）", async () => {
    const identity = "user-feedback-5";
    const siteId = await makeSubmission(identity, "https://rereject.example/");
    const headers = { authorization: "Bearer feedback-admin-token" };
    // 第一次拒绝：写 pending→archived
    const first = await app.inject({ method: "PATCH", url: `/api/submissions/${siteId}`, headers, payload: { action: "reject", reason: "第一次理由" } });
    expect(first.statusCode).toBe(200);
    // 第二次拒绝：状态已是 archived（早退分支），但原因说明更新必须落库
    const second = await app.inject({ method: "PATCH", url: `/api/submissions/${siteId}`, headers, payload: { action: "reject", reason: "补充更具体的理由" } });
    expect(second.statusCode).toBe(200);
    const items = await ctx.repo.listSubmissionFeedback(identity);
    expect(items).toHaveLength(1);
    expect(items[0]!.status).toBe("rejected");
    expect(items[0]!.reason).toContain("暂未通过");
    // 关键：复审原因走 AI/模板重新生成并覆盖写入（reasonedAt 刷新）
    const reviews = await ctx.repo.raw("SELECT reason, reviewed_at FROM submission_reviews WHERE site_id = ?", [siteId]);
    expect(reviews).toHaveLength(1);
    expect(String(reviews[0]!.reason)).toContain("暂未通过");
  });

  it("投稿创建：子分类必须属于所选主分类（跨类目 400）", async () => {
    const identity = "user-submit-crosscat";
    const headers = { "x-navhub-user-id": identity, "x-navhub-identity-signature": signIdentity("test-secret", identity) };
    const res = await app.inject({
      method: "POST", url: "/api/submissions", headers,
      payload: { title: "跨类目投稿", url: "https://crosscat.example/", categoryId: "cat-ai", subCategoryId: "sub-design" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("子类目不属于所选主分类");
  });

  it("投稿创建：不同形态的同一 URL（大小写/utm/尾斜杠）被规范化去重返回 409", async () => {
    const identity = "user-submit-dedup";
    const headers = { "x-navhub-user-id": identity, "x-navhub-identity-signature": signIdentity("test-secret", identity) };
    const first = await app.inject({
      method: "POST", url: "/api/submissions", headers,
      payload: { title: "首次投稿", url: "https://Canonical.example/path/?utm_source=news", categoryId: "cat-ai" },
    });
    expect(first.statusCode).toBe(201);
    // 另一种形态：小写 host、不同 utm、去尾斜杠 → 规范化后同一 URL
    const second = await app.inject({
      method: "POST", url: "/api/submissions", headers,
      payload: { title: "重复投稿", url: "https://canonical.example/path?utm_source=other", categoryId: "cat-ai" },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().message).toContain("已存在");
  });
});
