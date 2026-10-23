import type { Repository } from "../repository.ts";
import { randomUUID } from "node:crypto";
import type {
  UserRecord,
} from "./records.ts";
import {
  rowToUser,
} from "./dialect.ts";

/**
 * OAuth 身份 → users 行的唯一入口。
 *
 * **绑定策略：只认 provider 身份（`id` = `provider:providerId`）与 username 精确匹配，
 * 不再按 email 兜底绑定。**
 */
export async function upsertOauthUser(repo: Repository, input: { id?: string; username: string; email?: string | null; avatar?: string | null; source?: string }): Promise<UserRecord> {
  const row = (input.id ? (await repo.raw("SELECT * FROM users WHERE id = ? LIMIT 1", [input.id]))[0] : undefined)
    ?? (await repo.raw("SELECT * FROM users WHERE username = ? LIMIT 1", [input.username]))[0];
  if (row) {
    try {
      await repo.run(
        "UPDATE users SET email = COALESCE(?, email), avatar = COALESCE(?, avatar), source = ? WHERE id = ?",
        [input.email ?? null, input.avatar ?? null, input.source ?? "github", String(row.id)],
      );
    } catch {
      // 该 email 已属于另一行（历史重复数据或跨 provider 同邮箱）：只更新非唯一字段。
      await repo.run(
        "UPDATE users SET avatar = COALESCE(?, avatar), source = ? WHERE id = ?",
        [input.avatar ?? null, input.source ?? "github", String(row.id)],
      );
    }
    const updated = (await repo.raw("SELECT * FROM users WHERE id = ?", [String(row.id)]))[0];
    if (!updated) throw new Error("更新用户后无法读回");
    return rowToUser(updated);
  }
  const id = input.id ?? randomUUID();
  // password_hash 为 NOT NULL；OAuth 用户无密码，置空串（本系统登录走 next-auth 会话，不查密码）
  const insert = async (email: string | null): Promise<void> => {
    await repo.run(
      "INSERT INTO users (id, username, password_hash, role, email, avatar, source, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [id, input.username, "", "user", email, input.avatar ?? null, input.source ?? "github", Date.now()],
    );
  };
  let storedEmail = input.email ?? null;
  try {
    await insert(storedEmail);
  } catch (err) {
    if (!storedEmail) throw err;
    storedEmail = null;
    await insert(null);
  }
  return { id, username: input.username, role: "user", email: storedEmail, avatar: input.avatar ?? null, source: input.source ?? "github" };
}

export async function getUser(repo: Repository, idOrUsername: string): Promise<UserRecord | null> {
  const row = (await repo.raw("SELECT * FROM users WHERE id = ? OR username = ? LIMIT 1", [idOrUsername, idOrUsername]))[0];
  return row ? rowToUser(row) : null;
}

/**
 * 更新用户中心个人展示资料（昵称 username / 头像 avatar）。
 * 若该登录身份尚未在 users 表落行，则按 canonical id 自动初始化一行。
 */
export async function updateUserProfileInfo(
  repo: Repository,
  identity: string,
  patch: { username?: string; avatar?: string | null },
): Promise<{ ok: true; user: UserRecord } | { ok: false; reason: "username_taken" | "invalid_input" }> {
  const cleanUsername = patch.username !== undefined ? patch.username.trim() : undefined;
  if (cleanUsername !== undefined && (cleanUsername.length < 1 || cleanUsername.length > 40)) {
    return { ok: false, reason: "invalid_input" };
  }
  if (cleanUsername) {
    const conflict = (
      await repo.raw("SELECT id FROM users WHERE username = ? AND id <> ? LIMIT 1", [cleanUsername, identity])
    )[0];
    if (conflict) {
      return { ok: false, reason: "username_taken" };
    }
  }

  const existing = (await repo.raw("SELECT * FROM users WHERE id = ? LIMIT 1", [identity]))[0];
  if (!existing) {
    const source = identity.includes(":") ? identity.split(":")[0]! : "local";
    const defaultName = cleanUsername || (identity.includes(":") ? identity.split(":").slice(1).join(":") : identity);
    await repo.run(
      "INSERT INTO users (id, username, password_hash, role, email, avatar, source, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [identity, defaultName, "", "user", null, patch.avatar ?? null, source, Date.now()],
    );
  } else {
    const nextUsername = cleanUsername ?? String(existing.username);
    const nextAvatar = patch.avatar === undefined ? (existing.avatar == null ? null : String(existing.avatar)) : patch.avatar;
    await repo.run(
      "UPDATE users SET username = ?, avatar = ? WHERE id = ?",
      [nextUsername, nextAvatar, identity],
    );
  }

  const updated = (await repo.raw("SELECT * FROM users WHERE id = ? LIMIT 1", [identity]))[0];
  if (!updated) return { ok: false, reason: "invalid_input" };
  return { ok: true, user: rowToUser(updated) };
}
