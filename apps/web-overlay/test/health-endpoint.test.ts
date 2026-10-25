/**
 * /api/health（web 层探针）的行为测试。
 *
 * 钉住四件事：
 *  1. 运行时声明与实现一致 —— 旧版标 edge 却读 process.uptime，端点自己 500；
 *  2. 「web 存活」与「中枢可达」是两件事，不能互相冒充：上游挂了探针仍 200，
 *     但 status 必须如实变 degraded，且绝不把测不到的字段写成 0/false；
 *  3. degraded 只有在 ?strict=1 时才答 503（存活面永不因上游抖动而变）；
 *  4. 中枢基址、模式、能力位、Node 版本只给内部 token 调用方；没配 token 时零豁免。
 */
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ROUTE_SOURCE = readFileSync(new URL("../src/app/api/health/route.ts", import.meta.url), "utf8");

let originalFetch: typeof globalThis.fetch;
let upstreamCalls: string[];

function hubBody(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    mode: "lite",
    db: { ok: true },
    capabilities: { semantic: false, fts: true, llm: true, notes: ["FTS5 全文索引就绪", 42] },
    ...overrides,
  };
}

function stubHub(handler: () => Response | Error) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    upstreamCalls.push(String(input));
    const out = handler();
    if (out instanceof Error) throw out;
    return out;
  }) as typeof globalThis.fetch;
}

async function getHealth(query = "", headers?: Record<string, string>) {
  vi.resetModules();
  const route = await import("../src/app/api/health/route");
  const request = new Request(`http://localhost:3000/api/health${query}`, { headers });
  const res = await route.GET(request);
  return { status: res.status, headers: res.headers, body: (await res.json()) as Record<string, any> };
}

beforeEach(() => {
  upstreamCalls = [];
  originalFetch = globalThis.fetch;
  delete process.env.NAVHUB_INTERNAL_TOKEN;
  delete process.env.NAVHUB_STORAGE_BASE_URL;
  delete process.env.NEXT_PUBLIC_API_URL;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.NAVHUB_INTERNAL_TOKEN;
  delete process.env.NAVHUB_STORAGE_BASE_URL;
  delete process.env.NEXT_PUBLIC_API_URL;
});

