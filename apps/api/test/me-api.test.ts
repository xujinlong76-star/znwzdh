import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";

/**
 * 用户中心 API：身份必须来自签名头；匿名合并必须同时证明对 anonId 的所有权。
 */
const SECRET = "test-secret-please-rotate";
const USER = "github:u-me";
const ANON = "anon-22222222-2222-2222-2222-222222222222";

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

const userHeaders = () => ({
  "x-navhub-user-id": USER,
  "x-navhub-identity-signature": signIdentity(SECRET, USER),
});

const headersFor = (identity: string) => ({
  "x-navhub-user-id": identity,
  "x-navhub-identity-signature": signIdentity(SECRET, identity),
});

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-me-"));
  ctx = await createContext(
    loadConfig({ ...base, sqlitePath: join(dir, "me.db"), identitySecret: SECRET }),
  );
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("/api/me", () => {
  it("没有签名身份 -> 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me" });
    expect(res.statusCode).toBe(401);
  });

  it("签名身份 -> 返回概览", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me", headers: userHeaders() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.identity).toBe(USER);
    expect(body.counts.favorites).toBe(0);
    expect(body.aliases).toEqual([]);
  });
});

describe("/api/me/profile 邮箱绑定（T3）", () => {
  const OTHER = "github:u-email-other";

  it("绑定 / 解绑邮箱，回读生效", async () => {
    const bind = await app.inject({
      method: "PATCH",
      url: "/api/me/profile",
      headers: headersFor(USER),
      payload: { email: "me-api@example.com" },
    });
    expect(bind.statusCode).toBe(200);
    expect(bind.json().user.email).toBe("me-api@example.com");

    const clear = await app.inject({
      method: "PATCH",
      url: "/api/me/profile",
      headers: headersFor(USER),
      payload: { email: null },
    });
    expect(clear.statusCode).toBe(200);
    expect(clear.json().user.email).toBeNull();
  });

  it("他人已占用的邮箱 -> 409 并带可读原因", async () => {
    const seed = await app.inject({
      method: "PATCH",
      url: "/api/me/profile",
      headers: headersFor(OTHER),
      payload: { email: "taken@example.com" },
    });
    expect(seed.statusCode).toBe(200);

    const conflict = await app.inject({
      method: "PATCH",
      url: "/api/me/profile",
      headers: headersFor(USER),
      payload: { email: "taken@example.com" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toContain("已绑定其他账号");
  });

  it("非法邮箱格式 -> 400", async () => {
    const bad = await app.inject({
      method: "PATCH",
      url: "/api/me/profile",
      headers: headersFor(USER),
      payload: { email: "not-an-email" },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe("/api/me/llm-usage（T21 用量自查）", () => {
  it("返回窗口内用量与身份档位上限", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/me/llm-usage",
      headers: userHeaders(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.calls).toBe("number");
    expect(typeof body.tokens).toBe("number");
    // 测试环境配额全 0（闸门关闭口径）：只断言字段形状，量级由 config 校验守护
    expect(typeof body.limits.calls).toBe("number");
    expect(typeof body.limits.tokens).toBe("number");
    expect(body.windowMs).toBe(24 * 60 * 60 * 1000);
  });

  it("未受信身份 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me/llm-usage" });
    expect(res.statusCode).toBe(401);
  });
});

describe("/api/me/visits（T23 访问历史）", () => {
  it("只返回本身份的 click 流水并带站点信息，分页推进", async () => {
    const cat = await ctx.repo.createCategory({ title: "访问历史" });
    const site = await ctx.repo.createSite({ url: "https://visit-a.example.com", title: "访问 A", categoryId: cat.id });
    await ctx.repo.recordEvent("click", { siteId: site.id, identity: USER });
    // 别人的访问不能出现
    await ctx.repo.recordEvent("click", { siteId: site.id, identity: "github:visit-other" });
    // 搜索事件不算访问
    await ctx.repo.recordEvent("search", { query: "关键词", identity: USER });

    const page1 = await app.inject({ method: "GET", url: "/api/me/visits?limit=1", headers: userHeaders() });
    expect(page1.statusCode).toBe(200);
    const body = page1.json();
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].siteId).toBe(site.id);
    expect(body.items[0].site.title).toBe("访问 A");
    expect(body.hasMore).toBe(false);
  });

  it("未受信身份 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me/visits" });
    expect(res.statusCode).toBe(401);
  });
});

