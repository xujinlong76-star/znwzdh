/**
 * 收藏的云端同步：**失败必须说出来**，且登录/匿名走不同通道。
 *
 * 历史缺陷（改动前）：逐条 `addFavorite` + 全量 `listFavorites`，中枢不可达时
 * 每条都等满超时；失败与「云端确实没有收藏」不可区分，用户以为已同步。
 *
 * 当前契约（M1 批量同步）：
 *   - 登录用户：一次 `POST /api/me/favorites/sync`（ops + since），响应即增量
 *     （含墓碑）。**不再逐条推、不再单独 GET**；
 *   - 匿名用户：新端点只接受会话派生身份，因此保持旧的逐条通道（首条失败即中止）；
 *   - `cloud` 失败时必须为 null（空数组只表示「云端确实没有收藏」）；
 *   - `nextItems` 是算好的本地结果：全量（since=0）走云端覆盖，增量（since>0）
 *     走逐行 upsert——**增量绝不能做全量合并**，否则会删掉本地未推送的条目；
 *   - 游标只在完整成功后推进；写不进去就下次走全量（幂等）。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { syncFavoritesToCloud } from "../src/hooks/useFavorites";

const HERE = dirname(fileURLToPath(import.meta.url));

/** 定位并读取 overlay 里的文件；镜像副本（apps/web/test）不会被误当成源 */
function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return readFileSync(hit, "utf8");
}

interface FetchCall {
  method: string;
  url: string;
  body?: string;
}

const originalFetch = globalThis.fetch;
const globals = globalThis as unknown as { window?: unknown; localStorage?: unknown };
let lastStore: Record<string, string> = {};

/** 伪造 localStorage + window（node 环境没有），让身份与本地收藏可用 */
function installStorage(entries: Record<string, string>): void {
  const store: Record<string, string> = { ...entries };
  lastStore = store;
  const localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
  };
  globals.localStorage = localStorage;
  globals.window = {
    localStorage,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

function localItems(siteIds: string[]): string {
  return JSON.stringify(
    siteIds.map((siteId) => ({ siteId, title: "站点 " + siteId, href: "https://example.com/" + siteId, createdAt: 1 })),
  );
}

/** 登录态 + 本地收藏 */
function signedIn(siteIds: string[]): void {
  installStorage({ "navhub.userId": "user-1", "navhub.favorites.v1": localItems(siteIds) });
}

/** 匿名态 + 本地收藏 */
function anonUser(siteIds: string[]): void {
  installStorage({
    "navhub.anonId": "anon-11111111-2222-3333-4444-555555555555",
    "navhub.favorites.v1": localItems(siteIds),
  });
}

/**
 * 按序应答的 fetch 替身：seq 用尽后重复最后一项，便于断言「只发了一次」。
 * "network" 表示网络层失败（服务未启动 / DNS / 断网）。
 */
function stubFetch(seq: Array<number | "network">, bodies: Record<number, string> = {}): FetchCall[] {
  const calls: FetchCall[] = [];
  let i = 0;
  globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string }) => {
    calls.push({ method: (init?.method ?? "GET").toUpperCase(), url: String(input), body: init?.body });
    const next = seq.length === 0 ? 200 : seq[Math.min(i, seq.length - 1)];
    i++;
    if (next === "network") throw new TypeError("fetch failed");
    return {
      ok: next >= 200 && next < 300,
      status: next,
      text: async () => bodies[next] ?? "",
    } as unknown as Response;
  }) as typeof fetch;
  return calls;
}

const EMPTY_CLOUD = JSON.stringify({ items: [], folders: [] });

