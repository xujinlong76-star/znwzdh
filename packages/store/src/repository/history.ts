import { MAX_SEARCH_QUERY_LENGTH } from "@navhub/core";
import type { Repository } from "../repository.ts";

/**
 * 同一查询短时间内去重窗口。
 *
 * 浮层每 200ms 防抖重查、/search 页与浮层对同一查询各发一次——同一查询
 * 一分钟内能记两条一模一样的行（走查实测「AI 一分钟两条」）。窗口内重复
 * 只刷新时间与结果数、不新增行；窗口外（用户隔一阵子又搜同一词）照常新
 * 记一行，那是另一次搜索意图，不是重复。
 *
 * 归一化只做 trim + 小写：与导入恢复的去重（me.ts）同一口径；中文不受
 * 大小写影响，英文 "AI" 与 "ai" 视为同一查询。
 */
export const SEARCH_HISTORY_DEDUPE_WINDOW_MS = 5 * 60 * 1000;

export async function recordSearch(repo: Repository, userId: string, query: string, resultCount: number): Promise<void> {
  const q = query.trim();
  if (!q) return;
  // 最后一道形状守卫：REST / 导入都先过 schema，正常路径到不了这里。
  // 到了说明新增了未设上限的调用方，宁可显式失败也不静默截断用户数据。
  if (q.length > MAX_SEARCH_QUERY_LENGTH) {
    throw new Error(`搜索历史查询词超长：${q.length} > ${MAX_SEARCH_QUERY_LENGTH}（调用方应在入口处限制）`);
  }
  const now = Date.now();
  // 窗口内已有一条同查询：原地刷新（时间与结果数都取最新一次的值），
  // 不新增行。lower() 比较在 SQLite 与 PG 下都可用，调用方无需关心方言。
  const latest = await repo.raw(
    "SELECT id, created_at AS createdat FROM search_history WHERE user_id = ? AND lower(query) = ? ORDER BY created_at DESC, id DESC LIMIT 1",
    [userId, q.toLowerCase()],
  );
  const prev = latest[0];
  if (prev && now - Number(prev.createdat ?? 0) < SEARCH_HISTORY_DEDUPE_WINDOW_MS) {
    await repo.run("UPDATE search_history SET created_at = ?, result_count = ? WHERE id = ?", [
      now,
      resultCount,
      Number(prev.id),
    ]);
    return;
  }
  // id 自增：同毫秒的多条记录也能按插入顺序稳定排序
  await repo.run(
    "INSERT INTO search_history (user_id, query, result_count, created_at) VALUES (?,?,?,?)",
    [userId, q, resultCount, now],
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

/**
 * 批量删除（T4）：按 id 集合删除，只删属于该身份的行。
 * 逐条 DELETE 的 N 次往返在零结果清理场景（几十条）明显偏慢且中断无补偿——
 * 服务端一次往返完成，返回「实际删除数」（不属于该身份的 id 静默不计）。
 */
export async function deleteSearchHistoryItems(repo: Repository, userId: string, ids: number[]): Promise<number> {
  const unique = [...new Set(ids)].filter((id) => Number.isFinite(id) && id > 0);
  if (unique.length === 0) return 0;
  // 分块 IN：SQLite 默认变量上限 999，200/批留足余量
  let removed = 0;
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200);
    const placeholders = chunk.map(() => "?").join(",");
    const changes = await repo.runCount(
      `DELETE FROM search_history WHERE user_id = ? AND id IN (${placeholders})`,
      [userId, ...chunk],
    );
    removed += changes;
  }
  return removed;
}

/** 按身份删除早于 cutoff 的历史（T11：用户自设保留期的自动执行），返回删除数 */
export async function deleteSearchHistoryBefore(repo: Repository, userId: string, cutoff: number): Promise<number> {
  return repo.runCount("DELETE FROM search_history WHERE user_id = ? AND created_at < ?", [userId, cutoff]);
}

/**
 * 按身份删除早于 cutoff 的 click 信号（U-373）。
 *
 * click 信号存在 events 表（kind='click'，identity 列归属），与 search_history
 * 一样是「该用户的行为数据」，须按同一保留期清理；此前只在 rollup 聚合后
 * 间接删明细，从未按用户保留期执行过。
 */
export async function deleteClickEventsBefore(repo: Repository, identity: string, cutoff: number): Promise<number> {
  return repo.runCount(
    "DELETE FROM events WHERE identity = ? AND kind = 'click' AND created_at < ?",
    [identity, cutoff],
  );
}

/**
 * 该用户上次「按保留期清理过期历史」的时间（U-373：历史页脚的真实来源）。
 *
 * 唯一事实源是 audit_logs 里 action='user.search_history_expired' 的记录——
 * 定时清理与手动自检（POST /api/me/diagnostics）删掉 ≥1 条时都会写一条；
 * 从未清理过返回 null，调用方不得编造时间。
 */
export async function getLastHistoryCleanupAt(repo: Repository, userId: string): Promise<number | null> {
  const rows = await repo.raw(
    "SELECT MAX(created_at) AS t FROM audit_logs WHERE action = 'user.search_history_expired' AND target = ?",
    [userId],
  );
  const t = Number(rows[0]?.t ?? 0);
  return t > 0 ? t : null;
}

export interface ExpiredHistoryCleanupResult {
  identity: string;
  retentionDays: number;
  historyDeleted: number;
  clicksDeleted: number;
  /** 删掉 ≥1 条时为本次清理时间，否则 null（无清理记录） */
  cleanedAt: number | null;
}

const HISTORY_DAY_MS = 86_400_000;

/**
 * 按某用户的保留期删过期历史 + click 信号（U-373：定时任务与手动自检共用）。
 *
 * 删掉 ≥1 条时写一条 user.search_history_expired 审计——这就是
 * getLastHistoryCleanupAt 的事实源；审计写失败不阻断清理本身（与仓储内
 * 其他「审计尽力而为」的口径一致），只是页脚那次拿不到时间。
 */
export async function cleanupExpiredUserHistory(
  repo: Repository,
  identity: string,
  opts: { retentionDays: number; now?: number; actor: string; actorKind?: "system" | "user" },
): Promise<ExpiredHistoryCleanupResult> {
  const retentionDays = Math.trunc(opts.retentionDays);
  if (!(retentionDays > 0)) {
    throw new Error(`保留天数必须为正数，收到 retentionDays=${opts.retentionDays}（identity=${identity}）`);
  }
  const now = opts.now ?? Date.now();
  const cutoff = now - retentionDays * HISTORY_DAY_MS;
  const historyDeleted = await deleteSearchHistoryBefore(repo, identity, cutoff);
  const clicksDeleted = await deleteClickEventsBefore(repo, identity, cutoff);
  const cleanedAt = historyDeleted + clicksDeleted > 0 ? now : null;
  if (cleanedAt !== null) {
    await repo
      .audit({
        actor: opts.actor,
        actorKind: opts.actorKind,
        action: "user.search_history_expired",
        target: identity,
        diff: { retentionDays, historyDeleted, clicksDeleted },
      })
      .catch(() => {
        // 审计/遥测类写库是尽力而为：失败不阻断主操作，写失败即丢弃。
      });
  }
  return { identity, retentionDays, historyDeleted, clicksDeleted, cleanedAt };
}

/** 服务端筛选删除：清理全部零结果记录（result_count = 0），返回删除数 */
export async function deleteZeroResultSearchHistory(repo: Repository, userId: string): Promise<number> {
  return repo.runCount("DELETE FROM search_history WHERE user_id = ? AND result_count = 0", [userId]);
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
