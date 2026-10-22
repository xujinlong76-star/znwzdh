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
 *
 * 为什么删掉 email 兜底：OAuth provider 返回的 email 是「用户声称的」而非
 * 「已证明的」——GitHub 允许账号隐藏真实邮箱、也允许填入未验证地址；同一邮箱
 * 还可能同时属于内置 admin 或另一个真实用户。旧实现「按 username 查不到就按
 * email 查，命中即 UPDATE 该行」，等于把「邮箱字符串相同」当成「同一个人」，
 * 任何人注册一个邮箱相同的 OAuth 账号即可接管既有账号的全部数据（收藏、画像、
 * vault），这是一条完整的账号接管路径，且没有任何提示。
 *
 * id 优先于 username：`provider:providerId` 是 provider 签发的主体标识（OAuth sub），
 * 改名后仍然稳定；而 username 会变。若只按 username 匹配，GitHub 改名后的用户
 * 会带着同一个 id 走 INSERT → 主键冲突 → 登录 500，所以两条都要认（都不涉及 email）。
 *
 * 代价（已知、可接受）：username 与 providerId 双双变化（换账号）会得到新行；历史
 * 上靠 email 绑定起来的那批用户若 username 也不再匹配，可用 `POST /api/me/merge`
 * 把旧 id 的数据归并过来；身份别名表保证旧 anonId 仍可解析。
 *
 * 另外：users.email 现在有部分唯一索引（见 migrate.ts 的 dedupeUserEmails +
 * users_email_unique_idx）。跨 provider 同邮箱（如 Google 与 GitHub 用同一地址）
 * 会撞唯一约束，此时降级为「不写入 email」而不是让登录 500——email 在本系统
 * 只作展示，丢一个字段远比登录失败轻。
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
