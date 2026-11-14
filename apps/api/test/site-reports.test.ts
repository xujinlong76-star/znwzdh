import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

/**
 * 站点纠错上报（升级第 10 条）：
 *  - 匿名可报，不设登录门槛；上报只进复核队列，绝不直接改数据。
 *  - siteId 不存在 → 404；kinds 为空 → 400；detail 不在 5–2000 字 → 400。
 *  - 同一 IP 1 小时内超过 10 次 → 429。
 *  - 复核面只认管理员凭据（bootstrap token 全通）。
 */
const SECRET = "test-secret-site-reports-0123456789";
const BOOTSTRAP = "test-bootstrap-site-reports-0123456789abcdef";

const base = {
  mode: "lite" as const,
  embedding: {
    model: "Xenova/bge-small-zh-v1.5",
    endpoint: "https://hf-mirror.com",
    dtype: "q8",
    dim: 512,
    enabled: false,
  },
  llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
  fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
  corsOrigins: ["*"],
};

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
let siteId = "";

let seq = 0;
const inject = (opts: {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  payload?: unknown;
  ip?: string;
}) => {
  const { ip, ...rest } = opts;
  return app.inject({
    ...rest,
    remoteAddress: ip ?? `10.95.0.${(seq++ % 200) + 3}`,
  } as never);
};
const adminHeaders = { authorization: "Bearer " + BOOTSTRAP };
const validBody = {
  kinds: ["dead-link"],
  detail: "点开首页是 404，换了浏览器也一样。",
  source: "site-detail",
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-site-reports-"));
  ctx = await createContext(
    loadConfig({
      ...base,
      sqlitePath: join(dir, "reports.db"),
      identitySecret: SECRET,
      authRequired: true,
      bootstrapToken: BOOTSTRAP,
    }),
  );
  app = await buildServer(ctx);
  await app.ready();
  const categoryId = await ctx.repo.ensureUncategorized();
  const site = await ctx.repo.createSite({
    url: "https://report-target.example.com/",
    title: "待纠错站点",
    description: "用于上报测试的站点",
    categoryId,
  });
  siteId = site.id;
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/sites/:id/reports", () => {
  it("不存在的 siteId → 404", async () => {
    const res = await inject({
      method: "POST",
      url: "/api/sites/does-not-exist/reports",
      payload: validBody,
    });
    expect(res.statusCode, JSON.stringify(res.json())).toBe(404);
  });

  it("kinds 为空 → 400", async () => {
    const res = await inject({
      method: "POST",
      url: `/api/sites/${encodeURIComponent(siteId)}/reports`,
      payload: { ...validBody, kinds: [] },
    });
    expect(res.statusCode, JSON.stringify(res.json())).toBe(400);
  });

  it("kinds 含非法值 → 400", async () => {
    const res = await inject({
      method: "POST",
      url: `/api/sites/${encodeURIComponent(siteId)}/reports`,
      payload: { ...validBody, kinds: ["not-a-kind"] },
    });
    expect(res.statusCode, JSON.stringify(res.json())).toBe(400);
  });

  it("detail 太短（<5 字）→ 400", async () => {
    const res = await inject({
      method: "POST",
      url: `/api/sites/${encodeURIComponent(siteId)}/reports`,
      payload: { ...validBody, detail: "坏了" },
    });
    expect(res.statusCode, JSON.stringify(res.json())).toBe(400);
  });

  it("detail 超长（>2000 字）→ 400", async () => {
    const res = await inject({
      method: "POST",
      url: `/api/sites/${encodeURIComponent(siteId)}/reports`,
      payload: { ...validBody, detail: "描".repeat(2001) },
    });
    expect(res.statusCode, JSON.stringify(res.json())).toBe(400);
  });

  it("source 非法 → 400", async () => {
    const res = await inject({
      method: "POST",
      url: `/api/sites/${encodeURIComponent(siteId)}/reports`,
      payload: { ...validBody, source: "somewhere-else" },
    });
    expect(res.statusCode, JSON.stringify(res.json())).toBe(400);
  });

  it("合法上报 → 201 + { ok, id }，且站点本身未被改动", async () => {
    const before = await ctx.repo.getSite(siteId);
    const res = await inject({
      method: "POST",
      url: `/api/sites/${encodeURIComponent(siteId)}/reports`,
      payload: { ...validBody, kinds: ["wrong-description", "dead-link"], contact: "a@example.com" },
    });
    expect(res.statusCode, JSON.stringify(res.json())).toBe(201);
    const body = res.json() as { ok?: boolean; id?: string };
    expect(body.ok).toBe(true);
    expect(typeof body.id).toBe("string");
    const rows = (await ctx.repo.raw("SELECT * FROM site_reports WHERE id = ?", [body.id])) as Array<{
      site_id: string;
      kinds: string;
      detail: string;
      contact: string | null;
      source: string;
      status: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].site_id).toBe(siteId);
    expect(JSON.parse(rows[0].kinds)).toEqual(["wrong-description", "dead-link"]);
    expect(rows[0].detail).toBe(validBody.detail);
    expect(rows[0].contact).toBe("a@example.com");
    expect(rows[0].source).toBe("site-detail");
    expect(rows[0].status).toBe("open");
    // 上报绝不直接改数据：标题/描述/状态原样
    const after = await ctx.repo.getSite(siteId);
    expect(after?.title).toBe(before?.title);
    expect(after?.description).toBe(before?.description);
    expect(after?.status).toBe(before?.status);
  });

  it("同一 IP 1 小时内超过 10 次 → 429", async () => {
    const ip = "10.96.7.7";
    for (let i = 0; i < 10; i++) {
      const res = await inject({
        method: "POST",
        url: `/api/sites/${encodeURIComponent(siteId)}/reports`,
        payload: { ...validBody, detail: `第 ${i + 1} 次上报：链接打不开。` },
        ip,
      });
      expect(res.statusCode, JSON.stringify(res.json())).toBe(201);
    }
    const limited = await inject({
      method: "POST",
      url: `/api/sites/${encodeURIComponent(siteId)}/reports`,
      payload: { ...validBody, detail: "第 11 次上报：链接打不开。" },
      ip,
    });
    expect(limited.statusCode, JSON.stringify(limited.json())).toBe(429);
  });
});

