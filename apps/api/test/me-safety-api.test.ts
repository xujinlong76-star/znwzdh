import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";
import {
  classifyExportFreshness,
  classifySyncState,
  mapSyncErrorCode,
  parseAuditDiff,
  worstStatus,
} from "@navhub/store";

/**
 * 第 15 项：数据安全可见补完（Phase 1）。
 * GET /api/me/safety 聚合 + diagnostics 扩展 + 同步水位写入点 + 导出审计 truncated。
 */
const SECRET = "test-secret-please-rotate";
const USER = "github:u-safety";
const OTHER = "github:u-safety-other";
const FAIL_USER = "github:u-safety-fail";

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

const signedHeaders = (identity: string) => ({
  "x-navhub-user-id": identity,
  "x-navhub-identity-signature": signIdentity(SECRET, identity),
});
const userHeaders = (identity = USER) => signedHeaders(identity);

function call(
  method: "GET" | "POST",
  url: string,
  payload?: unknown,
  headers: Record<string, string> = userHeaders(),
) {
  return app.inject({ method, url, headers, payload: payload as never });
}

const DAY = 86_400_000;

/** 直接写审计行（可指定 created_at，用于新鲜度边界值）。 */
async function seedAudit(
  actor: string,
  action: string,
  diff: Record<string, unknown>,
  createdAt: number,
) {
  await ctx.repo.run(
    "INSERT INTO audit_logs (actor, actor_kind, action, target, diff, ip, created_at) VALUES (?,?,?,?,?,?,?)",
    [actor, "user", action, actor, JSON.stringify(diff), null, createdAt],
  );
}

