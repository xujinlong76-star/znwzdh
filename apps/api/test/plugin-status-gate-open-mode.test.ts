/**
 * A 批开放模式口径一致性：开放模式（authRequired=false，非生产默认）下，匿名身份
 * 按设计持有全部 scope（apps/api/src/auth.ts 的 ANONYMOUS_IDENTITY，actor "api"），
 * 即开放模式下匿名等同运营者本人——isAdminScope 对匿名返回 true。
 *
 * 因此 A-1 门禁在开放模式下对匿名同样放行（实测：下架包 versions / reviews /
 * audit 匿名均为 200），A 批门禁必须与之同一口径，不能一处放行、一处拦截。
 * 本文件锁定的就是这种“口径一致”：开放模式匿名调用时，A-1 端点与 A 批端点
 * 对同一插件返回同一状态；真正的门禁（非作者非管理员 404）由鉴权实例证明，
 * 见 plugin-status-gate-a1.test.ts（那里的匿名是无特权的，hook 先给 401，
 * 持票陌生人则吃门禁 404）。
 *
 * 夹具与 plugin-status-gate-a1.test.ts 同构（下架包/待审包/已上架包各一，
 * 下架包与已上架包各补一条“上架时做过体检”的审计行）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateAndCleanPluginManifest } from "@navhub/core";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

const SECRET = "a-gates-open-mode-test-secret";
const BOOTSTRAP = "a-gates-open-boot-secret";
const SECRET_URL = "https://delisted-secret-open.example.com/only-here";
const PENDING_URL = "https://pending-open.example.com/only-here";
const PUBLISHED_URL = "https://published-open.example.com/only-here";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
let openDelistedJobId = "";
let openPendingJobId = "";
let openPublishedJobId = "";

function sitePackManifest(name: string, urls: string[]) {
  const raw = {
    manifestVersion: 1,
    kind: "site-pack",
    name,
    description: "A 批开放模式门禁回归测试用网址包",
    version: "1.0.0",
    tags: ["测试"],
    payload: {
      categories: [{ title: "插件测试类目" }],
      sites: urls.map((url, i) => ({ url, title: `测试站点 ${i}`, category: "插件测试类目" })),
    },
  };
  const validated = validateAndCleanPluginManifest(raw as never);
  if (!validated.ok) throw new Error(`测试清单不合法：${validated.errors.join("; ")}`);
  return validated.manifest;
}

const anonGet = (url: string) => app.inject({ method: "GET", url });
const anonPost = (url: string, payload: unknown) => app.inject({ method: "POST", url, payload });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-plugin-a-gates-open-"));
  // 体检任务队列落盘位置改走临时目录，避免与其他测试文件共享任务记录。
  process.env.NAVHUB_AUDIT_QUEUE_PATH = join(dir, "audit-jobs.json");
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "open.db"),
    authRequired: false,
    bootstrapToken: BOOTSTRAP,
    identitySecret: SECRET,
    embedding: { enabled: false },
  } as never);
  ctx = await createContext(config);
  app = await buildServer(ctx);
  await app.ready();

  await ctx.repo.createPlugin(
    {
      manifest: sitePackManifest("开放模式下架包", [SECRET_URL]),
      slug: "open-delisted-pack",
      status: "published",
      source: "seed",
      author: "开放作者",
      ownerIdentity: "anon-author-open",
    },
    { actor: "test", actorKind: "system" },
  );
  const delisted = await ctx.repo.reviewPlugin("open-delisted-pack", "delist", "开放模式测试下架", {
    actor: "admin",
    actorKind: "admin",
  });
  expect(delisted.status).toBe("delisted");
  await ctx.repo.audit({
    actor: "test",
    actorKind: "system",
    action: "audit.plugin_url_audit",
    target: "open-delisted-pack",
    diff: { slug: "open-delisted-pack", declared: 1, sampled: 1, ok: 0, blocked: 0, suspicious: 0, broken: 1, reachability: 0 },
  });

  await ctx.repo.createPlugin(
    {
      manifest: sitePackManifest("开放模式待审包", [PENDING_URL]),
      slug: "open-pending-pack",
      status: "pending",
      source: "user",
      author: "开放作者",
      ownerIdentity: "anon-author-open",
    },
    { actor: "test", actorKind: "system" },
  );

  await ctx.repo.createPlugin(
    {
      manifest: sitePackManifest("开放模式已上架包", [PUBLISHED_URL]),
      slug: "open-published-pack",
      status: "published",
      source: "seed",
      author: "开放作者",
      ownerIdentity: "anon-author-open",
    },
    { actor: "test", actorKind: "system" },
  );
  await ctx.repo.audit({
    actor: "test",
    actorKind: "system",
    action: "audit.plugin_url_audit",
    target: "open-published-pack",
    diff: { slug: "open-published-pack", declared: 1, sampled: 1, ok: 1, blocked: 0, suspicious: 0, broken: 0, reachability: 100 },
  });

  // url-health 任务端点夹具（与 A-1 文件同构）：三包各一个体检任务。
  for (const [slug, url] of [
    ["open-delisted-pack", SECRET_URL],
    ["open-pending-pack", PENDING_URL],
    ["open-published-pack", PUBLISHED_URL],
  ] as const) {
    const enqueued = await anonPost("/api/plugins/url-health/jobs", { slug, urls: [url] });
    expect(enqueued.statusCode).toBe(202);
    const id = enqueued.json().id as string;
    if (slug === "open-delisted-pack") openDelistedJobId = id;
    if (slug === "open-pending-pack") openPendingJobId = id;
    if (slug === "open-published-pack") openPublishedJobId = id;
  }
}, 120_000);

afterAll(async () => {
  // 等后台 worker 落盘停稳再删临时目录（与 A-1 文件同理：删早了 save 会抛未处理异常）。
  const { getAuditQueue } = await import("../src/audit-queue-service.ts");
  const queue = await getAuditQueue();
  const deadline = Date.now() + 60_000;
  for (;;) {
    const jobs = await queue.list();
    if (!jobs.some((j) => j.state === "running")) break;
    if (Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  await new Promise((r) => setTimeout(r, 500));
  await app?.close();
  await ctx?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("A 批开放模式：A-1 与 A 批端点对同一插件返回同一状态", () => {
  const otherTarget = () => sitePackManifest("目标包", ["https://other-open.example.com/x"]);

  it("下架包：A-1 端点与 A 批端点匿名均为 200（开放模式匿名等同运营者）", async () => {
    // A-1 端点先行：若这里不是 200，说明口径假设已变，下面的 A 批断言须重审。
    for (const url of [
      "/api/plugins/open-delisted-pack/versions",
      "/api/plugins/open-delisted-pack/reviews",
      "/api/plugins/open-delisted-pack/audit",
    ]) {
      const res = await anonGet(url);
      expect(res.statusCode).toBe(200);
    }
    // A 批端点与之同一口径。
    const diff = await anonPost("/api/plugins/diff", {
      slug: "open-delisted-pack",
      targetManifest: otherTarget(),
    });
    expect(diff.statusCode).toBe(200);
    expect(diff.body).toContain(SECRET_URL);

    const audit = await anonPost("/api/plugins/open-delisted-pack/audit", { limit: 1 });
    expect(audit.statusCode).toBe(200);
    const heal = await anonPost("/api/plugins/open-delisted-pack/ai-heal", { brokenUrls: [SECRET_URL] });
    expect(heal.statusCode).toBe(200);
    const diagnose = await anonPost("/api/plugins/open-delisted-pack/url-deep-diagnose", { url: SECRET_URL });
    expect(diagnose.statusCode).toBe(200);
    for (const path of ["overlap", "url-health", "health", "url-health/history"]) {
      const res = await anonGet(`/api/plugins/open-delisted-pack/${path}`);
      expect(res.statusCode).toBe(200);
    }
  }, 60_000);

  it("待审包：A-1 端点与 A 批端点匿名状态一致", async () => {
    const a1 = await anonGet("/api/plugins/open-pending-pack/audit");
    const batch = await anonPost("/api/plugins/open-pending-pack/ai-heal", { brokenUrls: [PENDING_URL] });
    expect(a1.statusCode).toBe(batch.statusCode);
  });

  it("批量 /health 与 summary：下架包在开放模式下可见（与已上架包同形）", async () => {
    const batch = await anonGet("/api/plugins/health?slugs=open-delisted-pack,open-published-pack");
    expect(batch.statusCode).toBe(200);
    const bySlug = new Map(batch.json().items.map((i: { slug: string }) => [i.slug, i]));
    // 开放模式匿名等同运营者：下架包带真实体检时间，不按“从未体检”形态返回。
    expect((bySlug.get("open-delisted-pack") as { auditedAt: unknown }).auditedAt).not.toBeNull();
    expect((bySlug.get("open-published-pack") as { auditedAt: unknown }).auditedAt).not.toBeNull();

    const summary = await anonGet("/api/plugins/url-health/summary");
    expect(summary.statusCode).toBe(200);
    expect(summary.json().summaries["open-delisted-pack"]).toBeDefined();
    expect(summary.json().summaries["open-published-pack"]).toBeDefined();
  });

  it("任务端点：已上架包任务匿名可读；下架包任务与其它 A-1 端点同口径可见", async () => {
    const list = await anonGet("/api/plugins/url-health/jobs");
    expect(list.statusCode).toBe(200);
    const slugs = (list.json().items as Array<{ slug: string }>).map((i) => i.slug);
    expect(slugs).toContain("open-published-pack");
    // 开放模式匿名等同运营者（见文件头注释）：下架包任务与 summary/health 同口径可见，
    // 门禁的真正拦截由鉴权实例证明（见 plugin-status-gate-a1.test.ts）。
    expect(slugs).toContain("open-delisted-pack");
    expect(slugs).toContain("open-pending-pack");

    const published = await anonGet(`/api/plugins/url-health/jobs/${openPublishedJobId}`);
    expect(published.statusCode).toBe(200);
    expect(published.json().job.urls).toContain(PUBLISHED_URL);
    const delisted = await anonGet(`/api/plugins/url-health/jobs/${openDelistedJobId}`);
    expect(delisted.statusCode).toBe(200);
    expect(delisted.json().job.urls).toContain(SECRET_URL);
  });
});
