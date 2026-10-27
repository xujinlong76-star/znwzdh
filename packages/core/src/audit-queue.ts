/**
 * 体检任务队列（持久化 + 断点续跑 + 崩溃恢复）。
 *
 * 解决的现实问题：`POST /plugins/:slug/audit` 在请求里同步跑最多 200 次外链探活，
 * 客户端一断开这次计算就白做；进程重启更是全部丢失。而体检恰恰是最该「跑完」的操作——
 * 它决定要不要把一批站点从清单里剔除。
 *
 * 设计取舍：
 *   - **文件日志而不是数据库表**：任务是有生命周期的短暂状态（分钟级），
 *     没必要为它引入 SQLite/PG 两套 DDL；文件 + 原子替换足够，且天然单机可读。
 *   - **URL 列表在入队时固定**：续跑必须面对同一批样本，否则「跑了一半」的结果不可比。
 *   - **逐批落盘**：worker 每处理 N 条 save 一次，崩溃后从 `progress.cursor` 继续，
 *     已测过的结果保存在 `results` 里，不会重复消耗对方的带宽。
 *   - **僵死回收**：`running` 但超过 stale 时限没更新（进程被杀/机器重启）→ 重置为 pending。
 */
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ProbeOutcomeKind } from "./probe-policy.ts";

export type AuditJobState = "pending" | "running" | "done" | "failed";

export interface AuditJobResult {
  kind: ProbeOutcomeKind;
  status?: number;
}

export interface AuditJobProgress {
  /** 已处理到的样本下标（= 已写入 results 的条数） */
  cursor: number;
  total: number;
  ok: number;
  blocked: number;
  suspicious: number;
  broken: number;
}

export interface AuditJob {
  id: string;
  slug: string;
  /** 入队时固定的抽样列表，保证续跑面对同一批样本 */
  urls: string[];
  state: AuditJobState;
  progress: AuditJobProgress;
  /** 与 urls 同序；未测的为 null */
  results: Array<AuditJobResult | null>;
  createdAt: number;
  updatedAt: number;
  attempt: number;
  error?: string;
}

export interface AuditQueueOptions {
  /** 最多保留多少个任务（超出按 createdAt 淘汰最旧的已完成任务） */
  maxJobs: number;
  now: () => number;
  /** ID 生成器（测试可注入确定性实现） */
  newId: () => string;
}

export interface AuditQueue {
  enqueue(input: { slug: string; urls: readonly string[] }): Promise<AuditJob>;
  /** 取一个待跑任务并置为 running；顺带回收僵死任务 */
  claim(staleMs?: number): Promise<AuditJob | null>;
  /** 保存进度（原子落盘） */
  save(job: AuditJob): Promise<AuditJob>;
  finish(id: string): Promise<AuditJob | null>;
  fail(id: string, error: string): Promise<AuditJob | null>;
  get(id: string): Promise<AuditJob | null>;
  list(): Promise<AuditJob[]>;
  /** 把僵死的 running 任务重置为 pending，返回被回收的 id */
  recoverStale(staleMs: number): Promise<string[]>;
}

interface QueueFile {
  version: 1;
  jobs: AuditJob[];
}

const DEFAULT_STALE_MS = 60_000;

function isQueueFile(value: unknown): value is QueueFile {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<QueueFile>;
  return v.version === 1 && Array.isArray(v.jobs);
}

function emptyProgress(total: number): AuditJobProgress {
  return { cursor: 0, total, ok: 0, blocked: 0, suspicious: 0, broken: 0 };
}

/** 结论 → 汇总计数（只有这四类进进度条，unverified/server-error 计入 broken 之外的「未测准」） */
export function tallyKind(kind: ProbeOutcomeKind): keyof Omit<AuditJobProgress, "cursor" | "total"> | null {
  switch (kind) {
    case "ok":
      return "ok";
    case "blocked":
      return "blocked";
    case "parked":
      return "suspicious";
    case "dead":
    case "server-error":
    case "unverified":
      // 三者都不计入「真健康」；server-error/unverified 与 dead 分开体现在 results 里，
      // 汇总层面统一算 broken（等复检），避免进度条把「没测准」显示成健康。
      return "broken";
    default:
      return null;
  }
}

