/**
 * 用户数据主权：导出与注销。
 *
 * 导出是「用户能看到自己的全部数据」；注销是「用户能真正删掉自己的全部数据」。
 * 两个动作都只接受 canonical 登录身份（匿名身份由前端本地清理，不走这里）。
 *
 * 导出刻意不包含任何可还原的密钥：LLM 配置只保留模型/地址等非敏感字段，
 * apiKeyEnc 加密信封与金库 payload 密文都不导出（密文对用户没有意义，
 * 泄露却是额外的攻击面）。
 */
import type { Repository } from "../repository.ts";
import type {
  FavoriteFolderRecord,
  FavoriteRecord,
  UserProfileRecord,
  UserRecord,
  UserVaultRecord,
} from "./records.ts";
import { getSearchHistoryAll, type SearchHistoryItem } from "./history.ts";
import type { UserSettingsRecord } from "./settings.ts";
import type { UserLlmConfigRecord } from "./llm-config.ts";

/** 导出时单身份最多带上的搜索历史条数，避免超大账号把响应撑爆 */
export const EXPORT_HISTORY_LIMIT = 5000;

export interface ExportedLlmConfig {
  model: string;
  baseUrl: string;
  timeoutMs: number | null;
  jsonMode: string | null;
  allowPrivateNetwork: boolean | null;
  updatedAt: number;
}

export interface UserDataExport {
  exportedAt: number;
  identity: string;
  user: UserRecord | null;
  favorites: FavoriteRecord[];
  favoriteFolders: FavoriteFolderRecord[];
  searchHistory: { items: SearchHistoryItem[]; truncated: boolean };
  profile: UserProfileRecord | null;
  settings: UserSettingsRecord;
  llmConfig: ExportedLlmConfig | null;
  pluginInstalls: Array<{
    pluginId: string;
    slug: string;
    name: string;
    version: string;
    installedAt: number;
  }>;
  vault: Pick<UserVaultRecord, "version" | "updatedAt"> & { exists: boolean };
}

function safeLlmConfig(config: UserLlmConfigRecord | null): ExportedLlmConfig | null {
  if (!config) return null;
  const p = config.provider;
  const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
  return {
    model: str(p.model),
    baseUrl: str(p.baseUrl),
    timeoutMs: num(p.timeoutMs),
    jsonMode: typeof p.jsonMode === "string" ? p.jsonMode : null,
    allowPrivateNetwork: bool(p.allowPrivateNetwork),
    updatedAt: config.updatedAt,
  };
}

export async function exportUserData(repo: Repository, identity: string): Promise<UserDataExport> {
  const [user, favorites, folders, history, profile, settings, llm, installs, vault] = await Promise.all([
    repo.getUser(identity),
    repo.listFavorites(identity),
    repo.listFavoriteFolders(identity),
    getSearchHistoryAll(repo, identity, EXPORT_HISTORY_LIMIT),
    repo.getUserProfile(identity),
    repo.getUserSettings(identity),
    repo.getUserLlmConfig(identity),
    repo.listPluginInstallsByIdentity(identity),
    repo.getUserVault(identity),
  ]);

  return {
    exportedAt: Date.now(),
    identity,
    user,
    favorites,
    favoriteFolders: folders,
    searchHistory: history,
    profile,
    settings,
    llmConfig: safeLlmConfig(llm),
    pluginInstalls: installs.map((item) => ({
      pluginId: item.install.pluginId,
      slug: item.plugin.slug,
      name: item.plugin.name,
      version: item.install.version,
      installedAt: item.install.installedAt,
    })),
    vault: vault
      ? { exists: true, version: vault.version, updatedAt: vault.updatedAt }
      : { exists: false, version: 0, updatedAt: 0 },
  };
}

export interface UserDataDeletionCounts {
  favorites: number;
  favoriteFolders: number;
  searchHistory: number;
  events: number;
  profile: number;
  vault: number;
  llmConfig: number;
  settings: number;
  identityAliases: number;
  identityMerges: number;
  pluginInstalls: number;
  pluginStars: number;
}

/**
 * 删除某身份的全部用户数据（单事务）。
 *
 * 注意「工作区」也以 vault 的 `workspaces:` 前缀存着，但那是多人共享的协作数据，
 * 单方面注销账号不该把其他成员的工作区一起删掉——这里只清该身份的私有数据。
 */
export async function deleteUserData(repo: Repository, identity: string): Promise<UserDataDeletionCounts> {
  return repo.withTransaction(async () => {
    const count = async (sql: string, params: unknown[]): Promise<number> =>
      Number((await repo.raw(sql, params))[0]?.c ?? 0);

    const counts: UserDataDeletionCounts = {
      favorites: await count("SELECT COUNT(*) AS c FROM favorites WHERE user_id = ?", [identity]),
      favoriteFolders: await count("SELECT COUNT(*) AS c FROM favorite_folders WHERE user_id = ?", [identity]),
      searchHistory: await count("SELECT COUNT(*) AS c FROM search_history WHERE user_id = ?", [identity]),
      events: await count("SELECT COUNT(*) AS c FROM events WHERE identity = ?", [identity]),
      profile: await count("SELECT COUNT(*) AS c FROM user_profiles WHERE user_id = ?", [identity]),
      vault: await count("SELECT COUNT(*) AS c FROM user_vault_sync WHERE user_id = ?", [identity]),
      llmConfig: await count("SELECT COUNT(*) AS c FROM user_llm_configs WHERE identity = ?", [identity]),
      settings: await count("SELECT COUNT(*) AS c FROM user_settings WHERE identity = ?", [identity]),
      identityAliases: await count(
        "SELECT COUNT(*) AS c FROM identity_aliases WHERE alias = ? OR canonical = ?",
        [identity, identity],
      ),
      identityMerges: await count(
        "SELECT COUNT(*) AS c FROM identity_merges WHERE source = ? OR target = ?",
        [identity, identity],
      ),
      pluginInstalls: await count("SELECT COUNT(*) AS c FROM plugin_installs WHERE identity = ?", [identity]),
      pluginStars: await count("SELECT COUNT(*) AS c FROM plugin_stars WHERE identity = ?", [identity]),
    };

    await repo.run("DELETE FROM favorites WHERE user_id = ?", [identity]);
    await repo.run("DELETE FROM favorite_folders WHERE user_id = ?", [identity]);
    await repo.run("DELETE FROM search_history WHERE user_id = ?", [identity]);
    await repo.run("DELETE FROM events WHERE identity = ?", [identity]);
    await repo.run("DELETE FROM user_profiles WHERE user_id = ?", [identity]);
    await repo.run("DELETE FROM user_vault_sync WHERE user_id = ?", [identity]);
    await repo.run("DELETE FROM user_llm_configs WHERE identity = ?", [identity]);
    await repo.run("DELETE FROM user_settings WHERE identity = ?", [identity]);
    await repo.run("DELETE FROM identity_aliases WHERE alias = ? OR canonical = ?", [identity, identity]);
    await repo.run("DELETE FROM identity_merges WHERE source = ? OR target = ?", [identity, identity]);
    await repo.run("DELETE FROM plugin_installs WHERE identity = ?", [identity]);
    await repo.run("DELETE FROM plugin_stars WHERE identity = ?", [identity]);

    return counts;
  });
}