describe("/api/me/sessions（T8 会话治理）", () => {
  const sid = "test-sid-0123456789abcdef";
  const sidHash = (v: string) => require("node:crypto").createHash("sha256").update(v).digest("hex");

  it("check 登记 + 列表可见 + 踢出后 revoked", async () => {
    const check = await app.inject({
      method: "POST",
      url: "/api/me/sessions/check",
      headers: { ...userHeaders(), "content-type": "application/json" },
      payload: { sid, userAgent: "T8-Test-Agent/1.0", expiresAt: Date.now() + 86_400_000 },
    });
    expect(check.statusCode).toBe(200);
    expect(check.json().revoked).toBe(false);

    const list = await app.inject({ method: "GET", url: "/api/me/sessions", headers: userHeaders() });
    expect(list.statusCode).toBe(200);
    const devices = list.json().devices;
    expect(Array.isArray(devices)).toBe(true);
    const mine = devices.find((d: { token: string }) => d.token === sidHash(sid));
    expect(mine).toBeTruthy();
    expect(mine.userAgent).toBe("T8-Test-Agent/1.0");

    // 他人无法踢出（跨用户 sid 404）
    const otherKick = await app.inject({
      method: "DELETE",
      url: "/api/me/sessions/" + sidHash(sid),
      headers: headersFor("github:u-session-other"),
    });
    expect(otherKick.statusCode).toBe(404);

    const kick = await app.inject({
      method: "DELETE",
      url: "/api/me/sessions/" + sidHash(sid),
      headers: userHeaders(),
    });
    expect(kick.statusCode).toBe(200);

    const verify = await app.inject({
      method: "POST",
      url: "/api/me/sessions/check",
      headers: { ...userHeaders(), "content-type": "application/json" },
      payload: { sid },
    });
    expect(verify.json().revoked).toBe(true);
  });

  it("sid 格式非法 400；列表未受信 401", async () => {
    const bad = await app.inject({
      method: "POST",
      url: "/api/me/sessions/check",
      headers: { ...userHeaders(), "content-type": "application/json" },
      payload: { sid: "x" },
    });
    expect(bad.statusCode).toBe(400);

    const list = await app.inject({ method: "GET", url: "/api/me/sessions" });
    expect(list.statusCode).toBe(401);
  });
});

describe("/api/me/notifications（T13 站内通知）", () => {
  it("列表/未读数/单条已读/全部已读 + 身份隔离", async () => {
    await ctx.repo.createNotification({ identity: USER, kind: "sync_failed", title: "收藏同步失败", body: "b1" });
    await ctx.repo.createNotification({ identity: USER, kind: "backup_due", title: "该备份数据了" });
    // 别人的通知不能出现
    await ctx.repo.createNotification({ identity: "github:u-notify-other", kind: "sync_failed", title: "别人的" });

    const page1 = await app.inject({ method: "GET", url: "/api/me/notifications", headers: userHeaders() });
    expect(page1.statusCode).toBe(200);
    const body = page1.json();
    expect(body.items).toHaveLength(2);
    expect(body.unread).toBe(2);

    // 只看未读
    const unreadOnly = await app.inject({ method: "GET", url: "/api/me/notifications?unread=1", headers: userHeaders() });
    expect(unreadOnly.json().items).toHaveLength(2);

    // 单条已读（只标自己的）
    const mine = body.items[0];
    const marked = await app.inject({
      method: "POST",
      url: "/api/me/notifications/" + mine.id + "/read",
      headers: userHeaders(),
    });
    expect(marked.json().marked).toBe(true);
    const otherMark = await app.inject({
      method: "POST",
      url: "/api/me/notifications/whatever/read",
      headers: userHeaders(),
    });
    expect(otherMark.json().marked).toBe(false);

    const after = await app.inject({ method: "GET", url: "/api/me/notifications", headers: userHeaders() });
    expect(after.json().unread).toBe(1);

    // 全部已读
    const readAll = await app.inject({ method: "POST", url: "/api/me/notifications/read-all", headers: userHeaders() });
    expect(readAll.json().marked).toBe(1);
    const final = await app.inject({ method: "GET", url: "/api/me/notifications", headers: userHeaders() });
    expect(final.json().unread).toBe(0);
  });

  it("列表未受信 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me/notifications" });
    expect(res.statusCode).toBe(401);
  });
});

