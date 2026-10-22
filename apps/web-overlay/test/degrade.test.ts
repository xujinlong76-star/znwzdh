/**
 * 「故障」与「不存在」必须分开说 —— 这一层是用户信任问题，不是文案问题。
 *
 * 真实缺陷：中枢客户端的降级原则是「失败返回空结果」，但页面直接把空结果
 * 渲染成事实：
 *   - /site/[id] ：中枢连不上 → 「站点不存在或已被收录源清理」
 *   - /collections/[slug]：中枢连不上 → 「专题不存在或已下架」
 * 用户据此以为数据被删了，不会重试、也不会反馈，问题被永久掩盖。
 *
 * 这里锁两件事：
 *   1. lib/degrade.ts 的判定（纯函数）；
 *   2. navhub-api 的 fetch* 把失败事实通过 onDegraded 交回调用方，
 *      且 404（真不存在）不触发降级回调；
 *   3. 页面源码必须带 `!failed` 守卫，不许把两者混为一谈。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { describeDegrade, errorStatus, isAbort, isNotFound } from "../src/lib/degrade";
import {
  fetchCollectionDetail,
  fetchCollections,
  fetchSite,
  fetchTags,
  fetchTrending,
} from "../src/lib/navhub-api";

const HERE = dirname(fileURLToPath(import.meta.url));

/** 定位 overlay 里的文件；镜像副本（apps/web/test）不会被误当成源 */
function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return hit;
}

function httpError(status: number, message?: string): Error & { status: number } {
  const err = new Error(message ?? "hub " + status) as Error & { status: number };
  err.status = status;
  return err;
}

const originalFetch = globalThis.fetch;

/** 用固定状态码替换 fetch，返回记录到的请求 URL 列表 */
function stubFetch(status: number, body = ""): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    calls.push(String(input));
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
    } as unknown as Response;
  }) as typeof fetch;
  return calls;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("describeDegrade：把失败翻译成可行动的提示", () => {
  it("主动取消 / 超时 → 可重试，且说明是超时", () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(isAbort(abort)).toBe(true);
    const notice = describeDegrade(abort);
    expect(notice.retryable).toBe(true);
    expect(notice.message).toContain("超时");
  });

  it("网络层失败（fetch 抛 TypeError，没有 status）→ 可重试，指明连不上中枢", () => {
    const err = new TypeError("Failed to fetch");
    expect(errorStatus(err)).toBeNull();
    const notice = describeDegrade(err, "站点数据");
    expect(notice.retryable).toBe(true);
    expect(notice.message).toBe("Failed to fetch");
  });

  it("没有 message 也没有 status 时给默认文案，并带上出错对象名", () => {
    const notice = describeDegrade(undefined, "榜单数据");
    expect(notice.retryable).toBe(true);
    expect(notice.message).toContain("榜单数据");
    expect(notice.message).toContain("无法连接");
  });

  it("404 是「真不存在」：不可重试，且 isNotFound 为真", () => {
    const err = httpError(404, "站点不存在");
    expect(isNotFound(err)).toBe(true);
    const notice = describeDegrade(err, "站点数据");
    expect(notice.retryable).toBe(false);
    expect(notice.message).toBe("站点不存在");
  });

  it("401 / 403 不可重试，并提示去偏好设置更新 Token", () => {
    for (const status of [401, 403]) {
      const notice = describeDegrade(httpError(status));
      expect(notice.retryable).toBe(false);
      expect(notice.message).toContain("Token");
    }
  });

  it("429 / 5xx 可重试，并透出中枢给的可读原因", () => {
    const limited = describeDegrade(httpError(429, "请求过于频繁，请稍后再试"));
    expect(limited.retryable).toBe(true);
    expect(limited.message).toContain("过于频繁");

    for (const status of [500, 502, 503, 504]) {
      expect(describeDegrade(httpError(status)).retryable).toBe(true);
    }
  });

  it("任意脏输入都不抛异常", () => {
    for (const dirty of [null, undefined, 0, "", "boom", {}, [], Symbol("x")]) {
      expect(() => describeDegrade(dirty)).not.toThrow();
    }
  });
});

