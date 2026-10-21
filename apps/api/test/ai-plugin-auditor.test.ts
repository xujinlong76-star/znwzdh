import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import {
  evaluatePluginAudit,
  executeAutoAuditAndPublish,
  autoRemediatePluginManifest,
} from "../src/ai-plugin-auditor.ts";
import type { PluginManifest } from "@navhub/core";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-plugin-auditor-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "auditor.db"),
    auth: { enabled: false },
    embedding: { enabled: false },
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // 忽略 Windows 上 SQLite 文件短暂占用
  }
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

  it("多维严审：合规优质插件得分 >= 80，判定为 approve", async () => {
    const res = await evaluatePluginAudit(ctx, validSitePack);
    expect(res.decision).toBe("approve");
    expect(res.score).toBeGreaterThanOrEqual(80);
    expect(res.dimensionScores.security).toBe(100);
    expect(res.dimensionScores.compliance).toBeGreaterThanOrEqual(70);
    expect(res.level).toBe("safe");
    expect(res.checks.length).toBeGreaterThan(0);
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

  it("生命周期闭环：executeAutoAuditAndPublish 自动将 pending 插件上架为 published", async () => {
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

