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
 *
 * M1 三期（只推脏条目）：不再把本地全量当 ops 重发。变更点置脏
 * （navhub.favorites.dirty.v1），ops = 脏集合 ∩ 本地列表（add）
 * + 脏集合里已不在本地列表的 siteId（remove）；一次成功同步后清脏，
 * 失败保留（下次重试仍推）。pushed 从此是「本次实际提交的 ops 数」。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

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

/** 脏标记键（M1 三期）：本地变更过、云端还没确认的 siteId 列表 */
const DIRTY_KEY = "navhub.favorites.dirty.v1";

/**
 * 取一个「刚挂载」的 useFavorites 模块实例：内存脏集合为空，只认 localStorage
 * 里的脏标记。文件顶部的静态 import 是长生命周期实例（内存脏集合跨用例残留），
 * 需要「注入上一会话落盘的脏标记」或「模拟刷新重挂载」时用它。
 */
async function mountedModule(): Promise<typeof import("../src/hooks/useFavorites")> {
  vi.resetModules();
  return import("../src/hooks/useFavorites");
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
    // M1 三期：脏键从未写过 → 一次性迁移把本地全量推一次（防匿名转登录丢条目）；
    // 本机条数以 localCount 为准，别再把 pushed 当成本机条数
    expect(r.pushed).toBe(2);
    expect(r.localCount).toBe(2);
    const payload = JSON.parse(calls[0].body ?? "{}") as { ops: unknown[] };
    expect(payload.ops).toHaveLength(2);
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
    // M1 三期：ops 只来自脏集合，先注入两条脏标记（上一会话的 toggle 落盘的）
    installStorage({
      "navhub.userId": "user-1",
      "navhub.favorites.v1": localItems(["a", "b"]),
      [DIRTY_KEY]: JSON.stringify(["a", "b"]),
    });
    const { syncFavoritesToCloud: sync } = await mountedModule();
    const calls = stubFetch([200], { 200: batchBody([{ siteId: "a" }, { siteId: "b" }]) });
    await sync();
    const payload = JSON.parse(calls[0].body ?? "{}") as { ops: unknown[]; since: number };
    expect(payload.ops).toHaveLength(2);
    expect(payload.since).toBe(0);
  });

  it("超过 500 条自动分片：每片 <=500，不会因 400 变成永久失败", async () => {
    const many = Array.from({ length: 501 }, (_, i) => "s" + i);
    // M1 三期：分片对象从「本地全量」变成「脏集合」，501 条脏标记仍是 500 + 1 两片
    installStorage({
      "navhub.userId": "user-1",
      "navhub.favorites.v1": localItems(many),
      [DIRTY_KEY]: JSON.stringify(many),
    });
    const { syncFavoritesToCloud: sync } = await mountedModule();
    const calls = stubFetch([200], { 200: batchBody([{ siteId: "s0" }]) });
    const r = await sync();
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

describe("M1 三期：一次性迁移（脏键从未写过）", () => {
  it("脏键不存在且本地非空 → 首同步按全量推一次（匿名转登录不丢条目）", async () => {
    signedIn(["a", "b"]);
    const calls = stubFetch([200], { 200: batchBody([{ siteId: "a" }, { siteId: "b" }]) });
    const r = await syncFavoritesToCloud();
    const payload = JSON.parse(calls[0].body ?? "{}") as { ops: Array<{ op: string; siteId: string }> };
    expect(payload.ops.map((o) => o.siteId).sort()).toEqual(["a", "b"]);
    expect(payload.ops.every((o) => o.op === "add")).toBe(true);
    expect(r.ok).toBe(true);

    // 迁移只发生一次：键已写 → 第二次同步 ops 为空
    stubFetch([200], { 200: batchBody([{ siteId: "a" }]) });
    const calls2 = stubFetch([200], { 200: batchBody([{ siteId: "a" }]) });
    await syncFavoritesToCloud();
    const payload2 = JSON.parse(calls2[0].body ?? "{}") as { ops: unknown[] };
    expect(payload2.ops).toHaveLength(0);
  });

  it("脏键写过空数组 → 不触发迁移（用户确实清过脏）", async () => {
    installStorage({
      "navhub.userId": "user-1",
      "navhub.favorites.v1": localItems(["a"]),
      "navhub.favorites.dirty.v1": "[]",
      "navhub.favorites.sync.v1.user-1": "100",
    });
    const calls = stubFetch([200], { 200: batchBody([{ siteId: "a" }], 200) });
    await syncFavoritesToCloud();
    const payload = JSON.parse(calls[0].body ?? "{}") as { ops: unknown[] };
    expect(payload.ops).toHaveLength(0);
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
    // M1 三期：pushed = 本次实际提交的 ops 数；注入 1 条脏标记，推 1 条
    installStorage({
      "navhub.userId": "user-1",
      "navhub.favorites.v1": localItems(["a"]),
      [DIRTY_KEY]: JSON.stringify(["a"]),
    });
    const { syncFavoritesToCloud: sync } = await mountedModule();
    stubFetch([200], { 200: batchBody([{ siteId: "a" }]) });
    await sync();
    const ok = JSON.parse(lastStore["navhub.favorites.sync.last"] ?? "{}") as { ok: boolean; pushed: number };
    expect(ok.ok).toBe(true);
    expect(ok.pushed).toBe(1);

    // 第一次成功同步后脏标记已清空：这次失败走纯拉取，状态仍是失败
    stubFetch([502]);
    await sync();
    const bad = JSON.parse(lastStore["navhub.favorites.sync.last"] ?? "{}") as { ok: boolean; error?: string };
    expect(bad.ok).toBe(false);
    expect(bad.error).toBeTruthy();
  });
});

describe("M1 三期：只推脏条目", () => {
  it("① 首次同步：本地 2 条都是脏 → ops 长度 2，成功后脏标记清空", async () => {
    installStorage({
      "navhub.userId": "user-1",
      "navhub.favorites.v1": localItems(["a", "b"]),
      [DIRTY_KEY]: JSON.stringify(["a", "b"]),
    });
    const { syncFavoritesToCloud: sync } = await mountedModule();
    const calls = stubFetch([200], { 200: batchBody([{ siteId: "a" }, { siteId: "b" }]) });
    const r = await sync();
    const payload = JSON.parse(calls[0].body ?? "{}") as { ops: Array<{ op: string; siteId: string }> };
    expect(payload.ops).toHaveLength(2);
    expect(payload.ops.map((o) => o.siteId).sort()).toEqual(["a", "b"]);
    expect(payload.ops.every((o) => o.op === "add")).toBe(true);
    expect(r.pushed).toBe(2);
    expect(r.localCount).toBe(2);
    // 云端确认后清脏：落盘为空数组，不是原样留着
    expect(lastStore[DIRTY_KEY]).toBe("[]");
  });

  it("② 同一会话再同步：脏已确认 → ops 长度 0，只剩一次纯拉取", async () => {
    installStorage({
      "navhub.userId": "user-1",
      "navhub.favorites.v1": localItems(["a", "b"]),
      [DIRTY_KEY]: JSON.stringify(["a", "b"]),
    });
    const { syncFavoritesToCloud: sync } = await mountedModule();
    stubFetch([200], { 200: batchBody([{ siteId: "a" }, { siteId: "b" }]) });
    const first = await sync();
    expect(first.pushed).toBe(2);

    // 同一个模块实例（同一会话）：内存脏集合已在成功后清空，不再推任何 ops
    const calls = stubFetch([200], { 200: batchBody([{ siteId: "a" }, { siteId: "b" }]) });
    const again = await sync();
    expect(calls.length).toBe(1);
    const payload = JSON.parse(calls[0].body ?? "{}") as { ops: unknown[]; since: number };
    expect(payload.ops).toHaveLength(0);
    expect(payload.since).toBe(999);
    expect(again.pushed).toBe(0);
    // pushed 变了，本机条数不变
    expect(again.localCount).toBe(2);
  });

  it("③ 跨重新挂载：内存脏集合丢失，localStorage 里的标记仍只推那 1 条", async () => {
    installStorage({
      "navhub.userId": "user-1",
      "navhub.favorites.v1": localItems(["a", "b"]),
      [DIRTY_KEY]: JSON.stringify(["a"]),
    });
    // 会话 1：a 被推送并确认（该实例的内存脏集合随即清空）
    const session1 = await mountedModule();
    stubFetch([200], { 200: batchBody([{ siteId: "a" }, { siteId: "b" }]) });
    expect((await session1.syncFavoritesToCloud()).pushed).toBe(1);

    // 会话 1 里用户又改了一次收藏：落盘脏标记（等价于 toggle 的 markDirty；
    // 本测试文件不挂载 React 拿不到 hook 实例，直接写同一把键）
    lastStore[DIRTY_KEY] = JSON.stringify(["a"]);

    // 会话 2：重新挂载 = 新模块实例，内存脏集合丢失，只能从 localStorage 恢复
    const session2 = await mountedModule();
    const calls = stubFetch([200], { 200: batchBody([{ siteId: "a" }, { siteId: "b" }]) });
    const r = await session2.syncFavoritesToCloud();
    const payload = JSON.parse(calls[0].body ?? "{}") as { ops: Array<{ op: string; siteId: string }> };
    expect(payload.ops).toHaveLength(1);
    expect(payload.ops[0]!.op).toBe("add");
    expect(payload.ops[0]!.siteId).toBe("a");
    expect(r.pushed).toBe(1);
    // 重挂载也不会把全量重发一遍：b 自始至终不是脏的
    expect(r.localCount).toBe(2);
  });

  it("④ 本地删除（toggle 取消）：ops 含 remove，删除项走 remove、留存项走 add", async () => {
    // b 被取消收藏：本地列表只剩 a，但 b 的脏标记还在（toggle 取消同样置脏）
    installStorage({
      "navhub.userId": "user-1",
      "navhub.favorites.v1": localItems(["a"]),
      [DIRTY_KEY]: JSON.stringify(["a", "b"]),
    });
    const { syncFavoritesToCloud: sync } = await mountedModule();
    const calls = stubFetch([200], { 200: batchBody([{ siteId: "a" }]) });
    const r = await sync();
    const payload = JSON.parse(calls[0].body ?? "{}") as { ops: Array<{ op: string; siteId: string }> };
    expect(payload.ops).toHaveLength(2);
    const removes = payload.ops.filter((o) => o.op === "remove");
    expect(removes).toHaveLength(1);
    expect(removes[0]!.siteId).toBe("b");
    // a 还在本地列表里：走 add（服务端 upsert），不是 remove
    expect(payload.ops.find((o) => o.siteId === "a")?.op).toBe("add");
    expect(r.pushed).toBe(2);
  });

  it("⑤ clear() 之后：本地空、全部置脏 → ops 全为 remove", async () => {
    // clear() 把当前所有 siteId 置脏后清空本地：同步时它们都已不在本地列表
    installStorage({
      "navhub.userId": "user-1",
      "navhub.favorites.v1": localItems([]),
      [DIRTY_KEY]: JSON.stringify(["a", "b"]),
    });
    const { syncFavoritesToCloud: sync } = await mountedModule();
    const calls = stubFetch([200], { 200: batchBody([]) });
    const r = await sync();
    const payload = JSON.parse(calls[0].body ?? "{}") as { ops: Array<{ op: string; siteId: string }> };
    expect(payload.ops).toHaveLength(2);
    expect(payload.ops.every((o) => o.op === "remove")).toBe(true);
    expect(payload.ops.map((o) => o.siteId).sort()).toEqual(["a", "b"]);
    expect(r.pushed).toBe(2);
    expect(r.localCount).toBe(0);
    // 云端确认删除后清脏
    expect(lastStore[DIRTY_KEY]).toBe("[]");
  });

  it("⑥ 同步失败：脏标记保留，再同步 ops 数量不变", async () => {
    installStorage({
      "navhub.userId": "user-1",
      "navhub.favorites.v1": localItems(["a"]),
      [DIRTY_KEY]: JSON.stringify(["a"]),
    });
    const { syncFavoritesToCloud: sync } = await mountedModule();
    // 5xx 退避重试两次，共 3 次请求，全部失败
    stubFetch([502]);
    const failed = await sync();
    expect(failed.ok).toBe(false);
    // 失败不清脏：落盘标记原样保留，下次重试仍会推
    expect(lastStore[DIRTY_KEY]).toBe(JSON.stringify(["a"]));

    const calls = stubFetch([200], { 200: batchBody([{ siteId: "a" }]) });
    const retried = await sync();
    expect(retried.ok).toBe(true);
    const payload = JSON.parse(calls[0].body ?? "{}") as { ops: Array<{ siteId: string }> };
    expect(payload.ops).toHaveLength(1);
    expect(payload.ops[0]!.siteId).toBe("a");
    expect(retried.pushed).toBe(1);
    // 重试成功后确认
    expect(lastStore[DIRTY_KEY]).toBe("[]");
  });
});

describe("源码守卫：这套契约不许被改回去", () => {
  // P1-1 分层：同步行为（墓碑、游标、批量/逐条、重试）已在本文件上半部分用
  // 真实模块跑过；这里只锁「页面/钩子仍然接着这些能力」，不重复断言文案。
  it("favorites 页把失败文案与重试交给纯函数，而不是静默", () => {
    const src = overlaySource("src/app/favorites/page.tsx");
    // 文案已下沉到 lib/favorites-sync-copy（五种分支由 favorites-sync-copy.test.ts 行为级单测），
    // 这里只锁「页面确实用了它、且重试按钮真的会重新跑同步」这条接线。
    expect(src).toContain("describeSyncBanner");
    expect(src).toContain("shouldOfferRetry");
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

  it("M1 三期：只推脏条目，不许改回全量重发", () => {
    const hook = overlaySource("src/hooks/useFavorites.ts");
    // 脏标记的键与读写辅助必须存在
    expect(hook).toContain("navhub.favorites.dirty.v1");
    expect(hook).toContain("function readDirty()");
    expect(hook).toContain("function writeDirty(");
    expect(hook).toContain("function markDirty(");
    expect(hook).toContain("function clearDirty(");
    // ops 两类来源：脏集合 ∩ 本地（add）与脏集合 ∖ 本地（remove）
    expect(hook).toContain("if (!dirty.has(f.siteId)) continue");
    expect(hook).toContain("op: 'remove'");
    // 变更点必须置脏；replaceAll/clear 的语义区别必须在代码里说清
    expect(hook).toContain("markDirty([site.siteId])");
    expect(hook).toContain("markDirty(valid.map((i) => i.siteId))");
    // 成功清脏、失败不清（下次重试仍推）
    expect(hook).toContain("clearDirty()");
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
