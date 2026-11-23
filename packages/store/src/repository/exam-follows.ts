import type { Repository } from "../repository.ts";
import { randomUUID } from "node:crypto";
import type { ExamFollowRecord } from "./records.ts";
import { parseExamChecked, rowToExamFollow, serializeExamChecked } from "./dialect.ts";

/**
 * 考试关注同步（U-379）：与追剧清单同步同一套协议 —— 批量 ops + 版本游标 + 墓碑软删。
 *
 * 约定（与 watchlist.ts 保持一致，不另造口径）：
 * - `updated_at` 既是「最后修改时间」也是同步水位（version），任何写路径都必须刷新它。
 * - 取消关注写 `deleted_at` 墓碑而非物理删除，增量拉取（listExamFollowsSince）**包含**墓碑，
 *   读列表（listExamFollows）过滤墓碑。
 * - 一场考试一行，按 (user_id, exam_id) 唯一；勾选节点以 JSON 数组存在 checked_json。
 *
 * 冲突口径（行级 LWW，与收藏/追剧同级）：op 的 `at` 不大于存量 updated_at 就整行跳过，
 * 新勾选不能盖掉更新的勾选。两端同时勾选同一场考试时，后到的那次编辑获胜——
 * 另一端下次拉取即收敛到同一组勾选（不静默丢整场关注，只以时间戳决胜负）。
 * 取消关注与重新关注同样走行级 LWW：旧的取消关注到得晚，不会复活已重新关注的行。
 */

export type ExamFollowOp = {
  op: "follow" | "check" | "unfollow";
  examId: string;
  /** follow/check 时的全量勾选组（调用方发本地整组，不发增量差分） */
  checked?: string[];
  /** 关注创建时间（follow 时由客户端带上，让多端汇合时 created_at 一致） */
  createdAt?: number;
  /** 客户端事件时间戳；缺省为服务端 now。用于 LWW 冲突判定 */
  at?: number;
};

export interface ExamFollowSyncSlice {
  items: ExamFollowRecord[];
  version: number;
}

export async function listExamFollows(repo: Repository, userId: string): Promise<ExamFollowRecord[]> {
  const rows = await repo.raw(
    "SELECT * FROM exam_follows WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at ASC",
    [userId],
  );
  return rows.map(rowToExamFollow);
}

/** 增量拉取：updated_at > since 的行（含墓碑），version 为当前水位 */
export async function listExamFollowsSince(
  repo: Repository,
  userId: string,
  since: number,
): Promise<ExamFollowSyncSlice> {
  const rows = await repo.raw(
    "SELECT * FROM exam_follows WHERE user_id = ? AND updated_at > ? ORDER BY updated_at ASC",
    [userId, since],
  );
  const items = rows.map(rowToExamFollow);
  const version = await currentVersion(repo, userId, since);
  return { items, version };
}

/** 当前同步水位：MAX(updated_at)；空表 / 时钟回拨时退回 since，游标不后退 */
async function currentVersion(repo: Repository, userId: string, since: number): Promise<number> {
  const row = (await repo.raw(
    "SELECT MAX(updated_at) AS v FROM exam_follows WHERE user_id = ?",
    [userId],
  ))[0];
  const max = row?.v == null ? 0 : Number(row.v);
  return Math.max(Number.isFinite(max) ? max : 0, since);
}

/**
 * 批量应用客户端 ops（LWW），口径与 applyWatchOps 一致：
 * 逐条按 `at` 与该行 updated_at 比较，不大于存量就跳过；全部包在一个事务里。
 * follow = 全量覆盖语义（清墓碑 + 写勾选组）；check = 只改勾选组（无存量行或
 * 已取消关注时跳过——没关注的考试不接受勾选，与纯规则层 toggleNodeCheck 同口径）；
 * unfollow = 写墓碑（无存量行时也落一行墓碑，让「先取消关注后重新关注」的
 * 另一端能得知取消关注发生过）。
 */
export async function applyExamFollowOps(
  repo: Repository,
  userId: string,
  ops: ExamFollowOp[],
): Promise<{ applied: number; version: number }> {
  return repo.withTransaction(async () => {
    let applied = 0;
    for (const op of ops) {
      const at = typeof op.at === "number" && Number.isFinite(op.at) ? Math.trunc(op.at) : Date.now();
      const checked = op.checked !== undefined ? parseExamChecked(serializeExamChecked(op.checked)) : [];
      const row = (await repo.raw(
        "SELECT id, updated_at, deleted_at FROM exam_follows WHERE user_id = ? AND exam_id = ? LIMIT 1",
        [userId, op.examId],
      ))[0];
      if (row && at <= Number(row.updated_at ?? 0)) continue;

      if (!row) {
        if (op.op === "check") continue;
        const createdAt =
          typeof op.createdAt === "number" && Number.isFinite(op.createdAt) ? Math.trunc(op.createdAt) : at;
        await repo.run(
          `INSERT INTO exam_follows
             (id, user_id, exam_id, checked_json, created_at, updated_at, deleted_at)
           VALUES (?,?,?,?,?,?,?)`,
          [
            randomUUID(),
            userId,
            op.examId,
            op.op === "unfollow" ? "[]" : serializeExamChecked(checked),
            createdAt,
            at,
            op.op === "unfollow" ? at : null,
          ],
        );
        applied += 1;
        continue;
      }

      if (op.op === "unfollow") {
        await repo.run(
          "UPDATE exam_follows SET checked_json = '[]', deleted_at = ?, updated_at = ? WHERE user_id = ? AND exam_id = ?",
          [at, at, userId, op.examId],
        );
        applied += 1;
        continue;
      }

      if (op.op === "check" && row.deleted_at != null) continue;
      // follow 清墓碑并写勾选组；check 只改勾选组（不复活墓碑、不动 created_at）
      if (op.op === "follow") {
        await repo.run(
          "UPDATE exam_follows SET checked_json = ?, deleted_at = NULL, updated_at = ? WHERE user_id = ? AND exam_id = ?",
          [serializeExamChecked(checked), at, userId, op.examId],
        );
      } else {
        await repo.run(
          "UPDATE exam_follows SET checked_json = ?, updated_at = ? WHERE user_id = ? AND exam_id = ?",
          [serializeExamChecked(checked), at, userId, op.examId],
        );
      }
      applied += 1;
    }

    const version = await currentVersion(repo, userId, 0);
    return { applied, version };
  });
}

/** 清空云端考试关注（供数据管理域调用）；软删墓碑供其它端同步取消关注 */
export async function clearExamFollows(repo: Repository, userId: string): Promise<number> {
  const now = Date.now();
  return repo.runCount(
    "UPDATE exam_follows SET checked_json = '[]', deleted_at = ?, updated_at = ? WHERE user_id = ? AND deleted_at IS NULL",
    [now, now, userId],
  );
}
