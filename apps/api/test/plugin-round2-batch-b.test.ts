/**
 * 插件市场第二轮 B 批（管理与信任修复）永久测试。
 *
 * 每项先由 apps/api/test/scratch-b-repro.test.ts 复现（8/8 成立），
 * 本文件断言修复后的行为；scratch 已删，不进提交。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
let adminToken: string;

const BOOTSTRAP = "b-bootstrap-token-please-rotate";
const SECRET = "b-identity-secret-please-rotate";
const ADMIN_STATIC = "b-admin-static-please-rotate";

const OWNER = "anon-author-b";
const INSTALLER = "anon-installer-b";
const OTHER = "anon-other-b";

const sitePackV1 = {
  manifestVersion: 1,
  kind: "site-pack",
  name: "B 版本包",
  description: "B 批回滚复现：v1 有 A、B 两站",
  icon: "📦",
  author: "B 复现",
  license: "MIT",
  version: "1.0.0",
  tags: ["测试"],
  payload: {
    sites: [
      { title: "B 站 A", url: "https://b-site-a.example.com/", description: "A" },
      { title: "B 站 B", url: "https://b-site-b.example.com/", description: "B" },
    ],
    categories: [],
  },
};

const sitePackV2 = {
  ...sitePackV1,
  version: "2.0.0",
  description: "B 批回滚复现：v2 把 B 换成 C",
  payload: {
    sites: [
      { title: "B 站 A", url: "https://b-site-a.example.com/", description: "A" },
      { title: "B 站 C", url: "https://b-site-c.example.com/", description: "C" },
    ],
    categories: [],
  },
};

const darkPack = {
  manifestVersion: 1,
  kind: "theme",
  name: "B 深色包",
  description: "B 批待审新版复现",
  icon: "🌑",
  author: "B 复现",
  license: "MIT",
  version: "1.0.0",
  tags: ["深色", "主题"],
  payload: { tokens: { background: "#111111", foreground: "#eeeeee" } },
};

const darkPackV11 = { ...darkPack, version: "1.1.0", payload: { tokens: { background: "#000000", foreground: "#ffffff" } } };

const reviewPack = {
  manifestVersion: 1,
  kind: "theme",
  name: "B 评价包",
  description: "B 批评价删改复现",
  icon: "⭐",
  author: "B 复现",
  license: "MIT",
  version: "1.0.0",
  tags: ["主题"],
  payload: { tokens: { background: "#222222", foreground: "#dddddd" } },
};

async function createPublished(slug: string, manifest: Record<string, unknown>, owner = OWNER) {
  const plugin = await ctx.repo.createPlugin(
    {
      manifest: manifest as never,
      author: "B 复现",
      authorKind: "identity",
      ownerIdentity: owner,
      source: "user",
      status: "published",
      slug,
    },
    { actor: owner, actorKind: "identity" },
  );
  return plugin;
}

function signedHeaders(identity: string) {
  return {
    "x-navhub-anon-id": identity,
    "x-navhub-identity-signature": signIdentity(SECRET, identity),
  };
}

async function adminPost(url: string, body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url,
    headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
    payload: JSON.stringify(body),
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-plugin-batch-b-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "batch-b.db"),
    authRequired: true,
    bootstrapToken: BOOTSTRAP,
    adminToken: ADMIN_STATIC,
    identitySecret: SECRET,
    embedding: { model: "none", endpoint: "", dtype: "q8", dim: 512, cacheDir: join(dir, "models"), enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubBatchBTest/0.1" },
    corsOrigins: ["*"],
  } as never);
  ctx = await createContext(config);
  app = await buildServer(ctx);
  await app.ready();
  const minted = await app.inject({
    method: "POST",
    url: "/api/tokens",
    payload: { name: "b-admin", scopes: "admin" },
    headers: { authorization: `Bearer ${BOOTSTRAP}` },
  });
  expect(minted.statusCode).toBe(201);
  adminToken = minted.json().token as string;

  // b-version-pack：上架 v1 → 用户装 v1 → 作者提交 v2 → 审核上架 v2 → 用户升级到 v2
  const vp = await createPublished("b-version-pack", sitePackV1);
  await ctx.repo.installPlugin("b-version-pack", INSTALLER, { actor: INSTALLER, actorKind: "identity" });
  await ctx.repo.submitPluginVersion("b-version-pack", sitePackV2 as never, "v2：B 换成 C", {
    actor: OWNER,
    actorKind: "identity",
  });
  await ctx.repo.reviewPlugin("b-version-pack", "approve", "B 复现上架 v2", { actor: "admin", actorKind: "admin" });
  await ctx.repo.installPlugin("b-version-pack", INSTALLER, { actor: INSTALLER, actorKind: "identity" });
  void vp;

  // b-dark-pack：已上架 1.0.0，挂待审新版 1.1.0（shadow pending）
  await createPublished("b-dark-pack", darkPack);
  await ctx.repo.submitPluginVersion("b-dark-pack", darkPackV11 as never, "v1.1.0 待审", {
    actor: OWNER,
    actorKind: "identity",
  });

  // b-rejected：已驳回的插件（C-1）
  const rejected = await ctx.repo.createPlugin(
    {
      manifest: darkPack as never,
      author: "B 复现",
      authorKind: "identity",
      ownerIdentity: OWNER,
      source: "user",
      status: "pending",
      slug: "b-rejected",
    },
    { actor: OWNER, actorKind: "identity" },
  );
  void rejected;
  await ctx.repo.reviewPlugin("b-rejected", "reject", "B 复现驳回", { actor: "admin", actorKind: "admin" });

  // b-review-pack：评价删改夹具
  await createPublished("b-review-pack", reviewPack);
  await ctx.repo.installPlugin("b-review-pack", INSTALLER, { actor: INSTALLER, actorKind: "identity" });
  await ctx.repo.installPlugin("b-review-pack", OTHER, { actor: OTHER, actorKind: "identity" });
  await ctx.repo.createPluginReview("b-review-pack", INSTALLER, { rating: 5, title: "很好", content: "初版评价" });
  await ctx.repo.createPluginReview("b-review-pack", OTHER, { rating: 4, title: "不错", content: "他人评价" });
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("B 批：管理与信任修复", () => {
  it("C-1：已驳回插件可以重新审核上架（路由 + 存储层）", async () => {
    const res = await adminPost("/api/plugins/b-rejected/review", { action: "approve", note: "误驳回，重新上架" });
    expect(res.statusCode).toBe(200);
    const plugin = await ctx.repo.getPluginBySlug("b-rejected");
    expect(plugin?.status).toBe("published");
  });

  it("B-1：真实回滚——装回 v1 后新版独有站 C 消失、旧版站 B 回来，版本号与实际一致", async () => {
    // 另一身份仍装着 v2 时，删不干净就不能写旧版本号：直接拒绝
    await ctx.repo.installPlugin("b-version-pack", OTHER, { actor: OTHER, actorKind: "identity" });
    await expect(
      ctx.repo.rollbackPlugin("b-version-pack", INSTALLER, "1.0.0", { actor: INSTALLER, actorKind: "identity" }),
    ).rejects.toThrow(/其他用户仍在使用新版/);
    await ctx.repo.uninstallPlugin("b-version-pack", OTHER, {}, { actor: OTHER, actorKind: "identity" });

    const result = await ctx.repo.rollbackPlugin("b-version-pack", INSTALLER, "1.0.0", {
      actor: INSTALLER,
      actorKind: "identity",
    });
    expect(result.rolledBackFrom).toBe("2.0.0");
    expect(result.rolledBackTo).toBe("1.0.0");
    expect(result.install.version).toBe("1.0.0");
    expect(result.sitesRemoved).toBe(1);
    expect(await ctx.repo.findSiteByUrl("https://b-site-c.example.com/")).toBeNull();
    expect(await ctx.repo.findSiteByUrl("https://b-site-b.example.com/")).not.toBeNull();

    // 目标不低于已装版本不是回滚：拒绝（升级走安装）
    await expect(
      ctx.repo.rollbackPlugin("b-version-pack", INSTALLER, "2.0.0", { actor: INSTALLER, actorKind: "identity" }),
    ).rejects.toThrow(/不低于已安装版本/);
    // 回滚路由同样可用：1.0.0 → 先升回 2.0.0 再经路由滚回 1.0.0
    await ctx.repo.installPlugin("b-version-pack", INSTALLER, { actor: INSTALLER, actorKind: "identity" });
    const viaRoute = await app.inject({
      method: "POST",
      url: "/api/plugins/b-version-pack/rollback?version=1.0.0",
      headers: signedHeaders(INSTALLER),
    });
    expect(viaRoute.statusCode).toBe(200);
    const body = JSON.parse(viaRoute.body) as { rolledBackTo: string; sitesRemoved: number };
    expect(body.rolledBackTo).toBe("1.0.0");
    expect(body.sitesRemoved).toBe(1);
  });

  it("B-3：卸载后仍可修改自己的评价；删除真实可用且他人删不了；列表带 installedNow", async () => {
    // 卸载后修改自己的评价：不再被锁死
    await ctx.repo.uninstallPlugin("b-review-pack", INSTALLER, {}, { actor: INSTALLER, actorKind: "identity" });
    const updated = await app.inject({
      method: "POST",
      url: "/api/plugins/b-review-pack/reviews",
      headers: { ...signedHeaders(INSTALLER), "content-type": "application/json" },
      payload: JSON.stringify({ rating: 4, title: "改后", content: "卸载后改的错字" }),
    });
    expect(updated.statusCode).toBe(201);
    expect((JSON.parse(updated.body) as { review: { content: string } }).review.content).toBe("卸载后改的错字");

    // 他人删我的评价：403
    const myReview = await ctx.repo.getUserPluginReview(
      (await ctx.repo.getPluginBySlug("b-review-pack"))!.id,
      INSTALLER,
    );
    const forbidden = await app.inject({
      method: "DELETE",
      url: `/api/plugins/b-review-pack/reviews/${myReview!.id}`,
      headers: signedHeaders(OTHER),
    });
    expect(forbidden.statusCode).toBe(403);

    // 列表：我的评价 installedNow=false（已卸载），他人的=true
    const list = await app.inject({ method: "GET", url: "/api/plugins/b-review-pack/reviews" });
    const items = (JSON.parse(list.body) as { items: { identity: string; installedNow: boolean }[] }).items;
    expect(items.find((i) => i.identity === INSTALLER)?.installedNow).toBe(false);
    expect(items.find((i) => i.identity === OTHER)?.installedNow).toBe(true);

    // 本人删除：200，之后读不到
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/plugins/b-review-pack/reviews/${myReview!.id}`,
      headers: signedHeaders(INSTALLER),
    });
    expect(deleted.statusCode).toBe(200);
    expect(await ctx.repo.getUserPluginReview((await ctx.repo.getPluginBySlug("b-review-pack"))!.id, INSTALLER)).toBeNull();
  });

  it("C-2：公开列表不再透传 pendingManifest；作者中心与管理端能看到待审新版本", async () => {
    const pub = await app.inject({ method: "GET", url: "/api/plugins?q=%E6%B7%B1%E8%89%B2%E5%8C%85" });
    expect(pub.statusCode).toBe(200);
    const item = (JSON.parse(pub.body) as { items: Record<string, unknown>[] }).items.find(
      (i) => i.slug === "b-dark-pack",
    );
    expect(item).toBeTruthy();
    expect(item).not.toHaveProperty("pendingVersion");
    expect(item).not.toHaveProperty("pendingManifest");

    // 作者中心（ownerView）：能看到待审新版本
    const mine = await app.inject({
      method: "GET",
      url: "/api/plugins/mine",
      headers: signedHeaders(OWNER),
    });
    const mineItem = (JSON.parse(mine.body) as { items: Record<string, unknown>[] }).items.find(
      (i) => i.slug === "b-dark-pack",
    );
    expect(mineItem?.pendingVersion).toBe("1.1.0");

    // 管理端：待审新版本计数 + 筛选
    const admin = await app.inject({
      method: "GET",
      url: "/api/admin/plugins?hasPendingVersion=true",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const adminBody = JSON.parse(admin.body) as {
      items: Record<string, unknown>[];
      pendingVersionCount: number;
    };
    expect(adminBody.pendingVersionCount).toBeGreaterThanOrEqual(1);
    expect(adminBody.items.some((i) => i.slug === "b-dark-pack" && i.pendingVersion === "1.1.0")).toBe(true);
  });

  it("C-4：审核通知是人话、带插件链接；relay 后通知列表能读到 link", async () => {
    const reviewed = await adminPost("/api/plugins/b-dark-pack/review", { action: "approve", note: "B 复现批新版" });
    expect(reviewed.statusCode).toBe(200);
    const outbox = await ctx.repo.raw(
      "SELECT identity, kind, title, body, link FROM notification_outbox WHERE kind = 'plugin_approved' ORDER BY created_at DESC LIMIT 1",
    );
    expect(outbox.length).toBe(1);
    const row = outbox[0]!;
    expect(String(row.body)).toContain("B 深色包");
    expect(String(row.body)).toContain("已通过审核并上架");
    expect(() => JSON.parse(String(row.body))).toThrow();
    expect(String(row.link)).toBe("/marketplace/b-dark-pack");

    const relayed = await ctx.repo.relayNotifications();
    expect(relayed.delivered).toBeGreaterThanOrEqual(1);
    const page = await ctx.repo.listNotificationsPage(String(row.identity), 50, 0, false);
    const note = page.items.find((n) => n.kind === "plugin_approved");
    expect(note?.body).toContain("B 深色包");
    expect(note?.link).toBe("/marketplace/b-dark-pack");
  });

  it("R2A-1：q 里的 #标签 真实参与查询；?tag= 同口径", async () => {
    const byHash = await app.inject({ method: "GET", url: "/api/plugins?q=%23%E6%B7%B1%E8%89%B2" });
    const hashItems = (JSON.parse(byHash.body) as { items: { slug: string }[] }).items;
    expect(hashItems.some((i) => i.slug === "b-dark-pack")).toBe(true);

    const byParam = await app.inject({ method: "GET", url: "/api/plugins?tag=%E6%B7%B1%E8%89%B2" });
    const paramItems = (JSON.parse(byParam.body) as { items: { slug: string }[] }).items;
    expect(paramItems.some((i) => i.slug === "b-dark-pack")).toBe(true);

    // 文本 + 标签组合：名称命中且标签命中
    const combined = await app.inject({ method: "GET", url: "/api/plugins?q=%E6%B7%B1%E8%89%B2%E5%8C%85%20%23%E4%B8%BB%E9%A2%98" });
    const combinedItems = (JSON.parse(combined.body) as { items: { slug: string }[] }).items;
    expect(combinedItems.some((i) => i.slug === "b-dark-pack")).toBe(true);

    // 不存在的标签：诚实返回 0
    const none = await app.inject({ method: "GET", url: "/api/plugins?q=%23%E4%B8%8D%E5%AD%98%E5%9C%A8%E7%9A%84%E6%A0%87%E7%AD%BE" });
    expect((JSON.parse(none.body) as { total: number }).total).toBe(0);
  });

  it("R2A-2：featured=true 能返回真实精选（setPluginFeatured + 列表过滤）", async () => {
    await ctx.repo.setPluginFeatured("b-dark-pack", true, 1, { actor: "admin", actorKind: "admin" });
    await ctx.repo.setPluginFeatured("b-version-pack", true, 2, { actor: "admin", actorKind: "admin" });
    const res = await app.inject({ method: "GET", url: "/api/plugins?featured=true" });
    const items = (JSON.parse(res.body) as { items: { slug: string }[] }).items;
    expect(items.map((i) => i.slug)).toEqual(["b-dark-pack", "b-version-pack"]);
  });
});
