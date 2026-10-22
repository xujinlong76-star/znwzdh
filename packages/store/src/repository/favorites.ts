import type { Repository } from "../repository.ts";
import { randomUUID } from "node:crypto";
import {
  buildFtsTokens,
  canonicalizeUrl,
  getEnhancedSiteData,
  pinyinTraits,
  type Category,
  type Collection,
  type Site,
  type SiteAction,
  type SiteLiveMetrics,
  type SiteRelation,
  type SiteStatus,
} from "@navhub/core";
import type {
  ApiTokenRecord,
  AuditLogRecord,
  CategoryDistributionItem,
  DashboardOverview,
  FavoriteFolderRecord,
  FavoriteRecord,
  JobRecord,
  MaintenanceStatus,
  SecurityOverview,
  SiteInput,
  TagWithCount,
  UserProfileRecord,
  UserRecord,
  UserVaultRecord,
} from "./records.ts";
import {
  bindSqlite,
  buildIndexFields,
  normalizeTokenScopes,
  packMetadata,
  rowToApiToken,
  rowToAuditLog,
  rowToCategory,
  rowToCollection,
  rowToFavorite,
  rowToFolder,
  rowToJob,
  rowToProfile,
  rowToSite,
  rowToUser,
  slugify,
  toPgSql,
} from "./dialect.ts";
import type { Db } from "../driver.ts";

/**
 * 收藏同步（M1）：批量 ops + 版本游标 + 墓碑软删。
 *
 * 约定：
 * - `updated_at` 既是「最后修改时间」也是同步水位（version）。任何写路径都必须刷新它，
 *   否则增量拉取会漏事件。
 * - 删除写 `deleted_at` 墓碑而非物理删除：物理删除在增量同步里没有痕迹，
 *   另一端永远不知道这条收藏被删了。
 * - 读列表（listFavorites）过滤墓碑；增量拉取（listFavoritesSince）**包含**墓碑。
 */

export type FavoriteOp = {
  op: "add" | "update" | "remove";
  siteId: string;
  folderId?: string | null;
  note?: string | null;
  /** 客户端事件时间戳；缺省为服务端 now。用于 LWW 冲突判定 */
  at?: number;
};

export interface FavoriteSyncSlice {
  items: FavoriteRecord[];
  version: number;
}

export async function listFavorites(repo: Repository, userId: string): Promise<FavoriteRecord[]> {
  const rows = await repo.raw(
    "SELECT * FROM favorites WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC",
    [userId],
  );
  return rows.map(rowToFavorite);
}

export async function addFavorite(repo: Repository, input: { userId: string; siteId: string; folderId?: string | null; note?: string | null }): Promise<{ favorite: FavoriteRecord; existed: boolean }> {
  const id = randomUUID();
  const now = Date.now();
  // 幂等写入：并发双写靠 UNIQUE(user_id, site_id) 兜底，不再「先查后插」——
  // 先查后插在双写竞态下会撞唯一索引抛 500（本可返回 existed:true）。
  const changes = await repo.runCount(
    "INSERT INTO favorites (id, user_id, site_id, folder_id, note, created_at, updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id, site_id) DO NOTHING",
    [id, input.userId, input.siteId, input.folderId ?? null, input.note ?? null, now, now],
  );
  let row = (await repo.raw(
    "SELECT * FROM favorites WHERE user_id = ? AND site_id = ? LIMIT 1",
    [input.userId, input.siteId],
  ))[0];
  if (!row) throw new Error("创建收藏后无法读回");
  // 复活：唯一键上可能是一条墓碑。DO NOTHING 会把它当"已存在"直接返回，
  // 于是用户重新收藏后列表里依然看不到 —— 必须显式清墓碑并覆盖字段。
  if (row.deleted_at != null) {
    await repo.run(
      "UPDATE favorites SET deleted_at = NULL, folder_id = ?, note = ?, updated_at = ? WHERE user_id = ? AND site_id = ?",
      [input.folderId ?? null, input.note ?? null, now, input.userId, input.siteId],
    );
    row = (await repo.raw(
      "SELECT * FROM favorites WHERE user_id = ? AND site_id = ? LIMIT 1",
      [input.userId, input.siteId],
    ))[0];
    if (!row) throw new Error("复活收藏后无法读回");
    return { favorite: rowToFavorite(row), existed: false };
  }
  return { favorite: rowToFavorite(row), existed: changes === 0 };
}

export async function removeFavorite(repo: Repository, userId: string, siteId: string): Promise<boolean> {
  const now = Date.now();
  // 软删：保留 id/site_id 作为墓碑，供增量同步把「删除」传播到其它端。
  const changes = await repo.runCount(
    "UPDATE favorites SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND site_id = ? AND deleted_at IS NULL",
    [now, now, userId, siteId],
  );
  return changes > 0;
}