export async function openAuditQueue(
  file: string,
  options: Partial<AuditQueueOptions> = {},
): Promise<AuditQueue> {
  const opts: AuditQueueOptions = {
    maxJobs: 50,
    now: () => Date.now(),
    newId: () => `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    ...options,
  };

  let jobs: AuditJob[] = [];
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    if (isQueueFile(parsed)) jobs = parsed.jobs;
  } catch {
    jobs = [];
  }

  async function persist(): Promise<void> {
    const payload: QueueFile = { version: 1, jobs };
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(payload), "utf8");
    try {
      await rename(tmp, file);
    } catch (err) {
      await unlink(tmp).catch(() => {});
      throw err;
    }
  }

  function evictIfNeeded(): void {
    if (jobs.length <= opts.maxJobs) return;
    const removable = jobs
      .filter((j) => j.state === "done" || j.state === "failed")
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const job of removable) {
      if (jobs.length <= opts.maxJobs) break;
      jobs = jobs.filter((j) => j.id !== job.id);
    }
  }

  const queue: AuditQueue = {
    async enqueue({ slug, urls }) {
      const job: AuditJob = {
        id: opts.newId(),
        slug,
        urls: [...urls],
        state: "pending",
        progress: emptyProgress(urls.length),
        results: urls.map(() => null),
        createdAt: opts.now(),
        updatedAt: opts.now(),
        attempt: 0,
      };
      jobs.unshift(job);
      evictIfNeeded();
      await persist();
      return job;
    },

    async claim(staleMs = DEFAULT_STALE_MS) {
      await queue.recoverStale(staleMs);
      const job = jobs.filter((j) => j.state === "pending").sort((a, b) => a.createdAt - b.createdAt)[0];
      if (!job) return null;
      job.state = "running";
      job.attempt += 1;
      job.updatedAt = opts.now();
      await persist();
      return job;
    },

    async save(job) {
      job.updatedAt = opts.now();
      const idx = jobs.findIndex((j) => j.id === job.id);
      if (idx >= 0) jobs[idx] = job;
      else jobs.unshift(job);
      await persist();
      return job;
    },

    async finish(id) {
      const job = jobs.find((j) => j.id === id);
      if (!job) return null;
      job.state = "done";
      job.updatedAt = opts.now();
      await persist();
      return job;
    },

    async fail(id, error) {
      const job = jobs.find((j) => j.id === id);
      if (!job) return null;
      job.state = "failed";
      job.error = error.slice(0, 300);
      job.updatedAt = opts.now();
      await persist();
      return job;
    },

    async get(id) {
      return jobs.find((j) => j.id === id) ?? null;
    },

    async list() {
      return [...jobs].sort((a, b) => b.createdAt - a.createdAt);
    },

    async recoverStale(staleMs = DEFAULT_STALE_MS) {
      const cutoff = opts.now() - staleMs;
      const revived: string[] = [];
      for (const job of jobs) {
        if (job.state === "running" && job.updatedAt < cutoff) {
          job.state = "pending";
          job.updatedAt = opts.now();
          revived.push(job.id);
        }
      }
      if (revived.length > 0) await persist();
      return revived;
    },
  };

  return queue;
}

/**
 * 跑一个任务直到完成（或本次批处理结束）。
 *
 * `probeOne` 由调用方注入（生产是 guardedFetch 包装，测试可注入假实现），
 * 这样队列本身不依赖网络，也就能在无网环境把「断点续跑」测干净。
 */
export async function drainAuditJob(
  queue: AuditQueue,
  job: AuditJob,
  probeOne: (url: string) => Promise<AuditJobResult>,
  options: { batchSize?: number; shouldStop?: () => boolean } = {},
): Promise<AuditJob> {
  const batchSize = Math.max(1, options.batchSize ?? 10);
  let processed = 0;

  while (job.progress.cursor < job.urls.length) {
    if (options.shouldStop?.()) break;
    const index = job.progress.cursor;
    const url = job.urls[index];
    if (!url) break;

    const result = await probeOne(url);
    job.results[index] = result;
    const bucket = tallyKind(result.kind);
    if (bucket) job.progress[bucket] += 1;
    job.progress.cursor = index + 1;
    processed += 1;

    // 逐批落盘：崩溃后最多重测 batchSize 条，而不是重头再来
    if (processed % batchSize === 0 || job.progress.cursor === job.urls.length) {
      await queue.save(job);
    }
  }

  if (job.progress.cursor >= job.urls.length) {
    return (await queue.finish(job.id)) ?? job;
  }
  await queue.save(job);
  return job;
}
