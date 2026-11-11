import type { Repository } from "../repository.ts";
import { randomUUID } from "node:crypto";
import type { WatchCadence, WatchEntryRecord } from "./records.ts";
import { parseWatchCadence, rowToWatchEntry, serializeWatchCadence } from "./dialect.ts";

/**
 * 追剧清单同步：与收藏同步（M1）同一套协议 —— 批量 ops + 版本游标 + 墓碑软删。
 *
 * 约定（与 favorites.ts 保持一致，不另造口径）：
 * - `updated_at` 既是「最后修改时间」也是同步水位（version），任何写路径都必须刷新它。
 * - 删除写 `deleted_at` 墓碑而非物理删除，增量拉取（listWatchSince）**包含**墓碑，
 *   读列表（listWatchEntries）过滤墓碑。
 * - 条目按 (user_id, drama_key) 唯一：drama_key 由客户端按
 *   `${platformSiteId}::${归一化剧名}` 生成，同一部剧在两台设备上各加一次会自然汇合。
 */

export type WatchOp = {
  op: "add" | "update" | "remove";
  key: string;
  title?: string;
  platformSiteId?: string;
  platformTitle?: string;
  playUrl?: string;
  icon?: string | null;
  episode?: number;
  priority?: "high" | "normal";
  cadence?: WatchCadence;
  remind?: boolean;
  dismissedOn?: string | null;
  lastProgressAt?: number;
  /** 条目创建时间（add 时由客户端带上，让多端汇合时 created_at 一致） */
  createdAt?: number;
  /** 客户端事件时间戳；缺省为服务端 now。用于 LWW 冲突判定 */
  at?: number;
};

export interface WatchSyncSlice {
  items: WatchEntryRecord[];
  version: number;
}

export async function listWatchEntries(repo: Repository, userId: string): Promise<WatchEntryRecord[]> {
  const rows = await repo.raw(
    "SELECT * FROM watch_entries WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC",
    [userId],
  );
  return rows.map(rowToWatchEntry);
}

/** 增量拉取：updated_at > since 的行（含墓碑），version 为当前水位 */
export async function listWatchSince(
  repo: Repository,
  userId: string,
  since: number,
): Promise<WatchSyncSlice> {
  const rows = await repo.raw(
    "SELECT * FROM watch_entries WHERE user_id = ? AND updated_at > ? ORDER BY updated_at ASC",
    [userId, since],
  );
  const items = rows.map(rowToWatchEntry);
  const version = await currentVersion(repo, userId, since);
  return { items, version };
}

/** 当前同步水位：MAX(updated_at)；空表 / 时钟回拨时退回 since，游标不后退 */
async function currentVersion(repo: Repository, userId: string, since: number): Promise<number> {
  const row = (await repo.raw(
    "SELECT MAX(updated_at) AS v FROM watch_entries WHERE user_id = ?",
    [userId],
  ))[0];
  const max = row?.v == null ? 0 : Number(row.v);
  return Math.max(Number.isFinite(max) ? max : 0, since);
}

function clampEpisode(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
  return Math.min(Math.max(n, 0), 100_000);
}

/**
 * 批量应用客户端 ops（LWW），口径与 applyFavoriteOps 一致：
 * 逐条按 `at` 与该行 updated_at 比较，不大于存量就跳过；全部包在一个事务里。
 * add = 全量覆盖语义（清墓碑 + 写全字段，没传的按默认/空）；update = 局部补丁
 * （只改传入字段）；remove = 写墓碑（无存量行时也落一行墓碑，让「先删后加」的
 * 另一端能得知删除发生过）。
 */