describe("/api/me/tokens（T20 用户级令牌）", () => {
  it("创建（明文只回一次）→ 持令牌读自己的收藏 → 跨用户隔离 → 只读守卫 → 吊销失效", async () => {
    const OWNER = "github:u-token-owner";
    await ctx.repo.addFavorite({ userId: OWNER, siteId: "t20-site-own" });
    await ctx.repo.addFavorite({ userId: "github:u-token-other", siteId: "t20-site-theirs" });

    const created = await app.inject({
      method: "POST",
      url: "/api/me/tokens",
      headers: { ...headersFor(OWNER), "content-type": "application/json" },
      payload: { name: "扩展读令牌" },
    });
    expect(created.statusCode).toBe(200);
    const raw = created.json().token as string;
    expect(raw.startsWith("nh_")).toBe(true);
    expect(created.json().record.ownerIdentity).toBe(OWNER);

    // 持个人令牌（只带 Bearer，无任何身份头）读收藏：身份 = owner
    const asOwner = await app.inject({
      method: "GET",
      url: "/api/favorites",
      headers: { authorization: "Bearer " + raw },
    });
    expect(asOwner.statusCode).toBe(200);
    const ownIds = (asOwner.json().items as Array<{ siteId: string }>).map((i) => i.siteId);
    expect(ownIds).toContain("t20-site-own");
    expect(ownIds).not.toContain("t20-site-theirs");

    // 自报他人身份头也无法越权：owner 覆盖自称
    const spoof = await app.inject({
      method: "GET",
      url: "/api/favorites",
      headers: { authorization: "Bearer " + raw, "x-navhub-user-id": "github:u-token-other" },
    });
    const spoofIds = (spoof.json().items as Array<{ siteId: string }>).map((i) => i.siteId);
    expect(spoofIds).not.toContain("t20-site-theirs");

    // 只读令牌写收藏 → 403
    const write = await app.inject({
      method: "POST",
      url: "/api/favorites",
      headers: { authorization: "Bearer " + raw, "content-type": "application/json" },
      payload: { siteId: "t20-site-own" },
    });
    expect(write.statusCode).toBe(403);

    // 列表可见、吊销后失效
    const list = await app.inject({ method: "GET", url: "/api/me/tokens", headers: headersFor(OWNER) });
    expect(list.statusCode).toBe(200);
    const tokenId = list.json().tokens[0].id as string;
    expect(list.json().tokens[0].tokenPrefix.startsWith("nh_")).toBe(true);

    const revoke = await app.inject({
      method: "DELETE",
      url: "/api/me/tokens/" + tokenId,
      headers: headersFor(OWNER),
    });
    expect(revoke.statusCode).toBe(200);

    const after = await app.inject({
      method: "GET",
      url: "/api/favorites",
      headers: { authorization: "Bearer " + raw },
    });
    // 吊销后令牌在鉴权 hook 被视为无效凭据：public 路由按匿名处理 → 无身份 → 400
    //（与管理面路由的 401 不同——那里要求持票，这里只要求「有身份才能定归属」）
    expect(after.statusCode).toBe(400);
  });

  it("匿名身份不能创建令牌", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/me/tokens",
      headers: {
        "x-navhub-anon-id": ANON,
        "x-navhub-identity-signature": signIdentity(SECRET, ANON),
        "content-type": "application/json",
      },
      payload: { name: "anon" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("/api/me/merge", () => {
  it("缺少匿名签名 -> 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/me/merge",
      headers: userHeaders(),
      payload: { anonId: ANON },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain("匿名身份签名");
  });

  it("签名齐全 -> 合并匿名数据并返回统计", async () => {
    const cat = await ctx.repo.createCategory({ title: "用户中心测试" });
    const site = await ctx.repo.createSite({
      url: "https://me-merge.example.com",
      title: "Merge Site",
      categoryId: cat.id,
    });
    await ctx.repo.addFavorite({ userId: ANON, siteId: site.id });
    await ctx.repo.recordSearch(ANON, "匿名搜索", 1);

    const res = await app.inject({
      method: "POST",
      url: "/api/me/merge",
      headers: {
        ...userHeaders(),
        "x-navhub-anon-signature": signIdentity(SECRET, ANON),
      },
      payload: { anonId: ANON },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.favoritesMoved).toBe(1);
    expect(body.alreadyMerged).toBe(false);

    const overview = await app.inject({ method: "GET", url: "/api/me", headers: userHeaders() });
    expect(overview.statusCode).toBe(200);
    expect(overview.json().counts.favorites).toBe(1);
    expect(overview.json().aliases).toContain(ANON);
  });

  it("重复合并幂等", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/me/merge",
      headers: {
        ...userHeaders(),
        "x-navhub-anon-signature": signIdentity(SECRET, ANON),
      },
      payload: { anonId: ANON },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().alreadyMerged).toBe(true);
  });

  it("非法 anonId -> 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/me/merge",
      headers: userHeaders(),
      payload: { anonId: "../../etc/passwd" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("/api/me/activity（M10 用户可见操作记录）", () => {
  it("返回自己的审计事件，不含他人事件；未受信 401", async () => {
    await ctx.repo.audit({ actor: USER, actorKind: "user", action: "user.export", target: USER });
    await ctx.repo.audit({
      actor: "github:someone-else",
      actorKind: "user",
      action: "user.delete",
      target: "github:someone-else",
    });

    const res = await app.inject({ method: "GET", url: "/api/me/activity", headers: userHeaders() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { identity: string; items: Array<{ action: string; target: string | null }> };
    expect(body.identity).toBe(USER);
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(body.items)).not.toContain("someone-else");
    // 只暴露 action/target/at，不外传 ip 与 diff
    expect(Object.keys(body.items[0]).sort()).toEqual(["action", "at", "target"]);
  });
});

describe("/api/me/export/bookmarks.html（M9 互操作导出）", () => {
  it("按收藏夹分组输出 Netscape 格式，可直接导入浏览器", async () => {
    const cat = await ctx.repo.createCategory({ title: "导出测试" });
    const site = await ctx.repo.createSite({
      url: "https://netscape.example.com/",
      title: "Netscape 站点",
      categoryId: cat.id,
    });
    const folder = await ctx.repo.createFavoriteFolder(USER, "学习资料");
    await ctx.repo.addFavorite({ userId: USER, siteId: site.id, folderId: folder.id });

    const res = await app.inject({
      method: "GET",
      url: "/api/me/export/bookmarks.html",
      headers: userHeaders(),
    });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers["content-type"])).toContain("text/html");
    expect(String(res.headers["content-disposition"])).toContain("navhub-bookmarks.html");
    expect(res.payload).toContain("NETSCAPE-Bookmark-file-1");
    expect(res.payload).toContain("<H3>学习资料</H3>");
    expect(res.payload).toContain('HREF="https://netscape.example.com/"');
  });
});
