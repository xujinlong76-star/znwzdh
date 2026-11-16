/**
 * A 批开放模式口径一致性：生产默认是开放模式（authRequired=false），匿名身份
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
}, 120_000);

afterAll(async () => {
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
});
