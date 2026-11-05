/**
 * 协作式停手边界（P1-4「假取消」的另一半）。
 *
 * 背景：取消/超时不能靠 kill（JS 没有安全中断点，硬砍会把一个事务劈成半写）。
 * 真正的语义是「让 handler 在下一个分片边界自己停」——已提交的分片保留、
 * 未开始的不写，且**协作式停手不算失败**。
 *
 * 这两条护栏各自钉住一个 handler 的分片边界：
 *   - reindex：32 条一批，请求停手后已提交批次保留、未开始的不再写；
 *   - health_check：分批巡检，到点收手后剩余顺延下一轮，整轮不标失败。
 *
 * 两条都跑真实 SQLite + 真实 tick（不 mock 仓储），与 jobs.test.ts 同口径。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { buildServer } from "../src/server.ts";
import { JobRunner, jobEventBus, requestJobAbort, type JobEventPayload } from "../src/jobs.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-abort-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "abort.db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
    auth: { enabled: false },
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

/** 清掉可认领的任务，避免上一条用例的残留被本条 tick 抢先执行 */
async function drainClaimable(): Promise<void> {
  await ctx.repo.run("DELETE FROM jobs WHERE status IN ('pending', 'retrying')");
}

describe("reindex 的停手边界", () => {
  /**
   * 分片边界停手：已提交批次保留、未开始的不写。
   *
   * 观测用的是「被 reindex 处理过的站点数」而不是任务状态：reindex 每批调用
   * `updateSite`，那会顺带刷新 `updated_at`。因此「被刷新的站点数」正好等于
   * 已处理的条数，是唯一能直接看出停在第几片的量。
   */
  it("请求停手后停在批次边界：已提交批次保留、未开始的不写，且不标失败", async () => {
    await drainClaimable();
    await ctx.repo.createCategory({ id: "abort-cat", title: "停手类目" });

    const BATCH_SIZE = 32;
    // 2 批 + 零头：停手必须落在第 1 批之后，才看得出「不是全跑完也不是一条没跑」
    const total = BATCH_SIZE * 2 + 5;
    const ids: string[] = [];
    for (let i = 0; i < total; i++) {
      const site = await ctx.repo.createSite({
        url: `https://abort-reindex-${i}.example.com`,
        title: `停手站点 ${i}`,
        categoryId: "abort-cat",
      });
      ids.push(site.id);
    }
    // 全部拨到「很久没更新」：之后只有被 reindex 处理过的行才会前进
    const stale = Date.now() - 10 * 60_000;
    const inList = ids.map(() => "?").join(",");
    await ctx.repo.run("UPDATE sites SET updated_at = ? WHERE id IN (" + inList + ")", [stale, ...ids]);

    const jobId = await ctx.repo.enqueueJob("reindex", { siteIds: ids, vectors: false });

    /**
     * 不用「等 status 变 running 再 abort」那种抢跑写法：reindex 可能在本轮轮询
     * 看到 running 之前就跑完了，用例于是变成看运气。改为**按真实进度触发**：
     * 每批提交后对应站点的 updated_at 会前进，一旦观测到第 1 批已提交就请求停手，
     * 此时后面至少还剩 5 批（共 6 批 + 零头），停手必然落在批次边界上。
     */
    const runner = new JobRunner(ctx);
    const running = runner.tick();
    /**
     * 轮询必须是**微任务**而不是 setTimeout：reindex 全程跑在同一个宏任务里
     * （better-sqlite3 是同步驱动，批与批之间只有 await，没有宏任务让出），
     * 用 setTimeout 的话本循环要等整个 reindex 跑完才第一次被执行，
     * 于是只能观测到「一条没跑」或「全跑完」两个端点，测不到边界。
     * 另外仓储的读写闸门会让这条查询排在刚提交的事务之后，观测粒度天然对齐批次。
     */
    let aborted = false;
    for (let spin = 0; spin < 200_000; spin++) {
      const seen = await ctx.repo.raw(
        "SELECT COUNT(*) AS c FROM sites WHERE id IN (" + inList + ") AND updated_at > ?",
        [...ids, stale],
      );
      if (Number(seen[0]?.c ?? 0) >= BATCH_SIZE) {
        aborted = requestJobAbort(jobId, "cancelled");
        break;
      }
      await Promise.resolve();
    }
    // 确实命中了本进程的执行体（否则前面测的是「没人理它」而不是停手）
    expect(aborted).toBe(true);

    await running;

    const refreshed = await ctx.repo.raw(
      "SELECT COUNT(*) AS c FROM sites WHERE id IN (" + inList + ") AND updated_at > ?",
      [...ids, stale],
    );
    const processed = Number(refreshed[0]?.c ?? 0);

    /**
     * 关键断言：处理数必须严格落在 (0, total) 之间。
     *  - 等于 0     → 停手发生在第 1 批之前，等于「还没开始就被砍」，不是边界语义；
     *  - 等于 total → 停手根本没生效，护栏是摆设（这正是消融要抓住的情况）。
     * 批次是 32 的整数倍，用取模把它钉死，而不只是「小于 total」。
     */
    expect(processed).toBeGreaterThan(0);
    expect(processed).toBeLessThan(total);
    expect(processed % BATCH_SIZE).toBe(0);

    /**
     * 协作式停手不算失败。
     *
     * 这里断言「不是 failed」而不是「一定是 cancelled」：本用例走的是 Runner 侧的本地
     * 中止（`requestJobAbort`），它只停执行体、不改写库里的状态列——把行改成
     * `cancelling` 是 `repo.cancelJob` 的职责，两者按设计分开（见 jobs.ts 里
     * requestJobAbort 的注释）。因此只经本地中止时，行仍是 running，收尾的 CAS
     * 不命中、任务照常落 done。
     *
     * 这不掩盖问题：真正要保证的性质是「停手不被记成失败」，而本用例已用上面的
     * 处理数（严格小于 total）证明了 handler 确实提前收手了。
     */
    const after = (await ctx.repo.raw("SELECT status FROM jobs WHERE id = ?", [jobId]))[0];
    expect(String(after?.status)).not.toBe("failed");
  });
});

