import type { Repository } from "../repository.ts";
import { findUserByIdentity, listUserIdentityAliases } from "./users.ts";

/**
 * 会话治理（T8）：sessions 表此前是全库零读写的死表——纯 JWT 会话无吊销面，
 * 「踢出设备」不可能实现。激活语义：
 *   - token = Web 侧 JWT sid 的 sha256（不落原始 sid，库里泄了也撞不回会话）；
 *   - 行由 BFF 在代理 /api/me/* 时惰性 upsert（last_seen 即活跃心跳），
 *     会话行与 revoked_users 墓碑必须同时核对，防迟到登记绕过整体吊销；
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

export async function isSessionRevoked(
  repo: Repository,
  token: string,
  userId?: string,
  issuedAt?: number,
  passwordVersion?: number,
): Promise<boolean> {
  // 口令版本先于会话行判断：即使 sid 尚未登记，或重置后恰好用了更晚的
  // issuedAt，旧密码验证结果也不能通过。未带版本的旧 OAuth JWT 保持原语义。
  if (passwordVersion != null) {
    if (!userId) return true;
    const user = await findUserByIdentity(repo, userId);
    if (!user || user.passwordVersion !== passwordVersion) return true;
  }
  const row = (
    await repo.raw("SELECT revoked_at FROM sessions WHERE token = ? LIMIT 1", [token])
  )[0];
  if (row?.revoked_at != null) return true;
  // 会话行存在也必须核对用户级墓碑：核对与活动登记非原子，旧会话可能在
  // 整体吊销后的检查间隙迟到登记。没有 issuedAt 的旧 OAuth 会话无法证明
  // 签发于吊销点之后，按收敛语义拒绝；新登录 JWT 带 issuedAt 可正常放行。
  if (!userId) return false;
  const aliases = await listUserIdentityAliases(repo, userId);
  const placeholders = aliases.map(() => "?").join(", ");
  const revokedRow = (
    await repo.raw(
      `SELECT MAX(revoked_before) AS revoked_before FROM revoked_users WHERE user_id IN (${placeholders})`,
      aliases,
    )
  )[0];
  if (!revokedRow || revokedRow.revoked_before == null) return false;
  // 重置后新登录的会话签发于吊销点之后，不被旧标记误杀；issuedAt 缺失时按收敛版视为已吊销。
  if (issuedAt == null) return true;
  return issuedAt < Number(revokedRow.revoked_before);
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

/** 按 users.id 及其 raw / credentials / provider 别名列出全部活跃设备。 */
export async function listSessionDevicesForUser(repo: Repository, userId: string): Promise<SessionDeviceRecord[]> {
  const aliases = await listUserIdentityAliases(repo, userId);
  const placeholders = aliases.map(() => "?").join(", ");
  const rows = await repo.raw(
    "SELECT token, user_id, user_agent, created_at, last_seen_at, expires_at FROM sessions " +
      `WHERE user_id IN (${placeholders}) AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC`,
    [...aliases, Date.now()],
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

/** 踢出：只有属于该用户任一别名的会话可被吊销（跨用户 sid 无效返回 false） */
export async function revokeSessionDevice(repo: Repository, userId: string, token: string): Promise<boolean> {
  const changes = await repo.runCount(
    "UPDATE sessions SET revoked_at = ? WHERE token = ? AND user_id = ? AND revoked_at IS NULL",
    [Date.now(), token, userId],
  );
  return changes > 0;
}

/** 按用户全部身份别名踢出单个设备，兼容 legacy raw / credentials / provider 会话。 */
export async function revokeSessionDeviceForUser(repo: Repository, userId: string, token: string): Promise<boolean> {
  const aliases = await listUserIdentityAliases(repo, userId);
  const placeholders = aliases.map(() => "?").join(", ");
  const changes = await repo.runCount(
    `UPDATE sessions SET revoked_at = ? WHERE token = ? AND user_id IN (${placeholders}) AND revoked_at IS NULL`,
    [Date.now(), token, ...aliases],
  );
  return changes > 0;
}

/** 整体吊销（P0-2）：吊销全部已登记会话并写 revoked_users 兜底行，返回吊销数。 */
export async function revokeAllSessions(repo: Repository, userId: string): Promise<number> {
  const now = Date.now();
  const changes = await repo.runCount(
    "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
    [now, userId],
  );
  await repo.run(
    "INSERT INTO revoked_users (user_id, revoked_before) VALUES (?, ?) " +
      "ON CONFLICT (user_id) DO UPDATE SET revoked_before = excluded.revoked_before",
    [userId, now],
  );
  return changes;
}

/** 按 users.id 吊销 raw / credentials / canonical provider 等全部别名会话。 */
export async function revokeAllSessionsForUser(repo: Repository, userId: string): Promise<number> {
  let revoked = 0;
  for (const alias of await listUserIdentityAliases(repo, userId)) {
    revoked += await revokeAllSessions(repo, alias);
  }
  return revoked;
}