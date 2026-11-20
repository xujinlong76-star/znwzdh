/**
 * 投稿收录汇报（提交后网址收录情况）。
 *
 * 审核通过/未通过都写一条「状态 + 原因说明」，反馈目录按投稿人展示。
 * 每次审核覆盖写（site_id 一行）：复审（先拒后过）后最新结果即汇报内容，
 * 与通知流「每次审核各发一条」的语义区分——汇报要的是当前真相，不是历史流水。
 */
import type { Repository } from "../repository.ts";

export interface SubmissionReviewRecord {
  siteId: string;
  reviewStatus: "approved" | "rejected";
  /** 面向投稿人的原因说明（AI 生成；通过=亮点与收录理由，未通过=改进建议） */
  reason: string;
  /** 管理员原始备注（可空；reason 的生成素材之一） */
  reviewerNote: string | null;
  reviewedAt: number;
}

export interface SubmissionFeedbackItem {
  siteId: string;
  title: string;
  url: string;
  /** 提交时间（站点创建时间） */
  submittedAt: number;
  /** 汇报状态：审核中（无 review 记录）/ 已通过 / 未通过 */
  status: "pending" | "approved" | "rejected";
  /** 原因说明：审核中为空串 */
  reason: string;
  /** 审核时间：审核中为 null */
  reviewedAt: number | null;
}

/** 写入/覆盖一条审核汇报（审核 PATCH 事务内调用） */
export async function recordSubmissionReview(
  repo: Repository,
  input: { siteId: string; reviewStatus: "approved" | "rejected"; reason: string; reviewerNote?: string | null },
): Promise<void> {
  const now = Date.now();
  await repo.run(
    `INSERT INTO submission_reviews (site_id, review_status, reason, reviewer_note, reviewed_at, created_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT (site_id) DO UPDATE SET
       review_status = excluded.review_status,
       reason = excluded.reason,
       reviewer_note = excluded.reviewer_note,
       reviewed_at = excluded.reviewed_at`,
    [input.siteId, input.reviewStatus, input.reason, input.reviewerNote ?? null, now, now],
  );
}

/**
 * 按投稿人查收录汇报列表（反馈目录数据源）。
 *
 * 只回本人投稿（submission_owners 归属）；站点被物理删除时（外键 CASCADE）
 * 汇报随之消失——投稿都没了，汇报也就没有可指的对象。
 * order：先「审核中」后「已审」，各自按提交时间倒序（最新提交/最新汇报在前）。
 */
export async function listSubmissionFeedback(
  repo: Repository,
  identity: string,
  limit = 100,
): Promise<SubmissionFeedbackItem[]> {
  const capped = Math.max(1, Math.min(200, Math.trunc(limit)));
  const rows = await repo.raw(
    `SELECT s.id AS site_id, s.title AS title, s.url AS url, s.created_at AS submitted_at,
            r.review_status AS review_status, r.reason AS reason, r.reviewed_at AS reviewed_at
       FROM submission_owners o
       JOIN sites s ON s.id = o.site_id
       LEFT JOIN submission_reviews r ON r.site_id = s.id
      WHERE o.identity = ?
      ORDER BY
        CASE WHEN r.review_status IS NULL THEN 0 ELSE 1 END,
        s.created_at DESC
      LIMIT ?`,
    [identity, capped],
  );
  return rows.map((row: Record<string, unknown>) => ({
    siteId: String(row.site_id),
    title: String(row.title ?? ""),
    url: String(row.url ?? ""),
    submittedAt: Number(row.submitted_at ?? 0),
    status: row.review_status === "approved" ? "approved" : row.review_status === "rejected" ? "rejected" : "pending",
    reason: String(row.reason ?? ""),
    reviewedAt: row.reviewed_at == null ? null : Number(row.reviewed_at),
  }));
}
