/**
 * A-1 回归：下架/待审插件的内容不得通过版本/评价/审计端点公开读取。
 *
 * 详情页门禁（p2-detail-and-tools.ts）对非 published 的非作者/非管理员返回 404，
 * 但版本列表、版本详情、评价列表与 GET audit 三处只查插件是否存在、不查 status，
 * 导致详情 404 的插件仍能通过这三处被拉走完整 manifest、评价全文与审计评分。
 *
 * 夹具（authRequired 鉴权实例 + identitySecret 签名身份）：
 *   - a1-delisted-pack：上架 → 安装 1 站 → 评价 1 条 → 下架（delisted），
 *     版本快照 1.0.0 含完整 manifest；
 *   - a1-pending-pack：待审首发包（无版本快照，audit 仍对外亮分）；
 *   - a1-published-pack：已上架对照包，匿名仍须 200（不过度拦截）。
 *
 * 门禁口径与详情页一致：status !== "published" 时仅作者本人与管理员可读，
 * 其余一律 404（不区分 pending / rejected / delisted / quarantined）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateAndCleanPluginManifest } from "@navhub/core";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";

const SECRET = "a1-status-gate-test-secret";
const BOOTSTRAP = "a1-boot-secret-please-rotate";
const ADMIN_STATIC = "a1-admin-static-please-rotate";

const OWNER = "anon-author-a1";
const INSTALLER = "anon-installer-a1";
const STRANGER = "anon-stranger-a1";
const SECRET_URL = "https://delisted-secret-a1.example.com/only-here";
const SECRET_REVIEW = "真实评价全文-A1-SECRET-REVIEW";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
let adminToken = "";

function sitePackManifest(name: string, urls: string[]) {
  const raw = {
    manifestVersion: 1,
    kind: "site-pack",
    name,
    description: "A-1 状态门禁回归测试用网址包",
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

function signedHeaders(identity: string) {
  return {
    "x-navhub-anon-id": identity,
    "x-navhub-identity-signature": signIdentity(SECRET, identity),
  };
}

const anonGet = (url: string) => app.inject({ method: "GET", url });
const ownerGet = (url: string) => app.inject({ method: "GET", url, headers: signedHeaders(OWNER) });
const strangerGet = (url: string) => app.inject({ method: "GET", url, headers: signedHeaders(STRANGER) });
const adminGet = (url: string) =>
  app.inject({ method: "GET", url, headers: { authorization: `Bearer ${adminToken}` } });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-plugin-a1-gate-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "a1.db"),
    authRequired: true,
    bootstrapToken: BOOTSTRAP,
    adminToken: ADMIN_STATIC,
    identitySecret: SECRET,
    embedding: { enabled: false },
  } as never);
  ctx = await createContext(config);
  app = await buildServer(ctx);
  await app.ready();

  // 管理员令牌：bootstrap 换 admin scope 库内 token
  const minted = await app.inject({
    method: "POST",
    url: "/api/tokens",
    payload: { name: "a1-admin", scopes: "admin" },
    headers: { authorization: `Bearer ${BOOTSTRAP}` },
  });
  expect(minted.statusCode).toBe(201);
  adminToken = minted.json().token as string;

  // 下架包：上架（写版本快照）→ 安装 → 评价 → 下架
  await ctx.repo.createPlugin(
    {
      manifest: sitePackManifest("A1 下架包", [SECRET_URL]),
      slug: "a1-delisted-pack",
      status: "published",
      source: "seed",
      author: "A1 作者",
      ownerIdentity: OWNER,
    },
    { actor: "test", actorKind: "system" },
  );
  await ctx.repo.installPlugin("a1-delisted-pack", INSTALLER, {
    actor: INSTALLER,
    actorKind: "identity",
  });
  await ctx.repo.createPluginReview(
    "a1-delisted-pack",
    INSTALLER,
    { rating: 5, title: "好用", content: SECRET_REVIEW },
    { actor: INSTALLER, actorKind: "identity" },
  );
  const delisted = await ctx.repo.reviewPlugin("a1-delisted-pack", "delist", "A-1 测试下架", {
    actor: "admin",
    actorKind: "admin",
  });
  expect(delisted.status).toBe("delisted");

  // 待审首发包：无版本快照，但 audit 仍会亮分、reviews 仍 200
  await ctx.repo.createPlugin(
    {
      manifest: sitePackManifest("A1 待审包", ["https://pending-a1.example.com/only-here"]),
      slug: "a1-pending-pack",
      status: "pending",
      source: "user",
      author: "A1 作者",
      ownerIdentity: OWNER,
    },
    { actor: "test", actorKind: "system" },
  );

  // 已上架对照包：匿名四端点必须保持 200
  await ctx.repo.createPlugin(
    {
      manifest: sitePackManifest("A1 已上架包", ["https://published-a1.example.com/only-here"]),
      slug: "a1-published-pack",
      status: "published",
      source: "seed",
      author: "A1 作者",
      ownerIdentity: OWNER,
    },
    { actor: "test", actorKind: "system" },
  );
});

afterAll(async () => {
  await app?.close();
  await ctx?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("A-1：下架/待审插件版本·评价·审计端点状态门禁", () => {
  it("匿名：下架包详情 404，而 versions / versions/1.0.0 / reviews / audit 须同为 404", async () => {
    const detail = await anonGet("/api/plugins/a1-delisted-pack");
    expect(detail.statusCode).toBe(404);

    const versions = await anonGet("/api/plugins/a1-delisted-pack/versions");
    expect(versions.statusCode).toBe(404);

    const version = await anonGet("/api/plugins/a1-delisted-pack/versions/1.0.0");
    expect(version.statusCode).toBe(404);
    expect(version.body).not.toContain(SECRET_URL);

    const reviews = await anonGet("/api/plugins/a1-delisted-pack/reviews");
    expect(reviews.statusCode).toBe(404);
    expect(reviews.body).not.toContain(SECRET_REVIEW);
    expect(reviews.body).not.toContain(INSTALLER);

    const audit = await anonGet("/api/plugins/a1-delisted-pack/audit");
    expect(audit.statusCode).toBe(404);
  });

  it("匿名：待审包 audit 不得对外亮分，versions / reviews 不得 200", async () => {
    const detail = await anonGet("/api/plugins/a1-pending-pack");
    expect(detail.statusCode).toBe(404);

    const audit = await anonGet("/api/plugins/a1-pending-pack/audit");
    expect(audit.statusCode).toBe(404);
    expect(audit.body).not.toContain('"score"');

    const versions = await anonGet("/api/plugins/a1-pending-pack/versions");
    expect(versions.statusCode).toBe(404);

    const reviews = await anonGet("/api/plugins/a1-pending-pack/reviews");
    expect(reviews.statusCode).toBe(404);
  });

  it("作者本人：下架包四端点仍可读，且版本含完整 manifest、评价含全文与身份串", async () => {
    const versions = await ownerGet("/api/plugins/a1-delisted-pack/versions");
    expect(versions.statusCode).toBe(200);
    expect(versions.json().versions).toHaveLength(1);
    expect(versions.json().versions[0].version).toBe("1.0.0");

    const version = await ownerGet("/api/plugins/a1-delisted-pack/versions/1.0.0");
    expect(version.statusCode).toBe(200);
    expect(JSON.stringify(version.json().manifest)).toContain(SECRET_URL);

    const reviews = await ownerGet("/api/plugins/a1-delisted-pack/reviews");
    expect(reviews.statusCode).toBe(200);
    expect(reviews.json().total).toBe(1);
    expect(reviews.json().items[0].content).toBe(SECRET_REVIEW);
    expect(reviews.json().items[0].identity).toBe(INSTALLER);

    const audit = await ownerGet("/api/plugins/a1-delisted-pack/audit");
    expect(audit.statusCode).toBe(200);
    expect(audit.json().report.slug).toBe("a1-delisted-pack");
  });

  it("管理员：下架包四端点可读", async () => {
    for (const url of [
      "/api/plugins/a1-delisted-pack/versions",
      "/api/plugins/a1-delisted-pack/versions/1.0.0",
      "/api/plugins/a1-delisted-pack/reviews",
      "/api/plugins/a1-delisted-pack/audit",
    ]) {
      const res = await adminGet(url);
      expect(res.statusCode).toBe(200);
    }
  });

  it("陌生签名用户：下架包四端点均为 404", async () => {
    for (const url of [
      "/api/plugins/a1-delisted-pack/versions",
      "/api/plugins/a1-delisted-pack/versions/1.0.0",
      "/api/plugins/a1-delisted-pack/reviews",
      "/api/plugins/a1-delisted-pack/audit",
    ]) {
      const res = await strangerGet(url);
      expect(res.statusCode).toBe(404);
    }
  });

  it("已上架包：匿名四端点仍为 200（不过度拦截）", async () => {
    for (const url of [
      "/api/plugins/a1-published-pack/versions",
      "/api/plugins/a1-published-pack/versions/1.0.0",
      "/api/plugins/a1-published-pack/reviews",
      "/api/plugins/a1-published-pack/audit",
    ]) {
      const res = await anonGet(url);
      expect(res.statusCode).toBe(200);
    }
  });
});
