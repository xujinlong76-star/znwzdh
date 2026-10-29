/**
 * 搜索点击证据：**点了哪条、从哪个检索通道点进来的**必须回传到中枢。
 *
 * 真实缺陷（改动前）：`reportClick` 只发 `{ kind:'click', siteId }`。
 * 中枢的在线学习循环（telemetry.ts 的 `recordFeedback`）只在带 `query` 时
 * 才更新 LinUCB——于是「用户点了搜索结果」这件事在模型侧完全不可见，
 * 排序权重永远是初始值，离线调完分也只能靠改代码上线。
 *
 * 第二层缺陷（run100）：请求发出去了不等于中枢收到了。断网/页面被卸载时
 * fire-and-forget 的证据是**静默丢失**的，而 `sites.visit_count` 99.8% 为 0
 * 这种读数根本无法归因——是没人点，还是点了没送到？
 * 这里同时锁投递通道（keepalive / beacon 的适用条件）、幂等键与端侧出箱。
 *
 * 锁五件事：
 *   1. 请求体带上 query / channel / position，且不带多余的空字段；
 *   2. 脏值（未知通道、越界位置/停留时长）被丢弃或收敛，不写进事件表；
 *   3. 上报本身仍是 fire-and-forget：失败不冒泡到页面逻辑；
 *   4. 带身份的请求不走 sendBeacon（它带不了 header），失败的证据落端侧并能在恢复后补报；
 *   5. 投递失败/补送成功这类「差点丢了」的时刻留一条 click_delivery 漏斗信号，
 *      但它不进出箱、不带站点与查询词（否则观测数据本身就是第二份隐私流水）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildClickEventBody,
  flushClickOutbox,
  newClickEventId,
  reportClick,
  type ClickReportContext,
} from "../src/lib/navhub-api";
import { clearOfflineVisits } from "../src/lib/offline-recent";

const OUTBOX_LS_KEY = "navhub:click-outbox:v1";
const SETTINGS_LS_KEY = "navhub_user_settings";
const EVENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

afterEach(async () => {
  // 出箱内存兜底是模块级状态：不清就会串到下一个用例（读箱时 LS 为空会回落到它）
  await clearOfflineVisits();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** 浏览器存储替身：node 环境里既没有 localStorage 也没有 window */
