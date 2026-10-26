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
  /**
   * 额度窗口毫秒（对齐真实中枢：`@fastify/rate-limit` 是 300/分钟、allowList 不计入）。
   * 省略 = 窗口无穷大（单调计数器），只够判「有没有被挡」；
   * 阶段 3b 必须给它有限值，否则「等过 revalidate 的这段时间额度自己恢复了」这件事
   * 在夹具里不存在，复探前打满额度的那一次锤击就没东西可承重。
   */
  windowMs?: number;
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
  /**
   * true = 详情页走一个真的 ISR 状态机：每页记「上次产出时间」，超过
   * `isrRevalidateMs` 就返回 STALE 并**在后台**再生一次（后台再生会真的去取假中枢）。
   * 这是唯一能在不重启前端的前提下区分「豁免接进了 SSR 取数」和「过期后一直保旧快照」的形状。
   */
  isr?: boolean;
  /** isr 模式的 revalidate 毫秒（默认 900：要大于 settle、小于 grace+settle，状态机才分得出两趟） */
  isrRevalidateMs?: number;
  /** false = SSR 取数不带凭据（模拟豁免没接进 web 的服务端取数层） */
  isrSsrCarriesToken?: boolean;
};

function serveFakeApi(opts: ApiOpts): Promise<{ base: string; close: () => Promise<void> }> {
  return new Promise((resolvePromise) => {
    const windowMs = opts.windowMs ?? Number.POSITIVE_INFINITY;
    let publicSeen = 0;
    let windowStart = Date.now();
    const server = createServer((req, res) => {
      const headers = req.headers;
      const token = Array.isArray(headers["x-navhub-internal-token"])
        ? headers["x-navhub-internal-token"][0]
        : headers["x-navhub-internal-token"];
      const exempt = Boolean(token) && token.trim() === TOKEN && !opts.ignoreToken;
      if (!exempt) {
        // allowList 命中时 @fastify/rate-limit 根本不计数，这里也对齐
        if (Date.now() - windowStart >= windowMs) {
          windowStart = Date.now();
          publicSeen = 0;
        }
        publicSeen += 1;
      }
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
    // ---- isr 状态机（阶段 3b 的对照面）----
    const rvMs = opts.isrRevalidateMs ?? 900;
    const bornAt = Date.now();
    const states = new Map<string, { producedAt: number; shell: boolean }>();
    const inFlight = new Set<string>();
    for (let i = 1; i <= total; i += 1) states.set(String(i), { producedAt: bornAt, shell: false });
    const backgroundRegen = (key: string) => {
      // 成功才把「上次产出时间」推进；失败时旧条目原样留着 —— 这就是 Next 的保旧行为，
      // 也正是要靠复探第二趟才看得见的区别。
      fetch(`${apiBase}/api/sites?page=1&pageSize=1`, {
        headers: opts.isrSsrCarriesToken === false ? {} : { "x-navhub-internal-token": TOKEN },
      })
        .then((r) => {
          if (r.ok) states.set(key, { producedAt: Date.now(), shell: opts.shells === true });
        })
        .catch(() => undefined);
    };
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
        if (opts.isr) {
          const st = states.get(detail[1])!;
          const expired = Date.now() - st.producedAt > rvMs;
          if (expired && !inFlight.has(detail[1])) {
            inFlight.add(detail[1]);
            backgroundRegen(detail[1]);
            // 后台再生是异步的：这一趟必须先给旧快照（STALE），成败留给第二趟读
            setTimeout(() => inFlight.delete(detail[1]), 0);
          }
          res.writeHead(200, {
            "content-type": "text/html",
            "cache-control": "s-maxage=60, stale-while-revalidate=31535940",
            "x-nextjs-cache": expired ? "STALE" : "HIT",
          });
          res.end(
            st.shell
              ? `<html lang="zh-CN"><head><title>站点详情</title><meta name="robots" content="noindex, follow"/></head><body>稍后再试</body></html>`
              : `<html lang="zh-CN"><head><title>某站点 - NavHub</title></head><body><h1>某站点</h1></body></html>`,
          );
          return;
        }
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
        // 默认关掉 3b 的等待（用例不睡 75 秒）；要测 3b 的用例自己在 extra 里给
        // --revalidate-grace/--revalidate-settle —— argvParse 取第一个匹配项，所以必须排在后面。
        "--revalidate-grace=0",
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

  it("全是缓存 HIT 且关掉了复探 ⇒ 证据不足红灯（不许拿旧快照冒充验证过）", async () => {
    const { code, out } = await run({ publicLimit: 5 }, { cacheHitAll: true });
    expect(code, out).toBe(1);
    expect(out).toContain("证据不足");
    expect(out).toContain("关掉了复探");
    expect(out).toContain("不谎报为通过");
    // 归因只准指向「还活着」的来源：磁盘两层缓存早已在 CI 步骤里落地并被钉子测试锁住
    expect(out).toContain("next-server 进程内缓存");
    expect(out).not.toContain("CI 侧需要先清 server/route-cache");
    // grace=0 必须真的跳过复探：跑了复探就不是「这一条不可判」，而是另一套取证
    expect(out).not.toContain("阶段 3b");
  });

  it("复探能逼出真再生 ⇒ 3b 自证通过，豁免确实作用在 SSR 取数路径上", async () => {
    // 假前端是个真的 ISR 状态机：首趟全 HIT（快照没到期）→ 等过 revalidate →
    // 检查先把公开额度打满再复探 → 每页给 STALE 并后台向**已耗尽额度**的中枢取数。
    // 带凭据 ⇒ 取数成功 ⇒ 第二趟回到 HIT ⇒ 这才叫「在受限中枢面前重新生成过」。
    const { code, out } = await run(
      { publicLimit: 5, windowMs: 1200 },
      { isr: true },
      ["--revalidate-grace=1.5", "--revalidate-settle=0.4"],
    );
    expect(code, out).toBe(0);
    expect(out).toContain("阶段 3b 复探");
    expect(out).toContain("同步/后台成功=12");
    expect(out).toContain("限流豁免集成检查通过");
    // 三条红灯分支各自的签名词不许出现在绿灯里：出现即说明计数或分支写反了
    expect(out).not.toContain("没能再生、继续给旧快照");
    expect(out).not.toContain("仍全 HIT");
  });

  it("过期后一直给旧快照（SSR 取数没带凭据）⇒ 红灯归因到取数层，不许混进另外两条分支", async () => {
    // windowMs 必须有界：假中枢的额度要能在等 revalidate 的那段时间里自己恢复，
    // 否则「复探前重新打满额度」这一步没有东西可承重（真实中枢是 300/分钟的窗口）。
    const { code, out } = await run(
      { publicLimit: 5, windowMs: 1200 },
      { isr: true, isrSsrCarriesToken: false },
      ["--revalidate-grace=1.5", "--revalidate-settle=0.4"],
    );
    expect(code, out).toBe(1);
    expect(out).toContain("没能再生、继续给旧快照");
    expect(out).toContain("lib/server/hub.ts");
    // 「仍全 HIT」是 revalidate 窗口没起作用那条的签名，「关掉了复探」是 grace=0 那条的签名；
    // 这里快照明明过期了，归因混进任一条都会把人引开真正的取数层。
    expect(out).not.toContain("仍全 HIT");
    expect(out).not.toContain("关掉了复探");
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