describe("navhub-api：失败事实要交回调用方，404 除外", () => {
  it("fetchSite：502 触发 onDegraded，并返回 null", async () => {
    stubFetch(502);
    const seen: unknown[] = [];
    const site = await fetchSite("abc", (err) => seen.push(err));
    expect(site).toBeNull();
    expect(seen).toHaveLength(1);
    expect(errorStatus(seen[0])).toBe(502);
    expect(describeDegrade(seen[0]).retryable).toBe(true);
  });

  it("fetchSite：404 是正常业务结果，不触发 onDegraded", async () => {
    stubFetch(404);
    const seen: unknown[] = [];
    const site = await fetchSite("abc", (err) => seen.push(err));
    expect(site).toBeNull();
    expect(seen).toEqual([]);
  });

  it("fetchSite：200 正常返回数据，不触发 onDegraded", async () => {
    stubFetch(200, JSON.stringify({ id: "abc", title: "示例", url: "https://example.com" }));
    const seen: unknown[] = [];
    const site = await fetchSite("abc", (err) => seen.push(err));
    expect(site?.title).toBe("示例");
    expect(seen).toEqual([]);
  });

  it("fetchCollectionDetail：503 触发回调；404 不触发", async () => {
    stubFetch(503);
    const seen: unknown[] = [];
    expect(await fetchCollectionDetail("roadmap", (err) => seen.push(err))).toBeNull();
    expect(seen).toHaveLength(1);

    seen.length = 0;
    stubFetch(404);
    expect(await fetchCollectionDetail("roadmap", (err) => seen.push(err))).toBeNull();
    expect(seen).toEqual([]);
  });

  it("列表类：失败返回空数组的同时回调失败原因", async () => {
    stubFetch(429);
    const tagsSeen: unknown[] = [];
    expect(await fetchTags((err) => tagsSeen.push(err))).toEqual([]);
    expect(errorStatus(tagsSeen[0])).toBe(429);

    stubFetch(500);
    const colSeen: unknown[] = [];
    expect(await fetchCollections((err) => colSeen.push(err))).toEqual([]);
    expect(errorStatus(colSeen[0])).toBe(500);

    stubFetch(504);
    const trendSeen: unknown[] = [];
    expect(await fetchTrending(30, (err) => trendSeen.push(err))).toEqual([]);
    expect(errorStatus(trendSeen[0])).toBe(504);
  });

  it("不传回调时行为与改造前完全一致（静默降级，绝不抛错）", async () => {
    stubFetch(502);
    await expect(fetchSite("abc")).resolves.toBeNull();
    await expect(fetchTags()).resolves.toEqual([]);
    await expect(fetchCollections()).resolves.toEqual([]);
    await expect(fetchTrending()).resolves.toEqual([]);
    await expect(fetchCollectionDetail("x")).resolves.toBeNull();
  });

  it("回调自己抛异常也不会把降级路径带崩（降级原则：绝不向 UI 抛错）", async () => {
    stubFetch(500);
    await expect(
      fetchTags(() => {
        throw new Error("callback boom");
      }),
    ).resolves.toEqual([]);
    await expect(
      fetchSite("abc", () => {
        throw new Error("callback boom");
      }),
    ).resolves.toBeNull();
  });
});

describe("页面源码：不许把「中枢挂了」写成「不存在」", () => {
  // 2026-10-21 起站点详情交互体在客户端岛（服务端壳只做软 404 判定）；
  // 专题详情同批服务端化，降级行为随岛迁移到 collection-detail-view.tsx
  const sitePage = readFileSync(overlayFile("src/components/site-detail-view.tsx"), "utf8");
  const collectionPage = readFileSync(
    overlayFile("src/app/collections/[slug]/collection-detail-view.tsx"),
    "utf8",
  );

  it("站点详情页：用 !failed 守卫区分失败与不存在，并渲染降级提示 + 重试", () => {
    expect(sitePage).toContain("if (!s && !failed) setNotFound(true)");
    expect(sitePage).toContain("describeDegrade(error, '站点数据')");
    expect(sitePage).toContain("<HubDegradedNotice");
    expect(sitePage).toContain("onRetry={reload}");
  });

  it("专题详情页：同样区分失败与不存在", () => {
    expect(collectionPage).toContain("if (!d && !failed) setMissing(true)");
    expect(collectionPage).toContain("describeDegrade(error, '专题数据')");
    expect(collectionPage).toContain("<HubDegradedNotice");
  });

  it("详情页在降级时不会渲染「不存在」文案（先判 notice 再判 missing）", () => {
    const siteOrder = sitePage.indexOf("!site && notice");
    const siteMissingOrder = sitePage.indexOf("notFound || !site");
    expect(siteOrder).toBeGreaterThan(-1);
    expect(siteMissingOrder).toBeGreaterThan(siteOrder);

    const colNoticeOrder = collectionPage.indexOf("notice && !collection");
    const colMissingOrder = collectionPage.indexOf("missing || !collection");
    expect(colNoticeOrder).toBeGreaterThan(-1);
    expect(colMissingOrder).toBeGreaterThan(colNoticeOrder);
  });
});