function stubBrowserEnv(settings?: Record<string, unknown>) {
  const map = new Map<string, string>();
  const store = {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
  if (settings) map.set(SETTINGS_LS_KEY, JSON.stringify(settings));
  vi.stubGlobal("localStorage", store);
  vi.stubGlobal("window", { localStorage: store, dispatchEvent: () => {}, addEventListener: () => {} });
  return map;
}

function okResponse() {
  return new Response('{"ok":true}', { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("buildClickEventBody", () => {
  it("只有 siteId 时不携带任何空字段", () => {
    expect(buildClickEventBody("site-1")).toEqual({ kind: "click", siteId: "site-1" });
  });

  it("携带查询、检索通道与位置，供在线学习归因", () => {
    expect(
      buildClickEventBody("site-1", { query: "  图床  ", channel: "semantic", position: 3.9 }),
    ).toEqual({
      kind: "click",
      siteId: "site-1",
      query: "图床",
      channel: "semantic",
      position: 3,
    });
  });

  it("未知通道与非法位置被丢弃，而不是把垃圾写进事件表", () => {
    expect(buildClickEventBody("site-1", { channel: "made-up", position: 0 })).toEqual({
      kind: "click",
      siteId: "site-1",
    });
  });

  it("字段收敛到中枢 schema 的边界", () => {
    const body = buildClickEventBody("site-1", {
      query: "x".repeat(500),
      position: 999,
      dwellSeconds: 99_999,
    });
    expect((body.query as string).length).toBe(200);
    expect(body.position).toBe(200);
    expect(body.dwellSeconds).toBe(3600);
  });

  it("空白查询不当作证据", () => {
    expect(buildClickEventBody("site-1", { query: "   " })).toEqual({ kind: "click", siteId: "site-1" });
  });

  it("幂等键与客户端时间是选填项：不传就不带（纯函数输出形状不变）", () => {
    expect(buildClickEventBody("site-1", { query: "ai" })).toEqual({ kind: "click", siteId: "site-1", query: "ai" });
    expect(
      buildClickEventBody("site-1", { eventId: "abc-123", clientCreatedAt: 1_764_000_000_000 }),
    ).toEqual({ kind: "click", siteId: "site-1", eventId: "abc-123", clientCreatedAt: 1_764_000_000_000 });
  });

  it("超界或含非法字符的幂等键被丢弃（中枢会整条 400，不该由我们发出去）", () => {
    expect(buildClickEventBody("site-1", { eventId: "x".repeat(65) })).toEqual({ kind: "click", siteId: "site-1" });
    expect(buildClickEventBody("site-1", { eventId: "带 空格/斜杠" })).toEqual({ kind: "click", siteId: "site-1" });
  });
});

describe("newClickEventId", () => {
  it("生成的键满足中枢的字符集与长度约束", () => {
    for (let i = 0; i < 50; i++) {
      expect(newClickEventId()).toMatch(EVENT_ID_RE);
    }
  });

  it("两次调用不重用同一个键（幂等只针对同一次动作的重试）", () => {
    expect(newClickEventId()).not.toBe(newClickEventId());
  });
});

describe("reportClick", () => {
  it("把点击证据 POST 到中枢事件接口，并带匿名身份头", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    reportClick("site-1", "anon-123", { query: "ai 编程", channel: "fts", position: 2 });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/hub/events");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Navhub-Anon-Id"]).toBe("anon-123");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      "channel",
      "clientCreatedAt",
      "eventId",
      "kind",
      "position",
      "query",
      "siteId",
    ]);
    expect(body).toMatchObject({ kind: "click", siteId: "site-1", query: "ai 编程", channel: "fts", position: 2 });
    expect(String(body.eventId)).toMatch(EVENT_ID_RE);
    expect(Number(body.clientCreatedAt)).toBeGreaterThan(0);
  });

  it("页面正在卸载也要送出去：请求带 keepalive", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => okResponse());
    vi.stubGlobal("fetch", fetchMock);
    reportClick("site-1", "anon-123");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]![1].keepalive).toBe(true);
  });

  it("调用方自带的幂等键原样使用（重试要复用同一个键）", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => okResponse());
    vi.stubGlobal("fetch", fetchMock);
    const context: ClickReportContext = { query: "重试", eventId: "fixed-key-1" };
    reportClick("site-1", "anon-1", context);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1].body)).eventId).toBe("fixed-key-1");
    // 幂等键是「这次动作」的，不是「这次上下文对象」的：同一个 context 再报一次仍复用同键
    reportClick("site-1", "anon-1", context);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1].body)).eventId).toBe("fixed-key-1");
  });

  it("上报失败被静默吞掉，不向调用方冒泡", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(() => reportClick("site-1", undefined, { query: "ai" })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe("投递通道选择（身份优先于送达率）", () => {
  it("带匿名身份时用 fetch 而不是 sendBeacon：beacon 带不了 header，身份会整个丢失", async () => {
    const beacon = vi.fn(() => true);
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => okResponse());
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    vi.stubGlobal("document", { visibilityState: "hidden" });
    vi.stubGlobal("fetch", fetchMock);

    reportClick("site-1", "anon-123", { query: "ai" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(beacon).not.toHaveBeenCalled();
  });

  it("纯匿名且页面正在离开：用 sendBeacon，成功后不再补发 fetch", async () => {
    const beacon = vi.fn((_url: string, _payload: Blob) => true);
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => okResponse());
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    vi.stubGlobal("document", { visibilityState: "hidden" });
    vi.stubGlobal("fetch", fetchMock);

    reportClick("site-1", undefined, { query: "ai" });
    await vi.waitFor(() => expect(beacon).toHaveBeenCalledTimes(1));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(beacon.mock.calls[0]![0])).toBe("/api/hub/events");
  });

  it("纯匿名但页面可见：走 keepalive fetch，把 beacon 留给真正的卸载", async () => {
    // beacon 换不到「服务端收下了」的回执（返回 true 只代表浏览器接下了载荷），
    // 可见状态下没有卸载的压力，没必要用品味更差的通道。
    const beacon = vi.fn(() => true);
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => okResponse());
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    vi.stubGlobal("document", { visibilityState: "visible" });
    vi.stubGlobal("fetch", fetchMock);

    reportClick("site-1", undefined, { query: "ai" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(beacon).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0]![1].keepalive).toBe(true);
  });

  it("sendBeacon 返回 false（载荷被丢弃）时补发 fetch，不把「没送出」当成功", async () => {
    const beacon = vi.fn(() => false);
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => okResponse());
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    vi.stubGlobal("document", { visibilityState: "hidden" });
    vi.stubGlobal("fetch", fetchMock);

    reportClick("site-1", undefined);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]![1].keepalive).toBe(true);
  });
});

