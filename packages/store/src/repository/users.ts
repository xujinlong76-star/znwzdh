import type { Repository } from "../repository.ts";
import { randomUUID } from "node:crypto";
import { hashPassword, verifyPassword, validatePassword } from "@navhub/core";
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
      "INSERT INTO users (id, username, password_hash, role, email, avatar, source, email_verified, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [id, username, "", "user", email, input.avatar ?? null, input.source ?? "github", 1, Date.now()],
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
  return { id, username: storedUsername, role: "user", email: storedEmail, avatar: input.avatar ?? null, source: input.source ?? "github", emailVerified: true };
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
    if (RESERVED_USERNAMES.has(cleanUsername.toLowerCase())) {
      return { ok: false, reason: "username_taken" };
    }
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
      "INSERT INTO users (id, username, password_hash, role, email, avatar, source, email_verified, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [identity, defaultName, "", "user", patch.email ?? null, patch.avatar ?? null, source, 0, Date.now()],
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

/* ------------------------- 账号生命周期（注册/登录/找回） ------------------------- */

/** 邮箱格式的宽松校验：只挡明显非法，不追求 RFC 完备（注册转化率优先） */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 系统保留用户名（禁止普通注册或修改资料占用） */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  "admin",
  "administrator",
  "root",
  "system",
  "navhub",
  "operator",
  "support",
  "security",
  "master",
]);

/** 系统保留邮箱后缀域名（禁止外部注册冒用） */
export const RESERVED_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "navhub.local",
  "localhost",
  "internal",
]);

/** 按邮箱查用户（邮箱非唯一索引，这里做应用层查重） */
export async function findUserByEmail(repo: Repository, email: string): Promise<UserRecord | null> {
  const row = (
    await repo.raw("SELECT * FROM users WHERE email = ? LIMIT 1", [email])
  )[0];
  return row ? rowToUser(row) : null;
}

/** 按用户 id 查邮箱（通知 email 投递用）；无邮箱返回 null */
export async function findUserEmailById(repo: Repository, userId: string): Promise<string | null> {
  const row = (
    await repo.raw("SELECT email FROM users WHERE id = ? LIMIT 1", [userId])
  )[0];
  return row?.email ?? null;
}

/**
 * 按「邮箱或用户名」查用户（登录入口）。
 * 顺序：邮箱优先（注册以邮箱为主键心智），再用户名。
 */
export async function findUserByIdentifier(
  repo: Repository,
  identifier: string,
): Promise<UserRecord | null> {
  const id = identifier.trim();
  if (!id) return null;
  const byEmail = (await repo.raw("SELECT * FROM users WHERE email = ? LIMIT 1", [id]))[0];
  if (byEmail) return rowToUser(byEmail);
  const byName = (await repo.raw("SELECT * FROM users WHERE username = ? LIMIT 1", [id]))[0];
  return byName ? rowToUser(byName) : null;
}

export type CreateUserResult =
  | { ok: true; user: UserRecord }
  | { ok: false; reason: "username_taken" | "email_taken" | "invalid_username" | "invalid_email" | "invalid_password" };

/**
 * 创建带密码的用户（注册）。
 *
 * 用户名冲突与邮箱冲突都返回可读原因，前端据此提示；密码在写入前用 scrypt 哈希，
 * 明文绝不落库。email_verified 默认 0——注册后必须走邮箱验证才能获得完整权限。
 */
export async function createUserWithPassword(
  repo: Repository,
  input: { username: string; email: string; password: string },
): Promise<CreateUserResult> {
  const username = input.username.trim();
  const email = input.email.trim().toLowerCase();
  const pwError = validatePassword(input.password);
  if (pwError) return { ok: false, reason: "invalid_password" };
  if (username.length < 1 || username.length > 40) return { ok: false, reason: "invalid_username" };
  if (!EMAIL_RE.test(email)) return { ok: false, reason: "invalid_email" };

  // 1. 保留用户名与保留邮箱阻断
  if (RESERVED_USERNAMES.has(username.toLowerCase())) {
    return { ok: false, reason: "username_taken" };
  }
  const emailDomain = email.split("@")[1]?.toLowerCase();
  if (emailDomain && RESERVED_EMAIL_DOMAINS.has(emailDomain)) {
    return { ok: false, reason: "invalid_email" };
  }

  const nameTaken = (
    await repo.raw("SELECT id FROM users WHERE username = ? LIMIT 1", [username])
  )[0];
  if (nameTaken) return { ok: false, reason: "username_taken" };
  const emailTaken = (
    await repo.raw("SELECT id FROM users WHERE email = ? LIMIT 1", [email])
  )[0];
  if (emailTaken) return { ok: false, reason: "email_taken" };

  const id = randomUUID();
  const passwordHash = await hashPassword(input.password);
  try {
    await repo.run(
      "INSERT INTO users (id, username, password_hash, role, email, avatar, source, email_verified, created_at) " +
        "VALUES (?,?,?,?,?,?,?,?,?)",
      [id, username, passwordHash, "user", email, null, "local", 0, Date.now()],
    );
  } catch (err) {
    // 并发注册撞唯一约束：转成可读原因，不把底层 SQL 错误透给前端
    const msg = err instanceof Error ? err.message : String(err);
    if (/users_username_idx|UNIQUE/i.test(msg)) return { ok: false, reason: "username_taken" };
    throw err;
  }
  const created = (await repo.raw("SELECT * FROM users WHERE id = ? LIMIT 1", [id]))[0];
  if (!created) throw new Error("注册后无法读回用户行");
  return { ok: true, user: rowToUser(created) };
}

/**
 * 校验口令登录。
 *
 * 返回 null 表示「用户不存在或密码错误」——**不区分两者**，避免账号枚举
 * （攻击者可用「该邮箱是否注册」来缩小撞库范围）。
 */
export async function verifyUserPassword(
  repo: Repository,
  identifier: string,
  password: string,
): Promise<UserRecord | null> {
  const user = await findUserByIdentifier(repo, identifier);
  if (!user) {
    // 用户不存在时仍做一次哈希校验，抹平响应时间差异（防时序侧信道）
    await verifyPassword(password, "scrypt$16384$8$1$AAAA$AAAA");
    return null;
  }
  const row = (
    await repo.raw("SELECT password_hash FROM users WHERE id = ? LIMIT 1", [user.id])
  )[0];
  const hash = row?.password_hash;
  if (!hash) return null;
  const ok = await verifyPassword(password, String(hash));
  return ok ? user : null;
}

/** 更新密码（找回密码流程用）：先哈希再写，明文不落库 */
export async function updateUserPassword(
  repo: Repository,
  userId: string,
  newPassword: string,
): Promise<boolean> {
  const pwError = validatePassword(newPassword);
  if (pwError) return false;
  const passwordHash = await hashPassword(newPassword);
  const changes = await repo.runCount(
    "UPDATE users SET password_hash = ? WHERE id = ?",
    [passwordHash, userId],
  );
  return changes > 0;
}

/** 标记邮箱已验证（邮箱验证流程消费令牌后调用） */
export async function setUserEmailVerified(repo: Repository, userId: string): Promise<boolean> {
  const changes = await repo.runCount(
    "UPDATE users SET email_verified = 1 WHERE id = ?",
    [userId],
  );
  return changes > 0;
}
