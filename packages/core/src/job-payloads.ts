/**
 * 每类任务的 payload 契约。
 *
 * 为什么需要一张按 kind 分派的 schema：
 * `RunJobInput.payload` 是 `Record<string, unknown>`，任何拼写错误都会被静默忽略
 * （例如把 `olderThanDays` 写成 `olderThan`，purge_trash 会按默认 30 天照常执行）。
 * 对只读巡检这没关系；对 data_retention / purge_trash / backup_restore 这类
 * **会真删数据或恢复数据**的任务，「参数没生效但任务显示成功」是最危险的失败形态。
 *
 * 设计边界：
 *  - 只做声明式校验，不在这里执行任何 I/O；
 *  - 未知字段直接拒绝（.strict()），因为拼错字段名就是要挡住的场景；
 *  - 枚举与 `apps/api/src/jobs.ts` 的 JobKind 必须一一对应，
 *    由 `apps/api/test/job-payload-schema.test.ts` 的奇偶校验钉住。
 */
import { z } from "zod";

const SiteId = z.string().min(1).max(200);

export const JobPayloadSchemas = {
  health_check: z
    .object({
      siteId: SiteId.optional(),
      limit: z.number().int().min(1).max(5000).optional(),
    })
    .strict(),

  refetch_metadata: z
    .object({
      siteId: SiteId,
      llm: z.boolean().optional(),
    })
    .strict(),

  recompute_rank: z.object({}).strict(),

  reindex: z
    .object({
      siteId: SiteId.optional(),
      siteIds: z.array(SiteId).min(1).max(5000).optional(),
      targets: z.array(z.enum(["sites", "plugins"])).min(1).optional(),
      vectors: z.boolean().optional(),
    })
    .strict(),

  site_self_healing: z
    .object({
      siteId: SiteId,
    })
    .strict(),

  token_audit: z
    .object({
      expiringDays: z.number().int().min(1).max(365).optional(),
      dormantDays: z.number().int().min(1).max(3650).optional(),
    })
    .strict(),

  purge_trash: z
    .object({
      olderThanDays: z.number().int().min(1).max(3650).optional(),
    })
    .strict(),

  taxonomy_audit: z
    .object({
      dryRun: z.boolean().optional(),
      siteLimit: z.number().int().min(1).max(20_000).optional(),
    })
    .strict(),

  data_retention: z
    .object({
      mode: z.enum(["cleanup", "rollup"]).optional(),
      apply: z.boolean().optional(),
      maxDays: z.number().int().min(1).max(3650).optional(),
      maxGroups: z.number().int().min(1).max(1_000_000).optional(),
      maxScan: z.number().int().min(1).max(10_000_000).optional(),
      telemetryDays: z.number().int().min(1).max(3650).optional(),
    })
    .strict(),

  plugin_governance: z.object({}).strict(),

  user_data_audit: z.object({}).strict(),

  backup_restore: z
    .object({
      stagingPath: z.string().min(1).max(4096),
    })
    .strict(),
} as const;

export type JobPayloadKind = keyof typeof JobPayloadSchemas;

export const JOB_PAYLOAD_KINDS = Object.keys(JobPayloadSchemas) as JobPayloadKind[];

export type JobPayloadValidation =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; issues: z.ZodIssue[] };

/**
 * 校验并归一化入队参数。
 *
 * 返回归一化后的对象而不是原始输入：可选字段缺省时不出现在 payload 里，
 * 任务的默认值逻辑（`payload.limit ?? 50` 等）因此保持唯一来源。
 */
export function validateJobPayload(
  kind: string,
  payload: Record<string, unknown> | undefined,
): JobPayloadValidation {
  const schema = (JobPayloadSchemas as Record<string, z.ZodType>)[kind];
  if (!schema) {
    return {
      ok: false,
      issues: [
        {
          code: "custom",
          path: ["kind"],
          message: `未知任务类型: ${kind}`,
        } as z.ZodIssue,
      ],
    };
  }
  const parsed = schema.safeParse(payload ?? {});
  if (!parsed.success) return { ok: false, issues: parsed.error.issues };
  return { ok: true, payload: parsed.data as Record<string, unknown> };
}
