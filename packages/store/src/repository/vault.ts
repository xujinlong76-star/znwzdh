import type { Repository } from "../repository.ts";
import type {
  UserVaultRecord,
} from "./records.ts";

export async function getUserVault(repo: Repository, userId: string): Promise<UserVaultRecord | null> {
  const rows = await repo.raw(
    "SELECT user_id, payload, version, updated_at AS updatedat FROM user_vault_sync WHERE user_id = ? LIMIT 1",
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    userId: String(row.user_id),
    payload: String(row.payload),
    version: Number(row.version ?? 1),
    updatedAt: Number(row.updatedat ?? 0),
  };
}

export async function saveUserVault(repo: Repository, userId: string, payload: string): Promise<{ version: number; updatedAt: number }> {
  const now = Date.now();
  await repo.run(
    `INSERT INTO user_vault_sync (user_id, payload, version, updated_at)
     VALUES (?,?, 1, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       payload = excluded.payload,
       version = user_vault_sync.version + 1,
       updated_at = excluded.updated_at`,
    [userId, payload, now],
  );
  const updated = await repo.getUserVault(userId);
  return {
    version: updated?.version ?? 1,
    updatedAt: updated?.updatedAt ?? now,
  };
}

export async function deleteUserVault(repo: Repository, userId: string): Promise<boolean> {
  await repo.run("DELETE FROM user_vault_sync WHERE user_id = ?", [userId]);
  return true;
}

export type VaultSaveResult =
  | { ok: true; version: number; updatedAt: number }
  | { ok: false; conflict: true; current: { version: number; updatedAt: number } | null };

/**
 * 带版本前置条件的写入（多端同步）。
 *
 * 客户端带上「我最后看到的版本」：
 *  - expectedVersion = 0 表示本地认为云端没有金库；
 *  - expectedVersion = n 表示只在云端仍是第 n 版时才覆盖。
 * 不匹配就返回 409 语义的冲突结果，由前端决定「拉取最新」还是「强制覆盖」。
 * 条件写在 UPDATE 的 WHERE 里而不是先读后写：读与写之间可能被另一个设备插入一次写入。
 */
export async function saveUserVaultIfUnchanged(
  repo: Repository,
  userId: string,
  payload: string,
  expectedVersion: number,
): Promise<VaultSaveResult> {
  return repo.withTransaction(async () => {
    const current = await getUserVault(repo, userId);
    if (!current) {
      if (expectedVersion > 0) return { ok: false, conflict: true, current: null };
      const saved = await saveUserVault(repo, userId, payload);
      return { ok: true, ...saved };
    }
    if (current.version !== expectedVersion) {
      return {
        ok: false,
        conflict: true,
        current: { version: current.version, updatedAt: current.updatedAt },
      };
    }
    const now = Date.now();
    const changes = await repo.runCount(
      "UPDATE user_vault_sync SET payload = ?, version = version + 1, updated_at = ? WHERE user_id = ? AND version = ?",
      [payload, now, userId, expectedVersion],
    );
    if (changes === 0) {
      const latest = await getUserVault(repo, userId);
      return {
        ok: false,
        conflict: true,
        current: latest ? { version: latest.version, updatedAt: latest.updatedAt } : null,
      };
    }
    return { ok: true, version: expectedVersion + 1, updatedAt: now };
  });
}
