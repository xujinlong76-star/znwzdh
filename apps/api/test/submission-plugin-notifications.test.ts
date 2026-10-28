import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { hashToken } from "../src/auth.ts";
import { signIdentity } from "../src/identity-signature.ts";
import { ADMIN_NOTIFICATION_IDENTITY } from "../src/notifications.ts";
import * as autoAuditor from "../src/ai-plugin-auditor.ts";
import * as siteIndexer from "../src/index-site.ts";
import * as pluginIndexer from "../src/index-plugin.ts";

const SECRET = "submission-plugin-test-secret";
const ADMIN = "submission-plugin-test-admin";
const AUTHOR = "github:notification-author";
const OTHER = "github:notification-other";
const ALIAS = "github:notification-old";
const adminHeaders = { authorization: `Bearer ${ADMIN}` };
const signed = (identity: string) => ({
  "x-navhub-user-id": identity,
  "x-navhub-identity-signature": signIdentity(SECRET, identity),
});
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
let dir: string;
let sequence = 0;

function submission(headers: Record<string, string> = signed(AUTHOR), extra = {}) {
  const n = ++sequence;
  return app.inject({
    method: "POST", url: "/api/submissions", remoteAddress: `192.0.2.${n}`,
    headers, payload: { title: `投稿 ${n}`, url: `https://submission.example.test/${n}`, categoryId: "notification-leaf", ...extra },
  });
}
function reviewSite(id: string, action: "approve" | "reject", headers = adminHeaders) {
  return app.inject({ method: "PATCH", url: `/api/submissions/${id}`, headers, payload: { action, reason: "private-review-reason" } });
}
function theme(name: string, version = "1.0.0") {
  return {
    manifestVersion: 1, kind: "theme", name, description: "通知测试主题", version,
    payload: { accent: "violet", tokens: { "--primary": "262 83% 58%", "--primary-foreground": "0 0% 100%" } },
  };
}
function publish(name: string, headers = signed(AUTHOR), extra = {}) {
  return app.inject({ method: "POST", url: "/api/plugins", headers, payload: { manifest: theme(name), ...extra } });
}
function reviewPlugin(slug: string, action: "approve" | "reject" | "delist", headers = adminHeaders) {
  return app.inject({ method: "POST", url: `/api/plugins/${slug}/review`, headers, payload: { action, note: "private-plugin-note" } });
}
function outbox(identity: string) {
  return ctx.repo.raw("SELECT * FROM notification_outbox WHERE identity = ? ORDER BY created_at, id", [identity]);
}
async function counts() {
  const tables = ["sites", "submission_owners", "plugins", "plugin_versions", "audit_logs", "notification_outbox"];
  return Promise.all(tables.map(async (table) => Number((await ctx.repo.raw(`SELECT COUNT(*) AS n FROM ${table}`))[0].n)));
}
async function failOutbox(kind: string, run: () => Promise<void>, identity?: string) {
  await ctx.repo.run(`CREATE TEMP TRIGGER fail_review_outbox BEFORE INSERT ON notification_outbox
    WHEN NEW.kind = '${kind}'${identity ? ` AND NEW.identity = '${identity}'` : ""}
    BEGIN SELECT RAISE(ABORT, 'test outbox failure'); END`);
  try { await run(); } finally { await ctx.repo.run("DROP TRIGGER fail_review_outbox"); }
}

beforeAll(async () => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External fetch is forbidden in notification tests"); }));
  dir = mkdtempSync(join(tmpdir(), "navhub-submission-plugin-notify-"));
  ctx = await createContext(loadConfig({
    mode: "lite", sqlitePath: join(dir, "test.db"), authRequired: true, adminToken: ADMIN,
    identitySecret: SECRET, identitySignatureStrict: false,
    embedding: { enabled: false }, llm: { apiKey: null, allowPrivateNetwork: false },
  }));
  await ctx.repo.createCategory({ id: "notification-root", title: "通知测试" });
  await ctx.repo.createCategory({ id: "notification-leaf", title: "投稿类目", parentId: "notification-root" });
  await ctx.repo.mergeIdentity(ALIAS, AUTHOR);
  for (const scope of ["read", "write"]) {
    await ctx.repo.createApiToken({ name: `notify-${scope}`, tokenHash: hashToken(`notify-${scope}`), scopes: scope });
  }
  await ctx.repo.createApiToken({ name: "personal", tokenHash: hashToken("notify-personal"), scopes: "write", ownerIdentity: AUTHOR });
  app = await buildServer(ctx);
  await app.ready();
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await app?.close();
  await ctx?.close();
  vi.unstubAllGlobals();
  vi.resetModules();
  rmSync(dir, { recursive: true, force: true });
});

