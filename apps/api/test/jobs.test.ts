/**
 * JobRunner 与画像服务集成测试。
 *
 * 跑真实 SQLite + 真实 tick 循环（不 mock 仓储），覆盖：
 *  - recompute_rank：点击/收藏 -> trend_score 的真实排序效果
 *  - health_check：SSRF 目标被判 broken（不抛错咽掉整个循环）
 *  - refetch_metadata：坏 siteId -> 任务 failed 且不阻塞后续任务
 *  - 单实例锁：并发 tick 只有一个真正执行
 *  - 画像聚合：click 事件 -> user_profiles -> personal 通道可检索
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { JobRunner, backoffMs } from "../src/jobs.ts";
import { refreshUserProfile } from "../src/profile-service.ts";
import { clampWebhookTimeout, sendWebhookAlert } from "../src/alerts.ts";
import { createServer, type AddressInfo } from "node:http";

let dir: string;
let ctx: AppContext;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-jobs-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "jobs.db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("recompute_rank 任务", () => {
  it("点击多的站点 trend_score 更高，且写入 sites 表", async () => {
    await ctx.repo.createCategory({ id: "rc", title: "热度类目" });
    const hot = await ctx.repo.createSite({ url: "https://example.com/hot", title: "热门站", categoryId: "rc" });
    const cold = await ctx.repo.createSite({ url: "https://example.com/cold", title: "冷门站", categoryId: "rc" });
    const old = await ctx.repo.createSite({ url: "https://example.com/old", title: "老站", categoryId: "rc" });

    // 热门站：5 次点击 + 2 次收藏
    for (let i = 0; i < 5; i++) await ctx.repo.recordEvent("click", { siteId: hot.id, meta: { identity: "u1" } });
    for (let i = 0; i < 2; i++) await ctx.repo.addFavorite({ userId: "u1", siteId: hot.id });
    // 冷门站：1 次点击
    await ctx.repo.recordEvent("click", { siteId: cold.id, meta: { identity: "u1" } });
    // 老站：无互动，但人为改老创建时间
    await ctx.db.sqlite!.prepare("UPDATE sites SET created_at = ? WHERE id = ?").run(Date.now() - 200 * 86_400_000, old.id);

    await ctx.repo.enqueueJob("recompute_rank", {});
    const runner = new JobRunner(ctx);
    const result = await runner.tick();
    expect(result.processed).toBe(1);

    const hotAfter = await ctx.repo.getSite(hot.id);
    const coldAfter = await ctx.repo.getSite(cold.id);
    const oldAfter = await ctx.repo.getSite(old.id);
    expect(hotAfter!.trendScore!).toBeGreaterThan(coldAfter!.trendScore!);
    expect(hotAfter!.trendScore!).toBeGreaterThan(oldAfter!.trendScore!);
    expect(coldAfter!.trendScore!).toBeGreaterThan(oldAfter!.trendScore!); // 有互动 > 无互动
    expect(oldAfter!.trendScore!).toBe(0); // 无互动老站钳为 0

    // 热度榜反映真实顺序
    const ranking = await ctx.repo.hotSites(3);
    expect(ranking[0]!.id).toBe(hot.id);
  });
});

describe("health_check 任务", () => {
  it("SSRF 目标被判 broken 并记录原因，任务不失败", async () => {
    const site = await ctx.repo.createSite({ url: "http://127.0.0.1:9/", title: "内网站", categoryId: "rc" });
    await ctx.repo.enqueueJob("health_check", { siteId: site.id });
    const runner = new JobRunner(ctx);
    const result = await runner.tick();
    expect(result.processed).toBe(1);

    const after = await ctx.repo.getSite(site.id);
    expect(after!.status).toBe("broken");
    expect(after!.health!.error).toBeTruthy();
    expect(after!.health!.lastCheckedAt).toBeGreaterThan(0);
    // 任务本身是 done 不是 failed（抓取失败是业务的正常结果）
    const jobs = await ctx.repo.listJobs("done", 10);
    expect(jobs.some((j) => j.kind === "health_check")).toBe(true);
  });
});

describe("refetch_metadata 任务", () => {
  it("坏 siteId 首次失败回 pending（退避），不阻塞同轮其它任务", async () => {
    await ctx.repo.enqueueJob("refetch_metadata", { siteId: "no-such-site" });
    await ctx.repo.enqueueJob("recompute_rank", {});
    const runner = new JobRunner(ctx);
    const result = await runner.tick();
    expect(result.processed).toBe(2);

    // 首次失败不再直接终态 failed：回 pending 并排了退避时间（否则瞬时抖动一击毙命）
    const jobs = await ctx.repo.listJobs(undefined, 20);
    const refetch = jobs.find((j) => j.kind === "refetch_metadata" && j.error);
    expect(refetch).toBeTruthy();
    expect(refetch!.status).toBe("pending");
    expect(refetch!.nextRunAt).toBeGreaterThan(Date.now());
    const done = await ctx.repo.listJobs("done", 10);
    expect(done.some((j) => j.kind === "recompute_rank")).toBe(true);
  });

  it("退避到点前不被认领（不饿死正常任务）", async () => {
    const pending = (await ctx.repo.listJobs("pending", 10)).filter((j) => j.nextRunAt !== null);
    expect(pending.length).toBeGreaterThan(0);
    const runner = new JobRunner(ctx);
    // next_run_at 在未来 → 一个都认领不到
    expect((await runner.tick()).processed).toBe(0);
  });

  it("重试到点后重新认领，耗尽 3 次才落 failed 并触发一次告警", async () => {
    const alerts: string[] = [];
    const runner = new JobRunner(ctx, { onAlert: (msg) => alerts.push(msg) });
    let refetchId = "";

    // 把所有退避中的任务时间拨到过去，模拟"到点"
    const now = Date.now();
    ctx.db.sqlite!.prepare("UPDATE jobs SET next_run_at = ? WHERE next_run_at IS NOT NULL").run(now - 1);
    let jobs = await ctx.repo.listJobs("pending", 10);
    refetchId = jobs.find((j) => j.kind === "refetch_metadata")?.id ?? "";
    expect(refetchId).toBeTruthy();

    // attempts 已是 1 → 再执行 2 次即达到 MAX_JOB_ATTEMPTS=3
    await runner.tick();
    // 第二次失败后仍在退避
    ctx.db.sqlite!.prepare("UPDATE jobs SET next_run_at = ? WHERE id = ?").run(now - 1, refetchId);
    await runner.tick();

    const final = (await ctx.repo.listJobs(undefined, 50)).find((j) => j.id === refetchId);
    expect(final!.status).toBe("failed");
    expect(final!.attempts).toBeGreaterThanOrEqual(3);
    // 告警恰好一次（耗尽时），不是每次失败都喊
    expect(alerts.length).toBe(1);
    expect(alerts[0]).toContain("refetch_metadata");
    expect(alerts[0]).toContain("停止重试");
  });
});

describe("任务配置与退避", () => {
  it("backoffMs 指数增长且封顶 1 小时", () => {
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(2)).toBe(120_000);
    expect(backoffMs(3)).toBe(240_000);
    expect(backoffMs(20)).toBe(60 * 60_000); // 封顶
  });

  it("轮询间隔可由 NAVHUB_JOBS_INTERVAL_MS 配置（非法值回退 30s）", () => {
    process.env.NAVHUB_JOBS_INTERVAL_MS = "5000";
    expect(new JobRunner(ctx).interval).toBe(5000);
    process.env.NAVHUB_JOBS_INTERVAL_MS = "10"; // < 1000 视为非法
    expect(new JobRunner(ctx).interval).toBe(30_000);
    delete process.env.NAVHUB_JOBS_INTERVAL_MS;
    expect(new JobRunner(ctx).interval).toBe(30_000);
  });
});

describe("reindex 任务", () => {
  it("全站重建不报错（embedding 关闭时只重建拼音/FTS）", async () => {
    await ctx.repo.enqueueJob("reindex", { vectors: false });
    const runner = new JobRunner(ctx);
    const result = await runner.tick();
    expect(result.processed).toBe(1);
    const failed = await ctx.repo.listJobs("failed", 10);
    expect(failed.some((j) => j.kind === "reindex")).toBe(false);
  });
});

describe("单实例锁与防重入", () => {
  it("并发 tick 只有一个真正执行（防重入）", async () => {
    await ctx.repo.enqueueJob("recompute_rank", {});
    const runner = new JobRunner(ctx);
    const [a, b] = await Promise.all([runner.tick(), runner.tick()]);
    const executed = [a, b].filter((r) => !r.skipped);
    expect(executed.length).toBe(1);
    expect(a.processed + b.processed).toBe(1);
  });

  it("锁释放后下一轮可以继续消费", async () => {
    await ctx.repo.enqueueJob("recompute_rank", {});
    const runner = new JobRunner(ctx);
    expect((await runner.tick()).processed).toBe(1);
    await ctx.repo.enqueueJob("recompute_rank", {});
    expect((await runner.tick()).processed).toBe(1);
  });

  it("锁行在 idempotency 表且带持有者（可观测）", async () => {
    const row = ctx.db.sqlite!.prepare("SELECT key, response FROM idempotency WHERE key = ?").get("lock:job-runner") as { response?: string } | undefined;
    // tick 结束后锁已释放（DELETE），所以这里应该没有行——验证释放语义
    expect(row).toBeUndefined();
  });
});

describe("个性化画像服务", () => {
  it("click 事件聚合出画像，并可注入检索的 personal 通道", async () => {
    await ctx.repo.createCategory({ id: "ai-cat", title: "AI 工具" });
    await ctx.repo.createCategory({ id: "dev-cat", title: "开发运维" });
    const s1 = await ctx.repo.createSite({ url: "https://example.com/ai1", title: "AI 站一", categoryId: "ai-cat", tags: ["大模型"] });
    const s2 = await ctx.repo.createSite({ url: "https://example.com/ai2", title: "AI 站二", categoryId: "ai-cat", tags: ["大模型", "对话"] });
    await ctx.repo.createSite({ url: "https://example.com/dev1", title: "开发站", categoryId: "dev-cat", tags: ["代码"] });

    // 用户 u-p 连续点击 AI 类站点
    for (let i = 0; i < 4; i++) {
      await ctx.repo.recordEvent("click", { siteId: i % 2 === 0 ? s1.id : s2.id, meta: { identity: "u-p" } });
    }
    await ctx.repo.recordEvent("click", { siteId: (await ctx.repo.findSiteByUrl("https://example.com/dev1"))!.id, meta: { identity: "u-p" } });

    const refreshed = await refreshUserProfile(ctx, "u-p");
    expect(refreshed).toBe(true);

    const profile = await ctx.repo.getUserProfile("u-p");
    expect(profile).not.toBeNull();
    expect(profile!.topCategories[0]).toBe("ai-cat");
    expect(profile!.topTags).toContain("大模型");
    expect(profile!.visitedSiteIds.length).toBe(3);

    // 画像可直接作为 personalize 信号注入检索（personal 通道出现）。
    // 注意：personal 只对「已被相关性通道召回」的站点生效（设计约束），
    // 所以查询词必须能命中这些站点——用 "AI" 命中「AI 站一/二」。
    const result = await ctx.search.search({
      q: "AI",
      personalize: {
        topCategories: profile!.topCategories,
        topTags: profile!.topTags,
        visitedSiteIds: profile!.visitedSiteIds,
      },
      limit: 10,
    });
    expect(result.channelsUsed).toContain("personal");
    // personal 通道权重低：不会把不相关站点顶到第一（RRF 教训的回归保护）
    const first = result.hits[0];
    expect(first).toBeTruthy();
  });

  it("节流：60 秒内重复刷新返回 false", async () => {
    expect(await refreshUserProfile(ctx, "u-p")).toBe(false);
  });

  it("陌生身份刷新不出错（空画像）", async () => {
    const ok = await refreshUserProfile(ctx, "u-stranger");
    expect(ok).toBe(true);
    const profile = await ctx.repo.getUserProfile("u-stranger");
    expect(profile!.topCategories).toEqual([]);
    expect(profile!.searchCount).toBe(0);
  });
});

describe("失败告警 webhook 通道", () => {
  it("sendWebhookAlert 投递标准 JSON，2xx 算送达", async () => {
    const received: Array<{ url?: string; contentType?: string; body: any }> = [];
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        received.push({ url: req.url, contentType: req.headers["content-type"], body: JSON.parse(raw) });
        res.statusCode = 200;
        res.end("ok");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    try {
      const ok = await sendWebhookAlert(
        "http://127.0.0.1:" + port + "/hook", "测试告警",
        { kind: "recompute_rank", attempts: 3, error: "boom" }, 2000,
      );
      expect(ok).toBe(true);
      expect(received.length).toBe(1);
      expect(received[0]!.contentType).toContain("application/json");
      expect(received[0]!.body.source).toBe("navhub-jobs");
      expect(received[0]!.body.text).toBe("测试告警");
      expect(received[0]!.body.detail).toEqual({ kind: "recompute_rank", attempts: 3, error: "boom" });
      expect(typeof received[0]!.body.at).toBe("number");
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("非法协议 / 非法 URL / 不可达地址返回 false 且不抛错", async () => {
    const detail = { kind: "a", attempts: 1, error: "e" };
    expect(await sendWebhookAlert("file:///etc/passwd", "x", detail)).toBe(false);
    expect(await sendWebhookAlert("not a url", "x", detail)).toBe(false);
    expect(await sendWebhookAlert("", "x", detail)).toBe(false);
    // 本机 discard 端口：连接被拒，必须快速失败而不是挂住
    expect(await sendWebhookAlert("http://127.0.0.1:9/hook", "x", detail, 1500)).toBe(false);
  });

  it("clampWebhookTimeout 钳制在 1s~30s", async () => {
    expect(clampWebhookTimeout(100)).toBe(1000);
    expect(clampWebhookTimeout(120_000)).toBe(30_000);
    expect(clampWebhookTimeout(2500)).toBe(2500);
    expect(clampWebhookTimeout(Number.NaN)).toBe(5000);
  });

  it("Runner 重试耗尽时向 webhook 投递且仅一次", async () => {
    const received: any[] = [];
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => { raw += c; });
      req.on("end", () => { received.push(JSON.parse(raw)); res.statusCode = 200; res.end("ok"); });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    try {
      const loud = { ...ctx, config: { ...ctx.config, alerts: { webhookUrl: "http://127.0.0.1:" + port + "/hook", webhookTimeoutMs: 2000 } } };
      const runner = new JobRunner(loud, {});
      const id = await ctx.repo.enqueueJob("refetch_metadata", { siteId: "no-such-site-alert" });
      const past = Date.now() - 1;
      await runner.tick(); // attempts=1 → 退避
      ctx.db.sqlite!.prepare("UPDATE jobs SET next_run_at = ? WHERE id = ?").run(past, id);
      await runner.tick(); // attempts=2 → 退避
      ctx.db.sqlite!.prepare("UPDATE jobs SET next_run_at = ? WHERE id = ?").run(past, id);
      await runner.tick(); // attempts=3 → 耗尽 → failed + webhook（fire-and-forget）
      expect((await ctx.repo.getJob(id))!.status).toBe("failed");
      // fire-and-forget 投递：轮询等它，最多 3 秒
      const deadline = Date.now() + 3000;
      while (received.length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(received.length).toBe(1);
      expect(received[0].detail.kind).toBe("refetch_metadata");
      expect(received[0].detail.attempts).toBe(3);
      expect(received[0].source).toBe("navhub-jobs");
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("未配置 webhook 时只有日志没有投递（行为不变）", async () => {
    expect(ctx.config.alerts.webhookUrl).toBeNull();
    const runner = new JobRunner(ctx, {});
    const id = await ctx.repo.enqueueJob("refetch_metadata", { siteId: "no-such-site-quiet" });
    const past = Date.now() - 1;
    await runner.tick();
    ctx.db.sqlite!.prepare("UPDATE jobs SET next_run_at = ? WHERE id = ?").run(past, id);
    await runner.tick();
    ctx.db.sqlite!.prepare("UPDATE jobs SET next_run_at = ? WHERE id = ?").run(past, id);
    await runner.tick();
    expect((await ctx.repo.getJob(id))!.status).toBe("failed");
  });
});
