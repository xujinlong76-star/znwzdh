import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import { brotliCompressSync, deflateSync, gzipSync, zstdCompressSync } from "node:zlib";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  guardedFetch,
  pinnedLookup,
  safeFetch,
  safeFetchStream,
  SsrfBlockedError,
  type PinnedAddress,
} from "../src/ssrf.ts";

const execFileAsync = promisify(execFile);
const dns = vi.hoisted(() => ({
  calls: 0,
  byHost: new Map<string, Array<{ address: string; family: number }>>(),
}));

vi.mock("node:dns/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:dns/promises")>();
  return {
    ...actual,
    lookup: async (hostname: string, options?: unknown) => {
      const answer = dns.byHost.get(hostname);
      if (answer) return answer;
      if (hostname !== "rebind.example") return actual.lookup(hostname, options as never);
      dns.calls++;
      // 第一次解析通过校验；若实现像旧 guardedFetch 一样复查/重新解析，第二次会落到环回。
      return dns.calls === 1
        ? [{ address: "93.184.216.34", family: 4 }]
        : [{ address: "127.0.0.1", family: 4 }];
    },
  };
});

beforeEach(() => {
  dns.calls = 0;
  dns.byHost.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  dns.byHost.clear();
  vi.resetModules();
});

/** 模拟 Node 在 request 建连时调用 options.lookup，记录最终连接目标。 */
function mockRequestConnection(transport: typeof http | typeof https = http) {
  let connected: { address: string; family: number } | undefined;
  const request = vi.spyOn(transport, "request").mockImplementation(((options: Record<string, unknown>, callback: (res: unknown) => void) => {
    const req = new EventEmitter() as EventEmitter & {
      write: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
    };
    req.write = vi.fn();
    req.destroy = vi.fn(() => {
      req.emit("error", new Error("socket destroyed"));
      return req;
    });
    req.end = vi.fn(() => {
      const lookup = options.lookup as (
        hostname: string,
        opts: unknown,
        cb: (err: null, address: string, family: number) => void,
      ) => void;
      lookup(String(options.hostname), {}, (_err, address, family) => {
        connected = { address, family };
      });
      const res = PassThrough() as PassThrough & { statusCode: number; headers: Record<string, string> };
      res.statusCode = 200;
      res.headers = { "content-type": "text/plain" };
      callback(res);
      res.end("pinned-ok");
    });
    return req;
  }) as unknown as typeof http.request);
  return { request, connected: () => connected };
}

async function withLocalServer(handler: http.RequestListener, run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
}

