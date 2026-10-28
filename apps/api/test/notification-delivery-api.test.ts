import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { JobRunner } from "../src/jobs.ts";
import { ADMIN_NOTIFICATION_IDENTITY } from "../src/notifications.ts";
import { signIdentity } from "../src/identity-signature.ts";

const ADMIN = "test-notification-admin-token";
const SECRET = "test-notification-identity-secret";
let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
const headers = { authorization: `Bearer ${ADMIN}` };
const userHeaders = (identity: string) => ({
  "x-navhub-user-id": identity,
  "x-navhub-identity-signature": signIdentity(SECRET, identity),
});

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-notification-api-"));
  ctx = await createContext(loadConfig({
    mode: "lite", sqlitePath: join(dir, "api.db"), authRequired: true, adminToken: ADMIN, identitySecret: SECRET,
    embedding: { model: "none", endpoint: "", dtype: "q8", dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  }));
  app = await buildServer(ctx);
  await app.ready();
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("notification delivery management", () => {
  it("仅管理权限可读投递状态，deferred 不冒充成功且不返回正文", async () => {
    await ctx.repo.emitNotification({ identity: "github:recipient", idempotencyKey: "channels", kind: "test", title: "private title", body: "private body", channels: ["inapp", "email", "push"] });
    const url = "/api/admin/notifications/deliveries?status=deferred&limit=1";
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url, headers: userHeaders("github:recipient") })).statusCode).toBe(401);
    const res = await app.inject({ method: "GET", url, headers });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.json().hasMore).toBe(true);
    expect(res.json().items).toHaveLength(1);
    expect(res.json().items[0]).toMatchObject({ status: "deferred", deliveredAt: null });
    expect(res.body).not.toContain("private title");
    expect(res.body).not.toContain("private body");
    expect((await app.inject({ method: "GET", url: "/api/admin/notifications/deliveries?status=bogus", headers })).statusCode).toBe(400);
  });

  it("无任务时 Runner 也会投递待发通知", async () => {
    await ctx.repo.emitNotification({ identity: "github:tick", idempotencyKey: "tick", kind: "test", title: "notice" });
    expect(await ctx.repo.countUnreadNotifications("github:tick")).toBe(0);
    expect((await new JobRunner(ctx).tick()).processed).toBe(0);
    expect(await ctx.repo.countUnreadNotifications("github:tick")).toBe(1);
  });

  it("任务仅终态失败通知管理收件箱，错误正文不进通知且重复tick不重发", async () => {
    const id = await ctx.repo.enqueueJob("refetch_metadata", { siteId: "notification-missing-site" });
    const runner = new JobRunner(ctx);
    await runner.tick();
    expect((await ctx.repo.listNotificationDeliveries()).items.filter((n) => n.kind === "job_failed")).toHaveLength(0);
    await ctx.repo.run("UPDATE jobs SET attempts = 2, next_run_at = 0 WHERE id = ?", [id]);
    await runner.tick();
    expect((await ctx.repo.getJob(id))?.status).toBe("failed");
    const notices = (await ctx.repo.listNotificationsPage(ADMIN_NOTIFICATION_IDENTITY, 50, 0, false)).items.filter((n) => n.kind === "job_failed");
    expect(notices).toHaveLength(1);
    expect(notices[0].body).toContain(id);
    expect(notices[0].body).not.toContain("notification-missing-site");
    await runner.tick();
    expect((await ctx.repo.listNotificationDeliveries()).items.filter((n) => n.kind === "job_failed")).toHaveLength(1);
  });

  it("retention 完成与 outbox 同事务，回执区分预演和执行", async () => {
    const id = await ctx.repo.enqueueJob("data_retention", { mode: "rollup", apply: false });
    await new JobRunner(ctx).tick();
    expect((await ctx.repo.getJob(id))?.status).toBe("done");
    const notices = (await ctx.repo.listNotificationsPage(ADMIN_NOTIFICATION_IDENTITY, 50, 0, false)).items;
    expect(notices.find((n) => n.kind === "retention_completed")?.title).toContain("预演");
  });

  it("outbox 写入失败时终态更新回滚，不把通知故障误记为任务执行失败", async () => {
    const id = await ctx.repo.enqueueJob("data_retention", { mode: "rollup", apply: false });
    vi.spyOn(ctx.repo, "emitNotification").mockRejectedValueOnce(new Error("outbox unavailable"));
    await expect(new JobRunner(ctx).tick()).rejects.toThrow("outbox unavailable");
    expect((await ctx.repo.getJob(id))?.status).toBe("running");
    await ctx.repo.cancelJob(id);
  });

  it("管理员收件箱不能从用户接口读写，已读只作用于管理消息", async () => {
    const url = "/api/admin/notifications";
    const inbox = await app.inject({ method: "GET", url, headers });
    expect(inbox.statusCode).toBe(200);
    expect(inbox.json().unread).toBeGreaterThan(0);
    expect((await app.inject({ method: "GET", url, headers: userHeaders("github:recipient") })).statusCode).toBe(401);
    for (const path of ["/api/me/notifications", "/api/me/notifications/unread-count"]) {
      expect((await app.inject({ method: "GET", url: path, headers: userHeaders(ADMIN_NOTIFICATION_IDENTITY) })).statusCode).toBe(403);
    }
    expect((await app.inject({ method: "POST", url: "/api/me/notifications/read-all", headers: userHeaders(ADMIN_NOTIFICATION_IDENTITY) })).statusCode).toBe(403);
    const marked = await app.inject({ method: "POST", url: "/api/admin/notifications/read-all", headers });
    expect(marked.statusCode).toBe(200);
    expect(await ctx.repo.countUnreadNotifications(ADMIN_NOTIFICATION_IDENTITY)).toBe(0);
    expect(await ctx.repo.countUnreadNotifications("github:recipient")).toBe(1);
  });
});
