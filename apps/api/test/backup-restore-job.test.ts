/**
 * `backup_restore` 异步任务（2026-10-24 异步化改造的任务侧）。
 *
 * 为什么单独测任务、不测端点：端点还在等 `routes/backup.ts` 的并行改动让路，
 * 而任务逻辑（staging 读取 → 分片 → 进度 → 收尾）现在就能验证。
 * 任务与端点之间只有一条契约——**staging 文件的 JSON 形状**——测住它就够了。
 *
 * 四条硬约束：
 *   1. 正常路径：分类与站点都入库、staging 删掉、reindex 入队、进度到 total；
 *   2. staging 不在：**必须失败**，不能当成功（否则状态接口会谎报完成）；
 *   3. 站点缺 categoryId：失败且**一条都不写**（校验在建分类之前，不留半套数据）；
 *   4. 跨分片：2000/片，2100 条要跨两片，进度终值必须等于总数。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { JobRunner } from "../src/jobs.ts";

let dir: string;
let ctx: AppContext;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-restore-job-"));
  ctx = await createContext(
    loadConfig({
      mode: "lite",
      sqlitePath: join(dir, "job.db"),
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
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

interface StagedSite {
  url: string;
  title?: string;
  description?: string | null;
  categoryId?: string | null;
  tags?: string[];
  enabled?: boolean;
  createdAt?: number;
}

async function writeStaging(
  name: string,
  plan: { categories?: Array<{ id: string; title: string; description?: string | null; sort?: number }>; sites?: StagedSite[] },
): Promise<string> {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(plan), "utf8");
  return path;
}

async function runJob(stagingPath?: string): Promise<{ id: string; status: string; error: string | null }> {
  const id = await ctx.repo.enqueueJob(
    "backup_restore",
    stagingPath ? { stagingPath } : {},
  );
  const runner = new JobRunner(ctx, { enableCron: false });
  await runner.tick();
  const rows = await ctx.repo.raw(
    "SELECT status, error, progress_done AS done, progress_total AS total FROM jobs WHERE id = ?",
    [id],
  );
  const row = rows[0] ?? {};
  return {
    id,
    status: String(row.status ?? ""),
    error: row.error == null ? null : String(row.error),
  };
}

describe("backup_restore 任务", () => {
  it("正常路径：分类与站点入库、staging 删除、reindex 入队、进度到 total", async () => {
    await ctx.repo.run("DELETE FROM jobs WHERE kind IN ('backup_restore', 'reindex')");
    const stagingPath = await writeStaging("ok", {
      categories: [
        { id: "job-cat-1", title: "任务测试分类一" },
        { id: "job-cat-2", title: "任务测试分类二" },
      ],
      sites: [
        { url: "https://job-1.example.com", title: "任务站点一", categoryId: "job-cat-1", tags: ["批量"] },
        { url: "https://job-2.example.com", title: "任务站点二", categoryId: "job-cat-1" },
        { url: "https://job-3.example.com", title: "任务站点三", categoryId: "job-cat-2" },
        { url: "https://job-4.example.com", title: "任务站点四", categoryId: "job-cat-2" },
        { url: "https://job-5.example.com", title: "任务站点五", categoryId: "job-cat-2" },
      ],
    });

    const result = await runJob(stagingPath);
    expect(result.status).toBe("done");

    const sites = await ctx.repo.raw(
      "SELECT COUNT(*) AS c FROM sites WHERE url LIKE 'https://job-%' AND deleted_at IS NULL",
    );
    expect(Number(sites[0]!.c)).toBe(5);
    const cats = await ctx.repo.raw("SELECT COUNT(*) AS c FROM categories WHERE id LIKE 'job-cat-%'");
    expect(Number(cats[0]!.c)).toBe(2);

    // staging 成功后必须清掉（否则 staging 目录会随每次恢复增长）
    expect(existsSync(stagingPath)).toBe(false);

    // 语义索引补齐：恢复本身不建向量
    const reindex = await ctx.repo.raw("SELECT COUNT(*) AS c FROM jobs WHERE kind = 'reindex'");
    expect(Number(reindex[0]!.c)).toBe(1);

    // 进度：终值必须等于总数（不是 0/0，也不是部分值）
    const progress = await ctx.repo.raw(
      "SELECT progress_done AS done, progress_total AS total FROM jobs WHERE id = ?",
      [result.id],
    );
    expect(Number(progress[0]!.done)).toBe(5);
    expect(Number(progress[0]!.total)).toBe(5);
  });

  it("staging 文件不存在 → 任务失败，不能当成功", async () => {
    const result = await runJob(join(dir, "not-exist.json"));
    // 首次失败进入 retrying（还有重试机会），关键是**不是** completed
    expect(result.status).not.toBe("done");
    expect(result.error ?? "").toContain("staging");
  });

  it("站点缺 categoryId → 失败且一条都不写（校验在建分类之前）", async () => {
    await ctx.repo.run("DELETE FROM sites WHERE url LIKE 'https://job-bad-%'");
    const stagingPath = await writeStaging("bad", {
      categories: [{ id: "job-bad-cat", title: "不应被创建的分类" }],
      sites: [{ url: "https://job-bad-1.example.com", title: "缺分类", categoryId: null }],
    });

    const result = await runJob(stagingPath);
    expect(result.status).not.toBe("done");
    expect(result.error ?? "").toContain("categoryId");

    const sites = await ctx.repo.raw("SELECT COUNT(*) AS c FROM sites WHERE url LIKE 'https://job-bad-%'");
    expect(Number(sites[0]!.c)).toBe(0);
    // 分类也不该建：校验必须发生在任何写入之前
    const cats = await ctx.repo.raw("SELECT COUNT(*) AS c FROM categories WHERE id = 'job-bad-cat'");
    expect(Number(cats[0]!.c)).toBe(0);
    // 失败时 staging 保留，供重跑/复盘
    expect(existsSync(stagingPath)).toBe(true);
    rmSync(stagingPath, { force: true });
  });

  it("跨分片（2000/片）：2100 条全部写入，进度终值等于总数", async () => {
    await ctx.repo.run("DELETE FROM sites WHERE url LIKE 'https://job-chunk-%'");
    const sites = Array.from({ length: 2100 }, (_, i) => ({
      url: `https://job-chunk-${i}.example.com`,
      title: `分片站点 ${i}`,
      categoryId: "job-cat-1", // 复用第一个用例已建好的分类
    }));
    const stagingPath = await writeStaging("chunk", { categories: [], sites });

    const result = await runJob(stagingPath);
    expect(result.status).toBe("done");

    const count = await ctx.repo.raw(
      "SELECT COUNT(*) AS c FROM sites WHERE url LIKE 'https://job-chunk-%' AND deleted_at IS NULL",
    );
    expect(Number(count[0]!.c)).toBe(2100);

    const progress = await ctx.repo.raw(
      "SELECT progress_done AS done, progress_total AS total FROM jobs WHERE id = ?",
      [result.id],
    );
    expect(Number(progress[0]!.total)).toBe(2100);
    expect(Number(progress[0]!.done)).toBe(2100);
  });

  /**
   * 重试幂等：同一份计划被跑第二遍（模拟失败后 JobRunner 重试）。
   *
   * 这条覆盖两个**叠加**的缺陷，缺任何一个都会让「重试」变成灾难：
   *   1. 分类：`createCategory` 有同级同名检查，第二次直接抛错——于是带分类的
   *      备份在第一次失败后，剩下两次自动重试全部卡在第一步；
   *   2. 站点：`insertSitesBulk` 是裸 INSERT 且 `sites.url` 无唯一约束，
   *      不去重就会把已写入的分片再插一遍，静默产生重复行。
   */
  it("同一 staging 跑两遍：分类不撞名、站点不重复（重试幂等）", async () => {
    await ctx.repo.run("DELETE FROM sites WHERE url LIKE 'https://job-retry-%'");
    await ctx.repo.run("DELETE FROM categories WHERE id = 'job-retry-cat'");
    const plan = {
      categories: [{ id: "job-retry-cat", title: "重试幂等分类" }],
      sites: [
        { url: "https://job-retry-1.example.com", title: "重试一", categoryId: "job-retry-cat" },
        { url: "https://job-retry-2.example.com", title: "重试二", categoryId: "job-retry-cat" },
      ],
    };
    const stagingPath = await writeStaging("retry", plan);

    const first = await runJob(stagingPath);
    expect(first.status).toBe("done");

    // 模拟「失败重试」：任务成功会删 staging，重写回同一份计划再跑一次
    writeFileSync(stagingPath, JSON.stringify(plan), "utf8");
    const second = await runJob(stagingPath);
    expect(second.status).toBe("done");
    expect(second.error).toBeNull();

    const count = await ctx.repo.raw(
      "SELECT COUNT(*) AS c FROM sites WHERE url LIKE 'https://job-retry-%' AND deleted_at IS NULL",
    );
    // 关键断言：2 条，不是 4 条
    expect(Number(count[0]!.c)).toBe(2);
  });

  it("断点续跑：progress_done=2000 时只处理剩余 100 条（不从头重放）", async () => {
    await ctx.repo.run("DELETE FROM sites WHERE url LIKE 'https://job-resume-%'");
    const sites = Array.from({ length: 2100 }, (_, i) => ({
      url: `https://job-resume-${i}.example.com`,
      title: `续跑站点 ${i}`,
      categoryId: "job-cat-1",
    }));
    const stagingPath = await writeStaging("resume", { categories: [], sites });

    const id = await ctx.repo.enqueueJob("backup_restore", { stagingPath });
    // 预置「上一轮已处理 2000 条」（分片边界对齐），模拟被中断后重试
    await ctx.repo.run("UPDATE jobs SET progress_done = 2000 WHERE id = ?", [id]);

    const runner = new JobRunner(ctx, { enableCron: false });
    await runner.tick();

    const row = (await ctx.repo.raw("SELECT status, progress_done AS done FROM jobs WHERE id = ?", [id]))[0]!;
    expect(String(row.status)).toBe("done");
    expect(Number(row.done)).toBe(2100);

    const count = await ctx.repo.raw(
      "SELECT COUNT(*) AS c FROM sites WHERE url LIKE 'https://job-resume-%' AND deleted_at IS NULL",
    );
    // 前 2000 条被跳过（续跑），只写了最后 100 条。
    // 若续跑失效，这里会是 2100 —— 那正是「重试白跑一遍」的证据。
    expect(Number(count[0]!.c)).toBe(100);
  });

  /**
   * 取消：停在分片边界，不中断事务、不覆写终态。
   *
   * 两条性质同时被验证：
   *   1. 取消后**不再写新分片**（否则界面说已取消、库还在变，用户会立刻重新提交）；
   *   2. `completeJob` 的 CAS（`WHERE status='running'`）不会把 cancelled 改回 done——
   *      否则「取消」只是延迟生效的假动作。
   */
  it("取消后停在分片边界：不再写新分片、状态保持 cancelled、staging 保留", async () => {
    await ctx.repo.run("DELETE FROM sites WHERE url LIKE 'https://job-cancel-%'");
    // 清掉遗留的可认领任务：否则 tick 会先跑它们，我这条可能还没开始就被取消（测试变成看运气）
    await ctx.repo.run(
      "DELETE FROM jobs WHERE kind IN ('backup_restore', 'reindex') AND status IN ('pending', 'retrying')",
    );
    const sites = Array.from({ length: 3000 }, (_, i) => ({
      url: `https://job-cancel-${i}.example.com`,
      title: `取消站点 ${i}`,
      categoryId: "job-cat-1",
    }));
    const stagingPath = await writeStaging("cancel", { categories: [], sites });

    const id = await ctx.repo.enqueueJob("backup_restore", { stagingPath });
    const runner = new JobRunner(ctx, { enableCron: false });
    const running = runner.tick();

    /**
     * 等第一片写完（progress_done=2000）再取消。
     *
     * 为什么现在能确定性做到：任务在每片开头 `setImmediate` 让出事件循环，
     * 定时器（这里的轮询）先于 check 阶段执行，所以「片尾上报 → 轮询发现 → 取消 →
     * 下一片开头读到 cancelled」这个顺序是稳定的。
     * 没有那次让出时，同步驱动会把事件循环独占整片，轮询根本没机会跑。
     */
    const deadline = Date.now() + 60_000;
    let done = 0;
    while (Date.now() < deadline) {
      const row = (await ctx.repo.raw("SELECT progress_done FROM jobs WHERE id = ?", [id]))[0];
      done = Number(row?.progress_done ?? 0);
      if (done >= 2000) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(done).toBeGreaterThanOrEqual(2000);

    await ctx.repo.cancelJob(id);
    await running;

    const row = (
      await ctx.repo.raw("SELECT status, progress_done AS done FROM jobs WHERE id = ?", [id])
    )[0]!;
    // completeJob 的 CAS（WHERE status='running'）不会把它改回 done
    expect(String(row.status)).toBe("cancelled");

    const count = await ctx.repo.raw(
      "SELECT COUNT(*) AS c FROM sites WHERE url LIKE 'https://job-cancel-%' AND deleted_at IS NULL",
    );
    const written = Number(count[0]!.c);
    expect(written).toBeLessThan(3000); // 第三片没写
    expect(written).toBeGreaterThan(0); // 已提交的分片保留（取消不等于撤销）
    // staging 必须留着：retryJob 允许把 cancelled 重新排队，删了那次重试必然失败
    expect(existsSync(stagingPath)).toBe(true);
    rmSync(stagingPath, { force: true });
  });

  /**
   * 执行耗时的语义：只算 handler 本身，不含排队等待。
   *
   * 这条不是「性能测试」，而是锁口径——排查「哪个任务慢」时如果用的是
   * `updated_at - created_at`，一个在队列里躺了三分钟的任务会被误判成执行慢，
   * 于是去优化错的对象（本轮就因此绕了一大圈）。
   */
  it("记录本次执行耗时，且不含排队等待", async () => {
    const stagingPath = await writeStaging("duration", {
      categories: [],
      sites: [{ url: "https://job-duration-1.example.com", title: "耗时用例", categoryId: "job-cat-1" }],
    });
    const id = await ctx.repo.enqueueJob("backup_restore", { stagingPath });
    // 故意让它在队列里躺一会儿：这段等待不能算进 duration_ms
    await new Promise((resolve) => setTimeout(resolve, 300));

    await new JobRunner(ctx, { enableCron: false }).tick();

    const row = (
      await ctx.repo.raw(
        "SELECT status, duration_ms, created_at, updated_at FROM jobs WHERE id = ?",
        [id],
      )
    )[0]!;
    expect(String(row.status)).toBe("done");
    const duration = Number(row.duration_ms);
    const wall = Number(row.updated_at) - Number(row.created_at);
    expect(duration).toBeGreaterThan(0);
    expect(wall).toBeGreaterThanOrEqual(300); // 排队时间确实体现在 wall 上
    expect(duration).toBeLessThan(wall); // 而 duration 不含它
    expect(duration).toBeLessThan(300);
  });

  it("cancelJob 支持退避中的任务（否则用户只能干等重试窗口）", async () => {
    const id = await ctx.repo.enqueueJob("backup_restore", { stagingPath: join(dir, "none.json") });
    await ctx.repo.run("UPDATE jobs SET status = 'retrying' WHERE id = ?", [id]);
    await ctx.repo.cancelJob(id);
    const row = (await ctx.repo.raw("SELECT status FROM jobs WHERE id = ?", [id]))[0]!;
    expect(String(row.status)).toBe("cancelled");
  });
});
