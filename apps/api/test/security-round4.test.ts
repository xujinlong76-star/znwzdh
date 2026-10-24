import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { sanitizeSnapshotHtml } from "../src/routes/archive.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
let sharedSiteId: string;
let sharedCatId: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-sec4-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    embedding: {
      model: "Xenova/bge-small-zh-v1.5",
      endpoint: "https://hf-mirror.com",
      dtype: "q8",
      cacheDir: join(dir, "models"),
      dim: 512,
      enabled: false,
    },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    authRequired: false,
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);

  const rootCat = await ctx.repo.createCategory({ title: "Root Category" });
  const subCat = await ctx.repo.createCategory({ title: "Sub Category", parentId: rootCat.id });
  sharedCatId = subCat.id;

  const site = await ctx.repo.createSite({
    title: "Test Site",
    url: "https://example.com/test-site",
    categoryId: subCat.id,
    tags: ["tech", "tools"],
  });
  sharedSiteId = site.id;
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("第四轮安全与逻辑缺陷守卫", () => {
  it("PUT /api/sites/:id/facets 限制分面键值长度与数量防数据库膨胀", async () => {
    // 超过 50 个分面键
    const tooManyFacets: Record<string, string[]> = {};
    for (let i = 0; i < 55; i++) {
      tooManyFacets[`key_${i}`] = ["val"];
    }

    const resOver = await app.inject({
      method: "PUT",
      url: `/api/sites/${sharedSiteId}/facets`,
      payload: { facets: tooManyFacets },
    });
    expect(resOver.statusCode).toBe(400);

    // 超长 key
    const resLongKey = await app.inject({
      method: "PUT",
      url: `/api/sites/${sharedSiteId}/facets`,
      payload: { facets: { ["a".repeat(60)]: ["val"] } },
    });
    expect(resLongKey.statusCode).toBe(400);

    // 合法分面顺利落库
    const resOk = await app.inject({
      method: "PUT",
      url: `/api/sites/${sharedSiteId}/facets`,
      payload: { facets: { pricing: ["free", "open-source"] } },
    });
    expect(resOk.statusCode).toBe(200);
    const stored = await ctx.repo.getSiteFacets(sharedSiteId);
    expect(stored.pricing).toContain("free");
  });

  it("POST /api/plugins/taps 阻止非法协议与私有/内网/回环/重绑定/高危端口地址（SSRF 防御）", async () => {
    // 非法协议
    const resProto = await app.inject({
      method: "POST",
      url: "/api/plugins/taps",
      payload: { name: "Bad Tap", url: "ftp://127.0.0.1/plugins.json" },
    });
    expect(resProto.statusCode).toBe(400);

    // 回环地址
    const resLoop = await app.inject({
      method: "POST",
      url: "/api/plugins/taps",
      payload: { name: "Loop Tap", url: "http://127.0.0.1:8080/plugins.json" },
    });
    expect(resLoop.statusCode).toBe(400);

    // 云元数据服务地址
    const resMeta = await app.inject({
      method: "POST",
      url: "/api/plugins/taps",
      payload: { name: "Meta Tap", url: "http://169.254.169.254/latest/meta-data" },
    });
    expect(resMeta.statusCode).toBe(400);

    // IPv6 回环与 IPv4 映射 IPv6
    const resIpv6 = await app.inject({
      method: "POST",
      url: "/api/plugins/taps",
      payload: { name: "IPv6 Tap", url: "http://[::1]:8080/plugins.json" },
    });
    expect(resIpv6.statusCode).toBe(400);

    const resMappedIpv6 = await app.inject({
      method: "POST",
      url: "/api/plugins/taps",
      payload: { name: "Mapped IPv6 Tap", url: "http://[::ffff:127.0.0.1]/plugins.json" },
    });
    expect(resMappedIpv6.statusCode).toBe(400);

    // nip.io 泛解析私网域名与高危端口
    const resNipIo = await app.inject({
      method: "POST",
      url: "/api/plugins/taps",
      payload: { name: "NipIo Tap", url: "http://127.0.0.1.nip.io/plugins.json" },
    });
    expect(resNipIo.statusCode).toBe(400);

    const resRedisPort = await app.inject({
      method: "POST",
      url: "/api/plugins/taps",
      payload: { name: "Redis Port Tap", url: "https://plugins.example.com:6379/plugins.json" },
    });
    expect(resRedisPort.statusCode).toBe(400);
  });

  it("sanitizeSnapshotHtml 拦截 SVG onload、HTML 实体混淆伪协议与未闭合 script 注入", () => {
    const dirty = [
      '<p>正文段落</p>',
      '<svg onload="alert(1)"><circle r="10"/></svg>',
      '<a href="&#106;avascript:alert(document.cookie)">伪协议链接</a>',
      '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">Data链接</a>',
      '<img src="x" onerror=`alert(1)` />',
      '<script src="https://evil.example/xss.js">',
    ].join("\n");
    const cleaned = sanitizeSnapshotHtml(dirty);
    expect(cleaned).toContain("<p>正文段落</p>");
    expect(cleaned).not.toContain("<svg");
    expect(cleaned).not.toContain("onload");
    expect(cleaned).not.toContain("onerror");
    expect(cleaned).not.toContain("<script");
    expect(cleaned).not.toContain("&#106;avascript:");
    expect(cleaned).not.toContain("data:text/html");
    expect(cleaned).toContain('href="#"');
  });

  it("POST /api/plugins/:slug/report 限制举报理由最大长度为 500 字符", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/non-existent-plugin/report",
      payload: { reason: "x".repeat(501) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("500");
  });

  it("POST /api/backup/restore 过滤危险伪协议链接并记录 audit 审计", async () => {
    const backupData = {
      version: "1.0",
      generator: "NavHub Test",
      exportedAt: Date.now(),
      categories: [{ id: "cat-restore-1", title: "安全冷备分类", sort: 1 }],
      sites: [
        {
          id: "site-restore-1",
          title: "Safe Restored Site",
          url: "https://restored.example.com",
          categoryId: "cat-restore-1",
        },
        {
          id: "site-restore-2",
          title: "XSS Injected Site",
          url: "javascript:alert(localStorage.getItem('token'))",
          categoryId: "cat-restore-1",
        },
      ],
      stats: { categoryCount: 1, siteCount: 2 },
    };

    const res = await app.inject({
      method: "POST",
      url: "/api/backup/restore?dryRun=false",
      payload: backupData,
    });
    expect(res.statusCode).toBe(200);

    // 危险链接被安全忽略，只恢复合法链接
    const safeSite = await ctx.repo.findSiteByUrl("https://restored.example.com");
    expect(safeSite).toBeDefined();
    const badSite = await ctx.repo.findSiteByUrl("javascript:alert(localStorage.getItem('token'))");
    expect(badSite).toBeNull();

    // 检查记录了 backup.restore 审计日志
    const audits = await ctx.repo.raw(
      "SELECT * FROM audit_logs WHERE action = 'backup.restore' ORDER BY created_at DESC LIMIT 1",
    );
    expect(audits.length).toBe(1);
    expect(audits[0].target).toBe("backup");
  });

  it("GET /api/ready 脱敏数据库错误信息，防止泄露内网地址与凭据", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/ready",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.db.ok).toBe(true);
    // 正常状态无 error 字段
    expect(body.db.error).toBeUndefined();
  });
});
