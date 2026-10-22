/**
 * 工作区明文存储（独立于 E2EE 金库）。
 *
 * 历史问题：workspaces 模块曾把明文 JSON 写进 `user_vault_sync`（建表注释
 * 声明「服务端仅存密文 payload，无主密钥无法解密」）——表里密文与明文混存，
 * 隐私表述失真，且导出/注销都会漏掉这批键。
 *
 * 现在 workspaces 走本表（命名明确不含 vault/e2ee 字样），vault 表回归纯密文。
 * 键格式与旧版一致（`workspaces:<identity>` / `ws_members:<identity>:<wsId>`），
 * 便于迁移与 export 复用。
 */
import type { Repository } from "../repository.ts";

export interface WorkspaceBlobRecord {
  key: string;
  payload: string;
  updatedAt: number;
}

export async function getWorkspaceBlob(repo: Repository, key: string): Promise<WorkspaceBlobRecord | null> {
  const rows = await repo.raw(
    "SELECT user_id, payload, updated_at AS updatedat FROM user_workspace_blobs WHERE user_id = ? LIMIT 1",
    [key],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    key: String(row.user_id),
    payload: String(row.payload),
    updatedAt: Number(row.updatedat ?? 0),
  };
}

export async function saveWorkspaceBlob(repo: Repository, key: string, payload: string): Promise<void> {
  await repo.run(
    `INSERT INTO user_workspace_blobs (user_id, payload, updated_at)
     VALUES (?,?,?)
     ON CONFLICT (user_id) DO UPDATE SET
       payload = excluded.payload,
       updated_at = excluded.updated_at`,
    [key, payload, Date.now()],
  );
}
