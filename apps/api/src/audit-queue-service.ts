/**
 * 体检任务队列的服务端接线。
 *
 * 与同步体检的分工：
 *   - `POST /plugins/:slug/audit`（同步）：面板点一下就要数字，30 条样本、秒级返回，不落盘；
 *   - 本模块（异步）：一次最多 200 条、可被面板关掉/进程重启打断后续跑，
 *     给「批量净网」这类长任务用。URL 列表由调用方给定（调用方本来就知道包里有啥，
 *     服务端不必再读一遍清单，避免同一份 manifest 解析两次）。
 *
 * 单飞（single-flight）：同一实例同时只跑一个 worker，避免 N 个请求各起一个循环
 * 把出口带宽打满。多副本部署时每个实例各跑各的——任务文件在本地，不跨实例共享。
 */
import { resolve } from "node:path";
import {
  auditPageHealth,
  classifyProbeError,
  classifyProbeStatus,
  drainAuditJob,
  isTextualContentType,
  openAuditQueue,
  type AuditJobResult,
  type AuditQueue,
} from "@navhub/core";
import { guardedFetch, outboundProfile } from "@navhub/ai";

/** 异步任务探活沿用 probe profile：超时/体积/UA 只有一份定义（packages/ai/src/outbound.ts） */
const JOB_PROFILE = outboundProfile("probe");

let queuePromise: Promise<AuditQueue> | null = null;
let workerRunning = false;

export function auditQueuePath(): string {
  return resolve(process.env.NAVHUB_AUDIT_QUEUE_PATH || "data/audit-jobs.json");
}

export function getAuditQueue(): Promise<AuditQueue> {
  const existing = queuePromise;
  if (existing) return existing;
  const created = openAuditQueue(auditQueuePath());
  queuePromise = created;
  return created;
}

/** 一条 URL 的探活（判定全部走 core，内容层只判停放/软 404，与候选探活同口径） */
export async function probeOneForJob(url: string): Promise<AuditJobResult> {
  const started = Date.now();
  try {
    const res = await guardedFetch(url, {
      timeoutMs: JOB_PROFILE.timeoutMs,
      maxBytes: JOB_PROFILE.maxBytes,
      maxRedirects: JOB_PROFILE.maxRedirects,
      userAgent: JOB_PROFILE.userAgent,
    });
    const byStatus = classifyProbeStatus(res.status);
    if (byStatus) return { kind: byStatus.kind, ...(res.status ? { status: res.status } : {}) };

    if (res.body && isTextualContentType(res.contentType)) {
      const health = auditPageHealth(url, res.body, undefined, undefined, { truncated: res.truncated });
      if (health.status === "SUSPICIOUS_PARKED" || health.status === "SOFT_404") {
        return { kind: "parked", status: res.status };
      }
      // 截断时不下内容结论（与同步体检同一条纪律）
    }
    return { kind: "ok", status: res.status };
  } catch (err) {
    const outcome = classifyProbeError(err, {
      elapsedMs: Date.now() - started,
      timeoutMs: JOB_PROFILE.timeoutMs,
      url,
    });
    return { kind: outcome.kind };
  }
}

/**
 * 启动一次后台消费（单飞）。返回本次实际处理的任务 id 列表，便于测试断言。
 * 不抛错：任何单任务失败都写进任务记录，worker 继续消费下一个。
 */
export async function runAuditWorker(limit = 5): Promise<string[]> {
  if (workerRunning) return [];
  workerRunning = true;
  const processed: string[] = [];
  try {
    const queue = await getAuditQueue();
    for (let i = 0; i < limit; i++) {
      const job = await queue.claim();
      if (!job) break;
      processed.push(job.id);
      try {
        await drainAuditJob(queue, job, probeOneForJob, { batchSize: 10 });
      } catch (err) {
        await queue.fail(job.id, err instanceof Error ? err.message : String(err));
      }
    }
  } finally {
    workerRunning = false;
  }
  return processed;
}
