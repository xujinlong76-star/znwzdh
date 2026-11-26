/**
 * 语义通道向量冷启动补齐（U-369）。
 *
 * 问题：`reindex` 的 cron 是 `NOT_SCHEDULED`（jobs.ts），且从不在
 * `DEFAULT_CRON_SCHEDULES` 里——启用 embedding 或换模型后，已入库的站点
 * 永远拿不到新模型/维度的向量，语义通道对它们是空的；`index-site.ts`
 * 只在写站点时才编码，历史数据没有任何补齐入口。
 *
 * 本模块只做「缺失补齐」，不改 embedding 模型、不改索引逻辑：
 *  - 覆盖率：当前模型/维度下「在库总数 / 已有向量 / 缺失」三数全部现算
 *    （`repo.countSemanticVectorCoverage`，两条 COUNT，不读向量 BLOB）；
 *  - 触发：启动时（main.ts）与管理端手动（POST /api/admin/semantic-coverage/backfill）
 *    各调一次 `ensureSemanticVectorBackfill`；缺失 > 0 才入队，且只入队一条
 *    `reindex { vectors: true, missingVectorsOnly: true }`——缺失 id 在任务
 *    执行时现算、分页取，不塞进 payload；
 *  - 幂等：`enqueueJobIfAbsent` 按 kind 去重，同 kind 已有未跑完的任务时跳过；
 *    换模型后旧行不再匹配覆盖率口径，缺失数自然回到总数，下次触发即全量补齐。
 */
import type { AppContext } from "./context.ts";

export interface SemanticVectorCoverage {
  /** embedding 是否真的可用（配置已启用且服务已装配） */
  enabled: boolean;
  model: string;
  dim: number;
  /** 未删除站点总数 */
  total: number;
  /** 已有当前模型/维度向量的站点数 */
  withVector: number;
  /** 缺失当前模型/维度向量的站点数（现算，非硬编码） */
  missing: number;
}

export type SemanticBackfillReason =
  | "embedding-disabled"
  | "none-missing"
  | "reindex-already-queued"
  | "enqueued";

export interface SemanticBackfillResult extends SemanticVectorCoverage {
  enqueued: boolean;
  reason: SemanticBackfillReason;
  jobId: string | null;
}

const LIVE_JOB_STATUSES = ["pending", "running", "retrying", "cancelling"] as const;

/** 当前模型/维度下的向量覆盖率（embedding 关闭时也照算，只是不触发补齐）。 */
export async function getSemanticVectorCoverage(ctx: AppContext): Promise<SemanticVectorCoverage> {
  const { model, dim, enabled } = ctx.config.embedding;
  const counts = await ctx.repo.countSemanticVectorCoverage({ model, dim });
  return {
    enabled: enabled && ctx.embedding != null,
    model,
    dim,
    total: counts.total,
    withVector: counts.withVector,
    missing: counts.missing,
  };
}

/** 已入队（未跑完）的缺失向量补齐任务 id，没有则 null。 */
export async function findQueuedSemanticBackfillJob(ctx: AppContext): Promise<string | null> {
  for (const status of LIVE_JOB_STATUSES) {
    const jobs = await ctx.repo.listJobs(status, 10);
    for (const job of jobs) {
      if (job.kind !== "reindex") continue;
      const payload = job.payload as { missingVectorsOnly?: unknown } | null;
      if (payload && payload.missingVectorsOnly === true) return job.id;
    }
  }
  return null;
}

/**
 * 缺失向量自动补齐（仅补缺失）。
 *
 *  - embedding 未启用 → 不入队（`embedding-disabled`），不报错：关掉语义通道
 *    时补齐本身无意义，启动也不该因此失败；
 *  - 缺失为 0 → 不入队（`none-missing`）；
 *  - 已有未跑完的 reindex → 不重复入队（`reindex-already-queued`）；
 *  - 否则入队一条 missing-only reindex（`enqueued`，返回 jobId）。
 * 本函数只做「入队决策」，真正编码在 JobRunner 的 reindex 执行体里。
 */
export async function ensureSemanticVectorBackfill(ctx: AppContext): Promise<SemanticBackfillResult> {
  const coverage = await getSemanticVectorCoverage(ctx);
  if (!coverage.enabled) {
    return { ...coverage, enqueued: false, reason: "embedding-disabled", jobId: null };
  }
  if (coverage.missing === 0) {
    return { ...coverage, enqueued: false, reason: "none-missing", jobId: null };
  }
  const jobId = await ctx.repo.enqueueJobIfAbsent("reindex", { vectors: true, missingVectorsOnly: true });
  if (jobId === null) {
    return { ...coverage, enqueued: false, reason: "reindex-already-queued", jobId: null };
  }
  return { ...coverage, enqueued: true, reason: "enqueued", jobId };
}