/** 增量拉取：updated_at > since 的行（含墓碑），version 为当前水位 */
export async function listFavoritesSince(
  repo: Repository,
  userId: string,
  since: number,
): Promise<FavoriteSyncSlice> {
  const rows = await repo.raw(
    "SELECT * FROM favorites WHERE user_id = ? AND updated_at > ? ORDER BY updated_at ASC",
    [userId, since],
  );
  const items = rows.map(rowToFavorite);
  const version = await currentVersion(repo, userId, since);
  return { items, version };
}

/** 当前同步水位：MAX(updated_at)；空表 / 时钟回拨时退回 since，游标不后退 */
async function currentVersion(repo: Repository, userId: string, since: number): Promise<number> {
  const row = (await repo.raw(
    "SELECT MAX(updated_at) AS v FROM favorites WHERE user_id = ?",
    [userId],
  ))[0];
  const max = row?.v == null ? 0 : Number(row.v);
  return Math.max(Number.isFinite(max) ? max : 0, since);
}

/**
 * 批量应用客户端 ops（LWW）。
 *
 * 逐条按 `at` 与该行 updated_at 比较：不大于存量就跳过（旧事件不能覆盖新状态）。
 * 全部包在一个事务里：批量同步要么整体生效，要么整体回滚，避免客户端重放时
 * 看到「一半已应用、水位却已推进」的中间态。
 */
