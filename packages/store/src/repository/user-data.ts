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

/**
 * LIKE 前缀转义：identity 里可能出现 `_`（GitHub 用户名）或 `%`，
 * 不转义会把 `ws_members:a_b:` 匹配成 `ws_members:axb:`。
 */
function escapeLikePrefix(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => "\\" + ch);
}

/** 导出时单身份最多带上的搜索历史条数，避免超大账号把响应撑爆 */
export const EXPORT_HISTORY_LIMIT = 5000;

/**
 * 导出时单身份最多带上的收藏条数。必须与导入端 favorites 的 zod 上限同源：
 * 历史域曾修过「导出无上限、导入有上限」的往返不对称（超限的合法备份整份 400），
 * 收藏域按同一修法对齐（T2）。
 */
export const EXPORT_FAVORITES_LIMIT = 20000;

/** 当前导出格式版本。导入端据此判别「备份比服务新」的向前兼容场景。 */
export const EXPORT_SCHEMA_VERSION = 1;

export interface ExportedLlmConfig {
  model: string;
  baseUrl: string;
  timeoutMs: number | null;
  jsonMode: string | null;
  allowPrivateNetwork: boolean | null;
  updatedAt: number;
}

export interface UserDataExport {
  /** 备份格式版本（导入端向前兼容判别用；见 EXPORT_SCHEMA_VERSION） */
  schemaVersion: number;
  exportedAt: number;
  identity: string;
  user: UserRecord | null;
  favorites: FavoriteRecord[];
  /** 备份里的收藏是否达到了 EXPORT_FAVORITES_LIMIT（与历史域同语义） */
  favoritesTruncated: boolean;
  favoriteFolders: FavoriteFolderRecord[];
  searchHistory: { items: SearchHistoryItem[]; truncated: boolean };
  profile: UserProfileRecord | null;
  settings: UserSettingsRecord;
  llmConfig: ExportedLlmConfig | null;
  /** 插件星标（导出补齐：原先只有安装记录） */
  pluginStars: Array<{ pluginId: string; slug: string | null; name: string | null; starredAt: number }>;
  /** 用户撰写的插件评价（含正文——这是用户自己的内容，属于数据主权范围） */
  pluginReviews: Array<{
    id: string;
    pluginSlug: string | null;
    pluginName: string | null;
    rating: number;
    title: string | null;
    content: string | null;
    installedVersion: string;
    status: string;
    createdAt: number;
    updatedAt: number;
  }>;
  /** 本人名下的工作区原始记录（workspaces:<identity> 与 ws_members:<identity>:*） */
  workspaces: Array<{ key: string; payload: string | null }>;
  /** 行为事件按 kind 聚合（不导出逐条明细：events 180 天自动过期，聚合同等可用且体积可控） */
  eventsSummary: Array<{ kind: string; count: number; lastAt: number }>;
  pluginInstalls: Array<{
    pluginId: string;
    slug: string;
    name: string;
    version: string;
    installedAt: number;
  }>;
  vault: Pick<UserVaultRecord, "version" | "updatedAt"> & { exists: boolean };
  /**
   * CRDT 编辑日志（`crdt:<identity>` 行）。
   *
   * 它此前既不在导出包里、也不在注销删除清单里：用户换设备后自建分类/
   * 自定义站点全部消失，注销后这些日志仍留在服务端（删除权未履行）。
   */
  crdt: { exists: boolean; payload: string | null; updatedAt: number };
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
  const [user, favorites, folders, history, profile, settings, llm, installs, vault, crdtVault] = await Promise.all([
    repo.getUser(identity),
    repo.listFavorites(identity),
    repo.listFavoriteFolders(identity),
    getSearchHistoryAll(repo, identity, EXPORT_HISTORY_LIMIT),
    repo.getUserProfile(identity),
    repo.getUserSettings(identity),
    repo.getUserLlmConfig(identity),
    repo.listPluginInstallsByIdentity(identity),
    repo.getUserVault(identity),
    // 编辑日志是该身份的独立 vault 行（`crdt:<id>`），不属于默认 vault
    repo.getUserVault("crdt:" + identity),
  ]);
  // 星标 / 评价 / 工作区 / 事件聚合：原先导出缺这四类，用户拿到的「全部数据」名不副实
  const [starRows, reviewRows, workspaceRows, eventRows] = await Promise.all([
    repo.raw(
      "SELECT s.plugin_id, p.slug, p.name, s.created_at FROM plugin_stars s LEFT JOIN plugins p ON p.id = s.plugin_id WHERE s.identity = ? ORDER BY s.created_at DESC",
      [identity],
    ),
    repo.raw(
      "SELECT r.id, p.slug AS plugin_slug, p.name AS plugin_name, r.rating, r.title, r.content, r.installed_version, r.status, r.created_at, r.updated_at FROM plugin_reviews r LEFT JOIN plugins p ON p.id = r.plugin_id WHERE r.identity = ? ORDER BY r.created_at DESC LIMIT 1000",
      [identity],
    ),
    repo.raw(
      "SELECT user_id, payload FROM user_workspace_blobs WHERE user_id = ? OR user_id = ? OR user_id LIKE ? ESCAPE '\\'",
      [identity, "workspaces:" + identity, escapeLikePrefix("ws_members:" + identity + ":") + "%"],
    ),
    repo.raw(
      "SELECT kind, COUNT(*) AS c, MAX(created_at) AS last FROM events WHERE identity = ? GROUP BY kind",
      [identity],
    ),
  ]);

