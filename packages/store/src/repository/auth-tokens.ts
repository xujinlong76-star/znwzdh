/**
 * 认证令牌仓储：邮箱验证 + 密码重置。
 *
 * 核心安全不变量：
 *  - **只存 sha256**：库里的 token_hash 无法反推明文链接；
 *  - **一次性消费**：`consumeAuthToken` 用单条 UPDATE 的条件更新实现原子消费，
 *    避免「先查后改」之间的重放窗口（并发请求同时读到未消费行）；
 *  - **带过期**：过期令牌永不可用，防止链接长期有效被钓鱼；
 *  - **purpose 隔离**：邮箱验证令牌不能当密码重置用（同一张表但 CHECK 约束 + 查询条件双重隔离）。
 */
import { randomUUID } from "node:crypto";
import type { Repository } from "../repository.ts";

export type AuthTokenPurpose = "email_verification" | "password_reset";

export interface CreateAuthTokenInput {
  userId: string;
  purpose: AuthTokenPurpose;
  /** 明文令牌的 sha256（hex） */
  tokenHash: string;
  /** 过期时刻（毫秒） */
  expiresAt: number;
}

/** 生成一条未消费的认证令牌行，返回其 id */
export async function createAuthToken(
  repo: Repository,
  input: CreateAuthTokenInput,
): Promise<string> {
  const id = randomUUID();
  await repo.run(
    "INSERT INTO auth_tokens (id, user_id, purpose, token_hash, expires_at, consumed_at, created_at) " +
      "VALUES (?,?,?,?,?,NULL,?)",
    [id, input.userId, input.purpose, input.tokenHash, input.expiresAt, Date.now()],
  );
  return id;
}

/**
 * 原子消费一条令牌。
 *
 * 成功返回 true 并把 consumed_at 置为当前时间；失败（不存在/已用/过期/用途不符/
 * 用户不符）返回 false 且不改任何行。**必须单条 UPDATE**——若拆成 SELECT+UPDATE，
 * 两个并发请求可能都读到「未消费」，从而用同一链接各重置一次密码。
 */
export async function consumeAuthToken(
  repo: Repository,
  input: { userId: string; purpose: AuthTokenPurpose; tokenHash: string; now?: number },
): Promise<boolean> {
  const now = input.now ?? Date.now();
  const changes = await repo.runCount(
    "UPDATE auth_tokens SET consumed_at = ? " +
      "WHERE token_hash = ? AND user_id = ? AND purpose = ? " +
      "AND consumed_at IS NULL AND expires_at > ?",
    [now, input.tokenHash, input.userId, input.purpose, now],
  );
  return changes > 0;
}

/** 该用户某用途下是否已有未消费且未过期的令牌（用于「重新发送」的节流判断） */
export async function hasActiveAuthToken(
  repo: Repository,
  userId: string,
  purpose: AuthTokenPurpose,
  now?: number,
): Promise<boolean> {
  const t = now ?? Date.now();
  const row = (
    await repo.raw(
      "SELECT id FROM auth_tokens WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > ? LIMIT 1",
      [userId, purpose, t],
    )
  )[0];
  return Boolean(row);
}

/** 清理过期/已消费的历史令牌（保留少量近期行用于审计即可） */
export async function pruneAuthTokens(repo: Repository, before: number): Promise<number> {
  return repo.runCount("DELETE FROM auth_tokens WHERE created_at < ?", [before]);
}
