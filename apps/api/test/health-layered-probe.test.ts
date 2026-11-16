/**
 * U-13 分层探活回归：批量巡检不再把 WAF 拦截判死链。
 *
 * 真实缺陷：health_check 只用单层 NavHubBot UA 抓取，403/429/503 与真死链同码记
 * ok=false；连续 3 次即标 broken。2026-10-18 实测 50 站里 15 站被误标 broken
 * （kubernetes.io / figma.com / npmjs.com 均可正常访问）。
 *
 * 这里锁三段行为（本地 127.0.0.1 服务器实测，不 mock 抓取层）：
 *   1. needsDesktopRetry：只有 blocked / server-error 才发第二层；
 *   2. 第二层桌面 UA 救回：第一层 403、第二层 200 → 判健康；
 *   3. 两层都被拦截：写 BOT_BLOCKED verdict、永不标 broken，且该行打断连续失败链
 *      （3 轮后仍 active）；而真死链（404）3 轮后照旧标 broken。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import {
  BOT_BLOCKED_ERROR_PREFIX,
  handleHealthCheck,
  isBotBlockedHealthRecord,
  needsDesktopRetry,
  shouldBreak,
} from "../src/jobs/tasks/health-check.task.ts";
import type { JobRunHandle, PatrolSelection } from "../src/jobs.ts";

let dir: string;
let ctx: AppContext;
let server: Server;
let port: number;

const REAL_PAGE =
  "<html><head><title>Test Site</title></head><body><p>Hello world, this is a real site with plenty of content.</p></body></html>";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-layered-probe-"));
  // allowPrivateNetworks: true —— 本地 127.0.0.1 测试服务器才能被 guardedFetch 抓到。
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: true, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);

  server = createServer((req, res) => {
    const ua = req.headers["user-agent"] ?? "";
    const isBot = ua.includes("NavHub");
    if (req.url === "/waf-rescue") {
      // 只拦机器人 UA：桌面 UA 放行（模拟 Cloudflare 按 UA 的拦截）。
      if (isBot) {
        res.writeHead(403, { "content-type": "text/html" });
        res.end("<html><body>Sorry, you have been blocked</body></html>");
      } else {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(REAL_PAGE);
      }
      return;
    }
    if (req.url === "/waf-stubborn") {
      // 谁来都拦：桌面 UA 也 403（模拟严格 WAF）。
      res.writeHead(403, { "content-type": "text/html" });
      res.end("<html><body>Sorry, you have been blocked</body></html>");
      return;
    }
    if (req.url === "/gone") {
      res.writeHead(404, { "content-type": "text/html" });
      res.end("<html><body>Not found</body></html>");
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

function fakeRun(): JobRunHandle {
  return {
    jobId: "test-health-check",
    kind: "health_check",
    signal: new AbortController().signal,
    deadlineAt: 0,
    shouldStop: () => false,
  };
}

describe("needsDesktopRetry", () => {
  it("blocked 与 server-error 才重试", () => {
    // WAF/风控拦截码
    for (const s of [401, 403, 405, 412, 418, 429]) expect(needsDesktopRetry(s)).toBe(true);
    // 5xx（含 Cloudflare 常用的 503 挑战页）
    for (const s of [500, 502, 503, 504]) expect(needsDesktopRetry(s)).toBe(true);
  });

  it("死链与其它 4xx 不重试", () => {
    for (const s of [404, 410, 451, 400, 408, 422]) expect(needsDesktopRetry(s)).toBe(false);
    expect(needsDesktopRetry(200)).toBe(false);
    expect(needsDesktopRetry(301)).toBe(false);
  });
});

describe("isBotBlockedHealthRecord", () => {
  it("只认 BOT_BLOCKED: 前缀", () => {
    expect(isBotBlockedHealthRecord(`${BOT_BLOCKED_ERROR_PREFIX} 第 1 层 HTTP 403`)).toBe(true);
    expect(isBotBlockedHealthRecord("boom")).toBe(false);
    expect(isBotBlockedHealthRecord(null)).toBe(false);
    expect(isBotBlockedHealthRecord(undefined)).toBe(false);
  });
});

describe("shouldBreak 连续失败链", () => {
  it("最新的 bot-blocked 行打断链：之前再多失败也不判 broken", async () => {
    const cat = await ctx.repo.createCategory({ id: "cat-chain", title: "链测试分类", sort: 1, source: "api" } as never);
    const site = await ctx.repo.createSite({ url: "https://example.com/chain", title: "链测试", categoryId: cat.id } as never);
    const record = async (ok: boolean, error: string | null) =>
      ctx.repo.updateSiteHealth(site.id, {
        httpStatus: ok ? 200 : 403,
        ok,
        latencyMs: 10,
        redirectTo: null,
        error,
        markBroken: false,
      });
    await record(false, "boom");
    await new Promise((r) => setTimeout(r, 5));
    await record(false, "boom");
    await new Promise((r) => setTimeout(r, 5));
    await record(false, `${BOT_BLOCKED_ERROR_PREFIX} 第 1 层 HTTP 403，第 2 层桌面 UA 仍 HTTP 403`);
    expect(await shouldBreak(ctx, site.id)).toBe(false);
  });

  it("连续两次普通失败即到阈值（阈值 3，读最近 2 条）", async () => {
    const site = await ctx.repo.createSite({ url: "https://example.com/chain2", title: "链测试2", categoryId: "cat-chain" } as never);
    const record = async () =>
      ctx.repo.updateSiteHealth(site.id, {
        httpStatus: 500,
        ok: false,
        latencyMs: 10,
        redirectTo: null,
        error: "boom",
        markBroken: false,
      });
    await record();
    await new Promise((r) => setTimeout(r, 5));
    await record();
    expect(await shouldBreak(ctx, site.id)).toBe(true);
  });
});

describe("handleHealthCheck 分层探活（本地服务器实测）", () => {
  it("第一层 403、第二层 200 → 判健康；两层 403 → BOT_BLOCKED 且 3 轮不标 broken；404 三轮照旧标 broken", async () => {
    const cat = await ctx.repo.createCategory({ id: "cat-layered", title: "分层分类", sort: 1, source: "api" } as never);
    const rescued = await ctx.repo.createSite({ url: `http://127.0.0.1:${port}/waf-rescue`, title: "可救回", categoryId: cat.id } as never);
    const stubborn = await ctx.repo.createSite({ url: `http://127.0.0.1:${port}/waf-stubborn`, title: "顽固拦截", categoryId: cat.id } as never);
    const gone = await ctx.repo.createSite({ url: `http://127.0.0.1:${port}/gone`, title: "真死链", categoryId: cat.id } as never);

    const runAll = async () => {
      const targets = (await ctx.repo.listSites()).filter((s) =>
        [rescued.id, stubborn.id, gone.id].includes(s.id),
      );
      const selection: PatrolSelection = {
        targets: targets as unknown as PatrolSelection["targets"],
        quota: { backfill: 0, refresh: 3 },
        picked: { backfill: 0, refresh: 3 },
        depth: { unchecked: 0, checked: 3 },
      };
      await handleHealthCheck(ctx, {}, fakeRun(), async () => selection);
    };

    await runAll();
    const rescuedAfter = await ctx.repo.getSite(rescued.id);
    expect(rescuedAfter!.health!.ok).toBe(true);
    expect(rescuedAfter!.status).toBe("active");

    const stubbornAfter = await ctx.repo.getSite(stubborn.id);
    expect(stubbornAfter!.health!.ok).toBe(false);
    expect(stubbornAfter!.health!.httpStatus).toBe(403);
    expect(stubbornAfter!.health!.error).toMatch(/^BOT_BLOCKED:/);
    expect(stubbornAfter!.health!.error).toContain("第 1 层 HTTP 403");
    expect(stubbornAfter!.health!.error).toContain("第 2 层桌面 UA 仍 HTTP 403");
    expect(stubbornAfter!.status).toBe("active");

    const goneAfter = await ctx.repo.getSite(gone.id);
    expect(goneAfter!.health!.ok).toBe(false);
    expect(goneAfter!.health!.httpStatus).toBe(404);
    expect(goneAfter!.status).toBe("active"); // 第 1 次失败不判死

    // 再跑两轮：顽固拦截站 3 轮仍 active（BOT_BLOCKED 行打断链），真死链 3 轮标 broken。
    await runAll();
    await runAll();
    expect((await ctx.repo.getSite(stubborn.id))!.status).toBe("active");
    const stubbornRows = await ctx.repo.recentHealthChecks(stubborn.id, 3);
    expect(stubbornRows).toHaveLength(3);
    expect(stubbornRows.every((r) => isBotBlockedHealthRecord(r.error))).toBe(true);
    expect((await ctx.repo.getSite(gone.id))!.status).toBe("broken");
  });
});
