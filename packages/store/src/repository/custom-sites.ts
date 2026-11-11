/**
 * 用户自定义站点（用户中心「我的站点」）。
 *
 * 与收藏的根本区别：收藏指向目录内已有站点（site_id 外键语义），自定义站点是
 * 用户自己的网址（任意 http(s) 地址），不进全站目录、不参与搜索与排行，
 * 只属于这个身份，登录后跨设备可见。
 *
 * 排序：`sort_order` 显式列，重排接口按传入 id 顺序整表重写序号（个人清单
 * 量级在百以内，整表重写比逐行交换更不容易写出半序状态）。
 * 删除是物理删除：自定义站点没有跨端增量同步协议（不像收藏有墓碑需求），
 * 读路径永远是全量拉取，删了就是删了。
 */
import type { Repository } from "../repository.ts";
import { randomUUID } from "node:crypto";

export interface CustomSiteRecord {
  id: string;
  userId: string;
  title: string;
  url: string;
  note: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

/** 单身份自定义站点上限：个人清单不是目录，超限多半是误用/滥用 */
export const CUSTOM_SITES_MAX_PER_USER = 200;

function rowToCustomSite(row: Record<string, unknown>): CustomSiteRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title ?? ""),
    url: String(row.url ?? ""),
    note: row.note === null || row.note === undefined ? null : String(row.note),
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

export async function listCustomSites(repo: Repository, userId: string): Promise<CustomSiteRecord[]> {
  const rows = await repo.raw(
    "SELECT * FROM user_custom_sites WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC",
    [userId],
  );
  return rows.map(rowToCustomSite);
}

export async function countCustomSites(repo: Repository, userId: string): Promise<number> {
  const rows = await repo.raw("SELECT COUNT(*) AS c FROM user_custom_sites WHERE user_id = ?", [userId]);
  return Number(rows[0]?.c ?? 0);
}

export async function createCustomSite(
  repo: Repository,
  input: { userId: string; title: string; url: string; note?: string | null },
): Promise<CustomSiteRecord | null> {
  const count = await countCustomSites(repo, input.userId);
  if (count >= CUSTOM_SITES_MAX_PER_USER) return null;
  const now = Date.now();
  const id = randomUUID();
  // 新站点排在末尾：序号取当前最大值 + 1（空表从 0 起）
  const maxRows = await repo.raw(
    "SELECT COALESCE(MAX(sort_order), -1) AS m FROM user_custom_sites WHERE user_id = ?",
    [input.userId],
  );
  const sortOrder = Number(maxRows[0]?.m ?? -1) + 1;
  await repo.run(
    "INSERT INTO user_custom_sites (id, user_id, title, url, note, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
    [id, input.userId, input.title, input.url, input.note ?? null, sortOrder, now, now],
  );
  const rows = await repo.raw("SELECT * FROM user_custom_sites WHERE id = ?", [id]);
  return rows[0] ? rowToCustomSite(rows[0]) : null;
}

export async function updateCustomSite(
  repo: Repository,
  userId: string,
  id: string,
  patch: { title?: string; url?: string; note?: string | null },
): Promise<CustomSiteRecord | null> {
  const rows = await repo.raw("SELECT * FROM user_custom_sites WHERE id = ? AND user_id = ?", [id, userId]);
  if (!rows[0]) return null;
  const current = rowToCustomSite(rows[0]);
  const next = {
    title: patch.title ?? current.title,
    url: patch.url ?? current.url,
    note: patch.note !== undefined ? patch.note : current.note,
  };
  await repo.run("UPDATE user_custom_sites SET title = ?, url = ?, note = ?, updated_at = ? WHERE id = ? AND user_id = ?", [
    next.title,
    next.url,
    next.note,
    Date.now(),
    id,
    userId,
  ]);
  const after = await repo.raw("SELECT * FROM user_custom_sites WHERE id = ?", [id]);
  return after[0] ? rowToCustomSite(after[0]) : null;
}

export async function deleteCustomSite(repo: Repository, userId: string, id: string): Promise<boolean> {
  const rows = await repo.raw("SELECT id FROM user_custom_sites WHERE id = ? AND user_id = ?", [id, userId]);
  if (!rows[0]) return false;
  await repo.run("DELETE FROM user_custom_sites WHERE id = ? AND user_id = ?", [id, userId]);
  return true;
}

/**
 * 按给定顺序重排：ids 必须恰好是该用户现有 id 的全集（不多不少），
 * 否则拒绝——半份顺序写下去会把没提到的站点序号冲乱。返回重排后的全量列表。
 */
export async function reorderCustomSites(
  repo: Repository,
  userId: string,
  ids: string[],
): Promise<CustomSiteRecord[] | null> {
  const existing = await listCustomSites(repo, userId);
  const existingIds = new Set(existing.map((s) => s.id));
  if (ids.length !== existingIds.size || ids.some((id) => !existingIds.has(id))) return null;
  const now = Date.now();
  for (let i = 0; i < ids.length; i++) {
    await repo.run("UPDATE user_custom_sites SET sort_order = ?, updated_at = ? WHERE id = ? AND user_id = ?", [
      i,
      now,
      ids[i],
      userId,
    ]);
  }
  return listCustomSites(repo, userId);
}

/** 注销/清数据时连带删除（user-data 的删除域会调） */
export async function deleteAllCustomSites(repo: Repository, userId: string): Promise<number> {
  const count = await countCustomSites(repo, userId);
  await repo.run("DELETE FROM user_custom_sites WHERE user_id = ?", [userId]);
  return count;
}
