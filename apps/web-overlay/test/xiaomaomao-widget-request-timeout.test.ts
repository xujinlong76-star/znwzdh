/**
 * 请求超时 / 缓存恢复 / 存储失败可见守卫（2026-11-18，P0+P1 全修·请求超时线）：
 *
 * 覆盖 A P1-1（= C-04，聊天 POST 无超时）、C-09（navCache 阴性缓存永不重试）、
 * C-13（本地存储失败全静默）三项。
 *
 * 写法分两层（仓内不引 jsdom，沿 v4–v7 惯例）：
 *  1. 行为测试：用 node:vm 把挂件源码里自包含的真实函数（fetchWithTimeoutAbort、
 *     feedFindSiteId、persist/reportStorageFailure）抠出来执行，喂假 fetch /
 *     假时钟 / 会抛错的 localStorage，断言真实行为。抠不到函数时测试直接失败
 *     （不是静默通过）。
 *  2. 源码断言：钉住接线点（postJson 走 fetchWithTimeoutAbort、navCache 阴性 60 秒
 *     过期、noData 文案不再提演示页、persist 的 catch 上报失败），防回归。
 * 行为的最终验证在 CDP 真机探针（见 ~/workspace/cat-audit-requests-2026-11-18/VERIFICATION.md）。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayRoot(): string {
  const candidates = [resolve(HERE, ".."), resolve(HERE, "..", "..", "web-overlay")];
  const isOverlayDir = (p: string) => {
    const s = p.replace(/\\/g, "/");
    return s.includes("/web-overlay/") || s.endsWith("/web-overlay");
  };
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p));
  if (!hit) throw new Error("无法定位 web-overlay 根目录（候选：" + candidates.join(" | ") + "）");
  return hit;
}

const WIDGET = readFileSync(join(overlayRoot(), "public/xiaomaomao/xiaomaomao.js"), "utf8");

/** 从挂件源码里按名抠出一个顶层 function 声明的完整源码（大括号配对扫描）。 */
function extractFunction(src: string, name: string): string {
  const sig = "function " + name + "(";
  const at = src.indexOf(sig);
  expect(at, "挂件源码里找不到 function " + name).toBeGreaterThan(-1);
  const open = src.indexOf("{", at);
  expect(open, "function " + name + " 没有函数体").toBeGreaterThan(-1);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(at, i + 1);
    }
  }
  throw new Error("function " + name + " 的大括号没有配对闭合");
}

