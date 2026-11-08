/**
 * 2026-11-07 九维评审 4-2「探测覆盖预算与收录刷新时效断层」的回归守卫。
 *
 * 锁两件事：
 *   1. **未知状态不得被候选池挡住**。旧实现候选池是 `listSites({ limit: limit*4 })`
 *      = 400 条，而 listSites 按 sort/trend_score 排序并硬钳 1000 —— 排序在 400
 *      之后的站点永远不可能成为候选。实测库 4839 条活跃站点里 4258 条未探测，
 *      400 条池内只装得下 205 条，覆盖率天花板 8.3%；池内那批探完后队列就只剩
 *      同一批 400 条在轮转。另有一层次要问题：`planPatrol` 用 `createdAt` 顶替
 *      缺失的 `lastCheckedAt` 算年龄，刚批量导入的批次因此被判成「年轻、存活概率高」
 *      排到更老的已探测站点之后 —— 未探测集合没有年龄可算。
 *   2. **从未探测过的站点不得被瞬时抖动打进 broken**。这是 4-2 验收标准第 3 条
 *      「status=active AND health_ok IS NULL 连续 3 次巡检后保持 active 的比例=100%」
 *      的失败侧边界：第 1、2 次失败必须保持 active，第 3 次才降级。
 *
 * 独立库：候选池边界与库容量、sort 顺序直接相关，共享库的存量站点会污染断言。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { JobRunner, HEALTH_BACKFILL_SHARE, type JobRunHandle } from "../src/jobs.ts";
import { handleHealthCheck } from "../src/jobs/tasks/health-check.task.ts";

const DAY = 86_400_000;

let dir: string;
let ctx: AppContext;

/** 直接插行：这里要的是「400 条已探测 + 200 条未探测」的排序形态，走 createSite 太慢 */
function insertSite(opts: {
  id: string;
  url: string;
  sort: number;
  lastCheckedAt: number | null;
  createdAt: number;
  status?: string;
}) {
  ctx.db.sqlite!
    .prepare(
      `INSERT INTO sites (id, url, title, category_id, status, enabled, sort,
                          health_ok, http_status, last_checked_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      opts.id,
      opts.url,
      opts.url,
      "cat-coverage",
      opts.status ?? "active",
      opts.sort,
      opts.lastCheckedAt === null ? null : 1,
      opts.lastCheckedAt === null ? null : 200,
      opts.lastCheckedAt,
      opts.createdAt,
      opts.createdAt,
    );
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-coverage-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 1000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  await ctx.repo.createCategory({ id: "cat-coverage", title: "覆盖测试分类", sort: 1, source: "api" } as never);

  const now = Date.now();
  // 400 条「刚查过」的站点，sort 1..400 —— 旧的候选池正好只装得下这一批
  for (let i = 0; i < 400; i++) {
    insertSite({
      id: `checked-${String(i).padStart(3, "0")}`,
      url: `https://checked-${i}.example.com`,
      sort: i + 1,
      lastCheckedAt: now - 1 * DAY,
      createdAt: now - 30 * DAY,
    });
  }
  // 200 条从未探测的站点，sort 501..700 —— 排序在旧候选池之外，且创建时间很新
  for (let i = 0; i < 200; i++) {
    insertSite({
      id: `unchecked-${String(i).padStart(3, "0")}`,
      url: `https://unchecked-${i}.example.com`,
      sort: 501 + i,
      lastCheckedAt: null,
      createdAt: now,
    });
  }
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("4-2 巡检队列：未知状态不得被候选池饿死", () => {
  it("整库基数正确：200 条未探测 / 400 条已探测", async () => {
    const depth = await ctx.repo.countSitesByPatrolState();
    expect(depth).toEqual({ unchecked: 200, checked: 400 });
  });

  it("未探测队列不受 400 条候选池限制：排序在 500 之后的站点也能取到", async () => {
    const queue = await ctx.repo.listUncheckedSites(1000);
    expect(queue).toHaveLength(200);
    // 全部是未探测站点，且完全覆盖 sort 501..700 这一批
    expect(queue.every((s) => s.health?.lastCheckedAt == null)).toBe(true);
    expect(queue.map((s) => s.id)).toContain("unchecked-000");
    expect(queue.map((s) => s.id)).toContain("unchecked-199");
  });

  it("patrolTargets 按配额分流，且补探排在前面（时间预算先保未知状态）", async () => {
    const runner = new JobRunner(ctx, { intervalMs: 1000 });
    const selection = await (runner as any).patrolTargets(100);

    const expectedBackfill = Math.round(100 * HEALTH_BACKFILL_SHARE);
    expect(selection.quota).toEqual({ backfill: expectedBackfill, refresh: 100 - expectedBackfill });
    expect(selection.picked).toEqual({ backfill: expectedBackfill, refresh: 100 - expectedBackfill });
    expect(selection.depth).toEqual({ unchecked: 200, checked: 400 });
    expect(selection.targets).toHaveLength(100);

    // 前 backfill 个必须是未探测站点，后面必须是已探测站点 —— 顺序即优先级
    const ids = selection.targets.map((s: { id: string }) => s.id);
    expect(ids.slice(0, expectedBackfill).every((id: string) => id.startsWith("unchecked-"))).toBe(true);
    expect(ids.slice(expectedBackfill).every((id: string) => id.startsWith("checked-"))).toBe(true);
  });

  it("回归：旧实现的候选池只装 400 条，池外的未探测站点永远选不到", async () => {
    // 复刻旧实现的选择逻辑（listSites 候选池 400 + planPatrol），确认它确实漏掉池外站点。
    // 注意断言的是**池外**那批（sort 501..700）：池内若有未探测站点，旧实现是会选到的
    // （它们的 createdAt 只有 3 天，存活概率高于查过 7 天的站点）。真实库也是这样：
    // 400 条池内装得下 205 条未探测、池外还有 4053 条 —— 天花板 8.3% 由池子决定，
    // 不由排序决定。这条断言把「修复前是什么样」留在测试里：将来若有人把候选池
    // 改回去，上一条用例会红，而这条会解释红的原因。
    const legacyPool = await ctx.repo.listSites({ limit: Math.min(2000, 100 * 4) });
    expect(legacyPool).toHaveLength(400);
    const outsideIds = legacyPool.map((s) => s.id);
    expect(outsideIds).not.toContain("unchecked-000");
    expect(outsideIds).not.toContain("unchecked-199");
    // 池内也确实遗漏了未探测站点：200 条未探测全部排在 sort 501 之后
    expect(legacyPool.filter((s) => s.health?.lastCheckedAt == null)).toHaveLength(0);
  });

  it("队列不足时把剩余名额让给另一边（不空转配额）", async () => {
    const runner = new JobRunner(ctx, { intervalMs: 1000 });
    const selection = await (runner as any).patrolTargets(1000);
    // 未探测只有 200 条 → 全部选中，其余名额给已探测的 400 条
    expect(selection.picked.backfill).toBe(200);
    expect(selection.picked.refresh).toBe(400);
    expect(selection.targets).toHaveLength(600);
  });
});

