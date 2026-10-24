import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXPORT_HISTORY_LIMIT } from "@navhub/store";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";

/**
 * 第二批与 4.0 用户中心 API：收藏管理、历史分页/删除、设置与信号清理、插件聚合、备份恢复导入、分域清理、导出/注销、金库版本冲突。
 */
const SECRET = "test-secret-please-rotate";
const USER = "github:u-data-api";
const IMPORTER = "github:u-import-honesty";
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

/** 以另一个身份调用（归属隔离用例） */
function other(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
) {
  return data(method, url, payload, signedHeaders("github:other-batch"));
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

  it("batch-delete：zero_results 服务端筛选 + ids 归属过滤 + 超限 400（T4）", async () => {
    // 2 条零结果 + 2 条有命中；再给别的身份造 1 条零结果验证隔离
    await ctx.repo.recordSearch(USER, "零结果 a", 0);
    await ctx.repo.recordSearch(USER, "零结果 b", 0);
    await ctx.repo.recordSearch(USER, "命中 c", 5);
    await ctx.repo.recordSearch("github:other-batch", "别人的零结果", 0);

    const byFilter = await data("POST", "/api/search-history/batch-delete", { filter: "zero_results" });
    expect(byFilter.statusCode).toBe(200);
    // 上面分页用例留下的「历史 0」（resultCount=0）也算零结果：2 新 + 1 旧 = 3
    expect(byFilter.json().removed).toBe(3);
    const after = await data("GET", "/api/search-history?limit=50");
    expect(after.json().items.every((i: { resultCount: number }) => i.resultCount > 0)).toBe(true);

    // ids 路径：删自己的 + 混入他人的 id → 只删自己的
    const page = await data("GET", "/api/search-history?limit=1");
    const mine = page.json().items[0]!.id as number;
    const otherPage = await other("GET", "/api/search-history?limit=1");
    const otherId = otherPage.json().items[0]!.id as number;
    const byIds = await data("POST", "/api/search-history/batch-delete", { ids: [mine, otherId] });
    expect(byIds.statusCode).toBe(200);
    expect(byIds.json().removed).toBe(1);

    const tooMany = await data("POST", "/api/search-history/batch-delete", {
      ids: Array.from({ length: 201 }, (_, i) => i + 1),
    });
    expect(tooMany.statusCode).toBe(400);

    const neither = await data("POST", "/api/search-history/batch-delete", {});
    expect(neither.statusCode).toBe(400);
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

  it("GET /api/me/settings 对「从未保存过」的身份给 updatedAt=0，PATCH 后转正", async () => {
    // 前端 use-me-settings 的「本机匿名偏好先上云，别被默认值冲掉」判定完全依赖这条契约：
    // updatedAt === 0 ⇔ user_settings 里还没有这一行。这里把它钉住，防止服务端改成
    // 「无行也回 Date.now()」而让本机偏好在登录后被默认值静默覆盖。
    const fresh = signedHeaders("github:u-settings-never-saved");
    const before = await data("GET", "/api/me/settings", undefined, fresh);
    expect(before.statusCode).toBe(200);
    expect(before.json().settings.updatedAt).toBe(0);

    const patch = await data(
      "PATCH",
      "/api/me/settings",
      { defaultSearchEngine: "bing", cardDensity: "compact" },
      fresh,
    );
    expect(patch.statusCode).toBe(200);
    expect(patch.json().settings.updatedAt).toBeGreaterThan(0);

    const after = await data("GET", "/api/me/settings", undefined, fresh);
    expect(after.json().settings.updatedAt).toBeGreaterThan(0);
    expect(after.json().settings.defaultSearchEngine).toBe("bing");
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

describe("备份导入：恢复多少就报多少", () => {
  const importer = () => signedHeaders(IMPORTER);
  // /api/me/import 有每身份每分钟 10 次的限流；这里测的是恢复语义，
  // 用独立来源地址给每次请求换一个新的计数桶，免得把限流当成断言失败。
  let importSeq = 0;
  const importBackup = (payload: unknown, headers = importer()) =>
    app.inject({
      method: "POST",
      url: "/api/me/import",
      remoteAddress: `10.77.${Math.floor(importSeq / 200)}.${(importSeq++ % 200) + 3}`,
      headers,
      payload: payload as never,
    });
  // 断言「库里真的多了几条」：次数按导入前的基线算，免得受同组前序用例写入的记录影响
  const historyCount = async () => (await ctx.repo.listSearchHistory(IMPORTER, EXPORT_HISTORY_LIMIT)).length;

  it("干净备份：跳过/截断/设置错误全部如实归零，并回传上限供界面使用", async () => {
    const res = await importBackup({
      favoriteFolders: [{ id: "old-f1", name: "诚实导入夹" }],
      favorites: [{ siteId, folderId: "old-f1", note: "导入备注" }],
      searchHistory: { items: [{ query: "诚实关键词", resultCount: 3 }] },
      settings: { defaultSearchEngine: "bing" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.foldersImported).toBe(1);
    expect(body.favoritesImported).toBe(1);
    expect(body.favoritesSkipped).toBe(0);
    expect(body.favoritesSkippedMissingSite).toBe(0);
    expect(body.searchesImported).toBe(1);
    expect(body.searchesTruncated).toBe(0);
    expect(body.nextHistoryOffset).toBeNull();
    expect(body.settingsRestored).toBe(true);
    expect(body.settingsError).toBeNull();
    expect(body.backupHistoryTruncated).toBe(false);
    // 上限由服务端回传，界面不许自己写死
    expect(body.historyImportCap).toBeGreaterThan(0);
    expect(body.historyExportLimit).toBe(EXPORT_HISTORY_LIMIT);
    expect(body.historyExportLimit).toBeGreaterThan(body.historyImportCap);

    // 设置确实落库
    const settings = await data("GET", "/api/me/settings", undefined, importer());
    expect(settings.json().settings.defaultSearchEngine).toBe("bing");
  });

  it("两种「跳过」分开计数：站点已下架 ≠ 你已经收藏过", async () => {
    const res = await importBackup({
      favoriteFolders: [{ id: "old-f1", name: "诚实导入夹" }],
      favorites: [
        { siteId, folderId: "old-f1" },
        { siteId: "site-has-been-removed" },
      ],
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.foldersImported).toBe(0);
    expect(body.favoritesImported).toBe(0);
    expect(body.favoritesSkipped).toBe(2);
    expect(body.favoritesSkippedMissingSite).toBe(1);
    // 混在一个数里时用户无从判断「再收藏一次就好」还是「站点真的没了」
    expect(body.favoritesSkipped - body.favoritesSkippedMissingSite).toBe(1);
  });

  it("超出单次上限的历史：写入按上限、剩余条数与续导起点都回传", async () => {
    const total = 260;
    const before = await historyCount();
    const items = Array.from({ length: total }, (_, i) => ({ query: `批量历史-${i}`, resultCount: i }));
    const res = await importBackup({ searchHistory: { items } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.searchesImported).toBe(body.historyImportCap);
    expect(body.searchesSkippedDuplicate).toBe(0);
    expect(body.searchesTruncated).toBe(total - body.historyImportCap);
    expect(body.nextHistoryOffset).toBe(body.historyImportCap);

    // 库里确实只多了 cap 条：截断是写入边界，不是提示文案
    expect(await historyCount()).toBe(before + body.historyImportCap);
  });

  it("按 nextHistoryOffset 续导：窗口真的往前推，导完后不再申报截断", async () => {
    const total = 260;
    const before = await historyCount();
    const items = Array.from({ length: total }, (_, i) => ({ query: `续导历史-${i}`, resultCount: i }));
    const first = (await importBackup({ searchHistory: { items } })).json();

    const res = await importBackup({ searchHistory: { items }, searchHistoryOffset: first.nextHistoryOffset });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // 续导拿到的必须是后半批，而不是把前 200 条去重一遍后报「0 条导入 + 依然截断」
    expect(body.searchesImported).toBe(total - first.historyImportCap);
    expect(body.searchesTruncated).toBe(0);
    expect(body.nextHistoryOffset).toBeNull();
    expect(await historyCount()).toBe(before + total);

    // 重复提交同一份备份：一条也不会写两遍，并且界面拿得到「为什么是 0 条」
    const again = await importBackup({ searchHistory: { items } });
    expect(again.json().searchesImported).toBe(0);
    expect(again.json().searchesSkippedDuplicate).toBe(again.json().historyImportCap);
    expect(await historyCount()).toBe(before + total);
  });

  it("备份自身被导出侧截断过时，接口把这件事带回来", async () => {
    const res = await importBackup({
      searchHistory: { items: [{ query: "截断备份里的关键词" }], truncated: true },
    });
    expect(res.json().backupHistoryTruncated).toBe(true);
    expect(res.json().historyExportLimit).toBe(EXPORT_HISTORY_LIMIT);

    // 数组形态的旧备份没有这个标记，不得凭空报 true
    const legacy = await importBackup({ searchHistory: [{ query: "旧格式关键词" }] });
    expect(legacy.statusCode).toBe(200);
    expect(legacy.json().backupHistoryTruncated).toBe(false);
  });

  it("设置校验失败要回传原因，而不是静默丢掉", async () => {
    const res = await importBackup({
      favoriteFolders: [{ id: "old-f2", name: "设置失败也要说" }],
      settings: { defaultSearchEngine: "yahoo" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.settingsRestored).toBe(false);
    expect(typeof body.settingsError).toBe("string");
    expect(body.settingsError.length).toBeGreaterThan(0);
    expect(body.foldersImported).toBe(1);

    // 其余部分照常恢复，但设置没被写坏
    const settings = await data("GET", "/api/me/settings", undefined, importer());
    expect(settings.json().settings.defaultSearchEngine).toBe("bing");

    const empty = await importBackup({ settings: {} });
    expect(empty.json().settingsRestored).toBe(false);
    expect(empty.json().settingsError).toContain("至少");
  });

  it("条数超限的 400 点名是哪个字段；达到导出上限的备份不再被整份拒收", async () => {
    const tooManyFolders = Array.from({ length: 1001 }, (_, i) => ({ id: `f-${i}`, name: `夹-${i}` }));
    const rejected = await importBackup({ favoriteFolders: tooManyFolders });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error).toContain("favoriteFolders");

    // 这是本轮修的真缺陷：导入上限原本低于导出上限，
    // 用户拿一份「刚好导满」的合法备份来恢复会被整份 400，收藏与设置一起导不进来。
    const atExportLimit = Array.from({ length: EXPORT_HISTORY_LIMIT }, (_, i) => ({ query: `上限-${i}` }));
    const accepted = await importBackup(
      {
        favoriteFolders: [{ id: "old-f3", name: "满额备份" }],
        searchHistory: { items: atExportLimit, truncated: true },
        settings: { telemetryEnabled: false },
      },
    );
    expect(accepted.statusCode).toBe(200);
    const body = accepted.json();
    expect(body.foldersImported).toBe(1);
    expect(body.searchesImported).toBe(body.historyImportCap);
    expect(body.searchesTruncated).toBe(EXPORT_HISTORY_LIMIT - body.historyImportCap);
    expect(body.settingsRestored).toBe(true);
  });

  it("身份未受信仍然 401（新增字段不改变鉴权边界）", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/me/import",
      headers: { "x-navhub-user-id": IMPORTER },
      payload: { favoriteFolders: [] } as never,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("备份导入 T2：星标/评价重放 + 格式版本判别", () => {
  // 与上一组同法：/api/me/import 限流 10/min/来源，逐次换地址拿新桶
  let t2Seq = 500;
  const t2Import = (payload: unknown) =>
    app.inject({
      method: "POST",
      url: "/api/me/import",
      remoteAddress: `10.88.0.${(t2Seq++ % 200) + 3}`,
      headers: signedHeaders(IMPORTER),
      payload: payload as never,
    });
  const themeManifest = (name: string) => ({
    manifestVersion: 1,
    kind: "theme" as const,
    name,
    description: "T2 导入重放测试用主题",
    version: "1.0.0",
    payload: { accent: "violet" },
  });

  beforeAll(async () => {
    await ctx.repo.createPlugin(
      { manifest: themeManifest("T2 已安装主题"), slug: "t2-installed-theme", status: "published", source: "seed", author: "测试" },
      { actor: "test", actorKind: "system" },
    );
    await ctx.repo.createPlugin(
      { manifest: themeManifest("T2 未安装主题"), slug: "t2-not-installed-theme", status: "published", source: "seed", author: "测试" },
      { actor: "test", actorKind: "system" },
    );
    // 评价门禁要求活跃安装：只给第一个插件装上
    await ctx.repo.installPlugin("t2-installed-theme", IMPORTER);
  });

  it("星标重放：导入/备份内重复/插件缺失分开计数", async () => {
    const res = await t2Import({
      pluginStars: [
        { slug: "t2-installed-theme" },
        { slug: "t2-installed-theme" },
        { slug: "no-such-plugin" },
      ],
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.starsImported).toBe(1);
    expect(body.starsSkippedDuplicate).toBe(1);
    expect(body.starsSkippedMissing).toBe(1);
  });

  it("评价重放：遵守「已安装才可评」门禁，未安装/缺失如实跳过", async () => {
    const res = await t2Import({
      pluginReviews: [
        { slug: "t2-installed-theme", rating: 5, title: "好用", content: "导入恢复的评价" },
        { slug: "t2-not-installed-theme", rating: 4 },
        { slug: "no-such-plugin", rating: 3 },
      ],
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.reviewsImported).toBe(1);
    expect(body.reviewsSkippedNotInstalled).toBe(1);
    expect(body.reviewsSkippedMissing).toBe(1);
  });

  it("备份 schemaVersion 比当前服务新 -> 400 并点名版本", async () => {
    const res = await t2Import({ schemaVersion: 99, favorites: [] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("v99");
  });

  it("导出带 schemaVersion=1 与收藏截断口径，往返上限同源", async () => {
    const res = await data("GET", "/api/me/export");
    expect(res.statusCode).toBe(200);
    expect(res.json().schemaVersion).toBe(1);
    expect(res.json().favoritesTruncated).toBe(false);
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
