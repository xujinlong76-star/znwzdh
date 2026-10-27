import type { Repository } from "../repository.ts";

export async function getSystemState<T = unknown>(repo: Repository, key: string): Promise<T | null> {
  const rows = await repo.raw("SELECT value FROM system_states WHERE key = ? LIMIT 1", [key]);
  const val = rows[0]?.value;
  if (val === undefined || val === null) return null;
  try {
    return JSON.parse(String(val)) as T;
  } catch {
    return val as T;
  }
}

export async function setSystemState(repo: Repository, key: string, value: unknown): Promise<void> {
  const now = Date.now();
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (repo.db.dialect === "pg") {
    await repo.run(
      "INSERT INTO system_states (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at",
      [key, serialized, now],
    );
  } else {
    await repo.run(
      "INSERT INTO system_states (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      [key, serialized, now],
    );
  }
}

/** 删除一条系统状态（用于「恢复默认」：清除 DB 覆盖后回退环境变量）。 */
export async function deleteSystemState(repo: Repository, key: string): Promise<void> {
  await repo.run("DELETE FROM system_states WHERE key = ?", [key]);
}

/**
 * 原子占坑：多实例共享的「窗口内只做一次」原语。
 *
 * 仅当 key 不存在、或已存在的记录 `updated_at` 早于 `now - windowMs` 时，
 * 才把它写成 value 并返回 true；并发调用中最多只有一个返回 true。
 * 为什么必须是单条 UPSERT 而不是「先读后写」：两个副本同时读到「没有记录」
 * 再各自写入，就会各发一条告警——去重反而变成了双发。
 */
export async function claimSystemState(
  repo: Repository,
  key: string,
  value: unknown,
  windowMs: number,
  now = Date.now(),
): Promise<boolean> {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  const threshold = now - Math.max(0, windowMs);
  const sql =
    repo.db.dialect === "pg"
      ? "INSERT INTO system_states (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at WHERE system_states.updated_at < ?"
      : "INSERT INTO system_states (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at WHERE system_states.updated_at < ?";
  const changes = await repo.runCount(sql, [key, serialized, now, threshold]);
  return changes > 0;
}