describe("4-2 未知状态不得被瞬时抖动降级（验收标准 3 的失败侧）", () => {
  const runHandle = (): JobRunHandle => ({
    jobId: "test-coverage",
    kind: "health_check",
    signal: new AbortController().signal,
    deadlineAt: 0,
    shouldStop: () => false,
  });

  it("从未探测过的站点：首次失败保持 active，连续第 3 次才 broken", async () => {
    ctx.db.sqlite!
      .prepare(
        `INSERT INTO sites (id, url, title, category_id, status, enabled, sort, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', 1, 900, ?, ?)`,
      )
      .run("flaky-unchecked", "https://127.0.0.1:1/never", "未探测的抖动站点", "cat-coverage", Date.now(), Date.now());

    const site = (await ctx.repo.getSite("flaky-unchecked"))!;
    expect(site.health?.lastCheckedAt).toBeNull();

    const selection = () => ({
      targets: [site],
      quota: { backfill: 1, refresh: 0 },
      picked: { backfill: 1, refresh: 0 },
      depth: { unchecked: 1, checked: 0 },
    });

    const statusOf = async () => (await ctx.repo.getSite("flaky-unchecked"))!.status;

    // 127.0.0.1 在 allowPrivateNetworks=false 下会被 SSRF 拦截直接抛错，
    // 不需要真实外呼，也就不会因为网络环境让这条用例不稳定。
    await handleHealthCheck(ctx, { limit: 1 }, runHandle(), async () => selection());
    expect(await statusOf()).toBe("active");

    await handleHealthCheck(ctx, { limit: 1 }, runHandle(), async () => selection());
    expect(await statusOf()).toBe("active");

    await handleHealthCheck(ctx, { limit: 1 }, runHandle(), async () => selection());
    expect(await statusOf()).toBe("broken");

    const history = await ctx.repo.recentHealthChecks("flaky-unchecked", 5);
    expect(history).toHaveLength(3);
    expect(history.every((h) => h.ok === false)).toBe(true);
  });

  it("任务事件带上覆盖指标：没有这几个数，未知状态在下降还是在打转就看不出来", async () => {
    const row = ctx.db.sqlite!
      .prepare("SELECT meta FROM events WHERE kind = 'health_check' ORDER BY rowid DESC LIMIT 1")
      .get() as { meta: string } | undefined;
    expect(row?.meta, "health_check 没有落事件").toBeTruthy();
    const meta = JSON.parse(row!.meta);
    expect(meta).toMatchObject({
      planned: 1,
      checked: 1,
      quota: { backfill: 1, refresh: 0 },
      picked: { backfill: 1, refresh: 0 },
      depthBefore: { unchecked: 1, checked: 0 },
      uncheckedAfter: 0,
      coveragePct: 100,
    });
    // 补探 1 条即清空积压 ⇒ 投影 0 天（不是 null：null 只用于「本轮没做补探、无法外推」）
    expect(meta.projectedDaysToFullCoverage).toBe(0);
  });
});
