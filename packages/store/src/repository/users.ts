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
  const byId = input.id ? (await repo.raw("SELECT * FROM users WHERE id = ? LIMIT 1", [input.id]))[0] : undefined;
  // username 兜底的认领边界（T7-1）：
  //  - 带规范 id 的调用（现行唯一生产调用方 /api/users/sync）：只允许认领「未绑定
  //    provider 身份」的历史行（随机 UUID / 旧用户名主键）。已绑定 github:<id> 等
  //    规范身份的行不可被 username 命中改写——否则原用户在 provider 改名后，
  //    新用户注册同名即可冒领其资料行（email/avatar 被覆盖）。
  //  - 不带 id 的旧式调用（存量测试 / 遗留客户端）：保持历史行为，按 username 认领。
  //    冒领攻击者必然持有自己的 provider id（即走带 id 分支），此放宽不构成新风险面。
  const usernameClaimSql = input.id
    ? "SELECT * FROM users WHERE username = ? AND id NOT LIKE '%:%' LIMIT 1"
    : "SELECT * FROM users WHERE username = ? LIMIT 1";
  const byUsername = byId ? undefined
    : (await repo.raw(usernameClaimSql, [input.username]))[0];
  const row = byId ?? byUsername;
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
  const insert = async (username: string, email: string | null): Promise<void> => {
    await repo.run(
      "INSERT INTO users (id, username, password_hash, role, email, avatar, source, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [id, username, "", "user", email, input.avatar ?? null, input.source ?? "github", Date.now()],
    );
  };
  // username 全局唯一：插入失败逐层降级——原用户名+email → 原用户名+null email
  // （email 撞唯一索引时，保住用户名）→ 消歧用户名（用户名被他人占用时，追加
  // provider 数字后缀，tap 同名导入的既有模式）。绝不覆盖他人行，也不让登录因同名而 500。
  const fallbackSuffix = input.id?.includes(":") ? input.id.split(":").pop()! : randomUUID().slice(0, 8);
  const disambiguated = `${input.username.slice(0, 56)}-${fallbackSuffix}`;
  let storedEmail = input.email ?? null;
  let storedUsername = input.username;
  let inserted = false;
  try {
    await insert(storedUsername, storedEmail);
    inserted = true;
  } catch { /* 落降级链 */ }
  if (!inserted && storedEmail !== null) {
    storedEmail = null;
    try {
      await insert(storedUsername, null);
      inserted = true;
    } catch { /* 用户名也冲突，继续降级 */ }
  }
  if (!inserted) {
    storedEmail = null;
    await insert(disambiguated, null);
    storedUsername = disambiguated;
  }
  return { id, username: storedUsername, role: "user", email: storedEmail, avatar: input.avatar ?? null, source: input.source ?? "github" };
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
  patch: { username?: string; avatar?: string | null; email?: string | null },
): Promise<{ ok: true; user: UserRecord } | { ok: false; reason: "username_taken" | "email_taken" | "invalid_input" }> {
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

  // 邮箱唯一性先查后写（库里的部分唯一索引兜底并发，这里负责给出可读的失败原因）
  if (patch.email !== undefined && patch.email !== null) {
    const conflict = (
      await repo.raw("SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1", [patch.email, identity])
    )[0];
    if (conflict) {
      return { ok: false, reason: "email_taken" };
    }
  }

  const existing = (await repo.raw("SELECT * FROM users WHERE id = ? LIMIT 1", [identity]))[0];
  if (!existing) {
    const source = identity.includes(":") ? identity.split(":")[0]! : "local";
    const defaultName = cleanUsername || (identity.includes(":") ? identity.split(":").slice(1).join(":") : identity);
    await repo.run(
      "INSERT INTO users (id, username, password_hash, role, email, avatar, source, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [identity, defaultName, "", "user", patch.email ?? null, patch.avatar ?? null, source, Date.now()],
    );
  } else {
    const nextUsername = cleanUsername ?? String(existing.username);
    const nextAvatar = patch.avatar === undefined ? (existing.avatar == null ? null : String(existing.avatar)) : patch.avatar;
    const nextEmail =
      patch.email === undefined ? (existing.email == null ? null : String(existing.email)) : patch.email;
    await repo.run(
      "UPDATE users SET username = ?, avatar = ?, email = ? WHERE id = ?",
      [nextUsername, nextAvatar, nextEmail, identity],
    );
  }

  const updated = (await repo.raw("SELECT * FROM users WHERE id = ? LIMIT 1", [identity]))[0];
  if (!updated) return { ok: false, reason: "invalid_input" };
  return { ok: true, user: rowToUser(updated) };
}