describe("submission notification transactions", () => {
  it("signed submission -> review -> relay isolates the author and keeps ownership private", async () => {
    const indexed = vi.spyOn(siteIndexer, "indexSite").mockImplementation(async () => {
      expect(ctx.db.sqlite?.inTransaction).toBe(false);
    });
    const created = await submission(signed(ALIAS), { identity: OTHER, userId: OTHER, submitterNote: "private-submitter-note" });
    expect(created.statusCode).toBe(201);
    const id = created.json().siteId;
    expect(await ctx.repo.raw("SELECT identity FROM submission_owners WHERE site_id = ?", [id])).toEqual([{ identity: AUTHOR }]);
    expect(JSON.stringify(await ctx.repo.getSite(id))).not.toContain(AUTHOR);
    const pending = (await outbox(ADMIN_NOTIFICATION_IDENTITY)).filter((n) => String(n.body).includes(id));
    expect(pending).toHaveLength(1);
    expect(pending[0].kind).toBe("submission_pending");
    expect(await outbox(AUTHOR)).toHaveLength(0);
    expect((await reviewSite(id, "approve")).statusCode).toBe(200);
    expect((await reviewSite(id, "approve")).statusCode).toBe(200);
    const notices = (await outbox(AUTHOR)).filter((n) => String(n.body).includes(id));
    expect(notices).toHaveLength(1);
    expect(notices[0].kind).toBe("submission_approved");
    expect(JSON.stringify([...pending, ...notices])).not.toContain("private-");
    expect(indexed).toHaveBeenCalled();
    await ctx.repo.relayNotifications();
    await ctx.repo.relayNotifications();
    const mine = await app.inject({ method: "GET", url: "/api/me/notifications", headers: signed(AUTHOR) });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().items.filter((n: { body: string }) => n.body.includes(id))).toHaveLength(1);
    const other = await app.inject({ method: "GET", url: "/api/me/notifications", headers: signed(OTHER) });
    expect(other.json().items).toHaveLength(0);
    const publicSite = await app.inject({ method: "GET", url: `/api/sites/${id}` });
    expect(publicSite.statusCode).toBe(200);
    expect(publicSite.body).not.toContain(AUTHOR);
    const queue = await app.inject({ method: "GET", url: "/api/submissions?status=all", headers: adminHeaders });
    expect(queue.body).not.toContain(AUTHOR);
  });

  it("anonymous and signed body-only claims never create ownership; reserved recipients are rejected", async () => {
    for (const [headers, extra] of [
      [{}, {}],
      [signed("anon-notification-123"), { identity: AUTHOR }],
      [{ "x-navhub-identity-signature": signIdentity(SECRET, OTHER) }, { userId: OTHER }],
    ] as Array<[Record<string, string>, Record<string, string>]>) {
      const res = await submission(headers, extra);
      expect(res.statusCode).toBe(201);
      const id = res.json().siteId;
      expect(await ctx.repo.raw("SELECT * FROM submission_owners WHERE site_id = ?", [id])).toHaveLength(0);
      expect((await reviewSite(id, "reject")).statusCode).toBe(200);
      expect((await outbox(AUTHOR)).filter((n) => String(n.body).includes(id))).toHaveLength(0);
    }
    expect((await submission({}, { identity: AUTHOR })).statusCode).toBe(401);
    expect((await submission({ "x-navhub-user-id": AUTHOR })).statusCode).toBe(401);
    expect((await submission(signed(ADMIN_NOTIFICATION_IDENTITY))).statusCode).toBe(403);
    const res = await submission({ authorization: "Bearer notify-personal", "x-navhub-user-id": OTHER }, { identity: OTHER });
    expect(res.statusCode).toBe(201);
    expect(await ctx.repo.raw("SELECT identity FROM submission_owners WHERE site_id = ?", [res.json().siteId])).toEqual([{ identity: AUTHOR }]);
  });

  it("failed creation rolls back the site, audit, owner and outbox together", async () => {
    const before = await counts();
    await failOutbox("submission_pending", async () => {
      expect((await submission()).statusCode).toBe(500);
    });
    expect(await counts()).toEqual(before);
  });

  it("failed review rolls back state and audit; concurrent repeats and later transitions have distinct events", async () => {
    const created = await submission();
    const id = created.json().siteId;
    const before = await counts();
    await failOutbox("submission_approved", async () => {
      expect((await reviewSite(id, "approve")).statusCode).toBe(500);
    });
    expect((await ctx.repo.getSite(id))?.status).toBe("pending");
    expect(await counts()).toEqual(before);
    const results = await Promise.all([reviewSite(id, "approve"), reviewSite(id, "approve")]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    expect((await reviewSite(id, "reject")).statusCode).toBe(200);
    expect((await reviewSite(id, "reject")).statusCode).toBe(200);
    expect((await reviewSite(id, "approve")).statusCode).toBe(200);
    const notices = (await outbox(AUTHOR)).filter((n) => String(n.body).includes(id));
    expect(notices).toHaveLength(3);
    expect(new Set(notices.map((n) => n.id)).size).toBe(3);
  });

  it("deleteUserData removes private mappings without deleting public sites; FK cascades work", async () => {
    const identity = "github:delete-submitter";
    const created = await submission(signed(identity));
    const id = created.json().siteId;
    await ctx.repo.deleteUserData(identity);
    expect(await ctx.repo.raw("SELECT * FROM submission_owners WHERE site_id = ?", [id])).toHaveLength(0);
    expect(await ctx.repo.getSite(id)).not.toBeNull();
    expect((await reviewSite(id, "approve")).statusCode).toBe(200);
    expect(await outbox(identity)).toHaveLength(0);
    const cascaded = await submission(signed(identity));
    await ctx.repo.run("DELETE FROM sites WHERE id = ?", [cascaded.json().siteId]);
    expect(await ctx.repo.raw("SELECT * FROM submission_owners WHERE site_id = ?", [cascaded.json().siteId])).toHaveLength(0);
    expect((await ctx.repo.raw("PRAGMA index_list(submission_owners)")).some((r) => r.name === "submission_owners_identity_idx")).toBe(true);
  });
});

