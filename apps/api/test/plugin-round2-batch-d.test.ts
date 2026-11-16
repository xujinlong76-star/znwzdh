/**
 * 插件市场第二轮 D 批（功能缺口 R5 前 8 + B-3 遗留）永久测试。
 *
 * 每项先由 apps/api/test/scratch-d-repro.test.ts 复现（9/9 成立），
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
import { validateAndCleanPluginManifest, checkPluginCompat } from "@navhub/core";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
let adminToken: string;

const BOOTSTRAP = "d-bootstrap-token-please-rotate";
const SECRET = "d-identity-secret-please-rotate";
const ADMIN_STATIC = "d-admin-static-please-rotate";

const OWNER = "anon-author-d";
const INSTALLER = "anon-installer-d";
const OTHER = "anon-other-d";

const updatePackV1 = {
  manifestVersion: 1,
  kind: "site-pack",
  name: "D 更新包",
  description: "D 批更新提醒复现：v1",
  icon: "📦",
  author: "D 复现",
  license: "MIT",
  version: "1.0.0",
  tags: ["测试"],
  payload: {
    sites: [{ title: "D 站 A", url: "https://d-site-a.example.com/", description: "A" }],
    categories: [],
  },
};

const updatePackV2 = {
  ...updatePackV1,
  version: "1.1.0",
  description: "D 批更新提醒复现：v2",
};

const searchPackA = {
  manifestVersion: 1,
  kind: "search-pack",
  name: "D 搜索包 A",
  description: "D 批冲突复现 A",
  icon: "🔍",
  author: "D 复现",
  license: "MIT",
  version: "1.0.0",
  tags: ["搜索"],
  payload: {
    engines: [{ name: "A 引擎", prefix: "!dpack", searchUrl: "https://a.example.com/search?q={q}" }],
  },
};

const searchPackB = {
  manifestVersion: 1,
  kind: "search-pack",
  name: "D 搜索包 B",
  description: "D 批冲突复现 B（同前缀不同地址）",
  icon: "🔍",
  author: "D 复现",
  license: "MIT",
  version: "1.0.0",
  tags: ["搜索"],
  payload: {
    engines: [{ name: "B 引擎", prefix: "!dpack", searchUrl: "https://b.example.com/search?q={q}" }],
  },
};

const compatPack = {
  manifestVersion: 1,
  kind: "theme",
  name: "D 兼容包",
  description: "D 批兼容复现：要求 NavHub 99.0.0",
  icon: "🎨",
  author: "D 复现",
  license: "MIT",
  version: "1.0.0",
  tags: ["主题"],
  compat: { minAppVersion: "99.0.0" },
  screenshots: ["https://shots.example.com/1.png", "https://shots.example.com/2.png"],
  donateUrl: "https://donate.example.com/d-author",
  payload: { tokens: { "--background": "0 0% 100%", "--foreground": "0 0% 10%" } },
};

const sitePackA = {
  manifestVersion: 1,
  kind: "site-pack",
  name: "D 站点包 A",
  description: "D 批站点冲突复现 A",
  icon: "📦",
  author: "D 复现",
  license: "MIT",
  version: "1.0.0",
  tags: ["测试"],
  payload: {
    sites: [
      { title: "D 共享站", url: "https://d-shared.example.com/", description: "共享" },
      { title: "D 站 A 独有", url: "https://d-site-a-only.example.com/", description: "A" },
    ],
    categories: [],
  },
};

const sitePackB = {
  manifestVersion: 1,
  kind: "site-pack",
  name: "D 站点包 B",
  description: "D 批站点冲突复现 B（同站不同包）",
  icon: "📦",
  author: "D 复现",
  license: "MIT",
  version: "1.0.0",
  tags: ["测试"],
  payload: {
    sites: [{ title: "D 共享站（B 包）", url: "https://d-shared.example.com/", description: "共享" }],
    categories: [],
  },
};

const trendPack = {
  manifestVersion: 1,
  kind: "site-pack",
  name: "D 趋势包",
  description: "D 批安装趋势复现",
  icon: "📈",
  author: "D 复现",
  license: "MIT",
  version: "1.0.0",
  tags: ["测试"],
  payload: {
    sites: [{ title: "D 趋势站", url: "https://d-trend-only.example.com/", description: "趋势" }],
    categories: [],
  },
};

const reviewPack = {
  manifestVersion: 1,
  kind: "theme",
  name: "D 评价包",
  description: "D 批 B-3 复现",
  icon: "⭐",
  author: "D 复现",
  license: "MIT",
  version: "1.0.0",
  tags: ["主题"],
  payload: { tokens: { "--background": "0 0% 100%", "--foreground": "0 0% 10%" } },
};

async function createPublished(slug: string, manifest: Record<string, unknown>, owner = OWNER) {
  return ctx.repo.createPlugin(
    {
      manifest: manifest as never,
      author: "D 复现",
      authorKind: "identity",
      ownerIdentity: owner,
      source: "user",
      status: "published",
      slug,
    },
    { actor: owner, actorKind: "identity" },
  );
}

function signedHeaders(identity: string) {
  return {
    "x-navhub-anon-id": identity,
    "x-navhub-identity-signature": signIdentity(SECRET, identity),
  };
}

async function postJson(url: string, body: Record<string, unknown>, identity?: string) {
  return app.inject({
    method: "POST",
    url,
    headers: {
      ...(identity ? signedHeaders(identity) : {}),
      "content-type": "application/json",
    },
    payload: JSON.stringify(body),
  });
}

/** 安装路由的 plugin_install_success 事件是 fire-and-forget 写库，等它落库再断言 */
async function waitForEvent(slug: string, timeoutMs = 5000): Promise<boolean> {
  const started = Date.now();
  for (;;) {
    const rows = await ctx.repo.raw(
      "SELECT id FROM events WHERE kind = 'plugin_install_success' AND meta LIKE ?",
      [`%"slug":"${slug}"%`],
    );
    if (rows.length > 0) return true;
    if (Date.now() - started > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-plugin-batch-d-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "batch-d.db"),
    authRequired: true,
    bootstrapToken: BOOTSTRAP,
    adminToken: ADMIN_STATIC,
    identitySecret: SECRET,
    embedding: { model: "none", endpoint: "", dtype: "q8", dim: 512, cacheDir: join(dir, "models"), enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubBatchDTest/0.1" },
    corsOrigins: ["*"],
  } as never);
  ctx = await createContext(config);
  app = await buildServer(ctx);
  await app.ready();
  const minted = await app.inject({
    method: "POST",
    url: "/api/tokens",
    payload: { name: "d-admin", scopes: "admin" },
    headers: { authorization: `Bearer ${BOOTSTRAP}` },
  });
  expect(minted.statusCode).toBe(201);
  adminToken = minted.json().token as string;

  // d-update-pack：上架 v1 → 用户装 v1 → 作者提交 v2（shadow）→ 审核上架 v2
  // （审核 approve 时 R5-1 提醒已触发，写进 notification_outbox）
  await createPublished("d-update-pack", updatePackV1);
  await ctx.repo.installPlugin("d-update-pack", INSTALLER, { actor: INSTALLER, actorKind: "identity" });
  await ctx.repo.submitPluginVersion("d-update-pack", updatePackV2 as never, "v1.1.0", {
    actor: OWNER,
    actorKind: "identity",
  });
  await ctx.repo.reviewPlugin("d-update-pack", "approve", "D 复现上架 v2", { actor: "admin", actorKind: "admin" });

  // d-search-a/b：同前缀不同地址的两包；A 已装
  await createPublished("d-search-a", searchPackA);
  await createPublished("d-search-b", searchPackB);
  await ctx.repo.installPlugin("d-search-a", INSTALLER, { actor: INSTALLER, actorKind: "identity" });

  // d-site-a/b：同站不同包；A 已装
  await createPublished("d-site-a", sitePackA);
  await createPublished("d-site-b", sitePackB);
  await ctx.repo.installPlugin("d-site-a", INSTALLER, { actor: INSTALLER, actorKind: "identity" });

  // d-compat-pack：声明需要 NavHub 99.0.0
  await createPublished("d-compat-pack", compatPack);

  // d-trend-pack：趋势夹具（走 HTTP 安装，事件才落库）
  await createPublished("d-trend-pack", trendPack);

  // d-pending-pack：待审包（趋势接口应 404，不泄露安装史）
  await ctx.repo.createPlugin(
    {
      manifest: trendPack as never,
      author: "D 复现",
      authorKind: "identity",
      ownerIdentity: OWNER,
      source: "user",
      status: "pending",
      slug: "d-pending-pack",
    },
    { actor: OWNER, actorKind: "identity" },
  );

  // d-review-pack：评价夹具（B-3）
  await createPublished("d-review-pack", reviewPack);
  await ctx.repo.installPlugin("d-review-pack", INSTALLER, { actor: INSTALLER, actorKind: "identity" });
  await ctx.repo.installPlugin("d-review-pack", OTHER, { actor: OTHER, actorKind: "identity" });
  await ctx.repo.createPluginReview("d-review-pack", INSTALLER, { rating: 5, title: "很好", content: "初版评价" });
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("D 批：功能缺口 R5 前 8 + B-3 遗留", () => {
  it("R5-1：新版本上架后，已安装用户收到更新提醒；版本号不变的重上架不重复提醒", async () => {
    const plugin = await ctx.repo.getPluginBySlug("d-update-pack");
    expect(plugin?.version).toBe("1.1.0");
    const rows = await ctx.repo.raw(
      "SELECT identity, kind, title, body, link FROM notification_outbox WHERE identity = ? AND kind = 'plugin_update_available'",
      [INSTALLER],
    );
    expect(rows.length).toBe(1);
    expect(String(rows[0]!.title)).toContain("1.1.0");
    expect(rows[0]!.link).toBe("/marketplace/installed");

    // 没装过这包的用户不收到提醒
    const otherRows = await ctx.repo.raw(
      "SELECT id FROM notification_outbox WHERE identity = ? AND kind = 'plugin_update_available'",
      [OTHER],
    );
    expect(otherRows.length).toBe(0);

    // 下架再上架、版本号不变：不新增提醒（幂等键 + 版本未递增双重保障）
    await ctx.repo.reviewPlugin("d-update-pack", "delist", "D 复现下架复测", { actor: "admin", actorKind: "admin" });
    await ctx.repo.reviewPlugin("d-update-pack", "approve", "D 复现重新上架", { actor: "admin", actorKind: "admin" });
    const rowsAfter = await ctx.repo.raw(
      "SELECT id FROM notification_outbox WHERE identity = ? AND kind = 'plugin_update_available'",
      [INSTALLER],
    );
    expect(rowsAfter.length).toBe(1);
    expect((await ctx.repo.getPluginBySlug("d-update-pack"))?.status).toBe("published");
  });

  it("禁用开关：禁用/启用走路由，installed 列表带 disabled 字段，幂等", async () => {
    const disabled = await postJson("/api/plugins/d-update-pack/disable", {}, INSTALLER);
    expect(disabled.statusCode).toBe(200);
    const disabledBody = JSON.parse(disabled.body) as { success: boolean; disabled: boolean; changed: boolean };
    expect(disabledBody.success).toBe(true);
    expect(disabledBody.disabled).toBe(true);
    expect(disabledBody.changed).toBe(true);

    const installed = await app.inject({
      method: "GET",
      url: "/api/plugins/installed",
      headers: signedHeaders(INSTALLER),
    });
    expect(installed.statusCode).toBe(200);
    const item = (JSON.parse(installed.body) as { items: { slug: string; disabled: boolean; disabledAt: number | null }[] }).items.find(
      (i) => i.slug === "d-update-pack",
    );
    expect(item?.disabled).toBe(true);
    expect(typeof item?.disabledAt).toBe("number");

    // 重复禁用：幂等，不报错、changed=false
    const disabledAgain = await postJson("/api/plugins/d-update-pack/disable", {}, INSTALLER);
    expect(disabledAgain.statusCode).toBe(200);
    expect((JSON.parse(disabledAgain.body) as { changed: boolean }).changed).toBe(false);

    const enabled = await postJson("/api/plugins/d-update-pack/enable", {}, INSTALLER);
    expect(enabled.statusCode).toBe(200);
    expect((JSON.parse(enabled.body) as { disabled: boolean; changed: boolean }).disabled).toBe(false);
    expect((JSON.parse(enabled.body) as { changed: boolean }).changed).toBe(true);

    const installedAfter = await app.inject({
      method: "GET",
      url: "/api/plugins/installed",
      headers: signedHeaders(INSTALLER),
    });
    const itemAfter = (JSON.parse(installedAfter.body) as { items: { slug: string; disabled: boolean; disabledAt: number | null }[] }).items.find(
      (i) => i.slug === "d-update-pack",
    );
    expect(itemAfter?.disabled).toBe(false);
    expect(itemAfter?.disabledAt).toBeNull();

    // 没装过的插件禁不了；无身份 400；伪造签名 401
    const neverInstalled = await postJson("/api/plugins/d-compat-pack/disable", {}, INSTALLER);
    expect(neverInstalled.statusCode).toBe(400);
    const anon = await postJson("/api/plugins/d-update-pack/disable", {});
    expect(anon.statusCode).toBe(400);
    const forged = await app.inject({
      method: "POST",
      url: "/api/plugins/d-update-pack/disable",
      headers: {
        "x-navhub-anon-id": INSTALLER,
        "x-navhub-identity-signature": signIdentity("wrong-secret-please-rotate", INSTALLER),
        "content-type": "application/json",
      },
      payload: JSON.stringify({}),
    });
    expect(forged.statusCode).toBe(401);
  });

  it("冲突检测：同前缀搜索包 409 返回冲突清单，用户确认后才安装", async () => {
    const blocked = await postJson("/api/plugins/d-search-b/install", {}, INSTALLER);
    expect(blocked.statusCode).toBe(409);
    const blockedBody = JSON.parse(blocked.body) as {
      error: string;
      conflicts: { type: string; message: string; otherSlug?: string }[];
    };
    expect(Array.isArray(blockedBody.conflicts)).toBe(true);
    expect(blockedBody.conflicts[0]?.type).toBe("search-prefix");
    expect(blockedBody.conflicts[0]?.message).toContain("!dpack");
    expect(blockedBody.conflicts[0]?.otherSlug).toBe("d-search-a");

    // 确认后安装成功，且未安装前安装记录里没有 B
    const confirmed = await postJson(
      "/api/plugins/d-search-b/install",
      { acknowledgeConflicts: true },
      INSTALLER,
    );
    expect(confirmed.statusCode).toBe(200);
    const installed = await ctx.repo.getPluginInstall(
      (await ctx.repo.getPluginBySlug("d-search-b"))!.id,
      INSTALLER,
    );
    expect(installed).not.toBeNull();
  });

  it("冲突检测：同站网址包 409 返回 site-url 冲突，确认后才安装", async () => {
    const blocked = await postJson("/api/plugins/d-site-b/install", {}, INSTALLER);
    expect(blocked.statusCode).toBe(409);
    const blockedBody = JSON.parse(blocked.body) as {
      conflicts: { type: string; message: string; otherSlug?: string }[];
    };
    expect(blockedBody.conflicts[0]?.type).toBe("site-url");
    expect(blockedBody.conflicts[0]?.otherSlug).toBe("d-site-a");

    const confirmed = await postJson(
      "/api/plugins/d-site-b/install",
      { acknowledgeConflicts: true },
      INSTALLER,
    );
    expect(confirmed.statusCode).toBe(200);
  });

  it("兼容性声明：校验器保留 compat/screenshots/donateUrl；不兼容安装被服务端拒绝", async () => {
    const validated = validateAndCleanPluginManifest(compatPack);
    expect(validated.ok).toBe(true);
    if (validated.ok) {
      const manifest = validated.manifest as unknown as Record<string, unknown>;
      expect((manifest.compat as { minAppVersion: string }).minAppVersion).toBe("99.0.0");
      expect(manifest.screenshots).toEqual([
        "https://shots.example.com/1.png",
        "https://shots.example.com/2.png",
      ]);
      expect(manifest.donateUrl).toBe("https://donate.example.com/d-author");
    }
    expect(checkPluginCompat(compatPack as never)).toContain("99.0.0");
    expect(checkPluginCompat({ ...compatPack, compat: undefined } as never)).toBeNull();

    // 服务端安装闸：要求 99.0.0 的包照样装不了，文案写清版本
    const res = await postJson("/api/plugins/d-compat-pack/install", {}, INSTALLER);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error as string).toContain("99.0.0");
    expect(await ctx.repo.getPluginInstall((await ctx.repo.getPluginBySlug("d-compat-pack"))!.id, INSTALLER)).toBeNull();
  });

  it("作者档案：本人可写、作者页可读、他人写不进别人档案、非法值 400 且不污染旧档案", async () => {
    const ownerKey = (await ctx.repo.getPluginBySlug("d-update-pack"))!.ownerKey;

    const saved = await postJson(
      "/api/plugins/author/profile",
      {
        displayName: "D 作者",
        bio: "写插件的人",
        avatar: "🐱",
        links: { homepage: "https://d-author.example.com/" },
        donateUrl: "https://donate.example.com/d-author",
      },
      OWNER,
    );
    expect(saved.statusCode).toBe(200);
    const savedBody = JSON.parse(saved.body) as { profile: { displayName: string; avatar: string; donateUrl: string } };
    expect(savedBody.profile.displayName).toBe("D 作者");
    expect(savedBody.profile.avatar).toBe("🐱");
    expect(savedBody.profile.donateUrl).toBe("https://donate.example.com/d-author");

    // 作者页公开可读档案；非本人 isOwner=false
    const page = await app.inject({ method: "GET", url: `/api/plugins/author/${ownerKey}` });
    expect(page.statusCode).toBe(200);
    const pageBody = JSON.parse(page.body) as {
      profile: { displayName: string; bio: string; donateUrl: string } | null;
      isOwner: boolean;
    };
    expect(pageBody.profile?.displayName).toBe("D 作者");
    expect(pageBody.profile?.bio).toBe("写插件的人");
    expect(pageBody.profile?.donateUrl).toBe("https://donate.example.com/d-author");
    expect(pageBody.isOwner).toBe(false);

    // 本人访问 isOwner=true
    const ownPage = await app.inject({
      method: "GET",
      url: `/api/plugins/author/${ownerKey}`,
      headers: signedHeaders(OWNER),
    });
    expect((JSON.parse(ownPage.body) as { isOwner: boolean }).isOwner).toBe(true);

    // 他人只能写自己的档案，写不进 OWNER 的档案（owner_key 是身份哈希，
    // 各人只写得到自己哈希对应的那一行）
    const spoof = await postJson("/api/plugins/author/profile", { displayName: "冒充者" }, OTHER);
    expect(spoof.statusCode).toBe(200);
    expect((await ctx.repo.getPluginAuthorProfile(ownerKey))?.displayName).toBe("D 作者");
    const allProfiles = await ctx.repo.raw(
      "SELECT owner_key, display_name FROM plugin_author_profiles",
    );
    expect(allProfiles.length).toBe(2);
    expect(allProfiles.find((r) => r.owner_key === ownerKey)?.display_name).toBe("D 作者");
    expect(allProfiles.find((r) => r.owner_key !== ownerKey)?.display_name).toBe("冒充者");

    // 非法值 400，且旧档案不受损
    const badAvatar = await postJson(
      "/api/plugins/author/profile",
      { avatar: "https://evil.example.com/x.png" },
      OWNER,
    );
    expect(badAvatar.statusCode).toBe(400);
    const badDonate = await postJson(
      "/api/plugins/author/profile",
      { donateUrl: "ftp://donate.example.com/x" },
      OWNER,
    );
    expect(badDonate.statusCode).toBe(400);
    const tooLong = await postJson(
      "/api/plugins/author/profile",
      { displayName: "x".repeat(61) },
      OWNER,
    );
    expect(tooLong.statusCode).toBe(400);
    expect((await ctx.repo.getPluginAuthorProfile(ownerKey))?.displayName).toBe("D 作者");
  });

  it("安装趋势：HTTP 安装后趋势按天聚合，零安装补 0；待审/不存在的包不泄露", async () => {
    const res = await postJson("/api/plugins/d-trend-pack/install", {}, INSTALLER);
    expect(res.statusCode).toBe(200);
    expect(await waitForEvent("d-trend-pack")).toBe(true);

    const trend = await app.inject({ method: "GET", url: "/api/plugins/d-trend-pack/trend?days=30" });
    expect(trend.statusCode).toBe(200);
    const body = JSON.parse(trend.body) as {
      ok: boolean;
      slug: string;
      days: number;
      total: number;
      series: { date: string; installs: number }[];
    };
    expect(body.ok).toBe(true);
    expect(body.slug).toBe("d-trend-pack");
    expect(body.days).toBe(30);
    expect(body.total).toBe(1);
    expect(body.series.length).toBe(30);
    const today = new Date().toISOString().slice(0, 10);
    expect(body.series[29]?.date).toBe(today);
    expect(body.series[29]?.installs).toBe(1);
    expect(body.series.slice(0, 29).every((d) => d.installs === 0)).toBe(true);
    expect(body.series.reduce((n, d) => n + d.installs, 0)).toBe(1);
    // 日期连续不跳号
    for (let i = 1; i < body.series.length; i++) {
      const prev = new Date(body.series[i - 1]!.date).getTime();
      const cur = new Date(body.series[i]!.date).getTime();
      expect(cur - prev).toBe(24 * 60 * 60 * 1000);
    }

    const pending = await app.inject({ method: "GET", url: "/api/plugins/d-pending-pack/trend" });
    expect(pending.statusCode).toBe(404);
    const missing = await app.inject({ method: "GET", url: "/api/plugins/d-no-such-pack/trend" });
    expect(missing.statusCode).toBe(404);
  });

  it("B-3：管理员删评价——他人删 403，管理员删 200，删后列表读不到，再删 404", async () => {
    const pluginId = (await ctx.repo.getPluginBySlug("d-review-pack"))!.id;
    const myReview = await ctx.repo.getUserPluginReview(pluginId, INSTALLER);
    expect(myReview).not.toBeNull();

    const forbidden = await app.inject({
      method: "DELETE",
      url: `/api/plugins/d-review-pack/reviews/${myReview!.id}`,
      headers: signedHeaders(OTHER),
    });
    expect(forbidden.statusCode).toBe(403);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/plugins/d-review-pack/reviews/${myReview!.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(deleted.statusCode).toBe(200);
    expect((JSON.parse(deleted.body) as { deleted: boolean }).deleted).toBe(true);
    expect(await ctx.repo.getUserPluginReview(pluginId, INSTALLER)).toBeNull();

    const list = await app.inject({ method: "GET", url: "/api/plugins/d-review-pack/reviews" });
    expect(list.statusCode).toBe(200);
    const items = (JSON.parse(list.body) as { items: { id: string }[] }).items;
    expect(items.some((i) => i.id === myReview!.id)).toBe(false);

    const deletedAgain = await app.inject({
      method: "DELETE",
      url: `/api/plugins/d-review-pack/reviews/${myReview!.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(deletedAgain.statusCode).toBe(404);
  });
});
