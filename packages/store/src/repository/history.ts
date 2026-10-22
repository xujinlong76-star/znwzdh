import type { Repository } from "../repository.ts";

export async function recordSearch(repo: Repository, userId: string, query: string, resultCount: number): Promise<void> {
  const q = query.trim();
  if (!q) return;
  // id 自增：同毫秒的多条记录也能按插入顺序稳定排序
  await repo.run(
    "INSERT INTO search_history (user_id, query, result_count, created_at) VALUES (?,?,?,?)",
    [userId, q, resultCount, Date.now()],
  );
}

export interface SearchHistoryItem {
  id: number;
  query: string;
  resultCount: number;
  createdAt: number;
}

export async function listSearchHistory(repo: Repository, userId: string, limit = 10): Promise<SearchHistoryItem[]> {
  // 自增 id 作次级排序键：created_at 同毫秒时按真实插入顺序
  const rows = await repo.raw(
    "SELECT id, query, result_count AS resultcount, created_at AS createdat FROM search_history WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
    [userId, limit],
  );
  return rows.map((r) => ({
    id: Number(r.id ?? 0),
    query: String(r.query),
    resultCount: Number(r.resultcount ?? 0),
    createdAt: Number(r.createdat ?? 0),
  }));
}

/**
 * 分页列表：多取 1 条探针判断 hasMore，避免 COUNT 查询。
 * offset 分页而不是游标：历史是 append-only，删除单条后游标容易跳项。
 */
export async function listSearchHistoryPage(
  repo: Repository,
  userId: string,
  limit: number,
  offset: number,
): Promise<{ items: SearchHistoryItem[]; hasMore: boolean }> {
  const probe = Math.max(1, limit) + 1;
  const rows = await repo.raw(
    "SELECT id, query, result_count AS resultcount, created_at AS createdat FROM search_history WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
    [userId, probe, Math.max(0, offset)],
  );
  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map((r) => ({
    id: Number(r.id ?? 0),
    query: String(r.query),
    resultCount: Number(r.resultcount ?? 0),
    createdAt: Number(r.createdat ?? 0),
  }));
  return { items, hasMore };
}

/** 删除单条历史；只有属于该身份的记录会被删掉 */
export async function deleteSearchHistoryItem(repo: Repository, userId: string, id: number): Promise<boolean> {
  const changes = await repo.runCount("DELETE FROM search_history WHERE id = ? AND user_id = ?", [id, userId]);
  return changes > 0;
}

/** 导出用：一次取最多 limit 条，并告知是否被截断 */
export async function getSearchHistoryAll(
  repo: Repository,
  userId: string,
  limit: number,
): Promise<{ items: SearchHistoryItem[]; truncated: boolean }> {
  const page = await listSearchHistoryPage(repo, userId, limit, 0);
  return { items: page.items, truncated: page.hasMore };
}

export async function clearSearchHistory(repo: Repository, userId: string): Promise<void> {
  await repo.run("DELETE FROM search_history WHERE user_id = ?", [userId]);
}

export async function countSearchHistory(repo: Repository, userId: string): Promise<number> {
  const rows = await repo.raw("SELECT COUNT(*) AS c FROM search_history WHERE user_id = ?", [userId]);
  return Number(rows[0]?.c ?? 0);
}
