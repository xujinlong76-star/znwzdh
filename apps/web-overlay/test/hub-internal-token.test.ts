/**
 * 服务端取数的限流豁免头 —— 发与不发，以及**绝不该发**的地方。
 *
 * 背景（docs/seo/ISR-ROUTES.md 5.9 实测）：中枢全局按 IP 限流 300 req/min，
 * web 层 SSR/RSC 取数在部署上共用一个出口 IP，抓取式扫 1126 个收录页
 * ≈ 750 次/分钟 → 429 → `hubGetProbe` 判 `failed` → 详情页渲染成带 `noindex`
 * 的降级壳，而这份壳会被 ISR 缓存。豁免凭据是这条链的唯一出口。
 *
 * 这个文件同时钉住边界：浏览器侧的 `/api/hub/*` 代理**不许**附带这个头 ——
 * 附上了等于把全站访客流量都标成内部流量，按 IP 的限流形同虚设。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKEN = "0123456789abcdef0123456789abcdef";

type Seen = { url: string; headers: Record<string, string> };
let seen: Seen[] = [];
let reply: { status: number; ok: boolean; body: unknown } = { status: 200, ok: true, body: { id: "s1" } };

/** 模块在载入时读 env 并固化凭据，所以每个用例都要重置模块图再动态 import。 */
async function loadHub() {
  vi.resetModules();
  return import("@/lib/server/hub");
}

beforeEach(() => {
  seen = [];
  reply = { status: 200, ok: true, body: { id: "s1" } };
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    const raw = (init?.headers ?? {}) as Record<string, string>;
    seen.push({ url: String(input), headers: Object.fromEntries(Object.entries(raw)) });
    return {
      ok: reply.ok,
      status: reply.status,
      json: async () => reply.body,
    } as Response;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NAVHUB_INTERNAL_TOKEN;
});

describe("hubGet / hubGetProbe 附带豁免凭据", () => {
  it("配置了 NAVHUB_INTERNAL_TOKEN：两条取数都带头，accept 不变", async () => {
    process.env.NAVHUB_INTERNAL_TOKEN = TOKEN;
    const { hubGet, hubGetProbe } = await loadHub();
    await hubGet("/api/sites/s1", 60);
    await hubGetProbe("/api/sites/s1", 60);
    expect(seen).toHaveLength(2);
    for (const s of seen) {
      expect(s.headers["x-navhub-internal-token"], s.url).toBe(TOKEN);
      expect(s.headers.accept).toBe("application/json");
    }
  });

  it("未配置时一个字节都不多发（零回归口径）", async () => {
    delete process.env.NAVHUB_INTERNAL_TOKEN;
    const { hubGet, hubGetProbe } = await loadHub();
    await hubGet("/api/sites/s1", 60);
    await hubGetProbe("/api/sites/s1", 60);
    expect(seen).toHaveLength(2);
    for (const s of seen) {
      expect(s.headers["x-navhub-internal-token"], s.url).toBeUndefined();
      expect(Object.keys(s.headers)).toEqual(["accept"]);
    }
  });

  it("只配了空白也算未配置（不能把空串当凭据发出去）", async () => {
    process.env.NAVHUB_INTERNAL_TOKEN = "   \n ";
    const { hubGet } = await loadHub();
    await hubGet("/api/sites/s1", 60);
    expect(seen[0]!.headers["x-navhub-internal-token"]).toBeUndefined();
  });

  it("值两侧空白在发送前抹掉（中枢按 trim 后的值比较）", async () => {
    process.env.NAVHUB_INTERNAL_TOKEN = `  ${TOKEN}  `;
    const { hubGet } = await loadHub();
    await hubGet("/api/sites/s1", 60);
    expect(seen[0]!.headers["x-navhub-internal-token"]).toBe(TOKEN);
  });

  it("429 仍判 failed：豁免只是不吃额度，不改变失败三分法", async () => {
    process.env.NAVHUB_INTERNAL_TOKEN = TOKEN;
    reply = { status: 429, ok: false, body: null };
    const { hubGetProbe } = await loadHub();
    expect((await hubGetProbe("/api/sites/s1", 60)).status).toBe("failed");
    reply = { status: 404, ok: false, body: null };
    expect((await hubGetProbe("/api/sites/zzz", 60)).status).toBe("miss");
  });
});

describe("豁免头的边界", () => {
  it("浏览器侧 /api/hub/* 代理不得附带这个头", () => {
    const src = readFileSync(resolve(HERE, "..", "src/app/api/hub/[...path]/route.ts"), "utf8");
    expect(src.includes("x-navhub-internal-token")).toBe(false);
    expect(src.includes("NAVHUB_INTERNAL_TOKEN")).toBe(false);
  });

  it("豁免只加在服务端取数层，浏览器侧客户端模块也不许带", () => {
    const src = readFileSync(resolve(HERE, "..", "src/lib/navhub-api.ts"), "utf8");
    expect(src.includes("x-navhub-internal-token")).toBe(false);
  });
});