function batchBody(
  items: Array<{ siteId: string; title?: string; deletedAt?: number | null; note?: string | null; folderId?: string | null }>,
  version = 999,
): string {
  return JSON.stringify({
    ok: true,
    applied: items.length,
    version,
    items: items.map((item) => ({
      siteId: item.siteId,
      folderId: item.folderId ?? null,
      note: item.note ?? null,
      createdAt: 1,
      deletedAt: item.deletedAt ?? null,
      site: item.deletedAt ? null : { url: "https://example.com/" + item.siteId, title: item.title ?? "A" },
    })),
    folders: [],
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete globals.window;
  delete globals.localStorage;
  lastStore = {};
});

describe("未登录：不假装同步过", () => {
  it("没有身份时直接给出原因，且一个请求都不发", async () => {
    // 不装 window：getIdentity() 在无 window 时返回空串（浏览器里总会回落 anon，
    // 这条测的是「拿到空身份」的防御分支）
    const calls = stubFetch([200]);
    const r = await syncFavoritesToCloud();
    expect(calls).toEqual([]);
    expect(r.ok).toBe(false);
    expect(r.cloud).toBeNull();
    expect(r.nextItems).toBeNull();
    expect(r.retryable).toBe(false);
    expect(r.error).toContain("未登录");
  });
});

describe("登录用户：一次批量同步", () => {
  it("只发一个 POST 到 /api/me/favorites/sync，不再逐条推 + GET", async () => {
    signedIn(["a", "b"]);
    const calls = stubFetch([200], { 200: batchBody([{ siteId: "a" }, { siteId: "b" }]) });
    const r = await syncFavoritesToCloud();
    expect(calls.length).toBe(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toContain("/api/me/favorites/sync");
    expect(r.ok).toBe(true);
    expect(r.pushed).toBe(2);
    expect(r.cloud?.map((i) => i.siteId).sort()).toEqual(["a", "b"]);
    expect(r.nextItems?.map((i) => i.siteId).sort()).toEqual(["a", "b"]);
  });

  it("成功后推进游标；失败时游标不动", async () => {
    signedIn(["a"]);
    stubFetch([200], { 200: batchBody([{ siteId: "a" }], 1234) });
    await syncFavoritesToCloud();
    expect(lastStore["navhub.favorites.sync.v1.user-1"]).toBe("1234");

    delete lastStore["navhub.favorites.sync.v1.user-1"];
    stubFetch([502]);
    await syncFavoritesToCloud();
    expect(lastStore["navhub.favorites.sync.v1.user-1"]).toBeUndefined();
  });

  it("首次（since=0）是全量语义：云端没有的本地条目会被移除", async () => {
    signedIn(["a", "stale"]);
    stubFetch([200], { 200: batchBody([{ siteId: "a" }]) });
    const r = await syncFavoritesToCloud();
    expect(r.nextItems?.map((i) => i.siteId)).toEqual(["a"]);
  });

  it("增量（since>0）绝不整表替换：本地未推送的条目必须保留", async () => {
    signedIn(["a", "local-only"]);
    installStorage({
      "navhub.userId": "user-1",
      "navhub.favorites.v1": localItems(["a", "local-only"]),
      "navhub.favorites.sync.v1.user-1": "100",
    });
    stubFetch([200], { 200: batchBody([{ siteId: "a", title: "云端改名" }], 200) });
    const r = await syncFavoritesToCloud();
    const ids = r.nextItems?.map((i) => i.siteId).sort();
    expect(ids).toEqual(["a", "local-only"]);
    expect(r.nextItems?.find((i) => i.siteId === "a")?.title).toBe("云端改名");
  });

  it("墓碑传播删除：deletedAt 非空的条目从本地移除", async () => {
    signedIn(["a", "b"]);
    installStorage({
      "navhub.userId": "user-1",
      "navhub.favorites.v1": localItems(["a", "b"]),
      "navhub.favorites.sync.v1.user-1": "100",
    });
    stubFetch([200], { 200: batchBody([{ siteId: "a", deletedAt: 123 }], 300) });
    const r = await syncFavoritesToCloud();
    expect(r.nextItems?.map((i) => i.siteId)).toEqual(["b"]);
  });

  it("请求体带 ops 与 since（mock 不校验 body 就是假绿）", async () => {
    signedIn(["a", "b"]);
    const calls = stubFetch([200], { 200: batchBody([{ siteId: "a" }, { siteId: "b" }]) });
    await syncFavoritesToCloud();
    const payload = JSON.parse(calls[0].body ?? "{}") as { ops: unknown[]; since: number };
    expect(payload.ops).toHaveLength(2);
    expect(payload.since).toBe(0);
  });

  it("超过 500 条自动分片：每片 <=500，不会因 400 变成永久失败", async () => {
    const many = Array.from({ length: 501 }, (_, i) => "s" + i);
    signedIn(many);
    const calls = stubFetch([200], { 200: batchBody([{ siteId: "s0" }]) });
    const r = await syncFavoritesToCloud();
    expect(r.ok).toBe(true);
    expect(calls.length).toBe(2);
    for (const call of calls) {
      const payload = JSON.parse(call.body ?? "{}") as { ops: unknown[] };
      expect(payload.ops.length).toBeLessThanOrEqual(500);
    }
  });

  it("本机为空但已有游标：仍拉一次增量（否则永不知云端新增）", async () => {
    installStorage({ "navhub.userId": "user-1", "navhub.favorites.sync.v1.user-1": "500" });
    const calls = stubFetch([200], { 200: batchBody([{ siteId: "remote-new" }], 600) });
    const r = await syncFavoritesToCloud();
    expect(calls.length).toBe(1);
    const payload = JSON.parse(calls[0].body ?? "{}") as { ops: unknown[]; since: number };
    expect(payload.ops).toHaveLength(0);
    expect(payload.since).toBe(500);
    expect(r.nextItems?.map((i) => i.siteId)).toEqual(["remote-new"]);
  });

  it("401 说的是登录过期，不是「更新 API Token」", async () => {
    signedIn(["a"]);
    stubFetch([401]);
    const r = await syncFavoritesToCloud();
    expect(r.ok).toBe(false);
    expect(r.error).toContain("登录已过期");
  });

  it("批量请求失败：重试耗尽后 cloud/nextItems 仍为 null，并给出可重试原因", async () => {
    signedIn(["a", "b"]);
    const calls = stubFetch([502]);
    const r = await syncFavoritesToCloud();
    // 5xx 会退避重试两次（300/900ms），因此是 3 次而不是 1 次；结果语义不变
    expect(calls.length).toBe(3);
    expect(r.ok).toBe(false);
    expect(r.cloud).toBeNull();
    expect(r.nextItems).toBeNull();
    expect(r.retryable).toBe(true);
    expect(r.error).toBeTruthy();
  });

  it("404 不值得重试，5xx 值得（不要给用户一个按了也没用的按钮）", async () => {
    signedIn(["a"]);
    stubFetch([404]);
    expect((await syncFavoritesToCloud()).retryable).toBe(false);
    stubFetch([500]);
    expect((await syncFavoritesToCloud()).retryable).toBe(true);
  });
});

describe("匿名用户：保持逐条通道（新端点只给登录态）", () => {
  it("逐条推上云端，再拉回云端列表", async () => {
    anonUser(["a", "b"]);
    const calls = stubFetch([200, 200, 200], { 200: EMPTY_CLOUD });
    const r = await syncFavoritesToCloud();
    expect(r.ok).toBe(true);
    expect(r.pushed).toBe(2);
    expect(r.cloud).toEqual([]);
    expect(r.nextItems).toEqual([]);
    expect(calls.filter((c) => c.method === "POST").length).toBe(2);
    expect(calls.filter((c) => c.method === "GET").length).toBe(1);
    // 匿名不得打批量端点（会 401）
    expect(calls.every((c) => !c.url.includes("/api/me/favorites/sync"))).toBe(true);
  });

  it("首条失败即中止，不再为剩余每条各等满一次超时", async () => {
    anonUser(["a", "b", "c"]);
    const calls = stubFetch([502]);
    const r = await syncFavoritesToCloud();
    expect(r.ok).toBe(false);
    expect(r.pushed).toBe(0);
    expect(r.nextItems).toBeNull();
    expect(calls.length).toBe(1);
  });

  it("推送成功但拉取失败：cloud 必须是 null（失败 ≠ 云端没有收藏）", async () => {
    anonUser(["a"]);
    const calls = stubFetch([200, 503]);
    const r = await syncFavoritesToCloud();
    expect(r.ok).toBe(false);
    expect(r.pushed).toBe(1);
    expect(r.cloud).toBeNull();
    expect(r.nextItems).toBeNull();
    expect(calls.map((c) => c.method)).toEqual(["POST", "GET"]);
  });

  it("网络层失败（中枢没启动 / 断网）不抛异常", async () => {
    anonUser(["a"]);
    const calls = stubFetch(["network"]);
    const r = await syncFavoritesToCloud();
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
    expect(r.retryable).toBe(true);
    expect(calls.length).toBe(1);
  });
});

describe("M1 二期：有限重试 / 墓碑提示 / 同步状态", () => {
  it("5xx 可重试：退避后第二次成功（只多一次往返）", async () => {
    signedIn(["a"]);
    const calls = stubFetch([502, 200], { 200: batchBody([{ siteId: "a" }]) });
    const r = await syncFavoritesToCloud();
    expect(r.ok).toBe(true);
    expect(calls.length).toBe(2);
  });

  it("404 不可重试：不浪费第二次请求", async () => {
    signedIn(["a"]);
    const calls = stubFetch([404, 200], { 200: batchBody([{ siteId: "a" }]) });
    const r = await syncFavoritesToCloud();
    expect(r.ok).toBe(false);
    expect(calls.length).toBe(1);
  });

  it("墓碑计数透出：另一台设备删了几条，页面上就要说几条", async () => {
    signedIn(["a", "b"]);
    installStorage({
      "navhub.userId": "user-1",
      "navhub.favorites.v1": localItems(["a", "b"]),
      "navhub.favorites.sync.v1.user-1": "100",
    });
    stubFetch([200], { 200: batchBody([{ siteId: "a", deletedAt: 123 }], 200) });
    const r = await syncFavoritesToCloud();
    expect(r.remoteRemoved).toBe(1);
  });

  it("同步状态落盘：成功与失败都可读回（页面上「上次同步」用它）", async () => {
    signedIn(["a"]);
    stubFetch([200], { 200: batchBody([{ siteId: "a" }]) });
    await syncFavoritesToCloud();
    const ok = JSON.parse(lastStore["navhub.favorites.sync.last"] ?? "{}") as { ok: boolean; pushed: number };
    expect(ok.ok).toBe(true);
    expect(ok.pushed).toBe(1);

    stubFetch([502]);
    await syncFavoritesToCloud();
    const bad = JSON.parse(lastStore["navhub.favorites.sync.last"] ?? "{}") as { ok: boolean; error?: string };
    expect(bad.ok).toBe(false);
    expect(bad.error).toBeTruthy();
  });
});

describe("源码守卫：这套契约不许被改回去", () => {
  it("favorites 页会展示失败原因与重试，而不是静默", () => {
    const src = overlaySource("src/app/favorites/page.tsx");
    expect(src).toContain("云端同步失败");
    expect(src).toContain("换设备登录可能看不到");
    expect(src).toContain("重试同步");
    expect(src).toContain("runCloudSync");
    expect(src).not.toContain("if (cloud && cloud.length > 0)");
  });

  it("登录态批量 / 匿名逐条双分支，且增量不和全量合并混用", () => {
    const hook = overlaySource("src/hooks/useFavorites.ts");
    expect(hook).toContain("identity.startsWith('anon-')");
    expect(hook).toContain("syncFavoritesBatch(");
    expect(hook).toContain("applyFavoriteDelta(");
    expect(hook).toContain("writeSyncCursor(");
    expect(hook).toContain("readSyncCursor(");
    // 全量才允许 mergeCloudFavorites；增量必须是 applyFavoriteDelta
    expect(hook).toMatch(/since === 0 \? mergeCloudFavorites\(local, alive\) : applyFavoriteDelta\(local, aggregated\)/);
    // 游标只在全部请求成功后推进一次
    expect(hook).toContain("removeItem(SYNC_CURSOR_PREFIX");
    // 匿名通道保留「首条失败即 break」
    expect(hook).toContain("if (!ok) break");
  });

  it("页面用 nextItems 落库，不自己再跑全量合并", () => {
    const src = overlaySource("src/app/favorites/page.tsx");
    expect(src).toContain("favorites.replaceAll(result.nextItems)");
    expect(src).not.toContain("mergeCloudFavorites(favorites.items, result.cloud)");
    expect(src).not.toContain("importJson(JSON.stringify({ version: 1, items: incoming }))");
  });

  it("navhub-api 暴露批量同步且失败交回调用方", () => {
    const src = overlaySource("src/lib/navhub-api.ts");
    expect(src).toContain("export async function syncFavoritesBatch(");
    expect(src).toContain("/api/me/favorites/sync");
    expect(src).toContain("export async function listFavorites(identity: string, onDegraded?: DegradedHandler)");
    expect(src).toContain("export async function addFavorite(identity: string, siteId: string, onDegraded?: DegradedHandler)");
    expect(src).toContain(
      "export async function removeFavorite(identity: string, siteId: string, onDegraded?: DegradedHandler)",
    );
  });
});