describe("/api/health：运行时与探针语义", () => {
  it("运行时与实现一致：edge 用不了 process.uptime，这里必须是 nodejs", async () => {
    vi.resetModules();
    const route = await import("../src/app/api/health/route");
    expect(route.runtime).toBe("nodejs");
    expect(route.dynamic).toBe("force-dynamic");
    expect(ROUTE_SOURCE).toMatch(/export const runtime = ['"]nodejs['"]/);
  });

  it("中枢正常 → 200 + status ok，匿名调用只拿到聚合面", async () => {
    stubHub(() => new Response(JSON.stringify(hubBody()), { status: 200 }));
    const { status, headers, body } = await getHealth();
    expect(status).toBe(200);
    expect(headers.get("cache-control")).toBe("no-store");
    expect(body.ok).toBe(true);
    expect(body.tier).toBe("web");
    expect(body.status).toBe("ok");
    expect(body.hub.ok).toBe(true);
    expect(body.hub.probe).toBe("ok");
    expect(body.hub.latencyMs).toBeGreaterThanOrEqual(0);
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    // 明细不外泄
    expect(body.hub.base).toBeUndefined();
    expect(body.hub.mode).toBeUndefined();
    expect(body.hub.capabilities).toBeUndefined();
    expect(body.node).toBeUndefined();
  });

  it("存活面与上游脱钩：中枢不可达仍是 200，但状态如实变 degraded", async () => {
    stubHub(() => Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8787"), { name: "TypeError" }));
    const { status, body } = await getHealth();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.status).toBe("degraded");
    expect(body.hub.ok).toBe(false);
    expect(body.hub.probe).toBe("failed");
    expect(body.hub.reason).toContain("中枢不可达");
  });

  it("?strict=1 把 degraded 变 503，中枢正常时依旧 200", async () => {
    stubHub(() => Object.assign(new Error("boom"), { name: "TypeError" }));
    expect((await getHealth("?strict=1")).status).toBe(503);

    stubHub(() => new Response(JSON.stringify(hubBody()), { status: 200 }));
    expect((await getHealth("?strict=1")).status).toBe(200);
  });

  it("中枢 404 与「连不上」要分清：前者说版本/网关，后者说不可达", async () => {
    stubHub(() => new Response("not found", { status: 404 }));
    const miss = await getHealth();
    expect(miss.body.hub.probe).toBe("miss");
    expect(miss.body.hub.reason).toContain("没有 /api/health");

    stubHub(() => new Error("socket hang up"));
    const failed = await getHealth();
    expect(failed.body.hub.probe).toBe("failed");
    expect(failed.body.hub.reason).toContain("中枢不可达");
  });

  it("中枢少给字段就留 null，不写成 false/0 冒充测到了", async () => {
    stubHub(() => new Response(JSON.stringify({ ok: true, capabilities: { notes: [] } }), { status: 200 }));
    process.env.NAVHUB_INTERNAL_TOKEN = "s3cret";
    const { body } = await getHealth("", { "x-navhub-internal-token": "s3cret" });
    expect(body.hub.ok).toBe(true);
    expect(body.hub.mode).toBeNull();
    expect(body.hub.db).toBeNull();
    expect(body.hub.capabilities).toEqual({ semantic: null, fts: null, llm: null });
  });

  it("notes 里的非字符串项被丢掉，而不是渲染成乱码", async () => {
    stubHub(() => new Response(JSON.stringify(hubBody()), { status: 200 }));
    process.env.NAVHUB_INTERNAL_TOKEN = "s3cret";
    const { body } = await getHealth("", { "x-navhub-internal-token": "s3cret" });
    expect(body.hub.notes).toEqual(["FTS5 全文索引就绪"]);
    expect(body.hub.mode).toBe("lite");
    expect(body.hub.db).toBe(true);
    expect(body.hub.capabilities).toEqual({ semantic: false, fts: true, llm: true });
    expect(body.hub.base).toBe("http://localhost:8787");
    expect(typeof body.node).toBe("string");
  });

  it("明细只认内部 token：值不对、或压根没配 token 时一律脱敏", async () => {
    stubHub(() => new Response(JSON.stringify(hubBody()), { status: 200 }));

    process.env.NAVHUB_INTERNAL_TOKEN = "s3cret";
    expect((await getHealth("", { "x-navhub-internal-token": "wrong" })).body.hub.base).toBeUndefined();
    expect((await getHealth()).body.hub.base).toBeUndefined();

    delete process.env.NAVHUB_INTERNAL_TOKEN;
    const noPolicy = await getHealth("", { "x-navhub-internal-token": "s3cret" });
    expect(noPolicy.body.hub.base).toBeUndefined();
    expect(noPolicy.body.node).toBeUndefined();
  });

  it("15 秒内重复探测复用上游结果并如实标注 fromCache", async () => {
    stubHub(() => new Response(JSON.stringify(hubBody()), { status: 200 }));
    const first = await getHealth();
    const before = upstreamCalls.length;
    // 同一模块实例（不 resetModules）才共享缓存，这里直接走一次原生 fetch 封装
    const route = await import("../src/app/api/health/route");
    const again = await route.GET(new Request("http://localhost:3000/api/health"));
    const body = (await again.json()) as Record<string, any>;
    expect(first.body.hub.fromCache).toBe(false);
    expect(body.hub.fromCache).toBe(true);
    expect(upstreamCalls.length).toBe(before);
  });

  it("探测带超时，中枢挂住不回包时探针不会跟着挂死", async () => {
    vi.resetModules();
    const spy = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response("stalled", { status: 500 });
    });
    globalThis.fetch = spy as unknown as typeof globalThis.fetch;
    const route = await import("../src/app/api/health/route");
    const res = await route.GET(new Request("http://localhost:3000/api/health"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, any>).status).toBe("degraded");
    expect(spy).toHaveBeenCalled();
  });
});

// env 卫生（D2）：恢复本文件改写的环境变量，避免驻留同 worker 的后续文件
afterAll(() => {
  delete process.env.NAVHUB_INTERNAL_TOKEN;
});
