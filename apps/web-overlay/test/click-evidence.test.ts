/**
 * 搜索点击证据：**点了哪条、从哪个检索通道点进来的**必须回传到中枢。
 *
 * 真实缺陷（改动前）：`reportClick` 只发 `{ kind:'click', siteId }`。
 * 中枢的在线学习循环（telemetry.ts 的 `recordFeedback`）只在带 `query` 时
 * 才更新 LinUCB——于是「用户点了搜索结果」这件事在模型侧完全不可见，
 * 排序权重永远是初始值，离线调完分也只能靠改代码上线。
 *
 * 这里锁三件事：
 *   1. 请求体带上 query / channel / position，且不带多余的空字段；
 *   2. 脏值（未知通道、越界位置/停留时长）被丢弃或收敛，不写进事件表；
 *   3. 上报本身仍是 fire-and-forget：失败不冒泡到页面逻辑。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildClickEventBody, reportClick } from "../src/lib/navhub-api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
});

describe("reportClick", () => {
  it("把点击证据 POST 到中枢事件接口，并带匿名身份头", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response('{"ok":true}', { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    reportClick("site-1", "anon-123", { query: "ai 编程", channel: "fts", position: 2 });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/hub/events");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Navhub-Anon-Id"]).toBe("anon-123");
    expect(JSON.parse(String(init.body))).toEqual({
      kind: "click",
      siteId: "site-1",
      query: "ai 编程",
      channel: "fts",
      position: 2,
    });
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