describe("点击出箱（离线补报）", () => {
  it("送达失败才入队，且入队的幂等键/身份与请求体一致", async () => {
    const store = stubBrowserEnv();
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetchMock);

    reportClick("site-9", "anon-9", { query: "离线点的" });
    await vi.waitFor(() => expect(store.get(OUTBOX_LS_KEY)).toBeTruthy());

    const sent = JSON.parse(String(fetchMock.mock.calls[0]![1].body)) as { eventId: string };
    const entries = JSON.parse(store.get(OUTBOX_LS_KEY)!) as Array<{
      eventId: string;
      identity?: string;
      body: { kind: string; siteId: string; query: string };
    }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.eventId).toBe(sent.eventId);
    expect(entries[0]!.identity).toBe("anon-9");
    expect(entries[0]!.body).toMatchObject({ kind: "click", siteId: "site-9", query: "离线点的" });
  });

  it("成功送达不入队（出箱只留真丢过的）", async () => {
    const store = stubBrowserEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init: RequestInit) => okResponse()),
    );
    reportClick("site-1", "anon-1");
    await new Promise((r) => setTimeout(r, 5));
    expect(store.get(OUTBOX_LS_KEY) ?? null).toBe(null);
  });

  it("关掉遥测开关后不落端侧：带查询词的流水不该在「已关闭」之后继续存", async () => {
    const store = stubBrowserEnv({ telemetryEnabled: false });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    reportClick("site-1", "anon-1", { query: "敏感词" });
    await new Promise((r) => setTimeout(r, 10));
    expect(store.get(OUTBOX_LS_KEY) ?? null).toBe(null);
  });

  it("补发按旧→新串行，只清已确认的条目", async () => {
    const store = stubBrowserEnv();
    store.set(
      OUTBOX_LS_KEY,
      JSON.stringify([
        { eventId: "e-old", queuedAt: 100, identity: "anon-1", body: { kind: "click", siteId: "s-old" } },
        { eventId: "e-new", queuedAt: 200, identity: "anon-1", body: { kind: "click", siteId: "s-new" } },
      ]),
    );
    const sentBodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        sentBodies.push(String(init.body));
        return okResponse();
      }),
    );

    await expect(flushClickOutbox()).resolves.toBe(2);
    expect(JSON.parse(sentBodies[0]!).siteId).toBe("s-old");
    expect(JSON.parse(sentBodies[1]!).siteId).toBe("s-new");
    expect(JSON.parse(store.get(OUTBOX_LS_KEY)!)).toEqual([]);
  });

  it("补发中途没送达就停在这里：其余留在箱里等下次", async () => {
    const store = stubBrowserEnv();
    store.set(
      OUTBOX_LS_KEY,
      JSON.stringify([
        { eventId: "e-1", queuedAt: 100, body: { kind: "click", siteId: "s-1" } },
        { eventId: "e-2", queuedAt: 200, body: { kind: "click", siteId: "s-2" } },
      ]),
    );
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(flushClickOutbox()).resolves.toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(store.get(OUTBOX_LS_KEY)!)).toHaveLength(2);
  });

  it("补发时身份跟着条目走，不会把重放的事件变成无主数据", async () => {
    const store = stubBrowserEnv();
    store.set(
      OUTBOX_LS_KEY,
      JSON.stringify([{ eventId: "e-1", queuedAt: 100, identity: "anon-keep", body: { kind: "click", siteId: "s-1" } }]),
    );
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await flushClickOutbox();
    expect((fetchMock.mock.calls[0]![1].headers as Record<string, string>)["X-Navhub-Anon-Id"]).toBe("anon-keep");
  });

  it("开关关闭后再联网补发：把箱里的证据删掉而不是偷偷送出", async () => {
    const store = stubBrowserEnv({ telemetryEnabled: false });
    store.set(
      OUTBOX_LS_KEY,
      JSON.stringify([{ eventId: "e-1", queuedAt: 100, body: { kind: "click", siteId: "s-1", query: "旧证据" } }]),
    );
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(flushClickOutbox()).resolves.toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(store.get(OUTBOX_LS_KEY)!)).toEqual([]);
    // 清箱时本会发一条 click_delivery(deleted/consent_off)，但它过同一道同意开关：
    // 「关掉遥测」之后连「我们删掉了什么」都不该再送出。
  });
});

