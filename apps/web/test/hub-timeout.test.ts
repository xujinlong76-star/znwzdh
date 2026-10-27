/**
 * 服务端取数的有界性：中枢挂死时 `hubGet` 必须**在有限时间内失败**，而不是一直挂着。
 *
 * 为什么单独钉这一条：`hubGet` 的失败路径（返回 null → 调用方降级）早就存在，
 * 但「一直不返回」不会走到那条路径——TCP 连上却不回包时，没有超时的 fetch
 * 会把 RSC 渲染和 ISR 后台再生一起挂在原地，表现是页面无响应而不是降级页。
 * 这类故障在监控上比 500 更难发现，所以超时必须是默认行为而不是调用方记得传。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

/** 模块在载入时读 env，重置模块图后再动态 import（与 hub-internal-token.test.ts 同口径） */
async function loadHub() {
  vi.resetModules();
  return import("@/lib/server/hub");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.NAVHUB_INTERNAL_TOKEN;
});

describe("hubGet 的超时", () => {
  it("默认 10s：AbortSignal.timeout(10_000)，且 next.revalidate 语义不受影响", async () => {
    const timeoutArgs: number[] = [];
    const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      timeoutArgs.push(ms);
      return new AbortController().signal;
    });
    const inits: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
      inits.push(init ?? {});
      return { ok: true, status: 200, json: async () => ({ ok: 1 }) } as Response;
    });

    const { hubGet } = await loadHub();
    await expect(hubGet("/api/sites", 60)).resolves.toEqual({ ok: 1 });

    expect(timeoutArgs).toEqual([10_000]);
    expect(inits[0]?.signal).toBeInstanceOf(AbortSignal);
    // 超时与缓存是两件事：带 revalidate 的取数仍要声明 next.revalidate
    expect((inits[0] as { next?: { revalidate: number } }).next?.revalidate).toBe(60);
    spy.mockRestore();
  });

  it("上游挂死时按传入的超时降级为 null（有界失败，不把渲染拖死）", async () => {
    vi.stubGlobal("fetch", (_input: unknown, init?: RequestInit) => {
      // 模拟「连接建立了但永远不回包」：只有 signal 中止才 reject
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        signal.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted due to timeout", "TimeoutError")),
        );
      });
    });

    const { hubGet } = await loadHub();
    const started = Date.now();
    await expect(hubGet("/api/sites", 0, 30)).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("timeoutMs <= 0 显式关闭超时（与 hubGetProbe 的口径一致）", async () => {
    const inits: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
      inits.push(init ?? {});
      return { ok: true, status: 200, json: async () => ({ ok: 1 }) } as Response;
    });

    const { hubGet } = await loadHub();
    await hubGet("/api/sites", 0, 0);
    expect(inits[0]?.signal).toBeUndefined();
  });

  it("非 2xx 仍然折叠成 null（超时改造不改失败三分法的输入）", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 503, json: async () => ({}) }) as Response);
    const { hubGet } = await loadHub();
    await expect(hubGet("/api/sites")).resolves.toBeNull();
  });
});
