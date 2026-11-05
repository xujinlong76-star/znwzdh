/**
 * 出站观测（升级改造方案 P2）。
 *
 * guardedFetch 是服务端所有主动出站的唯一出口（富化、探活、订阅源、动态 REST 工具），
 * `/api/metrics` 的 navhub_outbound_* 全靠这里注册的观察者喂数。因此这里守的不是
 * 「指标好不好看」，而是三条会让指标变成谎言的性质：
 *   1. 四类结果（ok / http_error / blocked / network_error）分得对——分错了运维就会
 *      把「目标站挂了」当成「自家出口挂了」来处理；
 *   2. 每一次调用都恰好上报一次（含失败路径），漏报等于流量被系统性低估；
 *   3. 观察者本身绝不能把抓取带崩——指标链路坏掉不应该让功能跟着坏。
 */
import { afterAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { SsrfBlockedError, guardedFetch, setOutboundObserver, type OutboundObservation } from "../src/ssrf.ts";

/**
 * 本包与 apps/api 共用 vitest 的 isolate:false，模块级 observer 变量会跨文件驻留。
 * 每个用例都在 finally 里摘掉观察者，afterAll 再兜一次底，
 * 否则同 worker 后面的文件会莫名多出出站回调（以及它抛出的错）。
 */
afterAll(() => setOutboundObserver(null));

function startServer(): Promise<{ server: Server; base: string; port: number }> {
  const server = createServer((req, res) => {
    const path = req.url ?? "";
    if (path === "/redirect-a") { res.writeHead(302, { location: "/final" }); res.end(); return; }
    if (path === "/final") { res.writeHead(200, { "content-type": "text/plain" }); res.end("hello"); return; }
    if (path === "/gone") { res.writeHead(404, { "content-type": "text/plain" }); res.end("nope"); return; }
    if (path === "/big") { res.writeHead(200, { "content-type": "text/plain" }); res.end("x".repeat(4096)); return; }
    if (path === "/loop") { res.writeHead(302, { location: "/loop" }); res.end(); return; }
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("boom");
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({ server, port, base: "http://127.0.0.1:" + port });
    });
  });
}

const guard = { allowPrivateNetworks: true, timeoutMs: 2000 };

async function collect<T>(fn: () => Promise<T>): Promise<{ observations: OutboundObservation[]; value: T | null; error: unknown }> {
  const observations: OutboundObservation[] = [];
  setOutboundObserver((o) => observations.push(o));
  try {
    const value = await fn();
    return { observations, value, error: null };
  } catch (error) {
    return { observations, value: null, error };
  } finally {
    setOutboundObserver(null);
  }
}

describe("出站观测：结果分类", () => {
  it("2xx：outcome=ok，hops 含重定向跳，bytes 是真实响应体长度", async () => {
    const { server, base } = await startServer();
    try {
      const { observations, error } = await collect(() => guardedFetch(base + "/redirect-a", guard));
      expect(error).toBeNull();
      expect(observations).toHaveLength(1);
      const o = observations[0]!;
      expect(o.outcome).toBe("ok");
      expect(o.status).toBe(200);
      expect(o.reason).toBeNull();
      // /redirect-a → /final：两次 HTTP 往返
      expect(o.hops).toBe(2);
      expect(o.bytes).toBe(5);
      expect(o.method).toBe("GET");
      expect(o.host).toContain("127.0.0.1");
      expect(o.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("4xx/5xx：outcome=http_error（对端应答了，是目标站的问题），不是 network_error", async () => {
    const { server, base } = await startServer();
    try {
      const { observations } = await collect(() => guardedFetch(base + "/gone", guard));
      expect(observations[0]).toMatchObject({ outcome: "http_error", status: 404, reason: null, hops: 1 });
      const serverError = await collect(() => guardedFetch(base + "/anything-else", guard));
      expect(serverError.observations[0]).toMatchObject({ outcome: "http_error", status: 500 });
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("SSRF 拦截：outcome=blocked 且带上界枚举的 reason，原始错误类型不变", async () => {
    const protocol = await collect(() => guardedFetch("file:///C:/Windows/win.ini"));
    expect(protocol.error).toBeInstanceOf(SsrfBlockedError);
    expect(protocol.observations).toHaveLength(1);
    expect(protocol.observations[0]).toMatchObject({ outcome: "blocked", reason: "protocol", status: null, bytes: 0 });

    const metadata = await collect(() => guardedFetch("http://169.254.169.254/latest/meta-data/"));
    expect(metadata.error).toBeInstanceOf(SsrfBlockedError);
    expect(metadata.observations[0]).toMatchObject({ outcome: "blocked", reason: "blocked-ip" });
  });

  it("没拿到应答（重定向环路超限）：outcome=network_error，hops 如实报 0 而不是按 1 估算", async () => {
    const { server, base } = await startServer();
    try {
      const { observations, error } = await collect(() =>
        guardedFetch(base + "/loop", { ...guard, maxRedirects: 2 }),
      );
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(SsrfBlockedError);
      expect(observations[0]).toMatchObject({ outcome: "network_error", status: null, reason: null, hops: 0 });
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("体积上限触发截断时，bytes 记的是实际读入量（上限），不是对端总大小", async () => {
    const { server, base } = await startServer();
    try {
      const { observations } = await collect(() => guardedFetch(base + "/big", { ...guard, maxBytes: 100 }));
      expect(observations[0]!.bytes).toBeLessThanOrEqual(100);
      expect(observations[0]!.bytes).toBeGreaterThan(0);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("写请求按调用方给的方法上报（POST 不会被记成 GET）", async () => {
    const { server, base } = await startServer();
    try {
      const { observations } = await collect(() =>
        guardedFetch(base + "/final", guard, { method: "POST", body: "a=1" }),
      );
      expect(observations[0]!.method).toBe("POST");
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

describe("出站观测：接线不能反过来影响抓取本身", () => {
  it("没注册观察者时一切照常（默认不计数、不抛）", async () => {
    const { server, base } = await startServer();
    try {
      setOutboundObserver(null);
      const res = await guardedFetch(base + "/final", guard);
      expect(res.status).toBe(200);
      expect(res.body).toContain("hello");
    } finally {
      setOutboundObserver(null);
      await new Promise((r) => server.close(r));
    }
  });

  it("观察者抛异常只吞掉这条指标，抓取结果与拦截错误都原样返回给调用方", async () => {
    const { server, base } = await startServer();
    try {
      setOutboundObserver(() => {
        throw new Error("指标链路炸了");
      });
      await expect(guardedFetch(base + "/final", guard)).resolves.toMatchObject({ status: 200 });
      await expect(guardedFetch("file:///etc/passwd")).rejects.toBeInstanceOf(SsrfBlockedError);
    } finally {
      setOutboundObserver(null);
      await new Promise((r) => server.close(r));
    }
  });

  it("URL 解析不出来时也不会漏报（host 落在 invalid-url，不会把异常输入变成新序列）", async () => {
    const { observations } = await collect(() => guardedFetch("not a url"));
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({ host: "invalid-url", outcome: "blocked", reason: "malformed" });
  });
});