describe("复核面 /api/admin/site-reports", () => {
  let reportId = "";

  it("先上报一条待复核", async () => {
    const res = await inject({
      method: "POST",
      url: `/api/sites/${encodeURIComponent(siteId)}/reports`,
      payload: { ...validBody, detail: "复核面测试：描述里的功能早已下线。", kinds: ["wrong-description"] },
    });
    expect(res.statusCode).toBe(201);
    reportId = (res.json() as { id: string }).id;
    expect(reportId.length).toBeGreaterThan(0);
  });

  it("匿名读复核列表 → 401/403", async () => {
    const res = await inject({ method: "GET", url: "/api/admin/site-reports" });
    expect([401, 403]).toContain(res.statusCode);
  });

  it("管理员读默认 open 列表，含刚上报那条", async () => {
    const res = await inject({
      method: "GET",
      url: "/api/admin/site-reports",
      headers: adminHeaders,
    });
    expect(res.statusCode, JSON.stringify(res.json())).toBe(200);
    const body = res.json() as { items: Array<{ id: string; status: string; siteTitle: string }> };
    expect(body.items.some((i) => i.id === reportId)).toBe(true);
    for (const item of body.items) expect(item.status).toBe("open");
    const hit = body.items.find((i) => i.id === reportId);
    expect(hit?.siteTitle).toBe("待纠错站点");
  });

  it("非法 status 筛选 → 400", async () => {
    const res = await inject({
      method: "GET",
      url: "/api/admin/site-reports?status=bogus",
      headers: adminHeaders,
    });
    expect(res.statusCode).toBe(400);
  });

  it("流转 open → in_progress → resolved，非法状态 → 400，不存在的上报 → 404", async () => {
    const bad = await inject({
      method: "PATCH",
      url: `/api/admin/site-reports/${encodeURIComponent(reportId)}`,
      headers: adminHeaders,
      payload: { status: "done" },
    });
    expect(bad.statusCode).toBe(400);

    const missing = await inject({
      method: "PATCH",
      url: "/api/admin/site-reports/does-not-exist",
      headers: adminHeaders,
      payload: { status: "resolved" },
    });
    expect(missing.statusCode).toBe(404);

    const step1 = await inject({
      method: "PATCH",
      url: `/api/admin/site-reports/${encodeURIComponent(reportId)}`,
      headers: adminHeaders,
      payload: { status: "in_progress" },
    });
    expect(step1.statusCode, JSON.stringify(step1.json())).toBe(200);
    expect((step1.json() as { status: string }).status).toBe("in_progress");

    const step2 = await inject({
      method: "PATCH",
      url: `/api/admin/site-reports/${encodeURIComponent(reportId)}`,
      headers: adminHeaders,
      payload: { status: "resolved" },
    });
    expect(step2.statusCode, JSON.stringify(step2.json())).toBe(200);
    const rows = (await ctx.repo.raw("SELECT status FROM site_reports WHERE id = ?", [reportId])) as Array<{
      status: string;
    }>;
    expect(rows[0].status).toBe("resolved");
  });

  it("匿名 PATCH → 401/403", async () => {
    const res = await inject({
      method: "PATCH",
      url: `/api/admin/site-reports/${encodeURIComponent(reportId)}`,
      payload: { status: "rejected" },
    });
    expect([401, 403]).toContain(res.statusCode);
  });
});
