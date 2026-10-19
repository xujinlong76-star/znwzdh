/**
 * 用户级 LLM 配置仓储。
 *
 * 只负责「按身份存取 JSON」；密钥加解密、字段校验与掩码在 API 层
 * （apps/api/src/llm-config.ts）完成，仓储层不感知密钥形态。
 */
import type { Repository } from "../repository.ts";

export interface UserLlmConfigRecord {
  identity: string;
  /** 解析后的 JSON（其中 apiKeyEnc 为加密信封，本层不解密） */
  provider: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

function parseProvider(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    // 历史脏数据不应让整条读链路失败：按「无配置」处理
    return {};
  }
}

export async function getUserLlmConfig(repo: Repository, identity: string): Promise<UserLlmConfigRecord | null> {
  const rows = await repo.raw(
    "SELECT identity, provider, created_at, updated_at FROM user_llm_configs WHERE identity = ? LIMIT 1",
    [identity],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    identity: String(row.identity),
    provider: parseProvider(row.provider),
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

export async function upsertUserLlmConfig(
  repo: Repository,
  identity: string,
  provider: Record<string, unknown>,
): Promise<void> {
  const now = Date.now();
  const payload = JSON.stringify(provider);
  if (repo.db.dialect === "pg") {
    await repo.run(
      "INSERT INTO user_llm_configs (identity, provider, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (identity) DO UPDATE SET provider = EXCLUDED.provider, updated_at = EXCLUDED.updated_at",
      [identity, payload, now, now],
    );
  } else {
    await repo.run(
      "INSERT INTO user_llm_configs (identity, provider, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(identity) DO UPDATE SET provider = excluded.provider, updated_at = excluded.updated_at",
      [identity, payload, now, now],
    );
  }
}

export async function deleteUserLlmConfig(repo: Repository, identity: string): Promise<void> {
  await repo.run("DELETE FROM user_llm_configs WHERE identity = ?", [identity]);
}