describe("plugin notification transactions", () => {
  it("pending notifies canonical owner and administrator; manual review notifies only owner", async () => {
    const created = await publish("Notification pending", signed(ALIAS), { identity: OTHER });
    expect(created.statusCode).toBe(201);
    const { slug, id } = created.json();
    expect((await ctx.repo.getPluginBySlug(slug))?.ownerIdentity).toBe(AUTHOR);
    for (const identity of [AUTHOR, ADMIN_NOTIFICATION_IDENTITY]) {
      const pending = (await outbox(identity)).filter((n) => String(n.body).includes(id));
      expect(pending).toHaveLength(1);
      expect(pending[0].kind).toBe("plugin_pending");
    }
    const indexed = vi.spyOn(pluginIndexer, "indexPluginsBatch").mockImplementation(async () => {
      expect(ctx.db.sqlite?.inTransaction).toBe(false);
      return { indexed: 0 } as never;
    });
    expect((await reviewPlugin(slug, "approve")).statusCode).toBe(200);
    expect((await reviewPlugin(slug, "approve")).statusCode).toBe(409);
    expect(indexed).toHaveBeenCalledTimes(1);
    await ctx.repo.relayNotifications(100);
    const owner = await ctx.repo.listNotificationsPage(AUTHOR, 50, 0, false);
    expect(owner.items.filter((n) => n.body?.includes(id)).map((n) => n.kind).sort()).toEqual(["plugin_approved", "plugin_pending"]);
    expect((await outbox(OTHER)).filter((n) => String(n.body).includes(id))).toHaveLength(0);
    const admin = (await outbox(ADMIN_NOTIFICATION_IDENTITY)).filter((n) => String(n.body).includes(id));
    expect(admin).toHaveLength(1);
    expect(JSON.stringify([...admin, ...owner.items])).not.toContain("private-plugin-note");
  });

  it("failure of the second pending notification rolls back plugin, versions, audit and first notification", async () => {
    const before = await counts();
    await failOutbox("plugin_pending", async () => {
      expect((await publish("Notification rollback")).statusCode).toBe(409);
    }, ADMIN_NOTIFICATION_IDENTITY);
    expect(await counts()).toEqual(before);
  });

  it("review failure rolls back all changes; repeated reject/delist emits no same-state event", async () => {
    const created = await publish("Notification review rollback");
    expect(created.statusCode).toBe(201);
    const { slug, id } = created.json();
    const before = await counts();
    await failOutbox("plugin_approved", async () => {
      expect((await reviewPlugin(slug, "approve")).statusCode).toBe(400);
    });
    expect((await ctx.repo.getPluginBySlug(slug))?.status).toBe("pending");
    expect(await counts()).toEqual(before);
    for (const action of ["reject", "reject", "delist", "delist", "approve", "delist", "approve"] as const) {
      expect((await reviewPlugin(slug, action)).statusCode).toBe(200);
    }
    const notices = (await outbox(AUTHOR)).filter((n) => String(n.body).includes(id));
    expect(notices).toHaveLength(6);
    expect(new Set(notices.map((n) => n.id)).size).toBe(6);
  });

  it("shadow release approval and rejection each include the reviewed version in distinct events", async () => {
    const name = "Notification shadow release";
    const created = await publish(name);
    expect(created.statusCode).toBe(201);
    const { slug, id } = created.json();
    expect((await reviewPlugin(slug, "approve")).statusCode).toBe(200);
    for (const [version, action] of [["1.1.0", "approve"], ["1.2.0", "reject"]] as const) {
      const submitted = await app.inject({ method: "POST", url: `/api/plugins/${slug}/versions`, headers: signed(AUTHOR), payload: { manifest: theme(name, version) } });
      expect(submitted.statusCode).toBe(202);
      expect((await ctx.repo.getPluginBySlug(slug))?.status).toBe("published");
      expect((await reviewPlugin(slug, action)).statusCode).toBe(200);
      expect((await ctx.repo.getPluginBySlug(slug))?.status).toBe("published");
    }
    const notices = (await outbox(AUTHOR)).filter((n) => String(n.body).includes(id) && n.kind !== "plugin_pending");
    expect(notices).toHaveLength(3);
    expect(notices.map((n) => JSON.parse(String(n.body)).version).sort()).toEqual(["1.0.0", "1.1.0", "1.2.0"]);
    expect(new Set(notices.map((n) => n.id)).size).toBe(3);
  });

  it("auto-audit IO starts after pending transaction commit (automatic review producer is separate)", async () => {
    const audit = vi.spyOn(autoAuditor, "executeAutoAuditAndPublish").mockImplementation(async (_ctx, plugin) => {
      expect(ctx.db.sqlite?.inTransaction).toBe(false);
      const pending = await ctx.repo.raw("SELECT * FROM notification_outbox WHERE kind = 'plugin_pending' AND body LIKE ?", [`%${plugin.id}%`]);
      expect(pending).toHaveLength(2);
      return { plugin, audit: {} } as never;
    });
    expect((await publish("Notification auto audit boundary", signed(AUTHOR), { autoAudit: true })).statusCode).toBe(201);
    expect(audit).toHaveBeenCalledTimes(1);
  });
});

