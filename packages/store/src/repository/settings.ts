/**
 * 用户中心设置。
 *
 * 目前只有两项：
 *  - personalizationEnabled：搜索结果是否注入个性化画像（关闭后 search 路由不再读画像）
 *  - favoriteSignalCutoff：用户「清理收藏信号」的时间水位，早于它的收藏不再参与画像
 *
 * 缺省即「开启 + 无水位」——旧用户没有这行记录也不需要迁移回填。
 */
import type { Repository } from "../repository.ts";

export interface UserSettingsRecord {
  identity: string;
  personalizationEnabled: boolean;
  favoriteSignalCutoff: number;
  updatedAt: number;
}

export async function getUserSettings(repo: Repository, identity: string): Promise<UserSettingsRecord> {
  const row = (
    await repo.raw(
      "SELECT personalization_enabled AS enabled, favorite_signal_cutoff AS cutoff, updated_at AS updatedat FROM user_settings WHERE identity = ? LIMIT 1",
      [identity],
    )
  )[0];
  if (!row) {
    return { identity, personalizationEnabled: true, favoriteSignalCutoff: 0, updatedAt: 0 };
  }
  return {
    identity,
    personalizationEnabled: Number(row.enabled ?? 1) !== 0,
    favoriteSignalCutoff: Number(row.cutoff ?? 0),
    updatedAt: Number(row.updatedat ?? 0),
  };
}

export async function updateUserSettings(
  repo: Repository,
  identity: string,
  patch: { personalizationEnabled?: boolean; favoriteSignalCutoff?: number },
): Promise<UserSettingsRecord> {
  const current = await getUserSettings(repo, identity);
  const next = {
    personalizationEnabled: patch.personalizationEnabled ?? current.personalizationEnabled,
    favoriteSignalCutoff: patch.favoriteSignalCutoff ?? current.favoriteSignalCutoff,
    updatedAt: Date.now(),
  };
  await repo.run(
    `INSERT INTO user_settings (identity, personalization_enabled, favorite_signal_cutoff, created_at, updated_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT (identity) DO UPDATE SET
       personalization_enabled = excluded.personalization_enabled,
       favorite_signal_cutoff = excluded.favorite_signal_cutoff,
       updated_at = excluded.updated_at`,
    [
      identity,
      next.personalizationEnabled ? 1 : 0,
      next.favoriteSignalCutoff,
      // created_at 只在首次插入时生效，冲突更新分支不会覆盖它
      next.updatedAt,
      next.updatedAt,
    ],
  );
  return { identity, ...next };
}

export async function deleteUserSettings(repo: Repository, identity: string): Promise<void> {
  await repo.run("DELETE FROM user_settings WHERE identity = ?", [identity]);
}
