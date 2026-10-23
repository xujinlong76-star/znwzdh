import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";

/**
 * 第二批与 4.0 用户中心 API：收藏管理、历史分页/删除、设置与信号清理、插件聚合、备份恢复导入、分域清理、导出/注销、金库版本冲突。
 */
const SECRET = "test-secret-please-rotate";
const USER = "github:u-data-api";
const ANON = "anon-33333333-3333-3333-3333-333333333333";

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
let siteId = "";

const signedHeaders = (identity: string) => ({
  "x-navhub-user-id": identity,
  "x-navhub-identity-signature": signIdentity(SECRET, identity),
});
const userHeaders = () => signedHeaders(USER);

/** 终端数据接口（收藏/历史/画像/金库）：签名身份 + 普通 URL */
function data(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
  headers: Record<string, string> = userHeaders(),
) {
  return app.inject({ method, url, headers, payload: payload as never });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-me-data-"));
  ctx = await createContext(
    loadConfig({ ...base, sqlitePath: join(dir, "me-data.db"), identitySecret: SECRET }),
  );
  app = await buildServer(ctx);
  await app.ready();
  const cat = await ctx.repo.createCategory({ title: "数据 API" });
  siteId = (
    await ctx.repo.createSite({ url: "https://me-data.example.com", title: "Data Site", categoryId: cat.id })
  ).id;
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("收藏管理 API", () => {
  it("PATCH 修改文件夹与备注；无效文件夹 400", async () => {
    await data("POST", "/api/favorites", { siteId });
    const folderRes = await data("POST", "/api/favorites/folders", { name: "API 夹" });
    const folderId = folderRes.json().id as string;

    const ok = await data("PATCH", "/api/favorites/" + siteId, { folderId, note: "备注" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().favorite.folderId).toBe(folderId);
    expect(ok.json().favorite.note).toBe("备注");

    const bad = await data("PATCH", "/api/favorites/" + siteId, { folderId: "no-such-folder" });
    expect(bad.statusCode).toBe(400);

    const rename = await data("PATCH", "/api/favorites/folders/" + folderId, { name: "改名" });
    expect(rename.statusCode).toBe(200);
    expect(rename.json().folder.name).toBe("改名");
  });

  it("DELETE /api/favorites 清空该身份收藏", async () => {
    const res = await data("DELETE", "/api/favorites");
    expect(res.statusCode).toBe(200);
    expect(res.json().removed).toBe(1);
    const list = await data("GET", "/api/favorites");
    expect(list.json().items).toEqual([]);
  });
});

describe("搜索历史 API", () => {
  it("分页返回 id/hasMore，单条删除校验归属", async () => {
    for (let i = 0; i < 3; i++) await ctx.repo.recordSearch(USER, `历史 ${i}`, i);
    const page = await data("GET", "/api/search-history?limit=2");
    expect(page.statusCode).toBe(200);
    const body = page.json();
    expect(body.items).toHaveLength(2);
    expect(body.hasMore).toBe(true);
    expect(typeof body.items[0].id).toBe("number");

    const del = await data("DELETE", "/api/search-history/" + body.items[0].id);
    expect(del.statusCode).toBe(200);

    const missing = await data("DELETE", "/api/search-history/999999");
    expect(missing.statusCode).toBe(404);
  });
});

describe("设置与画像信号", () => {
  it("GET /api/me 带设置；PATCH 可关闭个性化与更新扩展偏好", async () => {
    const before = await data("GET", "/api/me");
    expect(before.json().settings.personalizationEnabled).toBe(true);
    expect(before.json().settings.defaultSearchEngine).toBe("internal");

    const patch = await data("PATCH", "/api/me/settings", {
      personalizationEnabled: false,
      defaultSearchEngine: "google",
      cardDensity: "compact",
      historyRetentionDays: 30,
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().settings.personalizationEnabled).toBe(false);
    expect(patch.json().settings.defaultSearchEngine).toBe("google");
    expect(patch.json().settings.cardDensity).toBe("compact");
    expect(patch.json().settings.historyRetentionDays).toBe(30);

    const explain = await data("GET", "/api/profile?explain=1");
    expect(explain.statusCode).toBe(200);
    expect(explain.json().explain.personalizationEnabled).toBe(false);
    expect(explain.json().explain.signalCounts).toHaveProperty("searches");
  });

  it("PATCH /api/me/settings 支持 favoriteSignalCutoff，并拒绝越界值", async () => {
    const stamp = 1700000000000;
    const patch = await data("PATCH", "/api/me/settings", { favoriteSignalCutoff: stamp });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().settings.favoriteSignalCutoff).toBe(stamp);

    const negative = await data("PATCH", "/api/me/settings", { favoriteSignalCutoff: -1 });
    expect(negative.statusCode).toBe(400);
    const absurd = await data("PATCH", "/api/me/settings", { favoriteSignalCutoff: Number.MAX_SAFE_INTEGER });
    expect(absurd.statusCode).toBe(400);
    const empty = await data("PATCH", "/api/me/settings", {});
    expect(empty.statusCode).toBe(400);

    // 读回仍是合法值：越界请求不得留下脏数据
    const after = await data("GET", "/api/me/settings");
    expect(after.json().settings.favoriteSignalCutoff).toBe(stamp);
  });

  it("POST /api/me/diagnostics 自动巡检并修复孤儿收藏夹引用", async () => {
    const diag = await data("POST", "/api/me/diagnostics", {});
    expect(diag.statusCode).toBe(200);
    expect(diag.json().ok).toBe(true);
    expect(Array.isArray(diag.json().checks)).toBe(true);
  });

  it("GET /api/me/plugins 聚合返回已安装、星标与评价列表", async () => {
    const res = await data("GET", "/api/me/plugins");
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(Array.isArray(res.json().installed)).toBe(true);
    expect(Array.isArray(res.json().starred)).toBe(true);
    expect(Array.isArray(res.json().reviews)).toBe(true);
  });

  it("POST /api/me/import 支持从备份 JSON 幂等恢复收藏夹、收藏、历史与设置", async () => {
    const res = await data("POST", "/api/me/import", {
      favoriteFolders: [{ id: "old-f1", name: "导入夹" }],
      favorites: [{ siteId, folderId: "old-f1", note: "导入备注" }],
      searchHistory: { items: [{ query: "导入关键词", resultCount: 5 }] },
      settings: { defaultSearchEngine: "duckduckgo" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().favoritesImported).toBeGreaterThanOrEqual(1);
    expect(res.json().settingsRestored).toBe(true);
  });

  it("POST /api/me/prune 支持按域精细化清理而保留收藏", async () => {
    const prune = await data("POST", "/api/me/prune", { domains: ["search_history", "events_profile"] });
    expect(prune.statusCode).toBe(200);
    expect(prune.json().ok).toBe(true);
    expect(await ctx.repo.listFavorites(USER)).toHaveLength(1);
  });

  it("DELETE /api/profile/signals/click 清空点击事件", async () => {
    await ctx.repo.recordEvent("click", { siteId, identity: USER });
    const res = await data("DELETE", "/api/profile/signals/click");
    expect(res.statusCode).toBe(200);
    expect(res.json().removed).toBeGreaterThanOrEqual(1);
    const rows = await ctx.repo.raw("SELECT COUNT(*) AS c FROM events WHERE identity = ? AND kind = 'click'", [USER]);
    expect(Number(rows[0]?.c ?? 0)).toBe(0);
  });

  it("DELETE /api/profile/signals/favorite 推进收藏信号水位", async () => {
    await ctx.repo.addFavorite({ userId: USER, siteId });
    const res = await data("DELETE", "/api/profile/signals/favorite");
    expect(res.statusCode).toBe(200);
    const settings = await ctx.repo.getUserSettings(USER);
    expect(settings.favoriteSignalCutoff).toBeGreaterThan(0);
    // 收藏本身保留
    expect(await ctx.repo.listFavorites(USER)).toHaveLength(1);
  });

  it("非法 kind -> 400", async () => {
    const res = await data("DELETE", "/api/profile/signals/bogus");
    expect(res.statusCode).toBe(400);
  });
});

describe("金库版本前置条件", () => {
  it("旧版本写入 -> 409 并返回当前版本", async () => {
    const first = await data("PUT", "/api/vault/sync", { payload: "cipher-1", version: 0 });
    expect(first.statusCode).toBe(200);
    expect(first.json().version).toBe(1);

    const stale = await data("PUT", "/api/vault/sync", { payload: "cipher-2", version: 0 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().current.version).toBe(1);
    expect(stale.headers.etag).toBe('"1"');

    const ok = await data("PUT", "/api/vault/sync", { payload: "cipher-2" }, { ...userHeaders(), "if-match": 'W/"1"' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().version).toBe(2);
  });
});

describe("数据主权", () => {
  it("导出为 JSON 附件且不含密钥", async () => {
    const res = await data("GET", "/api/me/export");
    expect(res.statusCode).toBe(200);
    expect(String(res.headers["content-disposition"])).toContain("attachment");
    const body = res.json();
    expect(body.identity).toBe(USER);
    expect(body).toHaveProperty("favorites");
    expect(body).toHaveProperty("searchHistory");
    expect(JSON.stringify(body)).not.toContain("apiKeyEnc");
  });

  it("DELETE /api/me 必须二次确认；匿名身份 403", async () => {
    const wrong = await data("DELETE", "/api/me", { confirm: "delete" });
    expect(wrong.statusCode).toBe(400);

    const anon = await data("DELETE", "/api/me", { confirm: "DELETE" }, signedHeaders(ANON));
    expect(anon.statusCode).toBe(403);
  });

  it("DELETE /api/me 清空数据后概览归零", async () => {
    const res = await data("DELETE", "/api/me", { confirm: "DELETE" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    const overview = await data("GET", "/api/me");
    expect(overview.json().counts.favorites).toBe(0);
    expect(overview.json().counts.searches).toBe(0);
    expect(overview.json().vault.exists).toBe(false);
    expect(overview.json().settings.personalizationEnabled).toBe(true);
  });
});
