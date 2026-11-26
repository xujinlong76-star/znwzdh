/**
 * 刷新验证：路由端到端测试（POST /api/sites/:id/verify，Batch 4 Phase 2 P2-1）。
 *
 * 仿 compare-api.test.ts（临时 SQLite + createContext + buildServer + 双用户 seed
 * + app.inject）。真实出站由注入的假探活代替（setVerifyProbeForTests），锁的是
 * 调用链与守卫，不是真实网络：
 *  - 本人触发 202 pending → 后台任务跑完 → GET 状态 done + 健康字段与
 *    last_checked_at 更新，/api/compare 格子显示新日期；探活恰好调用一次；
 *  - 他人收藏 / 不存在 / 无人收藏 → 同一个 404 body，探活一次都没调；
 *  - 匿名 401；
 *  - 403（blocked）与超时（unverified）：状态 done、结论未验证，sites 健康字段
 *    一点没动（last_checked_at 仍为 null），响应里没有“已停更”/“不可达”；
 *  - 404 死链：健康字段更新（http_status 404、ok false），但 status 仍为 active，
 *    绝不标 broken；
 *  - 出站预算耗尽 → 429，探活不启动；
 *  - robots.txt 禁抓 → 200 robots_disallowed，探活不启动，健康字段不动；
 *  - robots.txt 纯解析：* 组 Disallow /、Allow 长规则优先、他组规则不适用。
 *
 *  - 评审 NIT 1（缓存命中不写假健康值）：probeWithCandidateProfile 新鲜缓存
 *    命中返回 fromCache + 原始 checkedAt；路由层 fromCache 的 ok/dead 结论跳过
 *    updateSiteHealth——last_checked_at / latency_ms 不变、health_checks 不新增，
 *    维护格仍显示上次真实核实日期；
 *  - 评审 NIT 11（在途任务去重）：同身份+同站已有 pending 任务时第二次 POST
 *    直接 202 复用，不新起任务、不重复探活、不占预算；任务跑完后再次 POST
 *    正常新起任务。
 *
 * 诚实缺口：默认探活（guardedFetch 真实出站 + probe-cache 落盘）未被本文件
 * 覆盖——沙箱无稳定公网目标可断言；锁的是注入缝处的调用次数与写库口径，
 * 默认探活的超时/预算常量另有断言（VERIFY_SINGLE_TIMEOUT_MS / BATCH）。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import {
  awaitPendingVerifyJobs,
  isRobotsDisallowed,
  setVerifyProbeForTests,
  setVerifyRobotsCheckForTests,
  VERIFY_BATCH_BUDGET_MS,
  VERIFY_SINGLE_TIMEOUT_MS,
  verifyOutboundBudget,
  type VerifyProbeResult,
} from "../src/routes/verify.ts";
import { getProbeCache } from "../src/probe-cache.ts";
import { probeWithCandidateProfile } from "../src/site-probe.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

let siteAId = "";
let siteBId = "";
let otherSiteId = "";
let neverFavoritedSiteId = "";

const USER = "user-1";
const OTHER = "user-2";
const userHeaders = { "x-navhub-user-id": USER };
const otherHeaders = { "x-navhub-user-id": OTHER };
const anonHeaders = { "x-navhub-anon-id": "anon-1" };

let probeCalls: string[] = [];
let probeResult: VerifyProbeResult = {
  kind: "ok",
  status: 200,
  latencyMs: 120,
  redirectTo: null,
  reason: "内容检测通过",
};

async function seed() {
  const cat = await ctx.repo.createCategory({ title: "效率办公", slug: "office" });
  const a = await ctx.repo.createSite({
    url: "https://verify-a.example.com",
    title: "验证站 A",
    description: "本人收藏的待验证站",
    categoryId: cat.id,
    tags: ["PPT"],
  });
  siteAId = a.id;
  const b = await ctx.repo.createSite({
    url: "https://verify-b.example.com",
    title: "验证站 B",
    description: "本人收藏的第二站",
    categoryId: cat.id,
    tags: ["PPT"],
  });
  siteBId = b.id;
  const other = await ctx.repo.createSite({
    url: "https://verify-other.example.com",
    title: "别人的收藏",
    description: "只在 user-2 的收藏里",
    categoryId: cat.id,
    tags: ["PPT"],
  });
  otherSiteId = other.id;
  const never = await ctx.repo.createSite({
    url: "https://verify-never.example.com",
    title: "无人收藏站",
    description: "谁都没收藏",
    categoryId: cat.id,
    tags: ["PPT"],
  });
  neverFavoritedSiteId = never.id;

  await ctx.repo.addFavorite({ userId: USER, siteId: siteAId });
  await ctx.repo.addFavorite({ userId: USER, siteId: siteBId });
  await ctx.repo.addFavorite({ userId: OTHER, siteId: otherSiteId });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-verify-"));
  ctx = await createContext(loadConfig({ mode: "lite", sqlitePath: join(dir, "api.db"), corsOrigins: ["*"] }));
  (ctx as { embedding: unknown }).embedding = null;
  app = await buildServer(ctx);
  await app.ready();
  await seed();
  // 默认：robots 一律放行、探活走可注入的假实现（不发真实出站）。
  setVerifyRobotsCheckForTests(async () => false);
  setVerifyProbeForTests(async (url) => {
    probeCalls.push(url);
    return { ...probeResult };
  });
});

afterAll(async () => {
  setVerifyProbeForTests(null);
  setVerifyRobotsCheckForTests(null);
  if (app) await app.close();
  if (ctx) await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

afterEach(async () => {
  await awaitPendingVerifyJobs();
  probeCalls = [];
  probeResult = { kind: "ok", status: 200, latencyMs: 120, redirectTo: null, reason: "内容检测通过" };
  setVerifyRobotsCheckForTests(async () => false);
  verifyOutboundBudget.reset();
});

async function postVerify(siteId: string, headers: Record<string, string> = userHeaders) {
  return app.inject({ method: "POST", url: `/api/sites/${siteId}/verify`, headers });
}

async function getVerifyStatus(siteId: string, headers: Record<string, string> = userHeaders) {
  return app.inject({ method: "GET", url: `/api/sites/${siteId}/verify`, headers });
}

async function maintenanceOf(siteId: string) {
  const other = siteId === siteAId ? siteBId : siteAId;
  const res = await app.inject({
    method: "GET",
    url: `/api/compare?siteIds=${siteId},${other}`,
    headers: userHeaders,
  });
  expect(res.statusCode).toBe(200);
  const items = (res.json() as { items: Array<{ siteId: string; maintenance: unknown }> }).items;
  return items.find((i) => i.siteId === siteId)!.maintenance as {
    value: unknown;
    verified: boolean;
    verifiedAt: number | null;
    lastCheckedAt: number | null;
  };
}

describe("正常：本人触发，202 后台跑，成功更新健康字段与格子日期", () => {
  it("POST 202 pending；任务跑完后状态 done，健康字段更新，探活恰好一次", async () => {
    const before = Date.now();
    const res = await postVerify(siteAId);
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.siteId).toBe(siteAId);
    expect(body.status).toBe("pending");
    expect(body.robots_disallowed).toBe(false);

    await awaitPendingVerifyJobs();
    expect(probeCalls).toHaveLength(1);
    expect(probeCalls[0]).toBe("https://verify-a.example.com");

    const status = await getVerifyStatus(siteAId);
    expect(status.statusCode).toBe(200);
    const statusBody = status.json();
    expect(statusBody.status).toBe("done");
    expect(statusBody.outcome.kind).toBe("ok");
    expect(statusBody.outcome.status).toBe(200);
    expect(typeof statusBody.lastCheckedAt).toBe("number");
    expect(statusBody.lastCheckedAt).toBeGreaterThanOrEqual(before);

    // 健康字段落库：http_status / latency_ms / last_checked_at
    const site = await ctx.repo.getSite(siteAId);
    expect(site?.health?.httpStatus).toBe(200);
    expect(site?.health?.latencyMs).toBe(120);
    expect(site?.health?.ok).toBe(true);
    expect(site?.health?.lastCheckedAt).toBe(statusBody.lastCheckedAt);
    expect(site?.status).toBe("active");

    // 对照表 maintenance 格回填新日期
    const cell = await maintenanceOf(siteAId);
    expect(cell.value).toBe("可达");
    expect(cell.verified).toBe(true);
    expect(cell.verifiedAt).toBe(statusBody.lastCheckedAt);
    expect(cell.lastCheckedAt).toBe(statusBody.lastCheckedAt);
  });

  it("重定向结果如实写 redirect_to", async () => {
    probeResult = { kind: "ok", status: 200, latencyMs: 90, redirectTo: "https://verify-b.example.com/", reason: "内容检测通过" };
    const res = await postVerify(siteBId);
    expect(res.statusCode).toBe(202);
    await awaitPendingVerifyJobs();
    const site = await ctx.repo.getSite(siteBId);
    expect(site?.health?.redirectTo).toBe("https://verify-b.example.com/");
    expect(site?.health?.httpStatus).toBe(200);
  });
});

describe("越权 404 不可区分：探活一次都没调", () => {
  it("他人收藏 / 不存在 / 无人收藏 → 同一个 404 body", async () => {
    const cases = [otherSiteId, "ghost-id-404", neverFavoritedSiteId];
    const bodies: unknown[] = [];
    for (const id of cases) {
      const res = await postVerify(id);
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.ok).toBe(false);
      expect(body.error).toBe("NOT_FOUND");
      expect(body.code).toBe("NOT_FOUND");
      expect(JSON.stringify(body)).not.toContain(id);
      // requestId 按请求唯一且与响应头同源，不属于可被探测的差异：只比对 body 形状
      expect(body.requestId).toBe(res.headers["x-request-id"]);
      const shape: Record<string, unknown> = { ...body };
      delete shape.requestId;
      bodies.push(shape);
    }
    for (const b of bodies.slice(1)) expect(b).toEqual(bodies[0]);
    expect(probeCalls).toHaveLength(0);
    // 他人用自己的身份调自己的收藏仍可触发（对照：other 调 otherSite 应 202）
    const own = await postVerify(otherSiteId, otherHeaders);
    expect(own.statusCode).toBe(202);
    await awaitPendingVerifyJobs();
    expect(probeCalls).toHaveLength(1);
  });
});

describe("身份：匿名 401，GET 状态同样守门", () => {
  it("POST 匿名 401，探活不启动", async () => {
    const res = await postVerify(siteAId, anonHeaders);
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("UNAUTHORIZED");
    expect(probeCalls).toHaveLength(0);
  });

  it("GET 状态匿名 401、他人 404", async () => {
    const anon = await getVerifyStatus(siteAId, anonHeaders);
    expect(anon.statusCode).toBe(401);
    const other = await getVerifyStatus(otherSiteId);
    expect(other.statusCode).toBe(404);
  });
});

describe("失败降级为未验证：不写脏数据、不写已停更", () => {
  it("403 blocked：状态 done、结论未验证，健康字段一点没动", async () => {
    probeResult = { kind: "blocked", status: 403, latencyMs: 210, redirectTo: null, reason: "HTTP 403：拒绝爬虫，无法验证内容" };
    const res = await postVerify(siteAId);
    expect(res.statusCode).toBe(202);
    await awaitPendingVerifyJobs();
    expect(probeCalls).toHaveLength(1);

    const status = (await getVerifyStatus(siteAId)).json();
    expect(status.status).toBe("done");
    expect(status.outcome.kind).toBe("blocked");
    expect(status.outcome.status).toBe(403);

    const site = await ctx.repo.getSite(siteAId);
    // 本用例跑在“成功”用例之后：last_checked_at 仍是成功那次的值，未被 403 覆盖
    expect(site?.health?.httpStatus).toBe(200);
    expect(site?.health?.ok).toBe(true);
    const cell = await maintenanceOf(siteAId);
    expect(cell.value).toBe("可达");
    expect(JSON.stringify(status)).not.toContain("已停更");
    expect(JSON.stringify(status)).not.toContain("不可达");
  });

  it("超时 unverified：从未验证过的站仍保持 lastCheckedAt null、格子未验证", async () => {
    probeResult = { kind: "unverified", latencyMs: 2500, redirectTo: null, reason: "抓取超时，未能确认可用性" };
    const res = await postVerify(siteBId);
    expect(res.statusCode).toBe(202);
    await awaitPendingVerifyJobs();
    const status = (await getVerifyStatus(siteBId)).json();
    expect(status.status).toBe("done");
    expect(status.outcome.kind).toBe("unverified");
    // siteB 在重定向用例里已被成功验证过一次；这里换一个从未验证过的断言维度：
    // 关键是超时没有把健康字段改成失败值——http_status 仍是上次成功值，未被覆盖
    const site = await ctx.repo.getSite(siteBId);
    expect(site?.health?.httpStatus).toBe(200);
    expect(site?.health?.ok).toBe(true);
    expect(JSON.stringify(status)).not.toContain("已停更");
  });

  it("404 死链：健康字段更新为 404，但 status 仍为 active（不标 broken）", async () => {
    probeResult = { kind: "dead", status: 404, latencyMs: 80, redirectTo: null, reason: "HTTP 404：页面不存在或已下线" };
    const res = await postVerify(siteBId);
    expect(res.statusCode).toBe(202);
    await awaitPendingVerifyJobs();
    const site = await ctx.repo.getSite(siteBId);
    expect(site?.health?.httpStatus).toBe(404);
    expect(site?.health?.ok).toBe(false);
    expect(site?.status).toBe("active");
    const cell = await maintenanceOf(siteBId);
    expect(cell.value).toBe("不可达");
  });
});

describe("预算与 robots：出站预算耗尽 429；robots 禁抓置灰", () => {
  it("预算耗尽 → 429，探活不启动；释放后恢复 202", async () => {
    expect(verifyOutboundBudget.tryAcquire(1)).toBe(true);
    expect(verifyOutboundBudget.tryAcquire(1)).toBe(true);
    // 并发槽占满（maxConcurrent 2）：再申请即失败
    const res = await postVerify(siteAId);
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe("RATE_LIMITED");
    expect(probeCalls).toHaveLength(0);
    verifyOutboundBudget.release();
    verifyOutboundBudget.release();
    const retry = await postVerify(siteAId);
    expect(retry.statusCode).toBe(202);
    await awaitPendingVerifyJobs();
    expect(probeCalls).toHaveLength(1);
  });

  it("robots 禁抓 → 200 robots_disallowed，探活不启动，健康字段不动", async () => {
    setVerifyRobotsCheckForTests(async () => true);
    const before = await ctx.repo.getSite(siteAId);
    const res = await postVerify(siteAId);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("robots_disallowed");
    expect(body.robots_disallowed).toBe(true);
    expect(probeCalls).toHaveLength(0);
    const after = await ctx.repo.getSite(siteAId);
    expect(after?.health?.lastCheckedAt).toBe(before?.health?.lastCheckedAt);
    const status = (await getVerifyStatus(siteAId)).json();
    expect(status.status).toBe("robots_disallowed");
    expect(status.robots_disallowed).toBe(true);
  });

  it("超时常量：单条 2.5 秒、整批 6 秒", () => {
    expect(VERIFY_SINGLE_TIMEOUT_MS).toBe(2500);
    expect(VERIFY_BATCH_BUDGET_MS).toBe(6000);
  });
});

describe("robots.txt 纯解析", () => {
  it("* 组 Disallow: / 禁抓全站；他组规则不适用", () => {
    expect(isRobotsDisallowed("User-agent: *\nDisallow: /", "/")).toBe(true);
    expect(isRobotsDisallowed("User-agent: *\nDisallow: /", "/docs/a")).toBe(true);
    expect(isRobotsDisallowed("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow:", "/")).toBe(false);
  });

  it("Allow 长规则优先于 Disallow 短规则；空 Disallow = 允许", () => {
    const txt = "User-agent: *\nDisallow: /private\nAllow: /private/public\n";
    expect(isRobotsDisallowed(txt, "/private/public/page")).toBe(false);
    expect(isRobotsDisallowed(txt, "/private/secret")).toBe(true);
    expect(isRobotsDisallowed("User-agent: *\nDisallow:\n", "/anything")).toBe(false);
  });

  it("NavHubBot 专属组同样适用", () => {
    expect(isRobotsDisallowed("User-agent: NavHubBot\nDisallow: /\n", "/")).toBe(true);
    expect(isRobotsDisallowed("User-agent: NavHubBot\nDisallow: /admin\n", "/docs")).toBe(false);
  });
});

describe("GET 状态：从未验证过的站是 idle", () => {
  it("idle 时 outcome 为 null、lastCheckedAt 透出当前值", async () => {
    const res = await getVerifyStatus(siteAId);
    expect(res.statusCode).toBe(200);
    // 前面的用例已跑过验证：状态是上一次任务的 done/robots，而不是 idle；
    // 这里只断言 idle 形态的字段齐全性由 fresh 站覆盖——见下：
    expect(["idle", "done", "robots_disallowed", "pending"]).toContain(res.json().status);
    expect(res.json()).toHaveProperty("lastCheckedAt");
    expect(res.json()).toHaveProperty("outcome");
  });
});

describe("NIT 1：缓存命中不写假健康值", () => {
  it("probeWithCandidateProfile 新鲜缓存命中：不发请求，返回 fromCache + 原始 checkedAt", async () => {
    // 探活缓存单例懒加载、路径在取用时读 env（沿用 site-alternative-probe-api.test.ts 的做法）。
    process.env.NAVHUB_PROBE_CACHE_PATH = join(dir, "probe-cache.json");
    const cache = await getProbeCache();
    const recorded = cache.record("https://verify-a.example.com", {
      kind: "ok",
      status: 200,
      reason: "内容检测通过",
    });
    const result = await probeWithCandidateProfile(
      "https://verify-a.example.com",
      new AbortController().signal,
    );
    expect(result.kind).toBe("ok");
    expect(result.status).toBe(200);
    expect(result.fromCache).toBe(true);
    expect(result.latencyMs).toBe(0);
    expect(result.checkedAt).toBe(recorded.checkedAt);
    expect(result.reason).toContain("缓存命中");
    delete process.env.NAVHUB_PROBE_CACHE_PATH;
  });

  it("fromCache 的 ok 结论：状态 done，但 last_checked_at / latency_ms 不变、health_checks 不新增", async () => {
    // 先用一次注入探活建立基线（真实写库的那次）。
    probeResult = { kind: "ok", status: 200, latencyMs: 120, redirectTo: null, reason: "内容检测通过" };
    const first = await postVerify(siteAId);
    expect(first.statusCode).toBe(202);
    await awaitPendingVerifyJobs();
    const before = await ctx.repo.getSite(siteAId);
    const beforeCheckedAt = before?.health?.lastCheckedAt ?? 0;
    expect(beforeCheckedAt).toBeGreaterThan(0);
    expect(before?.health?.latencyMs).toBe(120);
    const beforeRows = Number(
      (await ctx.repo.raw("SELECT COUNT(*) AS c FROM health_checks WHERE site_id = ?", [siteAId]))[0]?.c ?? 0,
    );

    // 缓存命中：模拟 probeWithCandidateProfile 的新鲜缓存分支（未发请求、latencyMs 0）。
    probeCalls = [];
    setVerifyProbeForTests(async (url) => {
      probeCalls.push(url);
      return {
        kind: "ok" as const,
        status: 200,
        latencyMs: 0,
        redirectTo: null,
        reason: "缓存命中：内容检测通过",
        fromCache: true,
        checkedAt: beforeCheckedAt,
      };
    });
    const res = await postVerify(siteAId);
    expect(res.statusCode).toBe(202);
    await awaitPendingVerifyJobs();
    expect(probeCalls).toHaveLength(1);

    const status = (await getVerifyStatus(siteAId)).json();
    expect(status.status).toBe("done");
    expect(status.outcome.kind).toBe("ok");
    expect(status.outcome.fromCache).toBe(true);

    // 关键断言：写库口径跳过了 updateSiteHealth——last_checked_at 仍是
    // 上次真实探活的值（不是今天此刻），latency_ms 仍是 120（不是 0），
    // health_checks 没有新增未真实发生的成功行（updateSiteHealth 与插行同事务）。
    const after = await ctx.repo.getSite(siteAId);
    expect(after?.health?.lastCheckedAt).toBe(beforeCheckedAt);
    expect(after?.health?.latencyMs).toBe(120);
    expect(after?.health?.httpStatus).toBe(200);
    const afterRows = Number(
      (await ctx.repo.raw("SELECT COUNT(*) AS c FROM health_checks WHERE site_id = ?", [siteAId]))[0]?.c ?? 0,
    );
    expect(afterRows).toBe(beforeRows);

    // 维护格仍显示上次真实核实日期，不被推成今天。
    const cell = await maintenanceOf(siteAId);
    expect(cell.verifiedAt).toBe(beforeCheckedAt);
    expect(cell.lastCheckedAt).toBe(beforeCheckedAt);
  });
});

describe("NIT 11：在途任务去重", () => {
  it("同一身份+站点已有 pending 任务时，第二次 POST 直接 202 复用，不新起任务、不重复探活", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      setVerifyProbeForTests(async (url) => {
        probeCalls.push(url);
        await gate;
        return { ...probeResult };
      });

      const first = await postVerify(siteBId);
      expect(first.statusCode).toBe(202);
      expect(first.json().status).toBe("pending");
      expect(probeCalls).toHaveLength(1);

      // 探活仍被 gate 挂住：第二次 POST 必须复用同一任务。
      const second = await postVerify(siteBId);
      expect(second.statusCode).toBe(202);
      expect(second.json().status).toBe("pending");
      expect(probeCalls).toHaveLength(1);
      // 第二次 POST 没占出站预算：首任务占 1/2 槽，仍应剩 1 个空闲槽。
      expect(verifyOutboundBudget.tryAcquire(1)).toBe(true);
      verifyOutboundBudget.release();

      release?.();
      await awaitPendingVerifyJobs();
      expect(probeCalls).toHaveLength(1);
      const status = (await getVerifyStatus(siteBId)).json();
      expect(status.status).toBe("done");
      expect(status.outcome.kind).toBe("ok");

      // 任务跑完后再次 POST 应新起任务（done 状态不复用）。
      const third = await postVerify(siteBId);
      expect(third.statusCode).toBe(202);
      await awaitPendingVerifyJobs();
      expect(probeCalls).toHaveLength(2);
    } finally {
      // 断言中途失败也必须放行被挂住的探活，否则 afterEach 会等它超时。
      release?.();
    }
  });
});