it("review scopes and reserved inbox boundaries cannot be bypassed by signed identities", async () => {
  const site = (await submission()).json().siteId;
  const plugin = (await publish("Notification scope guard")).json();
  const before = (await ctx.repo.raw("SELECT id FROM notification_outbox")).length;
  for (const headers of [{}, signed(AUTHOR), { authorization: "Bearer notify-read" }, { authorization: "Bearer notify-personal" }]) {
    expect([401, 403]).toContain((await reviewSite(site, "approve", headers)).statusCode);
    expect([401, 403]).toContain((await reviewPlugin(plugin.slug, "approve", headers)).statusCode);
  }
  expect((await reviewPlugin(plugin.slug, "approve", { authorization: "Bearer notify-write" })).statusCode).toBe(403);
  expect((await ctx.repo.raw("SELECT id FROM notification_outbox")).length).toBe(before);
  expect((await publish("Reserved notification identity", signed(ADMIN_NOTIFICATION_IDENTITY))).statusCode).toBe(403);
  expect((await app.inject({ method: "GET", url: "/api/me/notifications", headers: signed(ADMIN_NOTIFICATION_IDENTITY) })).statusCode).toBe(403);
  expect((await app.inject({ method: "GET", url: "/api/admin/notifications", headers: signed(AUTHOR) })).statusCode).toBe(401);
  expect((await app.inject({ method: "GET", url: "/api/admin/notifications", headers: adminHeaders })).statusCode).toBe(200);
});