export async function applyFavoriteOps(
  repo: Repository,
  userId: string,
  ops: FavoriteOp[],
): Promise<{ applied: number; version: number }> {
  return repo.withTransaction(async () => {
    let applied = 0;
    for (const op of ops) {
      const at = typeof op.at === "number" && Number.isFinite(op.at) ? Math.trunc(op.at) : Date.now();
      const row = (await repo.raw(
        "SELECT id, updated_at, deleted_at FROM favorites WHERE user_id = ? AND site_id = ? LIMIT 1",
        [userId, op.siteId],
      ))[0];
      if (row && at <= Number(row.updated_at ?? 0)) continue;

      if (!row) {
        // update 无事可做；add/remove 都需要落一行（remove 落墓碑，
        // 否则「先删后加」的另一端无法得知删除发生过）。
        if (op.op === "update") continue;
        await repo.run(
          "INSERT INTO favorites (id, user_id, site_id, folder_id, note, created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,?,?,?)",
          [
            randomUUID(),
            userId,
            op.siteId,
            op.op === "add" ? op.folderId ?? null : null,
            op.op === "add" ? op.note ?? null : null,
            at,
            at,
            op.op === "remove" ? at : null,
          ],
        );
        applied += 1;
        continue;
      }

      if (op.op === "remove") {
        await repo.run(
          "UPDATE favorites SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND site_id = ?",
          [at, at, userId, op.siteId],
        );
        applied += 1;
        continue;
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      if (op.op === "add") {
        // add 是"全量覆盖"语义：清墓碑并写全字段（没传就是 null）
        sets.push("deleted_at = NULL", "folder_id = ?", "note = ?");
        params.push(op.folderId ?? null, op.note ?? null);
      } else {
        // update 是"局部补丁"语义：只改传入的字段，未传的保持原值
        if (op.folderId !== undefined) {
          sets.push("folder_id = ?");
          params.push(op.folderId);
        }
        if (op.note !== undefined) {
          sets.push("note = ?");
          params.push(op.note);
        }
      }
      sets.push("updated_at = ?");
      params.push(at, userId, op.siteId);
      await repo.run(`UPDATE favorites SET ${sets.join(", ")} WHERE user_id = ? AND site_id = ?`, params);
      applied += 1;
    }

    const version = await currentVersion(repo, userId, 0);
    return { applied, version };
  });
}


export async function listFavoriteFolders(repo: Repository, userId: string): Promise<FavoriteFolderRecord[]> {
  const rows = await repo.raw(
    "SELECT * FROM favorite_folders WHERE user_id = ? ORDER BY sort ASC, created_at ASC",
    [userId],
  );
  return rows.map(rowToFolder);
}

export async function createFavoriteFolder(repo: Repository, userId: string, name: string): Promise<FavoriteFolderRecord> {
  const id = randomUUID();
  const now = Date.now();
  await repo.run(
    "INSERT INTO favorite_folders (id, user_id, name, sort, created_at) VALUES (?,?,?,?,?)",
    [id, userId, name.trim(), 0, now],
  );
  const row = (await repo.raw("SELECT * FROM favorite_folders WHERE id = ?", [id]))[0];
  if (!row) throw new Error("创建收藏夹后无法读回");
  return rowToFolder(row);
}

export async function deleteFavoriteFolder(repo: Repository, userId: string, folderId: string): Promise<void> {
  const now = Date.now();
  // 两条写语句必须原子：先移出收藏再删夹，中途失败会留下"收藏仍指向已删夹"的悬空态
  await repo.withTransaction(async () => {
    await repo.run(
      "UPDATE favorites SET folder_id = NULL, updated_at = ? WHERE user_id = ? AND folder_id = ?",
      [now, userId, folderId],
    );
    await repo.run("DELETE FROM favorite_folders WHERE id = ? AND user_id = ?", [folderId, userId]);
  });
}

export type FavoriteUpdateResult =
  | { ok: true; favorite: FavoriteRecord }
  | { ok: false; reason: "not_found" | "folder_not_found" };

/**
 * 更新收藏的文件夹 / 备注。
 *
 * 文件夹归属必须校验：folderId 是客户端传的，不校验就能把收藏挂到别人的文件夹上
 * （列表按 user_id 读，挂错后用户自己的文件夹树里就会出现不属于自己的项）。
 */
export async function updateFavorite(
  repo: Repository,
  userId: string,
  siteId: string,
  patch: { folderId?: string | null; note?: string | null },
): Promise<FavoriteUpdateResult> {
  const row = (await repo.raw(
    "SELECT * FROM favorites WHERE user_id = ? AND site_id = ? AND deleted_at IS NULL LIMIT 1",
    [userId, siteId],
  ))[0];
  if (!row) return { ok: false, reason: "not_found" };

  if (patch.folderId) {
    const folder = (await repo.raw(
      "SELECT id FROM favorite_folders WHERE id = ? AND user_id = ? LIMIT 1",
      [patch.folderId, userId],
    ))[0];
    if (!folder) return { ok: false, reason: "folder_not_found" };
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.folderId !== undefined) {
    sets.push("folder_id = ?");
    params.push(patch.folderId);
  }
  if (patch.note !== undefined) {
    sets.push("note = ?");
    params.push(patch.note);
  }
  if (sets.length === 0) return { ok: true, favorite: rowToFavorite(row) };

  sets.push("updated_at = ?");
  params.push(Date.now(), userId, siteId);
  await repo.run(`UPDATE favorites SET ${sets.join(", ")} WHERE user_id = ? AND site_id = ?`, params);
  const updated = (await repo.raw(
    "SELECT * FROM favorites WHERE user_id = ? AND site_id = ? LIMIT 1",
    [userId, siteId],
  ))[0];
  if (!updated) return { ok: false, reason: "not_found" };
  return { ok: true, favorite: rowToFavorite(updated) };
}

/** 清空云端收藏（本地 localStorage 由前端自行处理）；软删墓碑供其它端同步删除 */
export async function clearFavorites(repo: Repository, userId: string): Promise<number> {
  const now = Date.now();
  return repo.runCount(
    "UPDATE favorites SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND deleted_at IS NULL",
    [now, now, userId],
  );
}

export type FavoriteFolderUpdateResult =
  | { ok: true; folder: FavoriteFolderRecord }
  | { ok: false; reason: "not_found" };

/** 文件夹改名 / 排序；只允许操作自己的文件夹 */
export async function updateFavoriteFolder(
  repo: Repository,
  userId: string,
  folderId: string,
  patch: { name?: string; sort?: number },
): Promise<FavoriteFolderUpdateResult> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) return { ok: false, reason: "not_found" };
    sets.push("name = ?");
    params.push(name.slice(0, 30));
  }
  if (patch.sort !== undefined) {
    sets.push("sort = ?");
    params.push(Math.trunc(patch.sort));
  }
  if (sets.length === 0) {
    const existing = (await repo.raw(
      "SELECT * FROM favorite_folders WHERE id = ? AND user_id = ? LIMIT 1",
      [folderId, userId],
    ))[0];
    return existing ? { ok: true, folder: rowToFolder(existing) } : { ok: false, reason: "not_found" };
  }
  params.push(folderId, userId);
  const changes = await repo.runCount(
    `UPDATE favorite_folders SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`,
    params,
  );
  if (changes === 0) return { ok: false, reason: "not_found" };
  const row = (await repo.raw("SELECT * FROM favorite_folders WHERE id = ? LIMIT 1", [folderId]))[0];
  if (!row) return { ok: false, reason: "not_found" };
  return { ok: true, folder: rowToFolder(row) };
}
