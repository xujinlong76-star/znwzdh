/**
 * 待找（/api/me/wanted）：建/列/删、去重、上限、匿名 401、审核通过匹配通知。
 *
 * 审核匹配用开放模式 + 管理员直批（开放模式无 scope 门槛，见
 * submission-review-separation.test.ts）；indexSite 在测试里 mock 掉，
 * 避免审核去抓外网。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";
import * as siteIndexer from "../src/index-site.ts";

const SECRET = "test-secret-wanted-searches-0123456789";
const USER = "github:u-wanted";
const OTHER = "github:u-wanted-other";
const SUBMITTER = "github:u-wanted-submitter";

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
let categoryId: string;

const headersFor = (identity: string) => ({
  "x-navhub-user-id": identity,
  "x-navhub-identity-signature": signIdentity(SECRET, identity),
});

const outbox = (identity: string, kind?: string) =>
  ctx.repo.raw(
    "SELECT * FROM notification_outbox WHERE identity = ?" + (kind ? " AND kind = ?" : "") + " ORDER BY created_at, id",
    kind ? [identity, kind] : [identity],
  );

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-wanted-searches-"));
  ctx = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "test.db"), identitySecret: SECRET }));
  app = await buildServer(ctx);
  await app.ready();
  categoryId = await ctx.repo.ensureUncategorized();
  vi.spyOn(siteIndexer, "indexSite").mockImplementation(async () => undefined);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("/api/me/wanted 基础", () => {
  it("匿名 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me/wanted" });
    expect(res.statusCode).toBe(401);
  });

  it("空串 / 超长拒 400", async () => {
    const h = headersFor(USER);
    const empty = await app.inject({ method: "POST", url: "/api/me/wanted", headers: h, payload: { query: "   " } });
    expect(empty.statusCode).toBe(400);
    const long = await app.inject({ method: "POST", url: "/api/me/wanted", headers: h, payload: { query: "x".repeat(257) } });
    expect(long.statusCode).toBe(400);
  });

  it("建 / 列 / 删 + 同用户同查询去重（第二次 200 + duplicate: true）", async () => {
    const h = headersFor(USER);
    const a = await app.inject({ method: "POST", url: "/api/me/wanted", headers: h, payload: { query: "知乎" } });
    expect(a.statusCode).toBe(201);
    expect(a.json().item.query).toBe("知乎");
    const dup = await app.inject({ method: "POST", url: "/api/me/wanted", headers: h, payload: { query: "知乎" } });
    expect(dup.statusCode).toBe(200);
    expect(dup.json().duplicate).toBe(true);
    expect(dup.json().item.id).toBe(a.json().item.id);
    const list = await app.inject({ method: "GET", url: "/api/me/wanted", headers: h });
    expect(list.json().items.filter((i: { query: string }) => i.query === "知乎")).toHaveLength(1);
    const del = await app.inject({ method: "DELETE", url: `/api/me/wanted/${a.json().item.id}`, headers: h });
    expect(del.json()).toMatchObject({ ok: true, removed: true });
    const gone = await app.inject({ method: "DELETE", url: `/api/me/wanted/${a.json().item.id}`, headers: h });
    expect(gone.json()).toMatchObject({ ok: true, removed: false });
  });

  it("上限 20 条 open：21 条拒 409", async () => {
    const h = headersFor(OTHER);
    for (let i = 0; i < 20; i += 1) {
      const res = await app.inject({ method: "POST", url: "/api/me/wanted", headers: h, payload: { query: `待找词${i}` } });
      expect(res.statusCode).toBe(201);
    }
    const over = await app.inject({ method: "POST", url: "/api/me/wanted", headers: h, payload: { query: "待找词20" } });
    expect(over.statusCode).toBe(409);
  });
});

describe("/api/me/wanted 审核通过匹配通知", () => {
  it("approve 匹配站 → 恰好一条 wanted_site_found 通知 + 行变 notified；不匹配站无通知", async () => {
    const h = headersFor(USER);
    const wanted = await app.inject({ method: "POST", url: "/api/me/wanted", headers: h, payload: { query: "知乎" } });
    expect(wanted.statusCode).toBe(201);
    const nomatch = await app.inject({ method: "POST", url: "/api/me/wanted", headers: h, payload: { query: "不存在的词xyz" } });
    expect(nomatch.statusCode).toBe(201);

    const sub = await app.inject({
      method: "POST",
      url: "/api/submissions",
      headers: headersFor(SUBMITTER),
      payload: { title: "知乎问答", url: "https://zhihu-new.example.test/qa", categoryId },
    });
    expect(sub.statusCode, sub.body).toBe(201);
    const siteId = sub.json().siteId as string;
    const review = await app.inject({ method: "PATCH", url: `/api/submissions/${siteId}`, payload: { action: "approve" } });
    expect(review.statusCode, review.body).toBe(200);

    const notices = await outbox(USER, "wanted_site_found");
    expect(notices).toHaveLength(1);
    expect(String(notices[0].title)).toContain("知乎");
    expect(String(notices[0].title)).toContain("知乎问答");
    const list = await app.inject({ method: "GET", url: "/api/me/wanted", headers: h });
    const row = list.json().items.find((i: { query: string }) => i.query === "知乎");
    expect(row.status).toBe("notified");
    expect(row.notifiedSiteId).toBe(siteId);
    const other = list.json().items.find((i: { query: string }) => i.query === "不存在的词xyz");
    expect(other.status).toBe("open");
  });

  it("同一待找被两个站先后匹配 → 只通知第一次", async () => {
    const before = await outbox(USER, "wanted_site_found");
    expect(before).toHaveLength(1);
    const sub = await app.inject({
      method: "POST",
      url: "/api/submissions",
      headers: headersFor(SUBMITTER),
      payload: { title: "知乎日报", url: "https://zhihu-daily.example.test/", categoryId },
    });
    expect(sub.statusCode, sub.body).toBe(201);
    const review = await app.inject({ method: "PATCH", url: `/api/submissions/${sub.json().siteId}`, payload: { action: "approve" } });
    expect(review.statusCode).toBe(200);
    expect(await outbox(USER, "wanted_site_found")).toHaveLength(1);
  });
});