export async function applyWatchOps(
  repo: Repository,
  userId: string,
  ops: WatchOp[],
): Promise<{ applied: number; version: number }> {
  return repo.withTransaction(async () => {
    let applied = 0;
    for (const op of ops) {
      const at = typeof op.at === "number" && Number.isFinite(op.at) ? Math.trunc(op.at) : Date.now();
      const row = (await repo.raw(
        "SELECT id, updated_at, deleted_at FROM watch_entries WHERE user_id = ? AND drama_key = ? LIMIT 1",
        [userId, op.key],
      ))[0];
      if (row && at <= Number(row.updated_at ?? 0)) continue;

      if (!row) {
        if (op.op === "update") continue;
        const createdAt =
          typeof op.createdAt === "number" && Number.isFinite(op.createdAt) ? Math.trunc(op.createdAt) : at;
        await repo.run(
          `INSERT INTO watch_entries
             (id, user_id, drama_key, title, platform_site_id, platform_title, play_url, icon,
              episode, priority, cadence, remind, dismissed_on, last_progress_at,
              created_at, updated_at, deleted_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            randomUUID(),
            userId,
            op.key,
            op.op === "add" ? (op.title ?? "") : "",
            op.op === "add" ? (op.platformSiteId ?? "") : "",
            op.op === "add" ? (op.platformTitle ?? "") : "",
            op.op === "add" ? (op.playUrl ?? "") : "",
            op.op === "add" ? (op.icon ?? null) : null,
            op.op === "add" ? clampEpisode(op.episode) : 0,
            op.op === "add" && op.priority === "high" ? "high" : "normal",
            op.op === "add" ? serializeWatchCadence(op.cadence) : serializeWatchCadence(undefined),
            op.op === "add" && op.remind === false ? 0 : 1,
            op.op === "add" ? (op.dismissedOn ?? null) : null,
            op.op === "add" ? Math.trunc(op.lastProgressAt ?? createdAt) || createdAt : createdAt,
            createdAt,
            at,
            op.op === "remove" ? at : null,
          ],
        );
        applied += 1;
        continue;
      }

      if (op.op === "remove") {
        await repo.run(
          "UPDATE watch_entries SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND drama_key = ?",
          [at, at, userId, op.key],
        );
        applied += 1;
        continue;
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      if (op.op === "add") {
        // add 是"全量覆盖"语义：清墓碑并写全字段（没传就是默认/空）
        sets.push(
          "deleted_at = NULL",
          "title = ?",
          "platform_site_id = ?",
          "platform_title = ?",
          "play_url = ?",
          "icon = ?",
          "episode = ?",
          "priority = ?",
          "cadence = ?",
          "remind = ?",
          "dismissed_on = ?",
          "last_progress_at = ?",
        );
        params.push(
          op.title ?? "",
          op.platformSiteId ?? "",
          op.platformTitle ?? "",
          op.playUrl ?? "",
          op.icon ?? null,
          clampEpisode(op.episode),
          op.priority === "high" ? "high" : "normal",
          serializeWatchCadence(op.cadence),
          op.remind === false ? 0 : 1,
          op.dismissedOn ?? null,
          Math.trunc(op.lastProgressAt ?? at) || at,
        );
      } else {
        // update 是"局部补丁"语义：只改传入的字段，未传的保持原值
        if (op.title !== undefined) { sets.push("title = ?"); params.push(op.title); }
        if (op.platformSiteId !== undefined) { sets.push("platform_site_id = ?"); params.push(op.platformSiteId); }
        if (op.platformTitle !== undefined) { sets.push("platform_title = ?"); params.push(op.platformTitle); }
        if (op.playUrl !== undefined) { sets.push("play_url = ?"); params.push(op.playUrl); }
        if (op.icon !== undefined) { sets.push("icon = ?"); params.push(op.icon); }
        if (op.episode !== undefined) { sets.push("episode = ?"); params.push(clampEpisode(op.episode)); }
        if (op.priority !== undefined) { sets.push("priority = ?"); params.push(op.priority === "high" ? "high" : "normal"); }
        if (op.cadence !== undefined) { sets.push("cadence = ?"); params.push(serializeWatchCadence(op.cadence)); }
        if (op.remind !== undefined) { sets.push("remind = ?"); params.push(op.remind === false ? 0 : 1); }
        if (op.dismissedOn !== undefined) { sets.push("dismissed_on = ?"); params.push(op.dismissedOn); }
        if (op.lastProgressAt !== undefined) { sets.push("last_progress_at = ?"); params.push(Math.trunc(op.lastProgressAt) || 0); }
        // 补丁顺带复活墓碑行没有意义：update 命中已删行时保持墓碑（与收藏口径一致，
        // 收藏的 update 同样不清 deleted_at —— 复活只能走 add 全量覆盖）
      }
      sets.push("updated_at = ?");
      params.push(at, userId, op.key);
      await repo.run(`UPDATE watch_entries SET ${sets.join(", ")} WHERE user_id = ? AND drama_key = ?`, params);
      applied += 1;
    }

    const version = await currentVersion(repo, userId, 0);
    return { applied, version };
  });
}

/** 清空云端追剧清单（供数据管理域调用）；软删墓碑供其它端同步删除 */
export async function clearWatchEntries(repo: Repository, userId: string): Promise<number> {
  const now = Date.now();
  return repo.runCount(
    "UPDATE watch_entries SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND deleted_at IS NULL",
    [now, now, userId],
  );
}

export { parseWatchCadence };
