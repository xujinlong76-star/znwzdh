/**
 * 用户中心设置。
 *
 * 包含核心个性化开关与扩展导航/隐私/交互偏好：
 *  - personalizationEnabled：搜索结果是否注入个性化画像（关闭后 search 路由不再读画像）
 *  - favoriteSignalCutoff：用户「清理收藏信号」的时间水位，早于它的收藏不再参与画像
 *  - defaultSearchEngine：默认搜索引擎（internal / google / bing / duckduckgo / github / perplexity）
 *  - openLinksInNewTab：点击导航站点卡片是否默认在新标签页打开
 *  - cardDensity：站点卡片展示密度（comfortable / compact / minimal）
 *  - speculativeZeroRttEnabled：是否启用搜索框 0-RTT 推测意图即时计算卡片
 *  - daypartSceneEnabled：是否开启早/中/晚全天候时段智能场景流推荐
 *  - spotlightShortcut：全局唤醒搜索框快捷键偏好（mod+k / slash / both）
 *  - searchHistoryEnabled：是否自动记录云端搜索历史
 *  - telemetryEnabled：是否允许记录行为事件用于统计与体验优化
 *  - historyRetentionDays：历史与行为数据自动保留天数（30 / 90 / 180 / 365）
 *
 * 缺省即「开启 + 默认体验」——旧用户没有这行记录或旧表尚未迁移 preferences_json 列时也不需要迁移回填即可安全读取。
 */
import type { Repository } from "../repository.ts";

export type SearchEngineId = "internal" | "google" | "bing" | "duckduckgo" | "github" | "perplexity";
export type CardDensityMode = "comfortable" | "compact" | "minimal";
export type SpotlightShortcutMode = "mod+k" | "slash" | "both";
export type HistoryRetentionDays = 30 | 90 | 180 | 365;

export interface ExtendedUserPreferences {
  defaultSearchEngine: SearchEngineId;
  openLinksInNewTab: boolean;
  cardDensity: CardDensityMode;
  speculativeZeroRttEnabled: boolean;
  daypartSceneEnabled: boolean;
  spotlightShortcut: SpotlightShortcutMode;
  searchHistoryEnabled: boolean;
  telemetryEnabled: boolean;
  historyRetentionDays: HistoryRetentionDays;
}

export interface UserSettingsRecord extends ExtendedUserPreferences {
  identity: string;
  personalizationEnabled: boolean;
  favoriteSignalCutoff: number;
  updatedAt: number;
}

export type UserSettingsPatch = Partial<Omit<UserSettingsRecord, "identity" | "updatedAt">>;

export const DEFAULT_EXTENDED_PREFERENCES: ExtendedUserPreferences = {
  defaultSearchEngine: "internal",
  openLinksInNewTab: true,
  cardDensity: "comfortable",
  speculativeZeroRttEnabled: true,
  daypartSceneEnabled: true,
  spotlightShortcut: "both",
  searchHistoryEnabled: true,
  telemetryEnabled: true,
  historyRetentionDays: 180,
};

const VALID_ENGINES = new Set<SearchEngineId>(["internal", "google", "bing", "duckduckgo", "github", "perplexity"]);
const VALID_DENSITIES = new Set<CardDensityMode>(["comfortable", "compact", "minimal"]);
const VALID_SHORTCUTS = new Set<SpotlightShortcutMode>(["mod+k", "slash", "both"]);
const VALID_RETENTION_DAYS = new Set<HistoryRetentionDays>([30, 90, 180, 365]);

