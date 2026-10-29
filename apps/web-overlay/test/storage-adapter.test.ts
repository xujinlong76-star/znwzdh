/**
 * http 存储适配器：连接熔断器与故障分类测试。
 *
 * 覆盖本次修复的三个核心行为：
 *   1. 连接级故障（fetch 抛出）与「中枢活着但报错」（HTTP 5xx / 畸形 JSON）
 *      必须被区分开 —— 后者不能跳闸；
 *   2. 跳闸后进入冷静期：期间不发新连接，直接快速失败；
 *   3. 告警按冷静期窗口去重（每窗一条 warn），恢复时输出一条 info。
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  createHttpAdapter,
  resolveAdapterKind,
  StorageError,
  type HttpAdapterOptions,
} from "../src/lib/storage-adapter";

const BASE = "http://127.0.0.1:8787";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** 收集 console 输出，测试结束后自动恢复 */
function spyConsole() {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  return { warn, error, info };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("resolveAdapterKind", () => {
  it("缺省为 http", () => {
    expect(resolveAdapterKind({})).toBe("http");
  });

  it("接受 github / http / sqlite", () => {
    expect(resolveAdapterKind({ STORAGE_ADAPTER: "GitHub" })).toBe("github");
    expect(resolveAdapterKind({ STORAGE_ADAPTER: "sqlite" })).toBe("sqlite");
  });

  it("拒绝未知值", () => {
    expect(() => resolveAdapterKind({ STORAGE_ADAPTER: "redis" })).toThrowError(StorageError);
  });
});

describe("createHttpAdapter 正常路径", () => {
  it("read 返回解析后的 JSON，且不产生任何日志", async () => {
    const { warn, error, info } = spyConsole();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ basic: { title: "中枢标题" } }));
    const adapter = createHttpAdapter({ baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });

    const data = await adapter.read("src/navsphere/content/site.json");
    expect(data).toEqual({ basic: { title: "中枢标题" } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(BASE + "/api/storage?path=" + encodeURIComponent("src/navsphere/content/site.json"));
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it("write 返回 note 并 PUT 到 /api/storage", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ note: "ok" }));
    const adapter = createHttpAdapter({ baseUrl: BASE + "/", fetchImpl: fetchImpl as unknown as typeof fetch });

    const res = await adapter.write("p.json", "{}", "msg");
    expect(res).toEqual({ ok: true, note: "ok" });
    expect(fetchImpl.mock.calls[0][0]).toBe(BASE + "/api/storage");
    expect((fetchImpl.mock.calls[0][1] as RequestInit).method).toBe("PUT");
  });
});

