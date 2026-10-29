import type { Repository } from "../repository.ts";
import { randomUUID } from "node:crypto";
import type {
  FavoriteFolderRecord,
  FavoriteRecord,
} from "./records.ts";
import {
  rowToFavorite,
  rowToFolder,
} from "./dialect.ts";
import { chunkList, inPredicate } from "../sql-in.ts";

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

/** 标签契约（T22）：最多 8 个、每个 1-24 字符（trim 后），去重；空集 = null（未打标签） */
export const FAVORITE_TAGS_MAX = 8;
export const FAVORITE_TAG_MAX_LEN = 24;

/** 返回 JSON 存储串或 null；非法形状一律收敛成 null（调用方无需再判） */
export function normalizeFavoriteTags(input: unknown): string | null {
  if (!Array.isArray(input)) return null;
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim().slice(0, FAVORITE_TAG_MAX_LEN);
    if (!tag) continue;
    seen.add(tag);
    if (seen.size >= FAVORITE_TAGS_MAX) break;
  }
  return seen.size > 0 ? JSON.stringify([...seen]) : null;
}

/** 库里的 JSON 串 → 数组（读取侧）；坏数据返回 null */
export function parseFavoriteTagsJson(raw: unknown): string[] | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const tags = parsed.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
    return tags.length > 0 ? tags : null;
  } catch {
    return null;
  }
}

export type FavoriteOp = {
  op: "add" | "update" | "remove";
  siteId: string;
  folderId?: string | null;
  note?: string | null;
  /** 标签（T22）：add = 全量覆盖；update 仅在显式传入时写；null = 清除（同步 null 语义） */
  tags?: string[] | null;
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

/** 收藏列表的检索 / 排序 / 分页参数（N8：万级收藏可用） */
export interface FavoriteListQuery {
  /** 关键词：匹配收藏备注、站点标题、站点地址（大小写不敏感） */
  q?: string;
  /** 限定某个收藏夹；空串 / 缺省 = 全部 */
  folderId?: string | null;
  /** created（默认，新→旧）| title（标题升序） */
  sort?: "created" | "title";
  limit?: number;
  offset?: number;
}

export interface FavoriteListPage {
  items: FavoriteRecord[];
  /** 满足筛选条件的总条数（不受 limit 影响），供前端显示「x / y」与判断 hasMore */
  total: number;
  hasMore: boolean;
}

/**
 * LIKE 通配符转义：用户输入的 `%` / `_` 必须当字面量，否则搜 `100%` 会变成前缀通配。
 * 反斜杠本身要先转义（顺序不能反）。
 */
function escapeLikeTerm(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => "\\" + ch);
}

/**
 * 收藏列表分页版（`GET /api/favorites?limit=…`）。
 *
 * 与 `listFavorites` 的分工：后者是**全量**，供导出 / 书签 HTML / 画像聚合使用——
 * 那些场景少一条就是数据丢失，绝不能加 LIMIT。这里只服务列表 UI。
 *
 * 关键词检索必须 JOIN sites：收藏行本身只有 note，用户眼里的「标题/网址」在 sites 表。
 * 站点被软删时 LEFT JOIN 仍保留收藏行（title/url 为 NULL），只按备注命中。
 */