async function safetyOf(identity = USER) {
  const res = await call("GET", "/api/me/safety", undefined, userHeaders(identity));
  expect(res.statusCode).toBe(200);
  return res.json() as Record<string, any>;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-me-safety-"));
  ctx = await createContext(
    loadConfig({ ...base, sqlitePath: join(dir, "me-safety.db"), identitySecret: SECRET }),
  );
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("新鲜度分类与错误码映射（纯函数）", () => {
  it("导出：7 天边界 ok、8 天 warning、30 天 warning、31 天 critical、null critical", () => {
    const now = Date.now();
    expect(classifyExportFreshness(now - 7 * DAY, now)).toBe("ok");
    expect(classifyExportFreshness(now - 7 * DAY - 1, now)).toBe("warning");
    expect(classifyExportFreshness(now - 30 * DAY, now)).toBe("warning");
    expect(classifyExportFreshness(now - 30 * DAY - 1, now)).toBe("critical");
    expect(classifyExportFreshness(null, now)).toBe("critical");
  });

  it("同步：1h 内失败 critical、从未成功 unknown、24h 内成功且无未读 ok、否则 warning", () => {
    const now = Date.now();
    expect(
      classifySyncState({ lastSuccessAt: now - 1000, lastFailureAt: now - 1000, lastErrorCode: "timeout" }, 0, now),
    ).toBe("critical");
    expect(classifySyncState({ lastSuccessAt: null, lastFailureAt: null, lastErrorCode: null }, 0, now)).toBe("unknown");
    expect(
      classifySyncState({ lastSuccessAt: now - 1000, lastFailureAt: null, lastErrorCode: null }, 0, now),
    ).toBe("ok");
    expect(
      classifySyncState({ lastSuccessAt: now - 1000, lastFailureAt: null, lastErrorCode: null }, 1, now),
    ).toBe("warning");
    expect(
      classifySyncState({ lastSuccessAt: now - 25 * 60 * 60_000, lastFailureAt: null, lastErrorCode: null }, 0, now),
    ).toBe("warning");
  });

  it("overall 取最差，serverBackup.unknown 不参与（由调用方排除，这里只验 worst 本身）", () => {
    expect(worstStatus(["ok", "warning", "unknown"])).toBe("warning");
    expect(worstStatus(["ok", "unknown"])).toBe("unknown");
    expect(worstStatus(["critical", "warning"])).toBe("critical");
  });

  it("错误码映射：timeout/network/5xx/4xx/unknown，映射不到一律 unknown", () => {
    expect(mapSyncErrorCode(new Error("request timed out"))).toBe("timeout");
    expect(mapSyncErrorCode(new Error("fetch failed"))).toBe("network");
    expect(mapSyncErrorCode(new Error("status 503"))).toBe("server_5xx");
    expect(mapSyncErrorCode(new Error("status 422"))).toBe("validation_4xx");
    expect(mapSyncErrorCode({ status: 504 })).toBe("timeout");
    expect(mapSyncErrorCode({ status: 500 })).toBe("server_5xx");
    expect(mapSyncErrorCode(new Error("no such table: watch_entries"))).toBe("unknown");
    expect(mapSyncErrorCode("???")).toBe("unknown");
    expect(mapSyncErrorCode(null)).toBe("unknown");
  });

  it("审计 diff 解析：坏 JSON 不抛错、字段为 null", () => {
    expect(parseAuditDiff(null)).toEqual({});
    expect(parseAuditDiff('{"broken"')).toEqual({});
    expect(parseAuditDiff({ favorites: 3 })).toEqual({ favorites: 3 });
  });
});

describe("GET /api/me/safety", () => {
  it("匿名/无签名 401", async () => {
    const anon = await app.inject({ method: "GET", url: "/api/me/safety" });
    expect(anon.statusCode).toBe(401);
    // 有 identity 但无签名同样 401（与 /api/me/* 同口径）
    const bare = await app.inject({
      method: "GET",
      url: "/api/me/safety",
      headers: { "x-navhub-user-id": USER },
    });
    expect(bare.statusCode).toBe(401);
  });

  it("无记录的新用户：lastExport/lastImport 为 null，overall critical，serverBackup unknown 且不参与计算", async () => {
    const body = await safetyOf("github:u-safety-fresh");
    expect(body.ok).toBe(true);
    expect(body.lastExport).toBeNull();
    expect(body.lastImport).toBeNull();
    expect(body.overall).toBe("critical");
    expect(body.serverBackup).toEqual({ status: "unknown", reason: "not-instrumented" });
    expect(body.sync.favorites).toEqual({ lastSuccessAt: null, lastFailureAt: null, lastErrorCode: null });
    expect(body.sync.watchlist).toEqual({ lastSuccessAt: null, lastFailureAt: null, lastErrorCode: null });
    expect(body.sync.unreadSyncFailures).toBe(0);
    expect(body.checks.map((c: { id: string }) => c.id)).toEqual([
      "export_freshness",
      "sync_failures",
      "vault_and_crdt",
    ]);
    // 响应不缓存：状态每次现算
    const raw = await call("GET", "/api/me/safety", undefined, userHeaders("github:u-safety-fresh"));
    expect(String(raw.headers["cache-control"] ?? "")).toContain("no-store");
  });

  it("actor 隔离：B 用户查不到 A 用户的导出审计", async () => {
    await seedAudit(USER, "user.export", { favorites: 5, folders: 2, searches: 3 }, Date.now());
    const mine = await safetyOf(USER);
    expect(mine.lastExport.at).toBeGreaterThan(0);
    expect(mine.lastExport.counts).toEqual({ favorites: 5, folders: 2, searches: 3 });
    expect(mine.lastExport.format).toBe("json");
    const others = await safetyOf(OTHER);
    expect(others.lastExport).toBeNull();
  });

  it("书签导出审计：format netscape，truncated 为 false", async () => {
    await seedAudit("github:u-safety-netscape", "user.export", { format: "netscape", favorites: 4, truncated: false }, Date.now());
    const body = await safetyOf("github:u-safety-netscape");
    expect(body.lastExport.format).toBe("netscape");
    expect(body.lastExport.truncated).toBe(false);
    expect(body.lastExport.counts.favorites).toBe(4);
  });

  it("导出 truncated：对象形式取或值；历史缺失为 null（是否完整未知）", async () => {
    await seedAudit(
      "github:u-safety-trunc",
      "user.export",
      { favorites: 1, truncated: { favorites: false, history: true } },
      Date.now(),
    );
    const body = await safetyOf("github:u-safety-trunc");
    expect(body.lastExport.truncated).toBe(true);
    // 无 truncated 字段的历史导出
    await seedAudit("github:u-safety-old", "user.export", { favorites: 1 }, Date.now());
    const old = await safetyOf("github:u-safety-old");
    expect(old.lastExport.truncated).toBeNull();
    expect(old.lastExport.sizeBytes).toBeNull();
  });

  it("导入审计：imported 与 skipped（缺失站点 + 截断 + 设置失败）", async () => {
    await seedAudit("github:u-safety-import", "user.import", {
      foldersImported: 1,
      favoritesImported: 2,
      searchesImported: 3,
      favoritesSkippedMissingSite: 1,
      searchesTruncated: 2,
      settingsError: "设置字段不符合当前格式",
    }, Date.now());
    const body = await safetyOf("github:u-safety-import");
    expect(body.lastImport.imported).toEqual({ folders: 1, favorites: 2, searches: 3 });
    expect(body.lastImport.skipped).toBe(4);
  });

  it("导出新鲜度边界：3 天 ok、8 天 warning、31 天 critical", async () => {
    const now = Date.now();
    await seedAudit("github:u-safety-3d", "user.export", { favorites: 0 }, now - 3 * DAY);
    await seedAudit("github:u-safety-8d", "user.export", { favorites: 0 }, now - 8 * DAY);
    await seedAudit("github:u-safety-31d", "user.export", { favorites: 0 }, now - 31 * DAY);
    expect((await safetyOf("github:u-safety-3d")).checks[0].status).toBe("ok");
    expect((await safetyOf("github:u-safety-8d")).checks[0].status).toBe("warning");
    expect((await safetyOf("github:u-safety-31d")).checks[0].status).toBe("critical");
    // 3 天用户：导出 ok，但同步从未成功过 → overall 是 unknown（不冒充 ok）
    expect((await safetyOf("github:u-safety-3d")).overall).toBe("unknown");
  });

  it("user_sync_state：成功写 lastSuccessAt；失败写 lastFailureAt 与错误码；未读失败影响 overall", async () => {
    const u = "github:u-safety-state";
    await seedAudit(u, "user.export", { favorites: 0 }, Date.now() - 2 * DAY);
    await ctx.repo.recordSyncSuccess(u, "favorites");
    await ctx.repo.recordSyncFailure(u, "watchlist", "timeout");
    let body = await safetyOf(u);
    expect(body.sync.favorites.lastSuccessAt).toBeGreaterThan(0);
    expect(body.sync.watchlist.lastFailureAt).toBeGreaterThan(0);
    expect(body.sync.watchlist.lastErrorCode).toBe("timeout");
    // 追剧 1h 内失败 → overall critical
    expect(body.overall).toBe("critical");
    // 未读 sync_failed 通知：成功在 24h 内但有未读失败 → warning
    const ntf = await ctx.repo.createNotification({ identity: u, kind: "sync_failed", title: "收藏同步失败" });
    body = await safetyOf(u);
    expect(body.sync.unreadSyncFailures).toBe(1);
    await ctx.repo.markNotificationRead(u, ntf.id);
    body = await safetyOf(u);
    expect(body.sync.unreadSyncFailures).toBe(0);
  });

  it("金库与 CRDT：vault 行与 crdt:<id> 行如实返回", async () => {
    const u = "github:u-safety-vault";
    await ctx.repo.saveUserVault(u, JSON.stringify({ v: 1 }));
    await ctx.repo.saveUserVault("crdt:" + u, JSON.stringify({ ops: [] }));
    const body = await safetyOf(u);
    expect(body.sync.vault.exists).toBe(true);
    expect(body.sync.vault.version).toBe(1);
    expect(body.sync.crdt.exists).toBe(true);
    expect(body.sync.crdt.updatedAt).toBeGreaterThan(0);
    expect(body.checks[2].status).toBe("ok");
  });

  it("路由已登记 scope + 限流：GET /api/me/safety 在路由清单里且 scope 为 public", async () => {
    const entry = app.routeInventory.find((r) => r.method === "GET" && r.url === "/api/me/safety");
    expect(entry).toBeTruthy();
    expect(entry!.scope).toBe("public");
  });
});

describe("导出审计补 truncated（未来导出）", () => {
  it("JSON 导出审计 diff 带 truncated 两个布尔；书签导出带 truncated:false", async () => {
    const json = await call("GET", "/api/me/export", undefined, userHeaders("github:u-safety-export"));
    expect(json.statusCode).toBe(200);
    const jsonAudit = (await ctx.repo.listAuditLogs({ actor: "github:u-safety-export", action: "user.export", limit: 1 })).items[0];
    expect((jsonAudit!.diff as { truncated: unknown }).truncated).toEqual({ favorites: false, history: false });

    const html = await call("GET", "/api/me/export/bookmarks.html", undefined, userHeaders("github:u-safety-export"));
    expect(html.statusCode).toBe(200);
    const htmlAudit = (await ctx.repo.listAuditLogs({ actor: "github:u-safety-export", action: "user.export", limit: 1 })).items[0];
    expect((htmlAudit!.diff as { format: unknown }).format).toBe("netscape");
    expect((htmlAudit!.diff as { truncated: unknown }).truncated).toBe(false);
  });
});

describe("同步写入点（成功与失败）", () => {
  it("收藏同步成功写 user_sync_state；追剧同步成功写 user_sync_state", async () => {
    const fav = await call("POST", "/api/me/favorites/sync", { ops: [], since: 0 }, userHeaders("github:u-safety-sync"));
    expect(fav.statusCode).toBe(200);
    const favState = await ctx.repo.getUserSyncState("github:u-safety-sync", "favorites");
    expect(favState.lastSuccessAt).toBeGreaterThan(0);

    const watch = await call(
      "POST",
      "/api/me/watchlist/sync",
      { ops: [{ op: "add", key: "k1", title: "剧 1" }], since: 0 },
      userHeaders("github:u-safety-sync"),
    );
    expect(watch.statusCode).toBe(200);
    const watchState = await ctx.repo.getUserSyncState("github:u-safety-sync", "watchlist");
    expect(watchState.lastSuccessAt).toBeGreaterThan(0);
  });

  it("POST /api/me/diagnostics 新增 3 项只读检查，不修复、不改数、复跑一致", async () => {
    const u = "github:u-safety-diag";
    await seedAudit(u, "user.export", { favorites: 0 }, Date.now() - 2 * DAY);
    const before = await ctx.repo.getUserCenterOverview(u);
    const first = await call("POST", "/api/me/diagnostics", {}, userHeaders(u));
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as { checks: Array<{ id: string }>; repairedCount: number };
    expect(firstBody.checks.map((c) => c.id)).toEqual([
      "orphan_folders",
      "history_retention",
      "settings_and_profile",
      "export_freshness",
      "sync_failures",
      "vault_and_crdt",
    ]);
    const second = await call("POST", "/api/me/diagnostics", {}, userHeaders(u));
    const secondBody = second.json() as { checks: Array<{ id: string }>; repairedCount: number };
    expect(secondBody.repairedCount).toBe(firstBody.repairedCount);
    expect(secondBody.checks.map((c) => c.id)).toEqual(firstBody.checks.map((c) => c.id));
    const after = await ctx.repo.getUserCenterOverview(u);
    expect(after.counts).toEqual(before.counts);
  });
});

describe("同步失败三件套（放在最后：临时 DROP 表，测完即恢复）", () => {
  const WATCH_DDL = `CREATE TABLE IF NOT EXISTS watch_entries (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, drama_key TEXT NOT NULL, title TEXT NOT NULL,
    platform_site_id TEXT NOT NULL, platform_title TEXT NOT NULL, play_url TEXT NOT NULL,
    icon TEXT, episode INTEGER NOT NULL DEFAULT 0, priority TEXT NOT NULL DEFAULT 'normal',
    cadence TEXT NOT NULL DEFAULT '{"kind":"unknown"}', remind INTEGER NOT NULL DEFAULT 1,
    dismissed_on TEXT, last_progress_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
  )`;
  const FAV_DDL = `CREATE TABLE IF NOT EXISTS favorites (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, site_id TEXT NOT NULL, folder_id TEXT,
    note TEXT, tags TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
  )`;

  async function outboxCount(identity: string): Promise<number> {
    const rows = await ctx.repo.raw(
      "SELECT COUNT(*) AS c FROM notification_outbox WHERE identity = ? AND kind = 'sync_failed'",
      [identity],
    );
    return Number(rows[0]?.c ?? 0);
  }

  it("追剧同步失败：审计（domain=watchlist）+ 水位 + 通知，60 分钟内二次失败不重发", async () => {
    await ctx.repo.run("DROP TABLE watch_entries");
    try {
      const first = await call(
        "POST",
        "/api/me/watchlist/sync",
        { ops: [{ op: "add", key: "k-fail", title: "剧" }], since: 0 },
        userHeaders(FAIL_USER),
      );
      expect(first.statusCode).toBe(500);
      const audit = (await ctx.repo.listAuditLogs({ actor: FAIL_USER, action: "user.sync_failed", limit: 1 })).items[0];
      expect((audit!.diff as { domain: unknown }).domain).toBe("watchlist");
      const state = await ctx.repo.getUserSyncState(FAIL_USER, "watchlist");
      expect(state.lastFailureAt).toBeGreaterThan(0);
      expect(state.lastErrorCode).toBe("unknown");
      expect(await outboxCount(FAIL_USER)).toBe(1);

      const second = await call(
        "POST",
        "/api/me/watchlist/sync",
        { ops: [{ op: "add", key: "k-fail", title: "剧" }], since: 0 },
        userHeaders(FAIL_USER),
      );
      expect(second.statusCode).toBe(500);
      expect(await outboxCount(FAIL_USER)).toBe(1);
    } finally {
      await ctx.repo.run(WATCH_DDL);
    }
  });

  it("收藏同步失败：审计（domain=favorites）+ 水位；通知沿用 60 分钟去重（不重发）", async () => {
    await ctx.repo.run("DROP TABLE favorites");
    try {
      const res = await call("POST", "/api/me/favorites/sync", { ops: [], since: 0 }, userHeaders(FAIL_USER));
      expect(res.statusCode).toBe(500);
      const audit = (await ctx.repo.listAuditLogs({ actor: FAIL_USER, action: "user.sync_failed", limit: 1 })).items[0];
      expect((audit!.diff as { domain: unknown }).domain).toBe("favorites");
      const state = await ctx.repo.getUserSyncState(FAIL_USER, "favorites");
      expect(state.lastFailureAt).toBeGreaterThan(0);
      // 追剧失败已在 60 分钟内发过 sync_failed 通知，本次不重发
      expect(await outboxCount(FAIL_USER)).toBe(1);
    } finally {
      await ctx.repo.run(FAV_DDL);
      await ctx.repo.run("CREATE UNIQUE INDEX IF NOT EXISTS favorites_user_site_idx ON favorites(user_id, site_id)");
      await ctx.repo.run("CREATE INDEX IF NOT EXISTS favorites_user_idx ON favorites(user_id)");
    }
  });

  it("限流存在：120/分钟——第 121 次请求回 429（放在最后，避免污染本文件其余用例）", async () => {
    let last = 200;
    for (let i = 0; i < 121; i++) {
      const res = await call("GET", "/api/me/safety", undefined, userHeaders("github:u-safety-ratelimit"));
      last = res.statusCode;
    }
    expect(last).toBe(429);
  });
});
