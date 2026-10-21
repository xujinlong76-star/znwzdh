/**
 * 收藏的云端同步：**失败必须说出来**。
 *
 * 真实缺陷（改动前）：`syncFavoritesToCloud()` 是这样写的——
 *
 *   for (const f of local) await addFavorite(identity, f.siteId)  // 返回值被丢掉
 *   const cloud = await listFavorites(identity)
 *   return cloud.items                                            // 失败时是 []
 *
 * 而 addFavorite/listFavorites 内部都是 `catch { return false/空 }`，于是：
 *
 *   1. 中枢不可达时，**每一条**本地收藏都会各发一次请求、各自等满超时
 *      （收藏 30 个站 + 中枢已停 = 页面在「同步」里空转十几分钟，零提示）；
 *   2. 页面只判断 `cloud.length > 0`，失败与「云端确实没有收藏」不可区分，
 *      用户以为收藏已经在云端 —— 换设备登录才发现全没了。
 *
 * 这里锁住新契约：
 *   - 首条推送失败即中止（同一时刻的中枢故障是共因），不要把 N 次超时排成队；
 *   - 失败时 `cloud` 必须是 **null**，空数组只表示「云端确实没有收藏」；
 *   - 全程不抛异常，失败原因与「值不值得重试」交回调用方；
 *   - 页面与 navhub-api 的源码保持这套契约（源码守卫）。
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
}

const originalFetch = globalThis.fetch;
const globals = globalThis as unknown as { window?: unknown; localStorage?: unknown };

/** 伪造 localStorage + window（node 环境没有），让身份与本地收藏可用 */
function installStorage(entries: Record<string, string>): void {
  const store: Record<string, string> = { ...entries };
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

/** 登录态 + 本地收藏 */
function signedIn(siteIds: string[]): void {
  installStorage({
    "navhub.userId": "user-1",
    "navhub.favorites.v1": JSON.stringify(
      siteIds.map((siteId) => ({ siteId, title: "站点 " + siteId, href: "https://example.com/" + siteId, createdAt: 1 })),
    ),
  });
}

/**
 * 按序应答的 fetch 替身：seq 用尽后重复最后一项，便于断言「只发了一次」。
 * "network" 表示网络层失败（服务未启动 / DNS / 断网）。
 */
function stubFetch(seq: Array<number | "network">, bodies: Record<number, string> = {}): FetchCall[] {
  const calls: FetchCall[] = [];
  let i = 0;
  globalThis.fetch = (async (input: unknown, init?: { method?: string }) => {
    calls.push({ method: (init?.method ?? "GET").toUpperCase(), url: String(input) });
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

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete globals.window;
  delete globals.localStorage;
});

describe("未登录：不假装同步过", () => {
  it("没有身份时直接给出原因，且一个请求都不发", async () => {
    const calls = stubFetch([200]);
    const r = await syncFavoritesToCloud();
    expect(calls).toEqual([]);
    expect(r.ok).toBe(false);
    expect(r.cloud).toBeNull();
    expect(r.retryable).toBe(false);
    expect(r.error).toContain("未登录");
  });
});

describe("成功路径", () => {
  it("逐条推上云端，再拉回云端列表", async () => {
    signedIn(["a", "b"]);
    const calls = stubFetch([200], { 200: EMPTY_CLOUD });
    const r = await syncFavoritesToCloud();
    expect(r.ok).toBe(true);
    expect(r.localCount).toBe(2);
    expect(r.pushed).toBe(2);
    expect(r.cloud).toEqual([]);
    expect(r.cloudFolders).toEqual([]);
    expect(calls.filter((c) => c.method === "POST").length).toBe(2);
    expect(calls.filter((c) => c.method === "GET").length).toBe(1);
  });

  it("云端确实没有收藏时 cloud 是空数组而不是 null（两者含义不同）", async () => {
    signedIn([]);
    stubFetch([200], { 200: EMPTY_CLOUD });
    const r = await syncFavoritesToCloud();
    expect(r.ok).toBe(true);
    expect(r.pushed).toBe(0);
    expect(r.cloud).toEqual([]);
  });
});

describe("失败必须说出来（回归：旧实现完全静默）", () => {
  it("首条推送就失败时立刻中止，不再为剩余每条各等满一次超时", async () => {
    signedIn(["a", "b", "c"]);
    const calls = stubFetch([502]);
    const r = await syncFavoritesToCloud();
    expect(r.ok).toBe(false);
    expect(r.pushed).toBe(0);
    expect(r.cloud).toBeNull();
    expect(r.retryable).toBe(true);
    expect(r.error).toBeTruthy();
    expect(calls.length).toBe(1);
  });

  it("推送成功但拉取失败：cloud 必须是 null（失败 ≠ 云端没有收藏）", async () => {
    signedIn(["a"]);
    const calls = stubFetch([200, 503]);
    const r = await syncFavoritesToCloud();
    expect(r.ok).toBe(false);
    expect(r.pushed).toBe(1);
    expect(r.cloud).toBeNull();
    expect(r.error).toBeTruthy();
    expect(calls.map((c) => c.method)).toEqual(["POST", "GET"]);
  });

  it("网络层失败（中枢没启动 / 断网）不抛异常，只把原因交回调用方", async () => {
    signedIn(["a"]);
    const calls = stubFetch(["network"]);
    const r = await syncFavoritesToCloud();
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
    expect(r.retryable).toBe(true);
    expect(calls.length).toBe(1);
  });

  it("404 不值得重试，5xx 值得（不要给用户一个按了也没用的按钮）", async () => {
    signedIn(["a"]);
    stubFetch([404]);
    expect((await syncFavoritesToCloud()).retryable).toBe(false);
    stubFetch([500]);
    expect((await syncFavoritesToCloud()).retryable).toBe(true);
  });
});

describe("源码守卫：这套契约不许被改回去", () => {
  it("favorites 页会展示失败原因与重试，而不是静默", () => {
    const src = overlaySource("src/app/favorites/page.tsx");
    expect(src).toContain("云端同步失败");
    expect(src).toContain("换设备登录可能看不到");
    expect(src).toContain("重试同步");
    expect(src).toContain("runCloudSync");
    // 旧写法：只判断 cloud.length，失败与空不可区分
    expect(src).not.toContain("if (cloud && cloud.length > 0)");
  });

  it("syncFavoritesToCloud 首条失败即 break，且失败时 cloud 为 null", () => {
    const src = overlaySource("src/hooks/useFavorites.ts");
    expect(src).toContain("if (!ok) break");
    expect(src).toContain("cloud: cloudFailed ? null : list.items");
    expect(src).toContain("describeDegrade");
  });

  it("同步成功后以云端成员集合替换本地，而不是并集导入", () => {
    const src = overlaySource("src/app/favorites/page.tsx");
    expect(src).toContain("mergeCloudFavorites(favorites.items, result.cloud)");
    expect(src).toContain("favorites.replaceAll(");
    // 旧的并集导入会把「其它设备已删除」的收藏重新写回本地
    expect(src).not.toContain("importJson(JSON.stringify({ version: 1, items: incoming }))");
    const hook = overlaySource("src/hooks/useFavorites.ts");
    expect(hook).toContain("cloudFolders");
    expect(hook).toContain("replaceAll");
  });

  it("navhub-api 的收藏接口把失败交回调用方（不再自己吞掉）", () => {
    const src = overlaySource("src/lib/navhub-api.ts");
    expect(src).toContain("export async function listFavorites(identity: string, onDegraded?: DegradedHandler)");
    expect(src).toContain("export async function addFavorite(identity: string, siteId: string, onDegraded?: DegradedHandler)");
    expect(src).toContain(
      "export async function removeFavorite(identity: string, siteId: string, onDegraded?: DegradedHandler)",
    );
  });
});