describe("A P1-1 / C-04：聊天请求 15 秒超时", () => {
  it("行为：fetch 挂起时 15 秒内拒绝、signal 已 abort，1 秒时还没落定", async () => {
    vi.useFakeTimers();
    try {
      const fetchSrc = extractFunction(WIDGET, "fetchWithTimeoutAbort");
      // 用对象盒装 signal：TS 的控制流分析不追踪闭包内对 let 变量的赋值，
      // 直接用 `capturedSignal && capturedSignal.aborted` 会在 strict 下把
      // 右侧收窄成 never（TS2339）；对象属性在 await 后不保留收窄，类型干净。
      const signalBox: { signal: { aborted: boolean } | null } = { signal: null };
      const hangingFetch = (_url: string, opts: { signal?: { aborted: boolean } }) => {
        signalBox.signal = opts.signal ?? null;
        return new Promise(() => {
          /* 永远不回：模拟服务端挂起 / 网络半断不断 */
        });
      };
      const sandbox: Record<string, unknown> = {
        window: {
          fetch: hangingFetch,
          setTimeout: globalThis.setTimeout,
          clearTimeout: globalThis.clearTimeout,
        },
        AbortController: globalThis.AbortController,
        Promise: globalThis.Promise,
        Error: globalThis.Error,
      };
      createContext(sandbox);
      runInContext(fetchSrc, sandbox);
      const fetchWithTimeoutAbort = (sandbox as unknown as { fetchWithTimeoutAbort: (u: string, o: object, ms: number) => Promise<unknown> }).fetchWithTimeoutAbort;
      expect(typeof fetchWithTimeoutAbort, "fetchWithTimeoutAbort 应可调用").toBe("function");

      let settled = false;
      const p = fetchWithTimeoutAbort("/api/hub/ai/chat", { method: "POST" }, 15000);
      p.then(() => { settled = true; }, () => { settled = true; });
      await vi.advanceTimersByTimeAsync(1000);
      expect(settled, "挂起 1 秒时请求不应落定").toBe(false);
      await vi.advanceTimersByTimeAsync(14000);
      expect(settled, "15 秒超时后请求应已落定").toBe(true);
      await expect(p).rejects.toThrow(/timeout/i);
      expect(settled, "15 秒超时后请求应已落定").toBe(true);
      expect(signalBox.signal?.aborted, "超时后应 abort 掉底层请求").toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("行为：fetch 正常回包时不触发超时、原样返回响应", async () => {
    vi.useFakeTimers();
    try {
      const fetchSrc = extractFunction(WIDGET, "fetchWithTimeoutAbort");
      const okRes = { ok: true, status: 200 };
      const sandbox: Record<string, unknown> = {
        window: {
          fetch: () => Promise.resolve(okRes),
          setTimeout: globalThis.setTimeout,
          clearTimeout: globalThis.clearTimeout,
        },
        AbortController: globalThis.AbortController,
        Promise: globalThis.Promise,
        Error: globalThis.Error,
      };
      createContext(sandbox);
      runInContext(fetchSrc, sandbox);
      const fetchWithTimeoutAbort = (sandbox as unknown as { fetchWithTimeoutAbort: (u: string, o: object, ms: number) => Promise<unknown> }).fetchWithTimeoutAbort;
      await expect(fetchWithTimeoutAbort("/api/hub/ai/chat", { method: "POST" }, 15000)).resolves.toBe(okRes);
    } finally {
      vi.useRealTimers();
    }
  });

  it("接线：postJson 走带超时的 fetch，超时常量为 15000ms", () => {
    expect(WIDGET).toContain("REQUEST_TIMEOUT_MS = 15000");
    const at = WIDGET.indexOf("function postJson(");
    expect(at, "找不到 postJson").toBeGreaterThan(-1);
    const body = WIDGET.slice(at, WIDGET.indexOf("function finishWithReply", at));
    expect(body).toContain("fetchWithTimeoutAbort");
    expect(body).toContain("REQUEST_TIMEOUT_MS");
    expect(body, "postJson 不应再用裸 window.fetch").not.toContain("window.fetch(");
  });
});

describe("C-09：navCache 阴性结果 60 秒过期", () => {
  function buildNavSandbox(fetchImpl: (url: string) => Promise<unknown>, nowRef: { now: number }) {
    const sandbox: Record<string, unknown> = {
      window: {
        fetch: fetchImpl,
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
      },
      Date: { now: () => nowRef.now },
      AbortController: globalThis.AbortController,
      Promise: globalThis.Promise,
      Error: globalThis.Error,
      REQUEST_TIMEOUT_MS: 15000,
      NAV_CACHE_NEGATIVE_TTL_MS: 60000,
      navCache: null,
      navCacheAt: 0,
      navCacheEmpty: false,
    };
    createContext(sandbox);
    runInContext(extractFunction(WIDGET, "fetchWithTimeoutAbort"), sandbox);
    runInContext(extractFunction(WIDGET, "feedUrlKey"), sandbox);
    const staleSrc = WIDGET.includes("function navCacheIsStale(")
      ? extractFunction(WIDGET, "navCacheIsStale")
      : "";
    if (staleSrc) runInContext(staleSrc, sandbox);
    runInContext(extractFunction(WIDGET, "feedFindSiteId"), sandbox);
    return sandbox as unknown as {
      feedFindSiteId: (url: string) => Promise<{ found: boolean; noData?: boolean; siteId?: string }>;
    };
  }

  it("行为：导航接口失败一次后 60 秒内仍用缓存、60 秒后重新拉取并恢复", async () => {
    let calls = 0;
    const nowRef = { now: 1_000_000 };
    const fetchImpl = () => {
      calls++;
      if (calls === 1) return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            navigationItems: [{ id: "s1", href: "https://example.com/x", title: "示例站" }],
          }),
      });
    };
    const { feedFindSiteId } = buildNavSandbox(fetchImpl, nowRef);

    await expect(feedFindSiteId("https://example.com/x")).resolves.toEqual({ found: false, noData: true });
    expect(calls, "第一次拉取应发 1 次请求").toBe(1);
    await expect(feedFindSiteId("https://example.com/x")).resolves.toEqual({ found: false, noData: true });
    expect(calls, "60 秒内阴性结果应复用缓存、不再发请求").toBe(1);

    nowRef.now += 61_000;
    await expect(feedFindSiteId("https://example.com/x")).resolves.toEqual({
      found: true,
      siteId: "s1",
      title: "示例站",
    });
    expect(calls, "60 秒过期后应重新拉取").toBe(2);
  });

  it("行为：导航接口挂起时 15 秒内落到阴性结果（不永久卡住喂猫）", async () => {
    vi.useFakeTimers();
    try {
      const nowRef = { now: 1_000_000 };
      const sandbox: Record<string, unknown> = {
        window: {
          fetch: () => new Promise(() => {}),
          setTimeout: globalThis.setTimeout,
          clearTimeout: globalThis.clearTimeout,
        },
        Date: { now: () => nowRef.now },
        AbortController: globalThis.AbortController,
        Promise: globalThis.Promise,
        Error: globalThis.Error,
        REQUEST_TIMEOUT_MS: 15000,
        NAV_CACHE_NEGATIVE_TTL_MS: 60000,
        navCache: null,
        navCacheAt: 0,
        navCacheEmpty: false,
      };
      createContext(sandbox);
      runInContext(extractFunction(WIDGET, "fetchWithTimeoutAbort"), sandbox);
      runInContext(extractFunction(WIDGET, "feedUrlKey"), sandbox);
      if (WIDGET.includes("function navCacheIsStale(")) {
        runInContext(extractFunction(WIDGET, "navCacheIsStale"), sandbox);
      }
      runInContext(extractFunction(WIDGET, "feedFindSiteId"), sandbox);
      const feedFindSiteId = (sandbox as unknown as { feedFindSiteId: (u: string) => Promise<unknown> }).feedFindSiteId;
      const p = feedFindSiteId("https://example.com/x");
      let settled = false;
      p.then(() => { settled = true; }, () => { settled = true; });
      await vi.advanceTimersByTimeAsync(1000);
      expect(settled, "导航挂起 1 秒时不应落定").toBe(false);
      await vi.advanceTimersByTimeAsync(14000);
      expect(settled, "导航挂起 15 秒超时后应落到阴性结果").toBe(true);
      await expect(p).resolves.toEqual({ found: false, noData: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("接线：阴性过期常量 60 秒在位；noData 文案不再提演示页", () => {
    expect(WIDGET).toContain("NAV_CACHE_NEGATIVE_TTL_MS = 60000");
    expect(WIDGET).toContain("navCacheIsStale");
    const at = WIDGET.indexOf("function feedFindSiteId(");
    expect(at, "找不到 feedFindSiteId").toBeGreaterThan(-1);
    const body = WIDGET.slice(at, WIDGET.indexOf("function feedLink(", at));
    expect(body).toContain("navCacheIsStale");
    expect(WIDGET).not.toContain("演示页没有接导航数据");
    expect(WIDGET).toContain("稍后再喂我一次试试");
  });
});

describe("C-13：本地存储失败不再静默", () => {
  function buildPersistSandbox() {
    const warns: unknown[][] = [];
    const notes: string[] = [];
    const sandbox: Record<string, unknown> = {
      window: {
        localStorage: {
          setItem: () => {
            throw new Error("QuotaExceededError");
          },
        },
      },
      console: { warn: (...args: unknown[]) => warns.push(args) },
      msgsEl: { appendChild: () => {} },
      addNote: (text: string) => notes.push(text),
      store: { voice: true },
      STORE_KEY: "navhub.xiaomaomao.v1",
      storageWarned: false,
      document: { createElement: () => ({}) },
    };
    createContext(sandbox);
    runInContext(extractFunction(WIDGET, "reportStorageFailure"), sandbox);
    runInContext(extractFunction(WIDGET, "persist"), sandbox);
    return {
      sandbox: sandbox as unknown as { persist: () => void },
      warns,
      notes,
    };
  }

  it("行为：setItem 抛错时 console.warn 上报、用户提示只出现一次", () => {
    const { sandbox, warns, notes } = buildPersistSandbox();
    expect(() => sandbox.persist()).not.toThrow();
    expect(() => sandbox.persist()).not.toThrow();
    expect(warns.length, "两次存储失败都应写 console.warn").toBe(2);
    expect(String(warns[0][0])).toContain("[xiaomaomao] storage failed");
    expect(notes.length, "用户可见提示每会话只应出现一次").toBe(1);
    expect(notes[0]).toContain("本地保存失败");
  });

  it("接线：persist 的 catch 上报失败；全文件不再有空 catch 吞存储失败", () => {
    const at = WIDGET.indexOf("function persist() {");
    expect(at, "找不到 persist").toBeGreaterThan(-1);
    const body = WIDGET.slice(at, WIDGET.indexOf("/* ---------- v4", at));
    expect(body).toContain("reportStorageFailure");
    expect(body).not.toContain("catch (e) { /* 忽略 */ }");
    expect(WIDGET).toContain("console.warn('[xiaomaomao] storage failed'");
    expect(WIDGET).toContain("reportStorageFailure");
  });
});