  // 收藏截断与历史同语义：导出端先声明上限，导入端的 zod 上限与之同源
  const favoritesTruncated = favorites.length > EXPORT_FAVORITES_LIMIT;
  const favoritesCapped = favoritesTruncated ? favorites.slice(0, EXPORT_FAVORITES_LIMIT) : favorites;

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: Date.now(),
    identity,
    user,
    favorites: favoritesCapped,
    favoritesTruncated,
    favoriteFolders: folders,
    searchHistory: history,
    profile,
    settings,
    llmConfig: safeLlmConfig(llm),
    pluginStars: starRows.map((row) => ({
      pluginId: String(row.plugin_id),
      slug: row.slug == null ? null : String(row.slug),
      name: row.name == null ? null : String(row.name),
      starredAt: Number(row.created_at),
    })),
    pluginReviews: reviewRows.map((row) => ({
      id: String(row.id),
      pluginSlug: row.plugin_slug == null ? null : String(row.plugin_slug),
      pluginName: row.plugin_name == null ? null : String(row.plugin_name),
      rating: Number(row.rating),
      title: row.title == null ? null : String(row.title),
      content: row.content == null ? null : String(row.content),
      installedVersion: String(row.installed_version),
      status: String(row.status),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    })),
    workspaces: workspaceRows.map((row) => ({
      key: String(row.user_id),
      payload: row.payload == null ? null : String(row.payload),
    })),
    eventsSummary: eventRows.map((row) => ({
      kind: String(row.kind),
      count: Number(row.c),
      lastAt: Number(row.last),
    })),
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
    crdt: crdtVault
      ? { exists: true, payload: crdtVault.payload, updatedAt: crdtVault.updatedAt }
      : { exists: false, payload: null, updatedAt: 0 },
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
  pluginReviews: number;
  sessions: number;
  /** 已匿名化的用量行数（UPDATE ... SET identity = NULL） */
  llmUsage: number;
  workspaces: number;
  userRow: number;
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
      // 默认金库 + CRDT 编辑日志：回执里的删除数必须与真实清理范围一致
      vault: await count("SELECT COUNT(*) AS c FROM user_vault_sync WHERE user_id = ? OR user_id = ?", [
        identity,
        "crdt:" + identity,
      ]),
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
      pluginReviews: await count("SELECT COUNT(*) AS c FROM plugin_reviews WHERE identity = ?", [identity]),
      sessions: await count("SELECT COUNT(*) AS c FROM sessions WHERE user_id = ?", [identity]),
      llmUsage: await count("SELECT COUNT(*) AS c FROM llm_usage WHERE identity = ?", [identity]),
      workspaces:
        (await count(
          "SELECT COUNT(*) AS c FROM user_workspace_blobs WHERE user_id = ? OR user_id LIKE ? ESCAPE '\\'",
          ["workspaces:" + identity, escapeLikePrefix("ws_members:" + identity + ":") + "%"],
        )) +
        (await count(
          "SELECT COUNT(*) AS c FROM user_vault_sync WHERE user_id = ? OR user_id LIKE ? ESCAPE '\\'",
          ["workspaces:" + identity, escapeLikePrefix("ws_members:" + identity + ":") + "%"],
        )),
      userRow: await count("SELECT COUNT(*) AS c FROM users WHERE id = ? AND id LIKE '%:%'", [identity]),
    };

    await repo.run("DELETE FROM favorites WHERE user_id = ?", [identity]);
    await repo.run("DELETE FROM favorite_folders WHERE user_id = ?", [identity]);
    await repo.run("DELETE FROM search_history WHERE user_id = ?", [identity]);
    await repo.run("DELETE FROM events WHERE identity = ?", [identity]);
    await repo.run("DELETE FROM user_profiles WHERE user_id = ?", [identity]);
    await repo.run("DELETE FROM user_vault_sync WHERE user_id = ?", [identity]);
    // CRDT 编辑日志是另一行（`crdt:<id>`）：精确匹配删不到，注销后会永久残留
    await repo.run("DELETE FROM user_vault_sync WHERE user_id = ?", ["crdt:" + identity]);
    await repo.run("DELETE FROM user_llm_configs WHERE identity = ?", [identity]);
    await repo.run("DELETE FROM user_settings WHERE identity = ?", [identity]);
    await repo.run("DELETE FROM identity_aliases WHERE alias = ? OR canonical = ?", [identity, identity]);
    await repo.run("DELETE FROM identity_merges WHERE source = ? OR target = ?", [identity, identity]);

    // 同步扣减活跃插件安装数与星标数，避免重复注册-安装/星标-注销造成计数无限膨胀与失真
    const activeInstallRows = await repo.raw(
      "SELECT plugin_id FROM plugin_installs WHERE identity = ? AND removed_at IS NULL",
      [identity],
    );
    for (const row of activeInstallRows) {
      await repo.run(
        "UPDATE plugins SET install_count = CASE WHEN install_count > 0 THEN install_count - 1 ELSE 0 END WHERE id = ?",
        [row.plugin_id],
      );
    }
    const starredRows = await repo.raw("SELECT plugin_id FROM plugin_stars WHERE identity = ?", [identity]);
    for (const row of starredRows) {
      await repo.run(
        "UPDATE plugins SET star_count = CASE WHEN star_count > 0 THEN star_count - 1 ELSE 0 END WHERE id = ?",
        [row.plugin_id],
      );
    }

    await repo.run("DELETE FROM plugin_installs WHERE identity = ?", [identity]);
    await repo.run("DELETE FROM plugin_stars WHERE identity = ?", [identity]);
    // 正文属于用户内容：注销后不得继续公开可见（原先整表漏删，评价会留在插件页上）
    await repo.run("DELETE FROM plugin_reviews WHERE identity = ?", [identity]);
    // 会话与用量：会话直接删；用量保留聚合价值但抹掉身份（可逆性为零，等同匿名化）
    await repo.run("DELETE FROM sessions WHERE user_id = ?", [identity]);
    await repo.run("DELETE FROM notifications WHERE identity = ?", [identity]);
    await repo.run("DELETE FROM api_tokens WHERE owner_identity = ?", [identity]);
    await repo.run("UPDATE llm_usage SET identity = NULL WHERE identity = ?", [identity]);
    // 本人名下的工作区记录（workspaces:<id> 与成员名册）。其他成员的工作区不受影响。
    // 新表为主；同时清 vault 里的历史残留（迁移失败/未跑到的部署也能删干净）。
    await repo.run("DELETE FROM user_workspace_blobs WHERE user_id = ? OR user_id LIKE ? ESCAPE '\\'", [
      "workspaces:" + identity,
      escapeLikePrefix("ws_members:" + identity + ":") + "%",
    ]);
    await repo.run("DELETE FROM user_vault_sync WHERE user_id = ? OR user_id LIKE ? ESCAPE '\\'", [
      "workspaces:" + identity,
      escapeLikePrefix("ws_members:" + identity + ":") + "%",
    ]);
    // OAuth 账号行：只删 canonical 形态（含 ':'）——内置管理员账号 id 不含 ':'，不会被误删
    await repo.run("DELETE FROM users WHERE id = ? AND id LIKE '%:%'", [identity]);

    return counts;
  });
}
