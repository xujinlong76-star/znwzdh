/**
 * 图标代理（`GET /api/assets/icon`）的兜底与内存缓存测试。
 *
 * 这个路由是浏览器控制台那一串 favicon 404 的服务端一侧：前端取的是
 * `/api/hub/assets/icon?url=…`，最终落到这里。锁三件事：
 *  1. 远端探不到图标时返回**确定性 SVG 兜底**而不是 404——404 就意味着前端
 *     `<img>` 报错，这条路径必须是 200；
 *  2. 兜底结果进内存缓存：同一主机第二次请求不再解析域名、也不再出站探测
 *     （桩计数是唯一硬证据），否则每个站点的头像都要重走一遍探测；
 *  3. ETag 协商：带 If-None-Match 命中就回 304，不重复传图。
 * DNS 与网络全部由桩接管，测试不出门。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

// hoisted：mock 工厂比本文件正文先求值，计数器必须先于 import 图存在
const probeLog = vi.hoisted(() => ({ dns: [] as string[], outbound: [] as string[] }));

// 域名解析桩固定返回一个公网地址，让流程走到「解析成功但图标探不到」那条分支：
// 解析失败或命中私网时路由直接回兜底 SVG 且不写内存缓存，就测不到本次要锁的路径。
vi.mock("node:dns/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:dns/promises")>();
  return {
    ...actual,
    lookup: async (hostname: string) => {
      probeLog.dns.push(hostname);
      return [{ address: "93.184.216.34", family: 4 }];
    },
  };
});

const dir = mkdtempSync(join(tmpdir(), "navhub-icon-cache-"));
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

function icon(target: string, headers?: Record<string, string>) {
  return app.inject({
    method: "GET",
    url: `/api/assets/icon?url=${encodeURIComponent(target)}`,
    headers,
  });
}

beforeAll(async () => {
  ctx = await createContext(
    loadConfig({
      mode: "lite" as const,
      embedding: { model: "m", endpoint: "https://hf-mirror.com", dtype: "q8" as const, cacheDir: join(dir, "models"), dim: 512, enabled: false },
      llm: { baseUrl: "https://icon-stub.test/v1", apiKey: "test-key", model: "icon-test-model", timeoutMs: 3000 },
      fetch: { timeoutMs: 1000, maxBytes: 65536, maxRedirects: 1, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
      corsOrigins: ["*"],
      sqlitePath: join(dir, "icon.db"),
    }),
  );
  app = await buildServer(ctx);
  await app.ready();

  // 所有探测都失败 → 走确定性 SVG 兜底
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL) => {
      probeLog.outbound.push(String(input));
      return new Response("not found", { status: 404 });
    },
  );
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

// 跨模块 mock 的兜底：isolate:false 下同 worker 的后续文件会拿到这个假 dns/promises
afterAll(() => {
  vi.resetModules();
});

describe("GET /api/assets/icon 兜底路径", () => {
  it("探测不到图标时返回 200 的 SVG 兜底，且第二次直接命中内存缓存", async () => {
    // 独占一个主机：内存缓存活在整个进程里，共用的话后一个用例会读到前一个的条目
    const host = `icon-fallback-${Math.random().toString(36).slice(2, 8)}.example.com`;
    const first = await icon(`https://${host}`);

    expect(first.statusCode, first.body).toBe(200);
    expect(first.headers["content-type"]).toContain("image/svg+xml");
    expect(first.body.trim()).toMatch(/^<svg/);
    expect(probeLog.dns).toEqual([host]);
    // favicon.ico 的 https/http 两次探测
    expect(probeLog.outbound).toEqual([`https://${host}/favicon.ico`, `http://${host}/favicon.ico`]);

    const etag = String(first.headers["etag"]);
    expect(etag).toMatch(/^W\/"svg_/);

    const second = await icon(`https://${host}`);
    expect(second.statusCode).toBe(200);
    expect(second.headers["etag"]).toBe(etag);
    // 命中内存缓存的硬证据：既没再解析域名，也没再出一次门
    expect(probeLog.dns).toHaveLength(1);
    expect(probeLog.outbound).toHaveLength(2);

    const negotiated = await icon(`https://${host}`, { "if-none-match": etag });
    expect(negotiated.statusCode).toBe(304);
  });

  it("缺少 url/domain 参数时拒绝，不落到兜底 SVG", async () => {
    const res = await app.inject({ method: "GET", url: "/api/assets/icon" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("url");
  });

  it("目标地址不合法时 400，而不是白跑一次探测", async () => {
    const before = probeLog.outbound.length;
    const res = await icon("http://");
    expect(res.statusCode).toBe(400);
    expect(probeLog.outbound).toHaveLength(before);
  });
});
