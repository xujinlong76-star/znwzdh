/**
 * 体检任务队列的契约测试（不触网）。
 *
 * 断点续跑是这里最贵的性质：一次体检最多 200 次外链请求，崩溃后重头再来
 * 既慢又对目标站不礼貌。测试用「注入的探针」把「已测过的 URL 不会被再测」
 * 这件事变成可断言的事实，而不是靠人工观察日志。
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { drainAuditJob, openAuditQueue, tallyKind, type AuditJobResult } from "../src/audit-queue.ts";

const dirs: string[] = [];

async function tempFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "audit-queue-test-"));
  dirs.push(dir);
  return join(dir, "jobs.json");
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function seqIds(): () => string {
  let n = 0;
  return () => `job-${++n}`;
}

describe("结论归类", () => {
  it("只有 ok/blocked/parked 各自计数，其余统一算 broken（待复检）", () => {
    expect(tallyKind("ok")).toBe("ok");
    expect(tallyKind("blocked")).toBe("blocked");
    expect(tallyKind("parked")).toBe("suspicious");
    expect(tallyKind("dead")).toBe("broken");
    expect(tallyKind("unverified")).toBe("broken");
    expect(tallyKind("server-error")).toBe("broken");
  });
});

describe("入队与领取", () => {
  it("入队后是 pending，claim 后变 running 且 attempt +1", async () => {
    const file = await tempFile();
    const queue = await openAuditQueue(file, { newId: seqIds(), now: () => 1_000 });
    const job = await queue.enqueue({ slug: "pack-a", urls: ["https://a.com", "https://b.com"] });
    expect(job.state).toBe("pending");
    expect(job.progress).toMatchObject({ cursor: 0, total: 2, ok: 0, broken: 0 });

    const claimed = await queue.claim();
    expect(claimed?.id).toBe("job-1");
    expect(claimed?.state).toBe("running");
    expect(claimed?.attempt).toBe(1);

    expect(await queue.claim()).toBeNull();
  });

  it("先入队的先领取（FIFO）", async () => {
    let t = 1;
    const file = await tempFile();
    const queue = await openAuditQueue(file, { newId: seqIds(), now: () => t++ });
    await queue.enqueue({ slug: "first", urls: ["https://a.com"] });
    await queue.enqueue({ slug: "second", urls: ["https://b.com"] });
    expect((await queue.claim())?.slug).toBe("first");
    expect((await queue.claim())?.slug).toBe("second");
  });

  it("URL 列表在入队时固定（后续改动入参不影响任务）", async () => {
    const file = await tempFile();
    const queue = await openAuditQueue(file, { newId: seqIds() });
    const urls = ["https://a.com"];
    const job = await queue.enqueue({ slug: "p", urls });
    urls.push("https://b.com");
    expect(job.urls).toEqual(["https://a.com"]);
  });
});

describe("断点续跑", () => {
  it("跑完的 URL 不会再被测一次（崩溃后从 cursor 继续）", async () => {
    const file = await tempFile();
    let now = 1_000;
    const queue = await openAuditQueue(file, { newId: seqIds(), now: () => now });
    const job = await queue.enqueue({ slug: "p", urls: ["https://a.com", "https://b.com", "https://c.com"] });
    const claimed = await queue.claim();
    expect(claimed).not.toBeNull();

    const probed: string[] = [];
    const probe = async (url: string): Promise<AuditJobResult> => {
      probed.push(url);
      return { kind: "ok", status: 200 };
    };

    // 第一次：只跑一条就「进程被杀」
    await drainAuditJob(queue, claimed!, probe, { batchSize: 1, shouldStop: () => probed.length >= 1 });
    expect(probed).toEqual(["https://a.com"]);
    expect(claimed!.progress.cursor).toBe(1);
    expect(claimed!.state).toBe("running");

    // 模拟重启：重新打开队列，僵死任务被视为 pending 后可继续
    now = 1_000 + 120_000;
    const reopened = await openAuditQueue(file, { now: () => now });
    const revived = await reopened.recoverStale(60_000);
    expect(revived).toEqual(["job-1"]);

    const resumed = await reopened.claim();
    expect(resumed?.progress.cursor).toBe(1);
    await drainAuditJob(reopened, resumed!, probe, { batchSize: 10 });

    // 只补测了剩下两条，a.com 没有被重复请求
    expect(probed).toEqual(["https://a.com", "https://b.com", "https://c.com"]);
    expect(resumed?.state).toBe("done");
    expect(resumed?.progress).toMatchObject({ cursor: 3, ok: 3, broken: 0 });
  });

  it("中途保存的进度能被重新打开读到（落盘真实生效）", async () => {
    const file = await tempFile();
    const queue = await openAuditQueue(file, { newId: seqIds(), now: () => 5 });
    const job = await queue.enqueue({ slug: "p", urls: ["https://a.com", "https://b.com"] });
    const claimed = await queue.claim();
    await drainAuditJob(queue, claimed!, async () => ({ kind: "dead", status: 404 }), {
      batchSize: 1,
      shouldStop: () => claimed!.progress.cursor >= 1,
    });

    const reopened = await openAuditQueue(file, { now: () => 6 });
    const persisted = await reopened.get(job.id);
    expect(persisted?.progress.cursor).toBe(1);
    expect(persisted?.results[0]).toEqual({ kind: "dead", status: 404 });
  });

  it("未超时的 running 任务不会被回收（避免抢跑正在运行的任务）", async () => {
    let now = 1_000;
    const file = await tempFile();
    const queue = await openAuditQueue(file, { newId: seqIds(), now: () => now });
    await queue.enqueue({ slug: "p", urls: ["https://a.com"] });
    await queue.claim();
    now = 1_000 + 10_000;
    expect(await queue.recoverStale(60_000)).toEqual([]);
    expect(await queue.claim()).toBeNull();
  });
});

describe("失败与容量", () => {
  it("fail 记录错误且状态为 failed（错误文案截断到 300 字）", async () => {
    const file = await tempFile();
    const queue = await openAuditQueue(file, { newId: seqIds() });
    const job = await queue.enqueue({ slug: "p", urls: ["https://a.com"] });
    const failed = await queue.fail(job.id, "x".repeat(400));
    expect(failed?.state).toBe("failed");
    expect(failed?.error?.length).toBe(300);
  });

  it("超过 maxJobs 时优先淘汰最旧的已完成任务，待跑的不会被丢", async () => {
    let t = 1;
    const file = await tempFile();
    const queue = await openAuditQueue(file, { newId: seqIds(), now: () => t++, maxJobs: 2 });
    const first = await queue.enqueue({ slug: "a", urls: [] });
    await queue.fail(first.id, "boom");
    await queue.enqueue({ slug: "b", urls: [] });
    await queue.enqueue({ slug: "c", urls: [] });
    const left = await queue.list();
    expect(left).toHaveLength(2);
    expect(left.map((j) => j.slug).sort()).toEqual(["b", "c"]);
  });

  it("文件损坏时当空队列，不抛错", async () => {
    const file = await tempFile();
    await writeFile(file, "not json at all", "utf8");
    const queue = await openAuditQueue(file);
    expect(await queue.list()).toEqual([]);
  });

  it("落盘不残留临时文件", async () => {
    const file = await tempFile();
    const queue = await openAuditQueue(file, { newId: seqIds() });
    await queue.enqueue({ slug: "p", urls: ["https://a.com"] });
    const names = await readdir(join(file, ".."));
    expect(names.filter((n) => n.endsWith(".tmp"))).toEqual([]);
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ version: 1 });
  });
});

describe("幂等提交", () => {
  it("同一批 URL 重复提交只排一个任务（重复的返回原任务并标 deduplicated）", async () => {
    const file = await tempFile();
    const queue = await openAuditQueue(file, { newId: seqIds() });
    const first = await queue.enqueue({ slug: "p", urls: ["https://a.com", "https://b.com"] });
    const again = await queue.enqueue({ slug: "p", urls: ["https://b.com", "https://a.com"] });
    expect(again.id).toBe(first.id);
    expect(again.deduplicated).toBe(true);
    expect(await queue.list()).toHaveLength(1);
  });

  it("URL 集合不同（或 slug 不同）就不算重复", async () => {
    const file = await tempFile();
    const queue = await openAuditQueue(file, { newId: seqIds() });
    await queue.enqueue({ slug: "p", urls: ["https://a.com"] });
    const other = await queue.enqueue({ slug: "p", urls: ["https://a.com", "https://c.com"] });
    const otherSlug = await queue.enqueue({ slug: "q", urls: ["https://a.com"] });
    expect(other.deduplicated).toBeUndefined();
    expect(otherSlug.deduplicated).toBeUndefined();
    expect(await queue.list()).toHaveLength(3);
  });

  it("任务完成后再提交同样的批次会重新排队（重跑是有意的）", async () => {
    const file = await tempFile();
    const queue = await openAuditQueue(file, { newId: seqIds() });
    const first = await queue.enqueue({ slug: "p", urls: ["https://a.com"] });
    const claimed = await queue.claim();
    await drainAuditJob(queue, claimed!, async () => ({ kind: "ok", status: 200 }), { batchSize: 5 });
    expect((await queue.get(first.id))?.state).toBe("done");

    const rerun = await queue.enqueue({ slug: "p", urls: ["https://a.com"] });
    expect(rerun.id).not.toBe(first.id);
    expect(rerun.deduplicated).toBeUndefined();
  });
});