export async function listFavoritesPage(
  repo: Repository,
  userId: string,
  query: FavoriteListQuery = {},
): Promise<FavoriteListPage> {
  const where: string[] = ["f.user_id = ?", "f.deleted_at IS NULL"];
  const params: unknown[] = [userId];

  const q = (query.q ?? "").trim();
  if (q) {
    const term = `%${escapeLikeTerm(q)}%`;
    where.push("(f.note LIKE ? ESCAPE '\\' OR s.title LIKE ? ESCAPE '\\' OR s.url LIKE ? ESCAPE '\\')");
    params.push(term, term, term);
  }
  if (query.folderId) {
    where.push("f.folder_id = ?");
    params.push(query.folderId);
  }

  const whereSql = where.join(" AND ");
  // 排序表达式必须双方言通用：`COLLATE NOCASE` 是 SQLite 专有，PG 会直接报错。
  // LOWER() 在两边语义一致，中文排序仍按码点（与既有 sort 行为一致）。
  const orderSql =
    query.sort === "title"
      ? "ORDER BY LOWER(COALESCE(s.title, '')) ASC, f.created_at DESC"
      : "ORDER BY f.created_at DESC";

  const limit = Math.min(Math.max(Math.trunc(query.limit ?? 50), 1), 200);
  const offset = Math.max(Math.trunc(query.offset ?? 0), 0);

  const rows = await repo.raw(
    `SELECT f.* FROM favorites f LEFT JOIN sites s ON s.id = f.site_id
     WHERE ${whereSql} ${orderSql} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const countRows = await repo.raw(
    `SELECT COUNT(*) AS c FROM favorites f LEFT JOIN sites s ON s.id = f.site_id WHERE ${whereSql}`,
    params,
  );
  const total = Number(countRows[0]?.c ?? 0);
  return {
    items: rows.map(rowToFavorite),
    total,
    hasMore: offset + rows.length < total,
  };
}

/**
 * 收藏夹越界（BOLA / OWASP API1:2023）。
 *
 * `favorites.folder_id` 是裸 text 列、没有指向 favorite_folders 的外键（schema.ts:341），
 * 所以「别人的文件夹 id」能被库原样收下——写进去就是跨用户数据串门。
 * REST 单条写入把它映射成 400；批量同步侧不抛（见 applyFavoriteOps 的降级口径）。
 */
export class FavoriteFolderNotOwnedError extends Error {
  readonly userId: string;
  readonly folderId: string;
  constructor(userId: string, folderId: string) {
    super(`收藏夹不存在或不属于该用户：user=${userId} folder=${folderId}`);
    this.name = "FavoriteFolderNotOwnedError";
    this.userId = userId;
    this.folderId = folderId;
  }
}

/**
 * 一次取回「这些 id 里属于该用户的子集」。
 *
 * 用分片 IN 而不是 `WHERE user_id = ?` 全量拉：后者的行数由该用户的文件夹总数决定，
 * 而这里只需要 ops 真正引用到的那几个 id。
 */
async function ownedFolderIds(
  repo: Repository,
  userId: string,
  ids: Array<string | null | undefined>,
): Promise<Set<string>> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
  const owned = new Set<string>();
  for (const part of chunkList(unique)) {
    const { sql, params } = inPredicate("id", part);
    const rows = await repo.raw(
      `SELECT id FROM favorite_folders WHERE user_id = ? AND ${sql}`,
      [userId, ...params],
    );
    for (const row of rows) owned.add(String(row.id));
  }
  return owned;
}

/** 不属于自己（或已删除/悬空）的夹子 id 一律当「未归档」，null 原样保留（= 移出文件夹） */
function ownedFolderIdOrNone(folderId: string | null | undefined, owned: Set<string>): string | null {
  return typeof folderId === "string" && folderId && owned.has(folderId) ? folderId : null;
}

export async function addFavorite(repo: Repository, input: { userId: string; siteId: string; folderId?: string | null; note?: string | null; tags?: string[] | null }): Promise<{ favorite: FavoriteRecord; existed: boolean }> {
  const id = randomUUID();
  const now = Date.now();
  // 归属校验（run112）：这一路此前完全不查 folder 属于谁，只有 PATCH 查——
  // 「同一资源的 POST 不设防、PATCH 设防」正是 BOLA 的经典形态。
  if (input.folderId && !(await ownedFolderIds(repo, input.userId, [input.folderId])).has(input.folderId)) {
    throw new FavoriteFolderNotOwnedError(input.userId, input.folderId);
  }
  // 幂等写入：并发双写靠 UNIQUE(user_id, site_id) 兜底，不再「先查后插」——
  // 先查后插在双写竞态下会撞唯一索引抛 500（本可返回 existed:true）。
  const changes = await repo.runCount(
    "INSERT INTO favorites (id, user_id, site_id, folder_id, note, tags, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id, site_id) DO NOTHING",
    [id, input.userId, input.siteId, input.folderId ?? null, input.note ?? null, normalizeFavoriteTags(input.tags), now, now],
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
      "UPDATE favorites SET deleted_at = NULL, folder_id = ?, note = ?, tags = ?, updated_at = ? WHERE user_id = ? AND site_id = ?",
      [input.folderId ?? null, input.note ?? null, normalizeFavoriteTags(input.tags), now, input.userId, input.siteId],
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

/** 轻量水位查询（B3 多端一致性轮询）：只取 MAX(updated_at)，不拉行 */
export async function getFavoritesVersion(repo: Repository, userId: string): Promise<number> {
  const rows = await repo.raw(
    "SELECT MAX(updated_at) AS v FROM favorites WHERE user_id = ?",
    [userId],
  );
  const v = Number(rows[0]?.v ?? 0);
  return Number.isFinite(v) && v > 0 ? v : 0;
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
 *
 * 文件夹归属（run112）：ops 里的 folderId 同样来自客户端，可能是别人的夹子或已删的夹子。
 * 这里**不抛错**——整批回滚会让客户端无限重放同一批不可修复的 op，水位永远推不动。
 * 口径：add 把外夹降级成 null（收藏照样落库，只是未归档）；update 跳过 folder_id 字段
 * （保持原值），其余字段照常生效。两种都只损失「归档位置」这一项信息。
 */
export async function applyFavoriteOps(
  repo: Repository,
  userId: string,
  ops: FavoriteOp[],
): Promise<{ applied: number; version: number }> {
  return repo.withTransaction(async () => {
    let applied = 0;
    const ownedFolders = await ownedFolderIds(repo, userId, ops.map((op) => op.folderId));
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
          "INSERT INTO favorites (id, user_id, site_id, folder_id, note, tags, created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,?,?,?,?)",
          [
            randomUUID(),
            userId,
            op.siteId,
            op.op === "add" ? ownedFolderIdOrNone(op.folderId, ownedFolders) : null,
            op.op === "add" ? op.note ?? null : null,
            op.op === "add" ? normalizeFavoriteTags(op.tags) : null,
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
        sets.push("deleted_at = NULL", "folder_id = ?", "note = ?", "tags = ?");
        params.push(ownedFolderIdOrNone(op.folderId, ownedFolders), op.note ?? null, normalizeFavoriteTags(op.tags));
      } else {
        // update 是"局部补丁"语义：只改传入的字段，未传的保持原值
        // folderId 为 null = 移出文件夹（合法）；非空但不属于自己 = 整个字段跳过，保持原值
        if (op.folderId !== undefined && (op.folderId === null || ownedFolders.has(op.folderId))) {
          sets.push("folder_id = ?");
          params.push(op.folderId);
        }
        if (op.note !== undefined) {
          sets.push("note = ?");
          params.push(op.note);
        }
        if (op.tags !== undefined) {
          sets.push("tags = ?");
          params.push(normalizeFavoriteTags(op.tags));
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
  // 追加到队尾而不是恒写 0：sort 是拖拽/上移下移重排的依据，
  // 恒 0 会让所有夹子同权、顺序退化为创建序（T16 修复）。
  const maxRow = (
    await repo.raw("SELECT MAX(sort) AS m FROM favorite_folders WHERE user_id = ?", [userId])
  )[0];
  const sort = Number(maxRow?.m ?? 0) + 1;
  await repo.run(
    "INSERT INTO favorite_folders (id, user_id, name, sort, created_at) VALUES (?,?,?,?,?)",
    [id, userId, name.trim(), sort, now],
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
  patch: { folderId?: string | null; note?: string | null; tags?: string[] | null },
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
  // 标签（T22）：显式传入才写（undefined = 不变；null = 清除）
  if (patch.tags !== undefined) {
    sets.push("tags = ?");
    params.push(normalizeFavoriteTags(patch.tags));
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
