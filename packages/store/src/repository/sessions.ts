import type { Repository } from "../repository.ts";

/**
 * 会话治理（T8）：sessions 表此前是全库零读写的死表——纯 JWT 会话无吊销面，
 * 「踢出设备」不可能实现。激活语义：
 *   - token = Web 侧 JWT sid 的 sha256（不落原始 sid，库里泄了也撞不回会话）；
 *   - 行由 BFF 在代理 /api/me/* 时惰性 upsert（last_seen 即活跃心跳），
 *     没有行 = 会话早于本功能或从未走过 BFF → 视为未吊销（fail-open）；
 *   - revoked_at 非空 = 已被用户踢出，BFF 下一次请求起 401。
 */
export interface SessionDeviceRecord {
  /** JWT sid 的 sha256（浏览器侧不知道原始 sid 与它的关系之外的任何信息） */
  token: string;
  userId: string;
  userAgent: string | null;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

export async function upsertSessionActivity(
  repo: Repository,
  input: { token: string; userId: string; userAgent?: string | null; expiresAt: number },
): Promise<void> {
  const now = Date.now();
  await repo.run(
    `INSERT INTO sessions (token, user_id, expires_at, created_at, user_agent, last_seen_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT (token) DO UPDATE SET
       last_seen_at = excluded.last_seen_at,
       user_agent = COALESCE(excluded.user_agent, sessions.user_agent),
       expires_at = excluded.expires_at`,
    [input.token, input.userId, input.expiresAt, now, input.userAgent ?? null, now],
  );
}

export async function isSessionRevoked(repo: Repository, token: string): Promise<boolean> {
  const row = (
    await repo.raw("SELECT revoked_at FROM sessions WHERE token = ? LIMIT 1", [token])
  )[0];
  if (!row) return false;
  return row.revoked_at != null;
}

export async function listSessionDevices(repo: Repository, userId: string): Promise<SessionDeviceRecord[]> {
  const rows = await repo.raw(
    "SELECT token, user_id, user_agent, created_at, last_seen_at, expires_at FROM sessions " +
      "WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC",
    [userId, Date.now()],
  );
  return rows.map((r) => ({
    token: String(r.token),
    userId: String(r.user_id),
    userAgent: r.user_agent == null ? null : String(r.user_agent),
    createdAt: Number(r.created_at ?? 0),
    lastSeenAt: Number(r.last_seen_at ?? r.created_at ?? 0),
    expiresAt: Number(r.expires_at ?? 0),
  }));
}

/** 踢出：只有属于该用户的会话可被吊销（跨用户 sid 无效返回 false） */
export async function revokeSessionDevice(repo: Repository, userId: string, token: string): Promise<boolean> {
  const changes = await repo.runCount(
    "UPDATE sessions SET revoked_at = ? WHERE token = ? AND user_id = ? AND revoked_at IS NULL",
    [Date.now(), token, userId],
  );
  return changes > 0;
}
