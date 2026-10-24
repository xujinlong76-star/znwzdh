import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig, type AppConfig } from "../src/config.ts";
import {
  evaluatePluginAudit,
  executeAutoAuditAndPublish,
  autoRemediatePluginManifest,
} from "../src/ai-plugin-auditor.ts";
import type { PluginManifest } from "@navhub/core";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
let stub: Server;
let stubUrl: string;
/** 本地模型桩的应答，由各用例改写：既能测「模型说 approve/reject」，也能测「模型说胡话」 */
let stubReply: { status: number; content: string };
let baseQuota: AppConfig["llmQuota"];
let baseLlm: AppConfig["llm"];

const AUDIT_APPROVE = JSON.stringify({
  decision: "approve",
  complianceScore: 92,
  relevanceScore: 88,
  rationale: "收录站点与描述一致，未见仿冒与违规。",
  suggestions: ["建议补充图标版权说明"],
});

/**
 * 模型桩：OpenAI 兼容的 /chat/completions。
 *
 * 为什么要真起一个 HTTP 服务而不是塞 fetchImpl：审核链路里
 * `evaluatePluginAudit → callLlm → chatCompletion` 全程用的是全局 fetch，
 * 起桩能把「模型真的参与了审理」这条路径整段跑通——包括用量落库、
 * 报回来的模型名、以及 JSON 解析。否则测试只能覆盖「模型缺席」那一半，
 * 而缺席分支恰恰是这次改造里最需要对照的一半。
 */
function startStub(): Promise<number> {
  return new Promise((resolve) => {
    stub = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c as Buffer));
      req.on("end", () => {
        void chunks;
        res.writeHead(stubReply.status, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            model: "stub-audit-model",
            choices: [{ message: { content: stubReply.content } }],
            usage: { prompt_tokens: 400, completion_tokens: 60 },
          }),
        );
      });
    });
    stub.listen(0, "127.0.0.1", () => resolve((stub.address() as AddressInfo).port));
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-plugin-auditor-"));
  stubReply = { status: 200, content: AUDIT_APPROVE };
  const port = await startStub();
  stubUrl = `http://127.0.0.1:${port}/v1`;

  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "auditor.db"),
    auth: { enabled: false },
    embedding: { enabled: false },
    llm: {
      baseUrl: stubUrl,
      apiKey: "sk-stub",
      model: "stub-audit-model",
      timeoutMs: 5000,
      // 桩在本机回环上；系统级才允许私网（用户级始终禁私网）
      allowPrivateNetwork: true,
    },
  });
  ctx = await createContext(config);
  baseQuota = { ...ctx.config.llmQuota };
  baseLlm = { ...ctx.config.llm };
  app = await buildServer(ctx);
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  await new Promise((r) => stub.close(() => r(undefined)));
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // 忽略 Windows 上 SQLite 文件短暂占用
  }
});

beforeEach(() => {
  stubReply = { status: 200, content: AUDIT_APPROVE };
});

afterEach(() => {
  // 缺席类用例会就地改写 llm（apiKey / allowPrivateNetwork）与额度；
  // 必须整份还原，否则「回环桩 + allowPrivateNetwork=false」会让后面的
  // 用例在 SSRF 门前就失败，看起来像模型坏了。
  ctx.config.llmQuota = { ...baseQuota };
  ctx.config.llm = { ...baseLlm };
});