describe("连接级 IP pinning", () => {
  it.each(["safeFetch", "guardedFetch"] as const)("%s 只解析一次并连接首次校验的 IP", async (kind) => {
    const mock = mockRequestConnection();
    const options = { timeoutMs: 1000, maxBytes: 1024 };
    const result = kind === "safeFetch"
      ? await safeFetch("http://rebind.example/path", options)
      : await guardedFetch("http://rebind.example/path", options);

    expect(dns.calls).toBe(1);
    expect(mock.connected()).toEqual({ address: "93.184.216.34", family: 4 });
    const requestOptions = mock.request.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(requestOptions.hostname).toBe("rebind.example");
    expect(requestOptions.servername).toBe("rebind.example");
    expect(requestOptions.agent).toBe(false);
    expect(result.status).toBe(200);
    if (kind === "safeFetch") {
      expect((result as Awaited<ReturnType<typeof safeFetch>>).pinnedIp).toBe("93.184.216.34");
      expect(new TextDecoder().decode((result as Awaited<ReturnType<typeof safeFetch>>).body)).toBe("pinned-ok");
    } else {
      expect((result as Awaited<ReturnType<typeof guardedFetch>>).body).toBe("pinned-ok");
    }
  });

  it.each(["safeFetch", "guardedFetch"] as const)("%s 的 HTTPS 连接使用首次校验 IP，并保留原域名 SNI", async (kind) => {
    const mock = mockRequestConnection(https);
    const result = kind === "safeFetch"
      ? await safeFetch("https://rebind.example/path", { timeoutMs: 1000, maxBytes: 1024 })
      : await guardedFetch("https://rebind.example/path", { timeoutMs: 1000, maxBytes: 1024 });

    expect(dns.calls).toBe(1);
    expect(mock.connected()).toEqual({ address: "93.184.216.34", family: 4 });
    const requestOptions = mock.request.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(requestOptions.hostname).toBe("rebind.example");
    expect(requestOptions.servername).toBe("rebind.example");
    expect(requestOptions.agent).toBe(false);
    expect(result.status).toBe(200);
  });

  it("safeFetch 可保留截断语义，默认仍在超限时抛可识别的安全错误", async () => {
    const server = http.createServer((_req, res) => res.end("x".repeat(100)));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const truncated = await safeFetch(`http://127.0.0.1:${port}/`, {
        allowPrivateNetworks: true,
        // archive 需要兼容既有行为：允许显式声明的非危险端口。
        allowedPorts: null,
        maxBytes: 10,
        truncateOnLimit: true,
      });
      expect(truncated.truncated).toBe(true);
      expect(truncated.body.byteLength).toBe(10);

      await expect(safeFetch(`http://127.0.0.1:${port}/`, {
        allowPrivateNetworks: true,
        allowedPorts: [port],
        maxBytes: 10,
      })).rejects.toMatchObject({ name: "SsrfBlockedError", reason: "body_too_large" });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    }
  });

  it("显式放行私网时，字面 IP 仍固定到该 IP 且元数据地址继续被拒", async () => {
    const mock = mockRequestConnection();
    const result = await safeFetch("http://127.0.0.1/", {
      allowPrivateNetworks: true,
      timeoutMs: 1000,
    });
    expect(result.pinnedIp).toBe("127.0.0.1");
    expect(mock.connected()?.address).toBe("127.0.0.1");
    await expect(safeFetch("http://169.254.169.254/", { allowPrivateNetworks: true })).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("pinnedLookup 同时兼容单地址与 Node 24 all:true 回调形态", () => {
    type Callback = (err: Error | null, result: string | PinnedAddress[], family?: number) => void;
    const invoke = (options: unknown) => {
      let value: string | PinnedAddress[] | undefined;
      let family: number | undefined;
      let error: Error | null = null;
      const lookup = pinnedLookup({ address: "127.0.0.1", family: 4 });
      lookup("example.test", options, ((err, result, resultFamily) => {
        error = err;
        value = result;
        family = resultFamily;
      }) as Callback);
      expect(error).toBeNull();
      return { value, family };
    };

    expect(invoke({})).toEqual({ value: "127.0.0.1", family: 4 });
    expect(invoke({ all: true, autoSelectFamily: true })).toEqual({
      value: [{ address: "127.0.0.1", family: 4 }],
      family: undefined,
    });
  });

  it.each(["safeFetch", "guardedFetch"] as const)(
    "%s 用真实 node:http 验证 Node 24 all:true 建连、Host、重定向与截断",
    async (kind) => {
      const server = http.createServer((req, res) => {
        if (req.url === "/start") {
          res.writeHead(302, { location: "/final" });
          res.end();
          return;
        }
        res.writeHead(200, {
          "content-type": "text/plain",
          "x-host": String(req.headers.host ?? ""),
          etag: '"local-etag"',
        });
        res.end("x".repeat(100));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as AddressInfo).port;
      // 返回全部已校验地址；连接必须由 pinnedLookup 固定到其中首个 IPv4。
      dns.byHost.set("localhost", [
        { address: "127.0.0.1", family: 4 },
        { address: "::1", family: 6 },
      ]);
      try {
        const url = `http://localhost:${port}/start`;
        const result = kind === "safeFetch"
          ? await safeFetch(url, {
              allowPrivateNetworks: true,
              allowedPorts: [port],
              timeoutMs: 2000,
              maxBytes: 10,
              truncateOnLimit: true,
            })
          : await guardedFetch(url, {
              allowPrivateNetworks: true,
              timeoutMs: 2000,
              maxBytes: 10,
            });
        expect(result.status).toBe(200);
        expect(result.truncated).toBe(true);
        expect(result.finalUrl).toBe(`http://localhost:${port}/final`);
        expect(result.redirects).toHaveLength(1);
        if (kind === "safeFetch") {
          expect(result.headers.get("x-host")).toBe(`localhost:${port}`);
          expect(result.headers.get("etag")).toBe('"local-etag"');
          expect(result.body.byteLength).toBe(10);
          expect(result.pinnedIp).toBe("127.0.0.1");
        } else {
          expect(result.contentType).toBe("text/plain");
          expect(result.etag).toBe('"local-etag"');
          expect(result.bytes).toBe(10);
          expect(result.body).toBe("x".repeat(10));
        }
      } finally {
        await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
      }
    },
  );

  it("allowPrivateNetworks 的域名也会固定到校验通过的 IP", async () => {
    const server = http.createServer((req, res) => res.end(req.socket.remoteAddress ?? ""));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    dns.byHost.set("private.local.test", [{ address: "127.0.0.1", family: 4 }]);
    try {
      const result = await safeFetch(`http://private.local.test:${port}/`, {
        allowPrivateNetworks: true,
        allowedPorts: [port],
        timeoutMs: 2000,
      });
      expect(result.pinnedIp).toBe("127.0.0.1");
      expect(new TextDecoder().decode(result.body)).toBe("127.0.0.1");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    }
  });

  it.each(["safeFetch", "guardedFetch"] as const)("%s 连续请求使用不同 socket", async (kind) => {
    const sockets = new Set<number>();
    const server = http.createServer((req, res) => {
      sockets.add(req.socket.remotePort ?? -1);
      res.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const fetchTwice = async () => {
        for (let i = 0; i < 2; i++) {
          const result = kind === "safeFetch"
            ? await safeFetch(`http://127.0.0.1:${port}/${i}`, {
                allowPrivateNetworks: true,
                allowedPorts: [port],
                timeoutMs: 2000,
              })
            : await guardedFetch(`http://127.0.0.1:${port}/${i}`, {
                allowPrivateNetworks: true,
                timeoutMs: 2000,
              });
          expect(result.status).toBe(200);
        }
      };
      await fetchTwice();
      expect(sockets.size).toBe(2);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    }
  });

  it("总超时不会被持续分包重置", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("x");
      const interval = setInterval(() => res.write("x"), 20);
      res.on("close", () => clearInterval(interval));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const started = Date.now();
      await expect(safeFetch(`http://127.0.0.1:${port}/`, {
        allowPrivateNetworks: true,
        allowedPorts: [port],
        timeoutMs: 120,
        maxBytes: 1024,
      })).rejects.toMatchObject({ name: "SsrfBlockedError", reason: "timeout" });
      expect(Date.now() - started).toBeLessThan(1500);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    }
  });

  it.each(["safeFetch", "guardedFetch"] as const)(
    "%s 用真实 node:https 验证 SNI、证书校验与固定 IP 建连",
    async (kind) => {
      const dir = await mkdtemp(join(tmpdir(), "navhub-ssrf-tls-"));
      const keyPath = join(dir, "key.pem");
      const certPath = join(dir, "cert.pem");
      let server: https.Server | undefined;
      try {
        await execFileAsync("openssl", [
          "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
          "-subj", "/CN=localhost",
          "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
          "-keyout", keyPath,
          "-out", certPath,
        ], { timeout: 15_000 });
        const key = await readFile(keyPath);
        const cert = await readFile(certPath);
        let servername: string | undefined;
        server = https.createServer({ key, cert }, (req, res) => {
          res.writeHead(200, { "content-type": "text/plain" });
          res.end(String(req.socket.remoteAddress ?? ""));
        });
        // SNI 回显仅用于断言；不替换 Node 的证书校验逻辑。
        server.on("secureConnection", (socket) => { servername = socket.servername; });
        await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
        const port = (server.address() as AddressInfo).port;
        dns.byHost.set("localhost", [{ address: "127.0.0.1", family: 4 }]);
        const request = https.request;
        // 只为本次测试注入受信 CA；真实 socket、SNI 和证书链校验仍由 node:https 完成。
        const caSpy = vi.spyOn(https, "request").mockImplementation(((options: https.RequestOptions, callback?: (res: http.IncomingMessage) => void) => {
          return request({ ...options, ca: cert }, callback);
        }) as typeof https.request);
        const fetchLocal = () => kind === "safeFetch"
          ? safeFetch(`https://localhost:${port}/`, {
              allowPrivateNetworks: true,
              allowedPorts: [port],
              timeoutMs: 2000,
            })
          : guardedFetch(`https://localhost:${port}/`, {
              allowPrivateNetworks: true,
              timeoutMs: 2000,
            });
        const result = await fetchLocal();
        expect(caSpy).toHaveBeenCalled();
        expect(servername).toBe("localhost");
        expect(result.status).toBe(200);
        expect(new TextDecoder().decode(
          kind === "safeFetch" ? result.body : new TextEncoder().encode(result.body),
        )).toBe("127.0.0.1");
        if (kind === "safeFetch") expect(result.pinnedIp).toBe("127.0.0.1");

        // 撤销受信 CA 后必须因自签名证书失败，而非静默放行。
        caSpy.mockRestore();
        await expect(fetchLocal()).rejects.toThrow(/certificate/i);
      } finally {
        if (server?.listening) {
          await new Promise<void>((resolve, reject) => server!.close((err) => err ? reject(err) : resolve()));
        }
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});

describe("Content-Encoding 解码与体积上限", () => {
  const codecs = [
    ["gzip", gzipSync],
    ["x-gzip", gzipSync],
    ["deflate", deflateSync],
    ["br", brotliCompressSync],
    ["zstd", zstdCompressSync],
  ] as const;

  it.each(codecs)("%s 响应在 safeFetch/guardedFetch 中解码并移除编码头", async (encoding, compress) => {
    const text = ` decoded-${encoding} `.repeat(20);
    const encoded = compress(Buffer.from(text));
    let receivedAcceptEncoding: string | undefined;
    await withLocalServer((req, res) => {
      receivedAcceptEncoding = req.headers["accept-encoding"];
      res.writeHead(200, {
        "content-type": "text/plain; charset=utf-8",
        "content-encoding": encoding,
        "content-length": String(encoded.byteLength),
      });
      res.end(encoded);
    }, async (baseUrl) => {
      const port = new URL(baseUrl).port;
      const common = {
        allowPrivateNetworks: true,
        timeoutMs: 2000,
        maxBytes: 1024,
      };
      const headers = { "Accept-Encoding": encoding };
      const fetched = await safeFetch(baseUrl, { ...common, allowedPorts: [Number(port)], headers });
      expect(new TextDecoder().decode(fetched.body)).toBe(text);
      expect(fetched.truncated).toBe(false);
      expect(fetched.headers.get("content-encoding")).toBeNull();
      expect(fetched.headers.get("content-length")).toBeNull();
      expect(fetched.headers.get("content-type")).toBe("text/plain; charset=utf-8");

      const guarded = await guardedFetch(baseUrl, common, { headers });
      expect(guarded.body).toBe(text);
      expect(guarded.truncated).toBe(false);
      expect(guarded.bytes).toBe(Buffer.byteLength(text));
      expect(receivedAcceptEncoding).toBe(encoding);
    });
  });

  it("多编码按相反顺序解码", async () => {
    const text = "multiple content encodings ".repeat(20);
    // 声明顺序为 gzip -> br -> deflate，解码顺序必须是 deflate -> br -> gzip。
    const encoded = deflateSync(brotliCompressSync(gzipSync(Buffer.from(text))));
    await withLocalServer((_req, res) => {
      res.writeHead(200, { "content-encoding": "gzip, br, deflate" });
      res.end(encoded);
    }, async (baseUrl) => {
      const result = await safeFetch(baseUrl, {
        allowPrivateNetworks: true,
        allowedPorts: null,
        timeoutMs: 2000,
        maxBytes: 1024,
        headers: { "Accept-Encoding": "gzip, br, deflate" },
      });
      expect(new TextDecoder().decode(result.body)).toBe(text);
      expect(result.truncated).toBe(false);
      expect(result.headers.get("content-encoding")).toBeNull();
      expect(result.headers.get("content-length")).toBeNull();
    });
  });

  it("未知编码保留完整原始字节与编码头，即使前面还有已知编码", async () => {
    const encoded = gzipSync(Buffer.from("must-stay-encoded"));
    await withLocalServer((_req, res) => {
      res.writeHead(200, {
        "content-encoding": "gzip, future-codec",
        "content-length": String(encoded.byteLength),
      });
      res.end(encoded);
    }, async (baseUrl) => {
      const result = await safeFetch(baseUrl, {
        allowPrivateNetworks: true,
        allowedPorts: null,
        timeoutMs: 2000,
        maxBytes: 1024,
        headers: { "Accept-Encoding": "gzip, future-codec" },
      });
      expect(Buffer.from(result.body)).toEqual(encoded);
      expect(result.truncated).toBe(false);
      expect(result.headers.get("content-encoding")).toBe("gzip, future-codec");
      expect(result.headers.get("content-length")).toBe(String(encoded.byteLength));
    });
  });

  it("解压炸弹默认抛 body_too_large，允许截断时返回上限内的解码结果", async () => {
    const encoded = gzipSync(Buffer.from("x".repeat(4096)));
    expect(encoded.byteLength).toBeLessThan(64);
    await withLocalServer((_req, res) => {
      res.writeHead(200, { "content-encoding": "gzip" });
      res.end(encoded);
    }, async (baseUrl) => {
      const options = {
        allowPrivateNetworks: true,
        allowedPorts: null,
        timeoutMs: 2000,
        maxBytes: 64,
        headers: { "Accept-Encoding": "gzip" },
      };
      await expect(safeFetch(baseUrl, options)).rejects.toMatchObject({
        name: "SsrfBlockedError",
        reason: "body_too_large",
      });

      const truncated = await safeFetch(baseUrl, { ...options, truncateOnLimit: true });
      expect(truncated.truncated).toBe(true);
      expect(truncated.body.byteLength).toBe(64);
      expect(new TextDecoder().decode(truncated.body)).toBe("x".repeat(64));
      expect(truncated.headers.get("content-encoding")).toBeNull();
      expect(truncated.headers.get("content-length")).toBeNull();

      // guardedFetch 历来内部启用截断，升级解码后必须保持这一公共语义。
      const guarded = await guardedFetch(baseUrl, options);
      expect(guarded.truncated).toBe(true);
      expect(guarded.bytes).toBe(64);
      expect(guarded.body).toBe("x".repeat(64));
    });
  });

  it("原始编码字节超限仍按既有规则抛错或返回原始截断结果", async () => {
    const encoded = gzipSync(randomBytes(2048));
    expect(encoded.byteLength).toBeGreaterThan(128);
    await withLocalServer((_req, res) => {
      res.writeHead(200, { "content-encoding": "gzip" });
      res.end(encoded);
    }, async (baseUrl) => {
      const options = {
        allowPrivateNetworks: true,
        allowedPorts: null,
        timeoutMs: 2000,
        maxBytes: 128,
        headers: { "Accept-Encoding": "gzip" },
      };
      await expect(safeFetch(baseUrl, options)).rejects.toMatchObject({ reason: "body_too_large" });
      const truncated = await safeFetch(baseUrl, { ...options, truncateOnLimit: true });
      expect(truncated.truncated).toBe(true);
      expect(Buffer.from(truncated.body)).toEqual(encoded.subarray(0, 128));
    });
  });
});

describe("safeFetchStream", () => {
  it.each([
    ["http", http],
    ["https", https],
  ] as const)("%s 只解析一次、连接首次校验 IP，并保留原域名 SNI", async (protocol, transport) => {
    const mock = mockRequestConnection(transport);
    const res = await safeFetchStream(`${protocol}://rebind.example/stream`, { timeoutMs: 1000, maxBytes: 1024 });

    expect(dns.calls).toBe(1);
    expect(mock.connected()).toEqual({ address: "93.184.216.34", family: 4 });
    const requestOptions = mock.request.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(requestOptions.hostname).toBe("rebind.example");
    expect(requestOptions.servername).toBe("rebind.example");
    expect(requestOptions.agent).toBe(false);
    expect(await res.text()).toBe("pinned-ok");
  });

  it("拒绝重定向并立即销毁连接，不把 Authorization 带到下一跳", async () => {
    let hits = 0;
    await withLocalServer((req, res) => {
      hits++;
      if (req.url === "/start") {
        res.writeHead(302, { location: "/final", "transfer-encoding": "chunked" });
        res.write("must-not-be-drained");
        const interval = setInterval(() => {
          if (!res.destroyed) res.write("x");
        }, 10);
        res.once("close", () => clearInterval(interval));
        return;
      }
      res.end("must-not-run");
    }, async (baseUrl) => {
      await expect(safeFetchStream(`${baseUrl}/start`, {
        allowPrivateNetworks: true,
        allowedPorts: null,
        headers: { Authorization: "Bearer secret" },
      })).rejects.toMatchObject({ name: "SsrfBlockedError", reason: "redirect" });
      expect(hits).toBe(1);
    });
  });

  it("重定向响应未结束时关闭上游 socket，停止排空响应体", async () => {
    let closed: Promise<{ closed: boolean; socketDestroyed: boolean }> | undefined;
    await withLocalServer((_req, res) => {
      res.writeHead(302, { location: "/final", "transfer-encoding": "chunked" });
      res.write("open-body");
      closed = new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ closed: false, socketDestroyed: res.socket?.destroyed === true }), 1000);
        res.once("close", () => {
          clearTimeout(timer);
          resolve({ closed: true, socketDestroyed: res.socket?.destroyed === true });
        });
      });
    }, async (baseUrl) => {
      await expect(safeFetchStream(baseUrl, {
        allowPrivateNetworks: true,
        allowedPorts: null,
      })).rejects.toMatchObject({ name: "SsrfBlockedError", reason: "redirect" });
      expect(await closed).toEqual({ closed: true, socketDestroyed: true });
    });
  });

  it.each([
    ["gzip", gzipSync("stream-body")],
    ["deflate", deflateSync("stream-body")],
    ["br", brotliCompressSync("stream-body")],
    ["zstd", zstdCompressSync("stream-body")],
  ] as const)("流式解码 %s 并移除编码头", async (encoding, encoded) => {
    await withLocalServer((_req, res) => {
      res.writeHead(200, { "content-encoding": encoding, "content-length": String(encoded.byteLength) });
      res.end(encoded);
    }, async (baseUrl) => {
      const res = await safeFetchStream(baseUrl, { allowPrivateNetworks: true, allowedPorts: null, maxBytes: 1024 });
      expect(res.headers.get("content-encoding")).toBeNull();
      expect(res.headers.get("content-length")).toBeNull();
      expect(await res.text()).toBe("stream-body");
    });
  });

  it("原始字节与解压后字节都受硬上限约束", async () => {
    await withLocalServer((_req, res) => res.end("x".repeat(100)), async (baseUrl) => {
      const raw = await safeFetchStream(baseUrl, { allowPrivateNetworks: true, allowedPorts: null, maxBytes: 10 });
      await expect(raw.text()).rejects.toMatchObject({ name: "SsrfBlockedError", reason: "body_too_large" });
    });

    const encoded = gzipSync("x".repeat(100));
    expect(encoded.byteLength).toBeLessThan(100);
    await withLocalServer((_req, res) => {
      res.writeHead(200, { "content-encoding": "gzip" });
      res.end(encoded);
    }, async (baseUrl) => {
      const decoded = await safeFetchStream(baseUrl, { allowPrivateNetworks: true, allowedPorts: null, maxBytes: 10 });
      await expect(decoded.text()).rejects.toMatchObject({ name: "SsrfBlockedError", reason: "body_too_large" });
    });
  });

  it("SSE 首块在服务端结束前即可读取", async () => {
    let finish: (() => void) | undefined;
    await withLocalServer(async (_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: first\n\n");
      await new Promise<void>((resolve) => { finish = resolve; });
      res.end("data: [DONE]\n\n");
    }, async (baseUrl) => {
      const res = await safeFetchStream(baseUrl, { allowPrivateNetworks: true, allowedPorts: null, maxBytes: 1024 });
      const reader = res.body!.getReader();
      try {
        const first = await reader.read();
        expect(new TextDecoder().decode(first.value)).toContain("data: first");
      } finally {
        finish?.();
      }
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
      }
    });
  });
});
