/**
 * 限流豁免的边界（docs/seo/ISR-ROUTES.md 5.9 的修复侧）。
 *
 * 真实缺陷（2026-10-23 prod 口径实测）：中枢全局按 IP 限流 300 req/min，
 * 而 web 层所有 SSR/RSC 取数在部署拓扑上共用一个出口 IP。一次抓取式扫 1126 个
 * 收录页 ≈ 每分钟 750+ 次取数（额度的 2.5 倍）→ 429 → `hubGetProbe` 判 `failed`
 * → 详情页渲染成带 `noindex, follow` 的降级壳，而这份壳会被 ISR 缓存。
 * 复现数字：60 个刚被判壳的 id 以 8 路并发重放 480 请求 = **185 个 429、0 超时**。
 *
 * 这里锁四件事：
 *   1. 判据本身（等长错凭据必须走定长比较、未配置恒为 false）；
 *   2. `allowList` 真的注册进了全局 limiter —— 前 3 个请求 200、第 4 个 429，
 *      带正确凭据头的第 4~N 个仍然 200（只测纯函数测不到装配）；
 *   3. 带错凭据不改变结果（红的是「有头就豁免」这种实现）；
 *   4. 未配置 `NAVHUB_INTERNAL_TOKEN` 时**任何**头都换不到豁免（零回归口径）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { INTERNAL_TOKEN_HEADER, isInternalTraffic } from "../src/internal-traffic.ts";

const TOKEN = "0123456789abcdef0123456789abcdef"; // 32 字符，测试里不参与生产强度校验

describe("isInternalTraffic 判据", () => {
  it("未配置凭据时恒不豁免（哪怕请求带了头）", () => {
    expect(isInternalTraffic(TOKEN, null)).toBe(false);
    expect(isInternalTraffic(TOKEN, undefined)).toBe(false);
    expect(isInternalTraffic(TOKEN, "")).toBe(false);
    expect(isInternalTraffic(TOKEN, "   ")).toBe(false);
  });

  it("凭据逐字相等才豁免", () => {
    expect(isInternalTraffic(TOKEN, TOKEN)).toBe(true);
    // 数组形态（重复头）取第一个，不因为类型意外放行
    expect(isInternalTraffic([TOKEN, "x"], TOKEN)).toBe(true);
  });

  it("长度相同但内容不同、长度不同、空头都必须为 false", () => {
    const sameLenWrong = "fffffffffffffffffffffffffffffff0";
    expect(sameLenWrong.length).toBe(TOKEN.length);
    expect(isInternalTraffic(sameLenWrong, TOKEN)).toBe(false);
    expect(isInternalTraffic(TOKEN.slice(0, 20), TOKEN)).toBe(false);
    expect(isInternalTraffic(TOKEN + "ff", TOKEN)).toBe(false);
    expect(isInternalTraffic("", TOKEN)).toBe(false);
    expect(isInternalTraffic(undefined, TOKEN)).toBe(false);
  });

  it("配置侧带空白时按 trim 后的值比较（web 侧也是 trim 后发出）", () => {
    expect(isInternalTraffic(TOKEN, `  ${TOKEN}\n`)).toBe(true);
  });
});

describe("全局限流的豁免装配", () => {
  let dir: string;
  let ctx: AppContext;
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "navhub-rl-"));
    const config = loadConfig({
      mode: "lite",
      sqlitePath: join(dir, "api.db"),
      embedding: {
        model: "x",
        endpoint: "https://hf-mirror.com",
        dtype: "q8",
        cacheDir: join(dir, "models"),
        dim: 512,
        enabled: false,
      },
      llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "m", timeoutMs: 5000 },
      fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
      corsOrigins: ["*"],
      // 把桶缩到 3 次/分钟：默认（test 环境 10000 次）在单测里不可能跑满，
      // 那样这条装配就只能靠「代码看起来对」来保证。
      rateLimitMax: 3,
      internalToken: TOKEN,
    });
    ctx = await createContext(config);
    app = await buildServer(ctx);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const hit = async (headers?: Record<string, string>) =>
    (await app.inject({ method: "GET", url: "/api/health", headers })).statusCode;

  it("普通流量把桶打满后 429，带正确凭据头的请求不受影响", async () => {
    expect(await hit()).toBe(200);
    expect(await hit()).toBe(200);
    expect(await hit()).toBe(200);
    // 第 4 个普通请求必须被限（证明桶真的只有 3）
    expect(await hit()).toBe(429);
    // 内部流量走的是豁免，不是「桶里还剩额度」
    for (let i = 0; i < 12; i += 1) {
      expect(await hit({ [INTERNAL_TOKEN_HEADER]: TOKEN }), `第 ${i + 1} 次内部请求被限流了`).toBe(200);
    }
    // 普通流量仍在限（豁免没有把桶清空或重置）
    expect(await hit()).toBe(429);
  });

  it("凭据长度相同但内容不同 = 不豁免（防止只比长度或只比前缀的实现）", async () => {
    expect(await hit({ [INTERNAL_TOKEN_HEADER]: "fffffffffffffffffffffffffffffff0" })).toBe(429);
  });

  it("凭据更短或更长也不豁免", async () => {
    expect(await hit({ [INTERNAL_TOKEN_HEADER]: TOKEN.slice(0, 24) })).toBe(429);
    expect(await hit({ [INTERNAL_TOKEN_HEADER]: TOKEN + "0" })).toBe(429);
  });

  /**
   * 限流响应头是客户端唯一的「自己减速」依据：没有它，客户端只能等 429 再退避。
   * @fastify/rate-limit 默认开启，这里锁住装配别把它关掉（或换插件时漏配）。
   */
  it("429 响应带限流头与 Retry-After", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(429);
    expect(res.headers["x-ratelimit-limit"]).toBe("3");
    expect(res.headers["x-ratelimit-remaining"]).toBe("0");
    expect(Number(res.headers["x-ratelimit-reset"])).toBeGreaterThan(0);
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
  });
});

describe("未配置豁免凭据的部署（零回归口径）", () => {
  let dir: string;
  let ctx: AppContext;
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "navhub-rl-off-"));
    const config = loadConfig({
      mode: "lite",
      sqlitePath: join(dir, "api.db"),
      embedding: { model: "x", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
      llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "m", timeoutMs: 5000 },
      fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
      corsOrigins: ["*"],
      rateLimitMax: 2,
      internalToken: null,
    });
    ctx = await createContext(config);
    app = await buildServer(ctx);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("中枢没配置时，带任何凭据头的请求都照样吃限流", async () => {
    expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
    for (const value of [TOKEN, "x", ""]) {
      const res = await app.inject({ method: "GET", url: "/api/health", headers: { [INTERNAL_TOKEN_HEADER]: value } });
      expect(res.statusCode, `未配置时 "${value}" 竟然换到了豁免`).toBe(429);
    }
  });
});
