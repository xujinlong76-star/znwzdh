/**
 * 短剧新集检查状态（drama_check_states）。
 *
 * 按（user_id, drama_key）唯一：记服务端上次为该用户查到的集数、
 * 上次检查时间与最近一次失败原因。不要往 watch_entries 里写服务端
 * 状态——那张表走客户端 ops 同步协议，服务端写会干扰多端汇合。
 */
import type { Repository } from "../repository.ts";

export interface DramaCheckState {
 userId: string;
 dramaKey: string;
 latestEpisode: number | null;
 lastCheckedAt: number;
 lastError: string | null;
}

export interface DramaCheckUpsert {
 latestEpisode: number | null;
 lastCheckedAt: number;
 lastError: string | null;
}

function rowToDramaCheckState(row: Record<string, unknown>): DramaCheckState {
 return {
 userId: String(row.user_id),
 dramaKey: String(row.drama_key),
 latestEpisode: row.latest_episode === null || row.latest_episode === undefined ? null : Number(row.latest_episode),
 lastCheckedAt: Number(row.last_checked_at),
 lastError: row.last_error === null || row.last_error === undefined ? null : String(row.last_error),
 };
}

export async function getDramaCheckState(
 repo: Repository,
 userId: string,
 dramaKey: string,
): Promise<DramaCheckState | null> {
 const rows = await repo.raw(
 "SELECT user_id, drama_key, latest_episode, last_checked_at, last_error FROM drama_check_states WHERE user_id = ? AND drama_key = ?",
 [userId, dramaKey],
 );
 const row = rows[0];
 return row ? rowToDramaCheckState(row) : null;
}


export async function upsertDramaCheckState(
 repo: Repository,
 userId: string,
 dramaKey: string,
 state: DramaCheckUpsert,
 now: number = Date.now(),
): Promise<void> {
 await repo.run(
 "INSERT INTO drama_check_states (user_id, drama_key, latest_episode, last_checked_at, last_error, created_at, updated_at) " +
 "VALUES (?,?,?,?,?,?,?) " +
 "ON CONFLICT (user_id, drama_key) DO UPDATE SET latest_episode = excluded.latest_episode, last_checked_at = excluded.last_checked_at, last_error = excluded.last_error, updated_at = excluded.updated_at",
 [userId, dramaKey, state.latestEpisode, state.lastCheckedAt, state.lastError, now, now],
 );
}

/** 关注了某部剧（drama_key）的用户 id（去重，不含已删除条目） */
export async function listDramaFollowers(repo: Repository, dramaKey: string): Promise<string[]> {
 const rows = await repo.raw(
 "SELECT DISTINCT user_id FROM watch_entries WHERE drama_key = ? AND deleted_at IS NULL",
 [dramaKey],
 );
 return rows.map((row) => String(row.user_id));
}