export function parseExtendedPreferences(raw: unknown): ExtendedUserPreferences {
  if (!raw) return { ...DEFAULT_EXTENDED_PREFERENCES };
  let parsed: Record<string, unknown> = {};
  if (typeof raw === "string") {
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        parsed = obj as Record<string, unknown>;
      }
    } catch {
      return { ...DEFAULT_EXTENDED_PREFERENCES };
    }
  } else if (typeof raw === "object" && !Array.isArray(raw)) {
    parsed = raw as Record<string, unknown>;
  }

  const engine = parsed.defaultSearchEngine as SearchEngineId;
  const density = parsed.cardDensity as CardDensityMode;
  const shortcut = parsed.spotlightShortcut as SpotlightShortcutMode;
  const retention = Number(parsed.historyRetentionDays) as HistoryRetentionDays;

  return {
    defaultSearchEngine: VALID_ENGINES.has(engine) ? engine : DEFAULT_EXTENDED_PREFERENCES.defaultSearchEngine,
    openLinksInNewTab:
      typeof parsed.openLinksInNewTab === "boolean"
        ? parsed.openLinksInNewTab
        : DEFAULT_EXTENDED_PREFERENCES.openLinksInNewTab,
    cardDensity: VALID_DENSITIES.has(density) ? density : DEFAULT_EXTENDED_PREFERENCES.cardDensity,
    speculativeZeroRttEnabled:
      typeof parsed.speculativeZeroRttEnabled === "boolean"
        ? parsed.speculativeZeroRttEnabled
        : DEFAULT_EXTENDED_PREFERENCES.speculativeZeroRttEnabled,
    daypartSceneEnabled:
      typeof parsed.daypartSceneEnabled === "boolean"
        ? parsed.daypartSceneEnabled
        : DEFAULT_EXTENDED_PREFERENCES.daypartSceneEnabled,
    spotlightShortcut: VALID_SHORTCUTS.has(shortcut) ? shortcut : DEFAULT_EXTENDED_PREFERENCES.spotlightShortcut,
    searchHistoryEnabled:
      typeof parsed.searchHistoryEnabled === "boolean"
        ? parsed.searchHistoryEnabled
        : DEFAULT_EXTENDED_PREFERENCES.searchHistoryEnabled,
    telemetryEnabled:
      typeof parsed.telemetryEnabled === "boolean"
        ? parsed.telemetryEnabled
        : DEFAULT_EXTENDED_PREFERENCES.telemetryEnabled,
    historyRetentionDays: VALID_RETENTION_DAYS.has(retention)
      ? retention
      : DEFAULT_EXTENDED_PREFERENCES.historyRetentionDays,
  };
}

export async function getUserSettings(repo: Repository, identity: string): Promise<UserSettingsRecord> {
  const row = (
    await repo.raw(
      "SELECT * FROM user_settings WHERE identity = ? LIMIT 1",
      [identity],
    )
  )[0];
  if (!row) {
    return {
      identity,
      personalizationEnabled: true,
      favoriteSignalCutoff: 0,
      ...DEFAULT_EXTENDED_PREFERENCES,
      updatedAt: 0,
    };
  }
  const ext = parseExtendedPreferences(row.preferences_json);
  return {
    identity,
    personalizationEnabled: Number(row.personalization_enabled ?? row.enabled ?? 1) !== 0,
    favoriteSignalCutoff: Number(row.favorite_signal_cutoff ?? row.cutoff ?? 0),
    ...ext,
    updatedAt: Number(row.updated_at ?? row.updatedat ?? 0),
  };
}

export async function updateUserSettings(
  repo: Repository,
  identity: string,
  patch: UserSettingsPatch,
): Promise<UserSettingsRecord> {
  const current = await getUserSettings(repo, identity);
  const nextExt: ExtendedUserPreferences = parseExtendedPreferences({
    defaultSearchEngine: patch.defaultSearchEngine ?? current.defaultSearchEngine,
    openLinksInNewTab: patch.openLinksInNewTab ?? current.openLinksInNewTab,
    cardDensity: patch.cardDensity ?? current.cardDensity,
    speculativeZeroRttEnabled: patch.speculativeZeroRttEnabled ?? current.speculativeZeroRttEnabled,
    daypartSceneEnabled: patch.daypartSceneEnabled ?? current.daypartSceneEnabled,
    spotlightShortcut: patch.spotlightShortcut ?? current.spotlightShortcut,
    searchHistoryEnabled: patch.searchHistoryEnabled ?? current.searchHistoryEnabled,
    telemetryEnabled: patch.telemetryEnabled ?? current.telemetryEnabled,
    historyRetentionDays: patch.historyRetentionDays ?? current.historyRetentionDays,
  });

  const next: UserSettingsRecord = {
    identity,
    personalizationEnabled: patch.personalizationEnabled ?? current.personalizationEnabled,
    favoriteSignalCutoff: patch.favoriteSignalCutoff ?? current.favoriteSignalCutoff,
    ...nextExt,
    updatedAt: Date.now(),
  };

  const prefsJson = JSON.stringify(nextExt);
  try {
    await repo.run(
      `INSERT INTO user_settings (identity, personalization_enabled, favorite_signal_cutoff, preferences_json, created_at, updated_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT (identity) DO UPDATE SET
         personalization_enabled = excluded.personalization_enabled,
         favorite_signal_cutoff = excluded.favorite_signal_cutoff,
         preferences_json = excluded.preferences_json,
         updated_at = excluded.updated_at`,
      [
        identity,
        next.personalizationEnabled ? 1 : 0,
        next.favoriteSignalCutoff,
        prefsJson,
        next.updatedAt,
        next.updatedAt,
      ],
    );
  } catch {
    // 兼容尚未执行 preferences_json 列迁移的存量旧表
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
        next.updatedAt,
        next.updatedAt,
      ],
    );
  }
  return next;
}

export async function deleteUserSettings(repo: Repository, identity: string): Promise<void> {
  await repo.run("DELETE FROM user_settings WHERE identity = ?", [identity]);
}
