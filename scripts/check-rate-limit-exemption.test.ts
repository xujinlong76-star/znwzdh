import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

/**
 * `check-rate-limit-exemption.mjs` 的用例。
 *
 * 这套豁免（中枢 allowList + web 侧 SSR 取数带共享凭据）此前只有单测，
 * 单测证明的是「函数认这个头」，不是「收录页因此不再是降级壳」。
 * 这里用一对假中枢/假前端把四条前提各自钉住，并且**逐条造反例**：
 * 每条断言都必须能被「把它关掉」变红，否则检查本身是空转的。
 */

const SCRIPT = resolve("scripts/check-rate-limit-exemption.mjs");
const TOKEN = "0123456789abcdef0123456789abcdef";

type ApiOpts = {
  /** 公开请求（不带凭据）第几次开始吃 429 */
  publicLimit?: number;
  /** true = 带凭据也照样被挡（模拟豁免丢失：allowList 被摘 / 两侧凭据不一致） */
  ignoreToken?: boolean;
  /** true = 谁都不挡（模拟豁免放宽到 IP 段，或凭据被判给了公开请求） */
  exemptEveryone?: boolean;
};

type WebOpts = {
  /** /site/* 总数 */
  sites?: number;
  /** true = 详情页渲染成降级壳（200 + 自己声明 noindex） */
  shells?: boolean;
  /** true = 全部命中缓存（x-nextjs-cache: HIT），没有一次真重渲染 */
  cacheHitAll?: boolean;
  /** true = 浏览器侧 /api/hub 代理自己附带内部凭据（边界违规） */
  proxyLeak?: boolean;
};

