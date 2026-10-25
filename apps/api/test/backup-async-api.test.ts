/**
 * 异步恢复端点：`POST /api/backup/restore/async` 与 `GET .../status/:jobId`。
 *
 * 与 `backup-restore-job.test.ts` 的分工：那个文件测任务本身（直接构造 staging），
 * 这个文件测**端点与任务之间的契约**——最容易被忽略的一层，因为两边各自都能过，
 * 但中间的 staging 形状或 payload 字段对不上就整条链路失效。
 *
 * 覆盖设计文档验收表里的关键几条：
 *   1. 202 + jobId，且 staging 文件与 job 行都真的产生了；
 *   2. 非法备份 400，**不留下 job 与 staging**（否则每来一次坏包就多一条僵尸任务）；
 *   3. 超限 413；
 *   4. status 只认 backup_restore，其它 kind 一律 404（不泄漏内部路径）；
 *   5. 端到端：async → tick → 站点入库、staging 删除、status 变 done。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { JobRunner } from "../src/jobs.ts";

let dir: string;
let stagingDir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-async-api-"));
  stagingDir = join(dir, "staging");
  // 端点按 env 决定 staging 位置：指向临时目录，避免脏化仓库的 data/
  process.env.NAVHUB_RESTORE_STAGING_DIR = stagingDir;

  ctx = await createContext(
    loadConfig({
      mode: "lite",
      sqlitePath: join(dir, "async.db"),
      embedding: {
        model: "Xenova/bge-small-zh-v1.5",
        endpoint: "https://hf-mirror.com",
        dtype: "q8",
        cacheDir: join(dir, "models"),
        dim: 512,
        enabled: false,
      },
      corsOrigins: ["*"],
    }),
  );
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  delete process.env.NAVHUB_RESTORE_STAGING_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function backupPayload(sites: Array<{ id: string; title: string; url: string; categoryId?: string }>) {
  return {
    version: "1.0",
    generator: "NavHub 2026 Sovereign Backup Engine",
    exportedAt: Date.now(),
    categories: [{ id: "async-cat", title: "异步恢复分类", slug: "async-cat" }],
    sites: sites.map((site) => ({
      id: site.id,
      title: site.title,
      url: site.url,
      description: "",
      categoryId: site.categoryId ?? "async-cat",
      tags: [],
    })),
    stats: { categoryCount: 1, siteCount: sites.length },
  };
}

function stagingFiles(): string[] {
  if (!existsSync(stagingDir)) return [];
  return readdirSync(stagingDir).filter((name) => name.endsWith(".json"));
}

describe("POST /api/backup/restore/async", () => {
  it("202 + jobId，且 staging 与 job 行都真的产生", async () => {
    const before = stagingFiles().length;
    const res = await app.inject({
      method: "POST",
      url: "/api/backup/restore/async",
      payload: backupPayload([
        { id: "a1", title: "异步站点一", url: "https://async-1.example.com" },
        { id: "a2", title: "异步站点二", url: "https://async-2.example.com" },
      ]),
    });
    expect(res.statusCode).toBe(202);
    const body = res.json() as Record<string, any>;
    expect(body.jobId).toBeTruthy();
    expect(body.accepted).toEqual({ categories: 1, sites: 2 });
    expect(body.statusUrl).toContain(body.jobId);

    // staging 文件确实写出来了（任务靠它读计划）
    expect(stagingFiles().length).toBe(before + 1);

    const jobs = await ctx.repo.raw("SELECT kind, status, payload FROM jobs WHERE id = ?", [body.jobId]);
    expect(jobs).toHaveLength(1);
    expect(String(jobs[0]!.kind)).toBe("backup_restore");
    expect(String(jobs[0]!.status)).toBe("pending");
    const payload = JSON.parse(String(jobs[0]!.payload));
    expect(String(payload.stagingPath)).toContain(stagingDir.replace(/\\/g, "/").split("/").pop()!);

    // 入队必须留审计（否则「谁在什么时候提交了恢复」无从追溯）
    const audits = await ctx.repo.raw(
      "SELECT diff FROM audit_logs WHERE action = 'backup.restore_queued' ORDER BY created_at DESC LIMIT 1",
    );
    expect(audits).toHaveLength(1);
  });

  it("非法备份 400，且不留下 job 与 staging", async () => {
    const jobsBefore = await ctx.repo.raw("SELECT COUNT(*) AS c FROM jobs WHERE kind = 'backup_restore'");
    const stagingBefore = stagingFiles().length;

    const res = await app.inject({
      method: "POST",
      url: "/api/backup/restore/async",
      payload: { version: "0.9", categories: [], sites: [] },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as Record<string, unknown>).error).toBe("INVALID_BACKUP");

    const jobsAfter = await ctx.repo.raw("SELECT COUNT(*) AS c FROM jobs WHERE kind = 'backup_restore'");
    expect(Number(jobsAfter[0]!.c)).toBe(Number(jobsBefore[0]!.c));
    // 关键：坏包不能留下 staging（否则每次误传都积一份全量数据在磁盘上）
    expect(stagingFiles().length).toBe(stagingBefore);
  });

  it("条目超限 413", async () => {
    // 分类超限测试：2001 条分类体积小（远低于 4MB bodyLimit），精准触发 BACKUP_TOO_LARGE 业务守卫
    const categories = Array.from({ length: 2_001 }, (_, i) => ({
      id: `c${i}`,
      title: `分类${i}`,
      slug: `c${i}`,
    }));
    const res = await app.inject({
      method: "POST",
      url: "/api/backup/restore/async",
      payload: {
        version: "1.0",
        generator: "NavHub 2026 Sovereign Backup Engine",
        exportedAt: Date.now(),
        categories,
        sites: [],
        stats: { categoryCount: 2001, siteCount: 0 },
      },
    });
    expect(res.statusCode).toBe(413);
    expect((res.json() as Record<string, unknown>).error).toBe("BACKUP_TOO_LARGE");
  });
});

describe("GET /api/backup/restore/status/:jobId", () => {
  it("只认 backup_restore：其它 kind 一律 404", async () => {
    const otherId = await ctx.repo.enqueueJob("reindex", { vectors: false });
    const res = await app.inject({ method: "GET", url: `/api/backup/restore/status/${otherId}` });
    expect(res.statusCode).toBe(404);
  });

  it("不存在的 id 返回 404", async () => {
    const res = await app.inject({ method: "GET", url: "/api/backup/restore/status/nope" });
    expect(res.statusCode).toBe(404);
  });

  it("端到端：async → 任务跑完 → 站点入库、staging 删除、status 变 done", async () => {
    /**
     * 先清掉前面用例留下的 pending backup_restore：tick 按 created_at 先认领它们，
     * 本用例的 job 可能排在后面——不清的话断言会看到「别人的数据」。
     * （这也说明 `tick` 会一次处理多条待办，是预期行为，不是测试缺陷。）
     */
    await ctx.repo.run("DELETE FROM jobs WHERE kind = 'backup_restore'");

    const res = await app.inject({
      method: "POST",
      url: "/api/backup/restore/async",
      payload: backupPayload([
        { id: "e2e-a1", title: "端到端站点一", url: "https://async-e2e-1.example.com" },
        { id: "e2e-a2", title: "端到端站点二", url: "https://async-e2e-2.example.com" },
        { id: "e2e-a3", title: "端到端站点三", url: "https://async-e2e-3.example.com" },
      ]),
    });
    expect(res.statusCode).toBe(202);
    const jobId = (res.json() as Record<string, string>).jobId;

    // staging 文件名是随机 UUID，**不含 jobId**——必须从 payload 拿真实路径，
    // 否则「文件已删除」这类断言会恒真（假通过）。
    const jobRows = await ctx.repo.raw("SELECT payload FROM jobs WHERE id = ?", [jobId]);
    const stagingPath = String(
      JSON.parse(String(jobRows[0]!.payload)).stagingPath as string,
    );
    expect(existsSync(stagingPath)).toBe(true);

    const runner = new JobRunner(ctx, { enableCron: false });
    await runner.tick();

    const sites = await ctx.repo.raw(
      "SELECT COUNT(*) AS c FROM sites WHERE url LIKE 'https://async-e2e-%' AND deleted_at IS NULL",
    );
    expect(Number(sites[0]!.c)).toBe(3);

    // 成功后 staging 必须清掉，否则磁盘会随每次恢复增长
    expect(existsSync(stagingPath)).toBe(false);

    const statusRes = await app.inject({ method: "GET", url: `/api/backup/restore/status/${jobId}` });
    expect(statusRes.statusCode).toBe(200);
    const status = statusRes.json() as Record<string, any>;
    expect(status.status).toBe("done");
    expect(status.progress).toEqual({ done: 3, total: 3 });
    expect(status.finishedAt).toBeTruthy();
    expect(status.retryable).toBe(false);
  });

  /**
   * 残留 staging 的清理。
   *
   * 失败的恢复故意保留 staging（可复盘/可重跑），但如果不清理就是永久堆积：
   * 每份最多约 4MB。设计文档曾写「由 data_retention 清理」，而那个清理从未存在——
   * 这条用例锁住「提交时会顺手删掉 24 小时前的残留」这个真实机制。
   */
  it("提交异步恢复时清掉过期 staging，保留刚失败的（可能马上要重跑）", async () => {
    mkdirSync(stagingDir, { recursive: true });
    const stale = join(stagingDir, "stale-25h.json");
    const fresh = join(stagingDir, "fresh-1h.json");
    writeFileSync(stale, "{}", "utf8");
    writeFileSync(fresh, "{}", "utf8");
    const now = Date.now();
    utimesSync(stale, new Date(now - 25 * 3600_000), new Date(now - 25 * 3600_000));
    utimesSync(fresh, new Date(now - 3600_000), new Date(now - 3600_000));

    const res = await app.inject({
      method: "POST",
      url: "/api/backup/restore/async",
      payload: backupPayload([
        { id: "sweep-1", title: "清理用例站点", url: "https://sweep-1.example.com" },
      ]),
    });
    expect(res.statusCode).toBe(202);

    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    // 本次请求自己的 staging 必须还在（任务要读它）
    const jobId = (res.json() as Record<string, string>).jobId;
    const rows = await ctx.repo.raw("SELECT payload FROM jobs WHERE id = ?", [jobId]);
    const own = String(JSON.parse(String(rows[0]!.payload)).stagingPath as string);
    expect(existsSync(own)).toBe(true);
  });
});

