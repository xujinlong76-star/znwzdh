import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
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
    // 归因必须指向本轮取证确认「还活着」的来源。磁盘侧两层缓存的清理早已在 CI 步骤里
    // 落地并被上面的钉子测试锁住，再把排查指向它只会让人重复做已经做过的事 ——
    // 那正是 run79 里这条红灯被误读成「豁免失效」的原因。
    expect(out).toContain("检查没跑成");
    expect(out).toContain("next-server 进程自己的内存路由缓存");
    expect(out).toContain("pgrep");
    expect(out).not.toContain("CI 侧需要先清 server/route-cache");
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

/**
 * CI 接线本身也要钉住。
 *
 * 动机是真实发生过的：一次并行会话把工作区刷回了一份比 #41/#42 更早的基线，
 * `.github/workflows/ci.yml` 里整个「限流豁免」步骤消失了，而 CI 照样全绿 ——
 * 步骤没了就没有红灯可归因，等于覆盖被静默删除。脚本有 9 条用例，
 * 但「这一步有没有被接进作业」没有任何东西在看着。
 *
 * 这里只钉四件事，都是踩过的坑（不是代码风格）：
 *  1) 作业里真的有一跑四阶段检查的步骤（且不是被注释掉）；
 *  2) `NAVHUB_INTERNAL_TOKEN` 在 `next start` **之前**就写进环境 —— 它是模块顶层常量；
 *  3) 不再用 `pgrep -f "next/dist/bin/next start"` 杀 web —— Next 改写了 process.title，
 *     argv 区被覆盖，这个 pattern 一个都匹配不到（上一轮误判红灯的根因）；
 *  4) 步骤里两层缓存都要清：只清 route-cache 时 Data Cache 还热，SSR 不打中枢，
 *     阶段 3 就是假绿灯。
 */
describe("CI 接线（源码级钉子）", () => {
  const ci = readFileSync(resolve(".github/workflows/ci.yml"), "utf8");
  const stepName = "- name: 限流豁免集成检查";
  const stepStart = ci.indexOf(stepName);
  const nextStepStart = ci.indexOf("- name: 失败时留下预览站日志", stepStart);

  it("作业里存在「限流豁免集成检查」步骤，并且真的调用四阶段脚本", () => {
    expect(stepStart, "ci.yml 里找不到限流豁免步骤（覆盖被删了？）").toBeGreaterThan(-1);
    const step = ci.slice(stepStart, nextStepStart > stepStart ? nextStepStart : undefined);
    expect(step).toContain("scripts/check-rate-limit-exemption.mjs");
  });

  it("凭据在 next start 之前写进环境（模块顶层常量只在进程启动时读一次）", () => {
    const tokenAt = ci.indexOf("NAVHUB_INTERNAL_TOKEN=");
    const webStartAt = ci.indexOf("node_modules/next/dist/bin/next start -p 3000");
    expect(tokenAt, "ci.yml 里找不到 NAVHUB_INTERNAL_TOKEN 的写入").toBeGreaterThan(-1);
    expect(webStartAt, "ci.yml 里找不到启动 Web 产物的命令").toBeGreaterThan(-1);
    expect(tokenAt, "凭据写晚了：web 启动后才写，进程不会带这个头").toBeLessThan(webStartAt);
  });

  it("不再用匹配不到 next-server 的 pgrep 杀 web", () => {
    // 只查可执行行：注释里为了记教训会原样提到这个 pattern，那不是会被执行的代码
    const codeLines = ci.split("\n").filter((line) => !line.trimStart().startsWith("#"));
    expect(codeLines.some((line) => line.includes('pgrep -f "next/dist/bin/next start"'))).toBe(false);
  });

  it("豁免步骤自己不重启 web，且两层缓存都清", () => {
    const step = ci.slice(stepStart, nextStepStart > stepStart ? nextStepStart : undefined);
    expect(step).not.toContain("next/dist/bin/next start -p 3000");
    expect(step).toContain("apps/web/.next/server/route-cache");
    expect(step).toContain("apps/web/.next/cache/fetch-cache");
  });
});
