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
