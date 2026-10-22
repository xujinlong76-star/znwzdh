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