function serveFakeApi(opts: ApiOpts): Promise<{ base: string; close: () => Promise<void> }> {
  return new Promise((resolvePromise) => {
    let publicSeen = 0;
    const server = createServer((req, res) => {
      const headers = req.headers;
      const token = Array.isArray(headers["x-navhub-internal-token"])
        ? headers["x-navhub-internal-token"][0]
        : headers["x-navhub-internal-token"];
      const exempt = Boolean(token) && token.trim() === TOKEN && !opts.ignoreToken;
      publicSeen += 1;
      const limited = !opts.exemptEveryone && !exempt && publicSeen > (opts.publicLimit ?? 5);
      if (limited) {
        res.writeHead(429, { "content-type": "application/json" });
        res.end('{"error":"rate limited"}');
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"items":[],"total":57}');
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolvePromise({
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

function serveFakeWeb(apiBase: string, opts: WebOpts): Promise<{ base: string; close: () => Promise<void> }> {
  return new Promise((resolvePromise) => {
    const total = opts.sites ?? 12;
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/sitemap.xml") {
        const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        res.writeHead(200, { "content-type": "application/xml" });
        res.end(
          `<?xml version="1.0"?><urlset>${Array.from({ length: total }, (_, i) => `<url><loc>${origin}/site/${i + 1}</loc></url>`).join("")}</urlset>`,
        );
        return;
      }
      const detail = /^\/site\/(\d+)$/.exec(url.pathname);
      if (detail) {
        // 「壳」在中枢侧只是 429，在爬虫侧才是可观察的形状 —— 这里直接给形状
        res.writeHead(200, {
          "content-type": "text/html",
          "cache-control": "s-maxage=60, stale-while-revalidate=31535940",
          "x-nextjs-cache": opts.cacheHitAll || Number(detail[1]) <= 2 ? "HIT" : "MISS",
        });
        res.end(
          opts.shells
            ? `<html lang="zh-CN"><head><title>站点详情</title><meta name="robots" content="noindex, follow"/></head><body>稍后再试</body></html>`
            : `<html lang="zh-CN"><head><title>某站点 - NavHub</title></head><body><h1>某站点</h1></body></html>`,
        );
        return;
      }
      if (url.pathname.startsWith("/api/hub/")) {
        // 代理：默认**不**带内部凭据（浏览器流量必须继续按 IP 受限）
        const r = await fetch(`${apiBase}${url.pathname.replace("/api/hub", "/api")}`, {
          headers: opts.proxyLeak ? { "x-navhub-internal-token": TOKEN } : {},
        });
        res.writeHead(r.status, { "content-type": "application/json" });
        res.end(await r.text());
        return;
      }
      res.writeHead(404).end();
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolvePromise({
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

async function run(api: ApiOpts, web: WebOpts, extra: string[] = [], env: Record<string, string> = {}) {
  const apiSrv = await serveFakeApi(api);
  const webSrv = await serveFakeWeb(apiSrv.base, web);
  try {
    const child = spawn(
      process.execPath,
      [
        SCRIPT,
        `--api-base=${apiSrv.base}`,
        `--web-base=${webSrv.base}`,
        "--public-hammer=8",
        "--pages=12",
        "--min-miss=5",
        ...extra,
      ],
      { env: { ...process.env, NAVHUB_INTERNAL_TOKEN: env.token === "" ? "" : TOKEN, ...env } },
    );
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c: string) => (out += c));
    child.stderr.on("data", (c: string) => (out += c));
    const code = await new Promise<number>((done) => {
      child.once("close", (exitCode) => done(exitCode ?? -1));
      child.once("error", () => done(-1));
    });
    return { code, out };
  } finally {
    await webSrv.close();
    await apiSrv.close();
  }
}

describe("check-rate-limit-exemption.mjs", () => {
  it("四条前提同时成立时绿灯（公开打穿 / 带凭据不被打穿 / 收录页可索引 / 代理仍受限）", async () => {
    const { code, out } = await run({ publicLimit: 5 }, {});
    expect(code, out).toBe(0);
    expect(out).toContain("限流豁免集成检查通过");
  });

  it("额度没被打穿 ⇒ 红灯并说明「后面的绿灯是空转」（不许静默通过）", async () => {
    const { code, out } = await run({ publicLimit: 1000 }, {});
    expect(code, out).toBe(1);
    expect(out).toContain("一次 429 都没有");
    // 边界阶段在额度打穿前不可判，必须显式跳过而不是报「代理泄漏」
    expect(out).toContain("阶段 4 跳过");
    expect(out).not.toContain("把全站访客标成内部流量");
  });

  it("带凭据仍被挡 ⇒ 红灯（豁免丢失：allowList 被摘或两侧凭据不一致）", async () => {
    const { code, out } = await run({ publicLimit: 5, ignoreToken: true }, {});
    expect(code, out).toBe(1);
    expect(out).toContain("豁免没生效");
  });

  it("详情页是降级壳 ⇒ 红灯，且归因写「先查上游」而不是让人翻渲染代码", async () => {
    const { code, out } = await run({ publicLimit: 5 }, { shells: true });
    expect(code, out).toBe(1);
    expect(out).toContain("降级壳");
    expect(out).toContain("先查中枢健康");
  });

  it("全是缓存 HIT ⇒ 证据不足红灯（没在受限中枢面前重渲染过，豁免有没有用不可知）", async () => {
    const { code, out } = await run({ publicLimit: 5 }, { cacheHitAll: true });
    expect(code, out).toBe(1);
    expect(out).toContain("证据不足");
  });

  it("浏览器侧 /api/hub 代理被标成内部流量 ⇒ 安全边界红灯", async () => {
    const { code, out } = await run({ publicLimit: 5 }, { proxyLeak: true });
    expect(code, out).toBe(1);
    expect(out).toContain("把全站访客标成内部流量");
  });

  it("限流整个没开（谁都不挡）⇒ 阶段 1 红灯，阶段 4 显式跳过而不是报「代理泄漏」", async () => {
    const { code, out } = await run({ publicLimit: 5, exemptEveryone: true }, {});
    expect(code, out).toBe(1);
    expect(out).toContain("阶段 1 不成立");
    expect(out).toContain("阶段 4 跳过");
  });

  it("没配凭据时以 2 退出（前置缺失不判绿也不伪装成形状红灯）", async () => {
    const { code, out } = await run({ publicLimit: 5 }, {}, [], { token: "" });
    expect(code, out).toBe(2);
    expect(out).toContain("未配置");
  });

  it("日志里不出现凭据本身（只出现长度）", async () => {
    const { code, out } = await run({ publicLimit: 5 }, {});
    expect(code, out).toBe(0);
    expect(out).not.toContain(TOKEN);
    expect(out).toContain(`凭据长度 ${TOKEN.length}`);
  });
});