describe("AI 专业级自动化插件审查与审批引擎 (AI Plugin Auditor)", () => {
  const validSitePack: PluginManifest = {
    manifestVersion: 1,
    kind: "site-pack",
    name: "全球前沿 AI 生产力导航",
    description: "精选全球顶级人工智能开源大模型与开发者工具集，助力高质效科研与编码。",
    author: "AI Lab",
    version: "1.0.0",
    tags: ["人工智能", "大模型", "生产力"],
    payload: {
      categories: [{ title: "AI 模型平台" }],
      sites: [
        {
          url: "https://huggingface.co",
          title: "Hugging Face",
          description: "全球领先的开源机器学习与模型社区",
          category: "AI 模型平台",
          tags: ["开源", "模型"],
        },
        {
          url: "https://github.com",
          title: "GitHub",
          description: "全球最大开源代码托管与协作平台",
          category: "AI 模型平台",
          tags: ["代码", "开源"],
        },
      ],
    },
  };

  it("模型参与时：四维齐备、得分来自模型实测、判定 approve", async () => {
    const res = await evaluatePluginAudit(ctx, validSitePack);
    expect(res.decision).toBe("approve");
    expect(res.llmReviewed).toBe(true);
    expect(res.reviewSkipped).toBeNull();
    expect(res.scoreBasis).toBe("full");
    expect(res.dimensionScores.compliance).toBe(92);
    expect(res.dimensionScores.relevance).toBe(88);
    expect(res.level).toBe("safe");
    expect(res.checks.length).toBeGreaterThan(0);
  });

  it("报模型名要报真的：不存在硬编码的 agnes-3.0-flash 兜底", async () => {
    const res = await evaluatePluginAudit(ctx, validSitePack);
    expect(res.model).toBe("stub-audit-model");
    const rows = await ctx.repo.raw(
      "SELECT model FROM llm_usage WHERE scenario = 'plugin_audit' ORDER BY created_at DESC LIMIT 1",
    );
    expect(String(rows[0].model)).toBe("stub-audit-model");
  });

  it("模型判 reject 时一票否决，高分也不能上架", async () => {
    stubReply = {
      status: 200,
      content: JSON.stringify({ decision: "reject", complianceScore: 99, relevanceScore: 99, rationale: "仿冒知名品牌" }),
    };
    const res = await evaluatePluginAudit(ctx, { ...validSitePack, name: "疑似仿冒包" });
    expect(res.decision).toBe("reject");
    expect(res.llmReviewed).toBe(true);
  });

  it("模型返回不可解析内容：算「未审理」，不能靠假初值过审", async () => {
    stubReply = { status: 200, content: "这个插件看起来不错，建议通过。" };
    const res = await evaluatePluginAudit(ctx, { ...validSitePack, name: "模型说胡话测试包" });
    expect(res.llmReviewed).toBe(false);
    expect(res.reviewSkipped).toBe("error");
    expect(res.dimensionScores.compliance).toBeNull();
    expect(res.dimensionScores.relevance).toBeNull();
    expect(res.decision).toBe("pending_review");
    expect(res.scoreBasis).toBe("static_plus_probe");
  });

  it("静态安全沙箱：检出 javascript: 伪协议注入时立即裁决 reject 并严重扣分", async () => {
    const maliciousPack: PluginManifest = {
      ...validSitePack,
      name: "恶意测试插件",
      payload: {
        categories: [{ title: "测试" }],
        sites: [
          {
            url: "javascript:alert('xss')",
            title: "恶意脚本",
            category: "测试",
          },
        ],
      },
    };

    const res = await evaluatePluginAudit(ctx, maliciousPack);
    expect(res.decision).toBe("reject");
    expect(res.score).toBeLessThanOrEqual(50);
    expect(res.checks.some((c) => c.name.includes("代码注入") && !c.passed)).toBe(true);
  });

  it("内网穿透防护 (SSRF)：检出回环或内网私有地址时立即拦截", async () => {
    const ssrfPack: PluginManifest = {
      ...validSitePack,
      name: "内网穿透测试包",
      payload: {
        categories: [{ title: "测试" }],
        sites: [
          {
            url: "http://127.0.0.1:8080/admin",
            title: "私网管理台",
            category: "测试",
          },
        ],
      },
    };

    const res = await evaluatePluginAudit(ctx, ssrfPack);
    expect(res.decision).toBe("reject");
    expect(res.checks.some((c) => c.name.includes("内网穿透") && !c.passed)).toBe(true);
  });

  /* ------------------------------------------------------------------ *
   * 模型缺席：这是本次改造的核心。缺席时必须「不补分、不冒充、不越权决定」。
   * ------------------------------------------------------------------ */

  it("未配置模型：合规/相关性为 null，判定 pending_review 而不是假 95 分过审", async () => {
    ctx.config.llm = { ...ctx.config.llm, apiKey: null, allowPrivateNetwork: false };
    const res = await evaluatePluginAudit(ctx, { ...validSitePack, name: "无模型测试包" });

    expect(res.llmReviewed).toBe(false);
    expect(res.reviewSkipped).toBe("unconfigured");
    expect(res.dimensionScores.compliance).toBeNull();
    expect(res.dimensionScores.relevance).toBeNull();
    // 静态与探活两维真实测过 → 归一化后仍是高分，但结论只能是「交人工」
    expect(res.scoreBasis).toBe("static_plus_probe");
    expect(res.decision).toBe("pending_review");
    // 缺席时不得自称 safe：那等于用两维证据给四维结论盖章
    expect(res.level).not.toBe("safe");
    expect(res.rationale).toContain("未审理");
    expect(res.rationale).not.toContain("已通过安全合规研判");
    expect(res.checks.some((c) => c.skipped && !c.passed)).toBe(true);
  });

  it("额度用尽：同样不碰模型，缺席原因与额度明细都写进结论", async () => {
    ctx.config.llmQuota = { ...baseQuota, identityDailyCalls: 1 };
    await ctx.repo.recordLlmUsage({ scenario: "plugin_audit", source: "system", model: "stub-audit-model", ok: true, identity: "author-quota" });
    const before = Number((await ctx.repo.raw("SELECT COUNT(*) AS c FROM llm_usage"))[0].c);

    const res = await evaluatePluginAudit(ctx, { ...validSitePack, name: "额度耗尽测试包" }, { identity: "author-quota" });

    expect(res.llmReviewed).toBe(false);
    expect(res.reviewSkipped).toBe("quota");
    expect(res.decision).toBe("pending_review");
    expect(res.quota).toMatchObject({ scope: "identity", metric: "calls", limit: 1, used: 1 });
    expect(res.rationale).toContain("额度");
    // 拦住 = 一条用量都没多
    const after = Number((await ctx.repo.raw("SELECT COUNT(*) AS c FROM llm_usage"))[0].c);
    expect(after).toBe(before);
  });

  it("生命周期：模型缺席时 executeAutoAuditAndPublish 不把 pending 插件上架", async () => {
    ctx.config.llm = { ...ctx.config.llm, apiKey: null, allowPrivateNetwork: false };
    const plugin = await ctx.repo.createPlugin(
      {
        manifest: { ...validSitePack, name: "缺席不上架测试包" },
        author: "TestAuthor",
        ownerIdentity: "author-absent",
        source: "user",
        status: "pending",
      },
      { actor: "author-absent" },
    );

    const { plugin: after, audit } = await executeAutoAuditAndPublish(ctx, plugin, { identity: "author-absent" });
    expect(audit.decision).toBe("pending_review");
    expect(after.status).toBe("pending");
    expect(after.publishedAt).toBeNull();
    // 缺席结论要留痕，管理员在待审队列里看得见原因
    expect(after.reviewNote).toContain("pending_review");
    expect(String(after.reviewNote)).toContain("unconfigured");
  });

  it("已上架插件不因模型抖动被成片打下架（缺席时保持 published，只留痕）", async () => {
    const created = await executeAutoAuditAndPublish(
      ctx,
      await ctx.repo.createPlugin(
        {
          manifest: { ...validSitePack, name: "已上架复审测试包" },
          author: "TestAuthor",
          ownerIdentity: "author-revalidate",
          source: "user",
          status: "pending",
        },
        { actor: "author-revalidate" },
      ),
      { identity: "author-revalidate" },
    );
    expect(created.plugin.status).toBe("published");

    ctx.config.llm = { ...ctx.config.llm, apiKey: null, allowPrivateNetwork: false };
    const reloaded = await ctx.repo.getPluginBySlug(created.plugin.slug);
    const { plugin: after, audit } = await executeAutoAuditAndPublish(ctx, reloaded!, { identity: "author-revalidate" });
    expect(audit.decision).toBe("pending_review");
    expect(after.status).toBe("published");
  });

  it("生命周期闭环：模型在线时 executeAutoAuditAndPublish 自动将 pending 插件上架为 published", async () => {
    const plugin = await ctx.repo.createPlugin(
      {
        manifest: validSitePack,
        author: "TestAuthor",
        ownerIdentity: "author-test-id",
        source: "user",
        status: "pending",
      },
      { actor: "author-test-id" }
    );

    expect(plugin.status).toBe("pending");

    const { plugin: audited, audit } = await executeAutoAuditAndPublish(ctx, plugin, {
      identity: "author-test-id",
    });

    expect(audit.decision).toBe("approve");
    expect(audited.status).toBe("published");
    expect(audited.publishedAt).toBeTypeOf("number");

    // 读回确认数据库持久化
    const reloaded = await ctx.repo.getPluginBySlug(plugin.slug);
    expect(reloaded?.status).toBe("published");
    expect(reloaded?.reviewNote).toContain("approve");
  });

  it("接口集成：POST /api/plugins 带 autoAudit=true 提交后直接通过并返回 published 状态与 audit 报告", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/plugins?anonId=test-user-auto&autoAudit=true",
      payload: {
        manifest: {
          ...validSitePack,
          name: "自动审核集成测试包",
        },
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.status).toBe("published");
    expect(body.audit).toBeDefined();
    expect(body.audit.decision).toBe("approve");
    expect(body.audit.score).toBeGreaterThanOrEqual(75);
    expect(body.audit.dimensionScores).toBeDefined();

    // 详情接口能直接查询到该插件的审核报告
    const auditRes = await app.inject({
      method: "GET",
      url: `/api/plugins/${encodeURIComponent(body.slug)}/audit`,
    });
    expect(auditRes.statusCode).toBe(200);
    expect(auditRes.json().report.decision).toBe("approve");
  });

  it("接口集成：POST /api/plugins/:slug/ai-audit 端点支持对已有插件重新发起 AI 严审", async () => {
    // 先创建一个待审插件（不带 autoAudit）
    const created = await app.inject({
      method: "POST",
      url: "/api/plugins?anonId=test-user-manual",
      payload: {
        manifest: {
          ...validSitePack,
          name: "手动重审测试包",
        },
      },
    });
    expect(created.statusCode).toBe(201);
    const slug = created.json().slug;
    expect(created.json().status).toBe("pending");

    // 发起 AI 自动审核
    const auditTrigger = await app.inject({
      method: "POST",
      url: `/api/plugins/${encodeURIComponent(slug)}/ai-audit?anonId=test-user-manual`,
    });
    expect(auditTrigger.statusCode).toBe(200);
    const result = auditTrigger.json();
    expect(result.success).toBe(true);
    expect(result.plugin.status).toBe("published");
    expect(result.audit.decision).toBe("approve");

    // 已上架插件再次重审：审核通过时状态保持 published，不能因为
    // reviewPlugin 只接受 pending/delisted/quarantined 而 400。
    const reAudit = await app.inject({
      method: "POST",
      url: `/api/plugins/${encodeURIComponent(slug)}/ai-audit?anonId=test-user-manual`,
    });
    expect(reAudit.statusCode).toBe(200);
    expect(reAudit.json().plugin.status).toBe("published");
    expect(reAudit.json().audit.decision).toBe("approve");
  });

  it("清单自愈：autoRemediatePluginManifest 自动安全升级 HTTP 为 HTTPS 并去除重复 URL", () => {
    const uncleaned: PluginManifest = {
      manifestVersion: 1,
      kind: "site-pack",
      name: "  测试杂乱清单  ",
      version: "1.0.0",
      tags: ["AI", "AI", "模型"],
      payload: {
        categories: [],
        sites: [
          {
            url: "http://example.com/",
            title: "示例一",
          },
          {
            url: "https://example.com",
            title: "重复示例",
          },
        ],
      },
    };

    const { fixedManifest, changes } = autoRemediatePluginManifest(uncleaned);
    expect(fixedManifest.name).toBe("测试杂乱清单");
    expect(fixedManifest.description).toBeTruthy();
    expect(fixedManifest.tags).toEqual(["AI", "模型"]);
    const payload = fixedManifest.payload as { sites: Array<{ url: string; category: string }> };
    expect(payload.sites.length).toBe(1);
    expect(payload.sites[0].url).toBe("https://example.com");
    expect(changes.length).toBeGreaterThan(0);
  });

  it("接口集成：POST /api/plugins/pre-audit 和 /api/plugins/auto-fix 预检与自愈端点正常响应", async () => {
    // 1. 预检
    const preRes = await app.inject({
      method: "POST",
      url: "/api/plugins/pre-audit",
      payload: {
        manifest: validSitePack,
      },
    });
    expect(preRes.statusCode).toBe(200);
    expect(preRes.json().ok).toBe(true);
    expect(preRes.json().audit.decision).toBe("approve");

    // 2. 自动修复
    const fixRes = await app.inject({
      method: "POST",
      url: "/api/plugins/auto-fix",
      payload: {
        manifest: {
          ...validSitePack,
          name: "  待自动修复包  ",
          payload: {
            categories: [],
            sites: [{ url: "http://example.org", title: "测试" }],
          },
        },
      },
    });
    expect(fixRes.statusCode).toBe(200);
    const fixBody = fixRes.json();
    expect(fixBody.ok).toBe(true);
    expect(fixBody.changes.length).toBeGreaterThan(0);
    expect(fixBody.manifest.name).toBe("待自动修复包");
    expect(fixBody.manifest.payload.sites[0].url).toBe("https://example.org");
  });

  it("版本升级：POST /api/plugins/:slug/versions?autoAudit=true 提交新版本后自动严审上架", async () => {
    // 1. 创建并上架初始版本 v1.0.0
    const created = await app.inject({
      method: "POST",
      url: "/api/plugins?anonId=version-owner-auto&autoAudit=true",
      payload: {
        manifest: {
          ...validSitePack,
          name: "可升级版本测试包",
          version: "1.0.0",
        },
      },
    });
    expect(created.statusCode).toBe(201);
    const slug = created.json().slug;
    expect(created.json().status).toBe("published");

    // 2. 提交新版本 v1.1.0 带 autoAudit=true
    const versionRes = await app.inject({
      method: "POST",
      url: `/api/plugins/${encodeURIComponent(slug)}/versions?anonId=version-owner-auto&autoAudit=true`,
      payload: {
        manifest: {
          ...validSitePack,
          name: "可升级版本测试包",
          version: "1.1.0",
        },
        changelog: "升级至 v1.1.0，扩充模型工具",
      },
    });

    expect(versionRes.statusCode).toBe(200);
    const vBody = versionRes.json();
    expect(vBody.success).toBe(true);
    expect(vBody.status).toBe("published");
    expect(vBody.version).toBe("1.1.0");
    expect(vBody.audit.decision).toBe("approve");
  });
});