/**
 * 并发、契约头、零增量、归一化一致性。
 *
 * 这一组都要求在「没有进行中任务」的干净状态下开始——每条用例自己先清场，
 * 否则上一条留下的 pending 任务会被并发守卫拦成 409，失败原因会变得莫名其妙。
 */
describe("异步恢复：并发守卫、契约头与零增量", () => {
  async function resetRestoreJobs(): Promise<void> {
    await ctx.repo.run("DELETE FROM jobs WHERE kind = 'backup_restore'");
  }

  /**
   * 端点带 `rateLimit: max 10 / 1min`（按 IP）。这一组用例的提交次数会超过 10 次，
   * 而所有 `app.inject` 默认共用 127.0.0.1 —— 于是会撞 429，失败原因看着像业务错。
   * 每个请求换一个来源 IP：限流本来就是按 IP 计数的，这样测到的仍是真实逻辑。
   */
  let ipSeq = 0;
  async function submit(sites: Array<{ id: string; title: string; url: string }>) {
    ipSeq += 1;
    return app.inject({
      method: "POST",
      url: "/api/backup/restore/async",
      remoteAddress: `10.9.0.${(ipSeq % 250) + 1}`,
      payload: backupPayload(sites),
    });
  }

  it("已有进行中的恢复 → 409，且不产生第二个任务", async () => {
    await resetRestoreJobs();
    const first = await submit([{ id: "c1", title: "并发一", url: "https://conflict-1.example.com" }]);
    expect(first.statusCode).toBe(202);
    const firstJobId = (first.json() as Record<string, any>).jobId;

    const second = await submit([{ id: "c2", title: "并发二", url: "https://conflict-2.example.com" }]);
    expect(second.statusCode).toBe(409);
    const body = second.json() as Record<string, any>;
    expect(body.error).toBe("CONFLICT_RESTORE_RUNNING");
    // 要把「正在跑的是谁」告诉调用方，否则只能干等
    expect(body.jobId).toBe(firstJobId);
    expect(String(body.statusUrl)).toContain(firstJobId);

    const count = await ctx.repo.raw("SELECT COUNT(*) AS c FROM jobs WHERE kind = 'backup_restore'");
    expect(Number(count[0]!.c)).toBe(1);
  });

  it("僵尸任务不算活跃：心跳超过 15 分钟不再阻塞新提交", async () => {
    await resetRestoreJobs();
    const staleAt = Date.now() - 20 * 60_000;
    await ctx.repo.run(
      "INSERT INTO jobs (id, kind, payload, status, attempts, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
      ["stale-running", "backup_restore", "{}", "running", 1, staleAt, staleAt],
    );

    const res = await submit([{ id: "z1", title: "僵尸放行", url: "https://stale-ok.example.com" }]);
    // 与 reapStaleJobs 同口径：15 分钟没心跳视为执行者已死，否则入口会被锁死
    expect(res.statusCode).toBe(202);
  });

  it("202 带 Location 与 Retry-After；status 未终态带、终态不带", async () => {
    await resetRestoreJobs();
    const res = await submit([{ id: "h1", title: "契约头", url: "https://headers-1.example.com" }]);
    expect(res.statusCode).toBe(202);
    const jobId = (res.json() as Record<string, any>).jobId;
    expect(String(res.headers.location)).toContain(jobId);
    expect(res.headers["retry-after"]).toBe("2");

    const pending = await app.inject({ method: "GET", url: `/api/backup/restore/status/${jobId}` });
    expect(pending.statusCode).toBe(200);
    expect(pending.headers["retry-after"]).toBe("2");
    expect((pending.json() as Record<string, any>).retryAfterMs).toBe(2000);

    await new JobRunner(ctx, { enableCron: false }).tick();
    const done = await app.inject({ method: "GET", url: `/api/backup/restore/status/${jobId}` });
    expect(done.headers["retry-after"]).toBeUndefined();
    expect((done.json() as Record<string, any>).retryAfterMs).toBeNull();
  });

  it("备份已全部存在 → 200 + nothingToDo，不建任务（不是 202 + 空任务）", async () => {
    await resetRestoreJobs();
    const payload = [{ id: "n1", title: "零增量", url: "https://nothing-1.example.com" }];
    const first = await submit(payload);
    expect(first.statusCode).toBe(202);
    await new JobRunner(ctx, { enableCron: false }).tick();

    const jobsBefore = await ctx.repo.raw("SELECT COUNT(*) AS c FROM jobs WHERE kind = 'backup_restore'");
    const again = await submit(payload);
    // RFC 9110 与通行实践：无事可做时应当 200，而不是 202 一个永远 0/0 的任务
    expect(again.statusCode).toBe(200);
    const body = again.json() as Record<string, any>;
    expect(body.nothingToDo).toBe(true);
    expect(body.jobId).toBeUndefined();

    const jobsAfter = await ctx.repo.raw("SELECT COUNT(*) AS c FROM jobs WHERE kind = 'backup_restore'");
    expect(Number(jobsAfter[0]!.c)).toBe(Number(jobsBefore[0]!.c));
  });

  it("URL 归一化与写入侧同口径：尾斜杠差异算重复，不算新站", async () => {
    await resetRestoreJobs();
    await submit([{ id: "s1", title: "归一化", url: "https://norm.example.com/x" }]);
    await new JobRunner(ctx, { enableCron: false }).tick();

    // 同一地址换个写法：过去 planRestore 与 findExistingSiteUrls 口径不同，
    // 会出现「预演当重复、写入当新站」或反之
    const res = await submit([{ id: "s2", title: "归一化加斜杠", url: "https://norm.example.com/x/" }]);
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, any>;
    expect(body.nothingToDo).toBe(true);
    expect(body.skipped.duplicateUrls).toBe(1);
  });

  it("取消后的任务：status 报 cancelled + retryable，且不再发 Retry-After", async () => {
    await resetRestoreJobs();
    const res = await submit([{ id: "x1", title: "取消用例", url: "https://cancel-1.example.com" }]);
    expect(res.statusCode).toBe(202);
    const jobId = (res.json() as Record<string, any>).jobId;

    await ctx.repo.cancelJob(jobId);
    const status = await app.inject({ method: "GET", url: `/api/backup/restore/status/${jobId}` });
    expect(status.statusCode).toBe(200);
    const body = status.json() as Record<string, any>;
    expect(body.status).toBe("cancelled");
    // 取消后应当允许重跑（retryJob 接受 cancelled），否则用户只能重新选文件
    expect(body.retryable).toBe(true);
    // 终态不再诱导轮询
    expect(status.headers["retry-after"]).toBeUndefined();
  });

  it("过期 staging 若仍被非终态任务引用，不会被清理", async () => {
    await resetRestoreJobs();
    mkdirSync(stagingDir, { recursive: true });
    const referenced = join(stagingDir, "referenced-old.json");
    writeFileSync(referenced, "{}", "utf8");
    const old = Date.now() - 30 * 3600_000;
    utimesSync(referenced, new Date(old), new Date(old));

    // 僵尸 running（超过 15 分钟心跳）：守卫会放行，但 staging 仍必须保护
    await ctx.repo.run(
      "INSERT INTO jobs (id, kind, payload, status, attempts, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
      [
        "protect-staging",
        "backup_restore",
        JSON.stringify({ stagingPath: referenced }),
        "running",
        1,
        old,
        old,
      ],
    );

    const res = await submit([{ id: "p1", title: "保护 staging", url: "https://protect-1.example.com" }]);
    expect(res.statusCode).toBe(202);

    // 文件被删的话，那个任务一旦被回收重跑就会「读不到 staging」永久失败，
    // 而状态接口仍说 retryable —— 用户会一直重试一直失败
    expect(existsSync(referenced)).toBe(true);
    rmSync(referenced, { force: true });
    await resetRestoreJobs();
  });
});