describe("故障分类：连接级 vs 中枢活着但报错", () => {
  it("fetch 抛出（ECONNREFUSED / fetch failed）-> unreachable=true，跳闸并 warn 一次", async () => {
    const { warn, error } = spyConsole();
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const adapter = createHttpAdapter({ baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(adapter.read("site.json")).rejects.toMatchObject({
      name: "StorageError",
      unreachable: true,
    });
    // 报错信息要能认出是哪个中枢
    await expect(adapter.read("site.json")).rejects.toThrow(/127\.0\.0\.1:8787/);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled(); // 关键：连接级故障不再按 error 刷屏
  });

  it("中枢返回 500 -> unreachable=false，带 status，且不跳闸（下次照常尝试连接）", async () => {
    const { warn } = spyConsole();
    const fetchImpl = vi.fn().mockImplementation(() => jsonResponse("内部错误", 500));
    const adapter = createHttpAdapter({ baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(adapter.read("site.json")).rejects.toMatchObject({
      name: "StorageError",
      status: 500,
      unreachable: false,
    });
    await expect(adapter.read("site.json")).rejects.toMatchObject({ status: 500 });
    // 两次都真发了请求：5xx 说明中枢活着，熔断器不该介人
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it("中枢响应不是合法 JSON -> unreachable=false，不跳闸", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => new Response("<html>gateway</html>", { status: 200 }));
    const adapter = createHttpAdapter({ baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(adapter.read("site.json")).rejects.toMatchObject({
      name: "StorageError",
      unreachable: false,
    });
    await expect(adapter.read("site.json")).rejects.toThrow(/不是合法 JSON/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("连接熔断器", () => {
  it("冷静期内读/写直接快速失败，不再发起连接", async () => {
    vi.useFakeTimers();
    const { warn } = spyConsole();
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const adapter = createHttpAdapter({ baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });

    // 第一次：真发连接 -> 失败 -> 跳闸
    await expect(adapter.read("site.json")).rejects.toMatchObject({ unreachable: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);

    // 冷静期内：读 3 次 + 写 1 次，全部快速失败，一次连接都不发
    for (let i = 0; i < 3; i++) {
      await expect(adapter.read("site.json")).rejects.toMatchObject({ unreachable: true });
    }
    await expect(adapter.write("site.json", "{}", "m")).rejects.toMatchObject({ unreachable: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1); // 整个窗口只有一条告警
  });

  it("冷静期结束后重新尝试；成功后复位并输出一条恢复日志", async () => {
    vi.useFakeTimers();
    const { warn, info } = spyConsole();
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockImplementation(() => jsonResponse({ ok: true }));
    const adapter = createHttpAdapter({ baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(adapter.read("site.json")).rejects.toMatchObject({ unreachable: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // 推进到冷静期边界：允许再次尝试
    vi.advanceTimersByTime(5_000);
    await expect(adapter.read("site.json")).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][0]).toContain("连接已恢复");

    // 已复位：下一次读正常发连接，且无额外日志
    await adapter.read("site.json");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(info).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("冷静期后再次失败 -> 新窗口重新 warn 一条（不是每个请求一条）", async () => {
    vi.useFakeTimers();
    const { warn } = spyConsole();
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const adapter = createHttpAdapter({ baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(adapter.read("site.json")).rejects.toMatchObject({ unreachable: true });
    vi.advanceTimersByTime(5_000);
    await expect(adapter.read("site.json")).rejects.toMatchObject({ unreachable: true });
    await expect(adapter.read("site.json")).rejects.toMatchObject({ unreachable: true }); // 新窗口冷静期内，不再 warn
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("cooldownMs=0 时熔断关闭：每次请求都尝试连接", async () => {
    spyConsole();
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const opts: HttpAdapterOptions = { baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch, cooldownMs: 0 };
    const adapter = createHttpAdapter(opts);

    await expect(adapter.read("site.json")).rejects.toMatchObject({ unreachable: true });
    await expect(adapter.read("site.json")).rejects.toMatchObject({ unreachable: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("读请求的 Data Cache（next.revalidate）", () => {
  /** 取最近一次 fetch 的 init（含 next 扩展字段） */
  function lastInit(fetchImpl: ReturnType<typeof vi.fn>): RequestInit & { next?: { revalidate?: number; tags?: string[] } } {
    return fetchImpl.mock.calls.at(-1)?.[1] as RequestInit & { next?: { revalidate?: number; tags?: string[] } };
  }

  it("默认 read 带 next.revalidate=60（首页 TTFB 不再每次打穿中枢）", async () => {
    spyConsole();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const adapter = createHttpAdapter({ baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });

    await adapter.read("site.json");
    expect(lastInit(fetchImpl).next).toEqual({ revalidate: 60 });
  });

  it("revalidateS 可覆盖（部署侧按内容变更频率调档）", async () => {
    spyConsole();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const adapter = createHttpAdapter({ baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch, revalidateS: 300 });

    await adapter.read("site.json");
    expect(lastInit(fetchImpl).next).toEqual({ revalidate: 300 });
  });

  it("revalidateS=0 时不带 next 选项（显式禁用 = 回到实时读）", async () => {
    spyConsole();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const adapter = createHttpAdapter({ baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch, revalidateS: 0 });

    await adapter.read("site.json");
    expect(lastInit(fetchImpl).next).toBeUndefined();
    expect(lastInit(fetchImpl).cache).toBe("no-store");
  });

  it("tags 只在真的进 Data Cache 时附加（写侧 revalidateTag 的抓手）", async () => {
    spyConsole();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const adapter = createHttpAdapter({
      baseUrl: BASE,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      tags: ["navhub-hub"],
    });

    await adapter.read("site.json");
    expect(lastInit(fetchImpl).next).toEqual({ revalidate: 60, tags: ["navhub-hub"] });
  });

  it("revalidateS=0 时 tags 不生效：实时读不进缓存，写后无需失效", async () => {
    spyConsole();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const adapter = createHttpAdapter({
      baseUrl: BASE,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      revalidateS: 0,
      tags: ["navhub-hub"],
    });

    await adapter.read("site.json");
    expect(lastInit(fetchImpl).next).toBeUndefined();
    expect(lastInit(fetchImpl).cache).toBe("no-store");
  });

  it("write（PUT）永远不带 next —— 写不过缓存", async () => {
    spyConsole();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ note: "ok" }));
    const adapter = createHttpAdapter({ baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });

    await adapter.write("p.json", "{}", "msg");
    expect(lastInit(fetchImpl).next).toBeUndefined();
    expect(lastInit(fetchImpl).method).toBe("PUT");
  });

  it("带 token 的部署也照常附带选项（Next 对鉴权 fetch 不缓存是它的安全默认，适配器只管附上）", async () => {
    spyConsole();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const adapter = createHttpAdapter({ baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch, token: "t0ken" });

    await adapter.read("site.json");
    expect(lastInit(fetchImpl).next).toEqual({ revalidate: 60 });
    expect((lastInit(fetchImpl).headers as Record<string, string>).Authorization).toBe("Bearer t0ken");
  });
});