describe("投递漏斗信号（click_delivery）", () => {
  it("没送出去并入队后补一条 failed/enqueued：分辨「没人点」与「点了没送到」", async () => {
    const store = stubBrowserEnv();
    const sent: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        sent.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        throw new Error("offline");
      }),
    );

    reportClick("site-9", "anon-9", { query: "离线点的" });
    await vi.waitFor(() => expect(store.get(OUTBOX_LS_KEY)).toBeTruthy());
    await vi.waitFor(() => expect(sent.some((b) => b.kind === "click_delivery")).toBe(true));

    const signal = sent.find((b) => b.kind === "click_delivery")!;
    expect(signal).toMatchObject({ outcome: "failed", code: "enqueued" });
    // 观测信号不带站点与查询词：漏斗数据不该变成第二份隐私流水
    expect(signal.siteId).toBeUndefined();
    expect(signal.query).toBeUndefined();
    expect(String(signal.eventId)).toMatch(EVENT_ID_RE);
  });

  it("出箱补送成功后补一条 success/drained（证明链路修复过，而不是「从来没坏」）", async () => {
    const store = stubBrowserEnv();
    store.set(
      OUTBOX_LS_KEY,
      JSON.stringify([{ eventId: "e-1", queuedAt: 1, identity: "anon-1", body: { kind: "click", siteId: "s-1" } }]),
    );
    const sent: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        sent.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return okResponse();
      }),
    );

    await expect(flushClickOutbox()).resolves.toBe(1);
    await vi.waitFor(() => expect(sent.some((b) => b.kind === "click_delivery")).toBe(true));
    expect(sent.find((b) => b.kind === "click_delivery")).toMatchObject({ outcome: "success", code: "drained" });
  });

  it("漏斗信号不进出箱：它自己失败时不制造待补送的条目", async () => {
    const store = stubBrowserEnv();
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        calls += 1;
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        if (body.kind === "click_delivery") throw new Error("signal lost");
        throw new Error("offline");
      }),
    );

    reportClick("site-9", "anon-9", { query: "离线点的" });
    await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(2));
    await new Promise((r) => setTimeout(r, 10));

    const entries = JSON.parse(store.get(OUTBOX_LS_KEY)!) as Array<{ body: { kind: string } }>;
    expect(entries.every((e) => e.body.kind === "click")).toBe(true);
    expect(entries).toHaveLength(1);
  });
});