describe("health_check 的停手边界", () => {
  /**
   * 收到中止信号后收手：剩余站点顺延下一轮，整轮**不标失败**。
   *
   * ⚠️ 本用例刻意走「取消」而不是「预算到点」：预算给足（deadline 远在未来），
   * 于是 deadlineAt 那条判断**不可能**触发，唯一的停手来源就是 AbortSignal。
   * 这样消融时把 shouldStop() 换回旧的 deadlineAt 写法，用例必然转红；
   * 若两者都可能触发，护栏就没法证明是哪一条在起作用。
   */
  it("收到中止信号后剩余站点顺延下一轮，整轮不标失败", async () => {
    await drainClaimable();
    await ctx.repo.createCategory({ id: "hc-cat", title: "巡检类目" });

    // 不可达地址：抓取必失败但很快返回，靠站点数量而不是单次耗时铺开时间窗
    for (let i = 0; i < 40; i++) {
      await ctx.repo.createSite({
        url: "http://127.0.0.1:9/abort-" + i,
        title: "顺延站点 " + i,
        categoryId: "hc-cat",
      });
    }

    const jobId = await ctx.repo.enqueueJob("health_check", { limit: 40 });

    // 预算给足：deadlineAt 远在未来，不可能成为停手原因
    const runner = new JobRunner(ctx, { budgetOverrides: { health_check: 600_000 } });
    const running = runner.tick();

    // 与 reindex 不同，这里可以用 setTimeout 轮询：guardedFetch 走真实网络 I/O，
    // 每两次抓取之间都有宏任务让出，轮询不会被整个 handler 挤到后面。
    const deadline = Date.now() + 30_000;
    let aborted = false;
    while (Date.now() < deadline) {
      const row = (await ctx.repo.raw("SELECT status FROM jobs WHERE id = ?", [jobId]))[0];
      if (String(row?.status ?? "") === "running") {
        aborted = requestJobAbort(jobId, "cancelled");
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    // 确实命中了本进程的执行体，否则测的是「没人理它」
    expect(aborted).toBe(true);

    await running;

    /**
     * 核心断言：整轮不标失败。
     * 协作式收手是设计行为，落 failed 会让定时巡检每轮都告警，
     * 运营最后只能把告警当噪音关掉。
     */
    const after = (await ctx.repo.raw("SELECT status FROM jobs WHERE id = ?", [jobId]))[0];
    expect(String(after?.status)).not.toBe("failed");

    // 顺延的证据：health_check 事件里记了 planned / checked / deferred
    const events = await ctx.repo.raw(
      "SELECT meta FROM events WHERE kind = 'health_check' ORDER BY id DESC LIMIT 5",
    );
    const withMeta = events
      .map((e) => {
        try { return JSON.parse(String(e.meta ?? "{}")); } catch { return {}; }
      })
      .find((m) => typeof m?.planned === "number");
    expect(withMeta).toBeTruthy();
    expect(Number(withMeta!.planned)).toBeGreaterThan(0);
    /**
     * 收手 = 有站点没被检查（顺延到下一轮）。
     * 这条正是护栏会咬人的地方：若 shouldStop() 判断缺失，巡检会抓完所有站点，
     * deferred 变成 0，下面两条断言全部转红。
     */
    expect(Number(withMeta!.deferred)).toBeGreaterThan(0);
    expect(Number(withMeta!.checked)).toBeLessThan(Number(withMeta!.planned));
  });
});
describe("取消路由：POST /api/jobs/:id/cancel", () => {
  /**
   * 路由级验收：对 **running** 的任务按取消，必须同时满足两件事——
   *   (a) 执行体很快收到 AbortSignal（不用等下一次心跳）；
   *   (b) 响应与 emit 里的状态是 cancelling 而不是 cancelled。
   *
   * 这两条合起来才是「真取消」：只改库状态不中止执行体，等于界面撒谎；
   * 反过来只中止执行体却 emit cancelled，等于给前端一个还没发生的终态
   * （管理端会立刻给出重试入口，而重试会和仍在跑的执行体并发写同一批数据）。
   */
  it("running 任务：立刻中止执行体，且状态如实回报 cancelling", async () => {
    await drainClaimable();
    await ctx.repo.createCategory({ id: "cancel-route-cat", title: "取消路由类目" });
    for (let i = 0; i < 20; i++) {
      await ctx.repo.createSite({
        url: "https://cancel-route-" + i + ".example.com",
        title: "取消路由站点 " + i,
        categoryId: "cancel-route-cat",
      });
    }

    const jobId = await ctx.repo.enqueueJob("health_check", { limit: 20 });

    // 先订阅再启动，避免事件在监听之前就发完
    const seen: JobEventPayload[] = [];
    const onJob = (payload: JobEventPayload) => {
      if (payload.jobId === jobId) seen.push(payload);
    };
    jobEventBus.on("job", onJob);

    // 预算给足：让停手的唯一来源是取消信号，而不是 deadlineAt
    const runner = new JobRunner(ctx, { budgetOverrides: { health_check: 600_000 } });
    const running = runner.tick();

    // 等任务真的被认领（进入 running），否则取消的是 pending，测不到执行体
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const row = (await ctx.repo.raw("SELECT status FROM jobs WHERE id = ?", [jobId]))[0];
      if (String(row?.status ?? "") === "running") break;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(String((await ctx.repo.raw("SELECT status FROM jobs WHERE id = ?", [jobId]))[0]?.status)).toBe("running");

    const res = await app.inject({ method: "POST", url: "/api/jobs/" + jobId + "/cancel" });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    /**
     * (b) 状态如实：running 的任务此刻停在 cancelling。
     * 真实终态 cancelled 要等 Runner 在 handler 结算后写入，此刻还没发生。
     */
    expect(body.status).toBe("cancelling");

    /**
     * (a) 立刻中止：路由确实命中了本进程的执行体。
     * abortedLocally 是 requestJobAbort 的返回值——为 true 说明执行体当场收到了
     * AbortSignal，不必等下一次心跳（默认 60s）读到 cancelling 才停。
     */
    expect(body.abortedLocally).toBe(true);

    // 库里的状态同样是 cancelling（不是被直接写成 cancelled）
    const rowAfter = (await ctx.repo.raw("SELECT status FROM jobs WHERE id = ?", [jobId]))[0];
    expect(String(rowAfter?.status)).toBe("cancelling");

    /**
     * 路由当次 emit 必须是 cancelling：真终态 cancelled 要等 handler 结算后由
     * finalizeAbortedRun 写入。因此这里断言的是**顺序**而不是「永不出现 cancelled」
     * ——取消那一刻就写 cancelled 才是撒谎（前端会立刻给出重试入口），
     * 收尾之后写 cancelled 是正确的终态上报。
     */
    const atCancelTime = seen.filter((e) => e.status === "cancelling" || e.status === "cancelled");
    expect(atCancelTime.length).toBeGreaterThan(0);
    expect(atCancelTime[0]!.status).toBe("cancelling");

    await running;
    jobEventBus.off("job", onJob);
  });

  /**
   * 终态任务：如实回「没做任何事」，不能回 200 + 看起来成功的消息。
   */
  it("终态任务：返回 409 说明未做变更，不谎报 cancelled", async () => {
    await drainClaimable();
    const jobId = await ctx.repo.enqueueJob("recompute_rank", {});
    // 直接推到终态：cancelJob 对终态两条 UPDATE 都不命中，回 null
    await ctx.repo.run("UPDATE jobs SET status = 'done' WHERE id = ?", [jobId]);

    const res = await app.inject({ method: "POST", url: "/api/jobs/" + jobId + "/cancel" });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe("JOB_NOT_CANCELLABLE");
    expect(body.status).toBe("done");
    // 库里没被改动
    const row = (await ctx.repo.raw("SELECT status FROM jobs WHERE id = ?", [jobId]))[0];
    expect(String(row?.status)).toBe("done");
  });
});
