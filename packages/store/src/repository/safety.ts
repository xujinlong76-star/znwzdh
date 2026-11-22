/**
 * 数据安全可见补完（第 15 项，Phase 1：A 用户导出 + B 云端同步 + 健康检查）。
 *
 * 只聚合已有真实来源的状态，不编造：
 *  - 上次导出/导入时间 ← audit_logs（user.export / user.import，保留 365 天）；
 *  - 同步成功/失败水位 ← user_sync_state（只记时间戳与有限枚举错误码，不记内容）；
 *  - 金库/CRDT ← user_vault_sync（概览已查 + crdt:<id> 行）；
 *  - 未读同步失败 ← notifications（kind='sync_failed'，用户在 /me/notifications 里看到的同一张表）。
 * 全站冷备（C 层）Phase 1 无来源：只返回 unknown 占位，不参与 overall 计算
 * （否则所有用户恒红——这一点写进注释，后人不要“修”掉）。
 */
import type { Repository } from "../repository.ts";
import { getUserCenterOverview } from "./identity.ts";
import { listAuditLogs } from "./events.ts";
import type { AuditLogRecord } from "./records.ts";

export type SafetyStatus = "ok" | "warning" | "critical" | "unknown";

/** 同步失败错误码：有限枚举，映射不到一律 unknown，绝不猜具体原因。 */
export type SyncErrorCode = "timeout" | "network" | "server_5xx" | "validation_4xx" | "unknown";

export type SyncDomain = "favorites" | "watchlist" | "exams";

export interface SyncState {
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastErrorCode: SyncErrorCode | null;
}

export interface SafetyCheck {
  id: string;
  label: string;
  status: SafetyStatus;
  detail: string;
}

export interface DataSafety {
  checkedAt: number;
  overall: SafetyStatus;
  lastExport: {
    at: number | null;
    format: "json" | "netscape" | null;
    counts: { favorites: number; folders: number; searches: number } | null;
    /** 上次导出是否截断；历史导出因审计未记而为 null（“是否完整未知”）。 */
    truncated: boolean | null;
    /** 审计不记字节大小（第 15 项决策 3：大小不记），恒为 null。 */
    sizeBytes: number | null;
  } | null;
  lastImport: {
    at: number | null;
    imported: { folders: number; favorites: number; searches: number };
    /** 未能恢复数 = 站点已不在库 + 历史截断 + 设置失败。 */
    skipped: number;
  } | null;
  sync: {
    favorites: SyncState;
    watchlist: SyncState;
    /** 考试关注同步水位（U-379）：与追剧同口径；安全卡暂只展示收藏/追剧两行 */
    exams: SyncState;
    vault: { exists: boolean; version: number | null; updatedAt: number | null };
    crdt: { exists: boolean; updatedAt: number | null };
    unreadSyncFailures: number;
  };
  localCounts: { favorites: number; folders: number; searches: number; recentEvents: number };
  /** Phase 1 不返回真实值，只返回 unknown 占位并说明原因，且不参与 overall 计算。 */
  serverBackup: { status: "unknown"; reason: "not-instrumented" };
  checks: SafetyCheck[];
}

/**
 * 导出新鲜度阈值（具名常量 + 理由，见设计 §2.4）：
 *  - 7 天：普通用户一周一次、可坚持的节奏；
 *  - 30 天：对齐回收站清理窗口——回收站每天清理 30 天前进入回收站的站点，
 *    导出超过 30 天，回收站里删掉的东西已无法从这份导出找回，
 *    备份的“后悔药”价值已过期。
 */
export const EXPORT_FRESH_DAYS = 7;
export const EXPORT_STALE_DAYS = 30;

/**
 * 同步阈值：
 *  - 1 小时：对齐 sync_failed 通知 60 分钟去重窗口；
 *  - 24 小时：“一天内没成功过就值得看一眼”的常识阈值，无仓库先例，
 *    标注为推荐值、可调。
 */
export const SYNC_FAILURE_CRITICAL_MS = 60 * 60_000;
export const SYNC_SUCCESS_WINDOW_MS = 24 * 60 * 60_000;

const DAY_MS = 86_400_000;

/** 无记录时导出即 critical（应提醒），但文案必须注明“近一年内无记录”——audit_logs 只保留 365 天，不能断言从未导出过。 */
export function classifyExportFreshness(at: number | null, now = Date.now()): SafetyStatus {
  if (at == null || !Number.isFinite(at)) return "critical";
  const age = now - at;
  if (age <= EXPORT_FRESH_DAYS * DAY_MS) return "ok";
  if (age <= EXPORT_STALE_DAYS * DAY_MS) return "warning";
  return "critical";
}

/**
 * 同步状态：
 *  - 1h 内有失败 → critical；
 *  - 从未有成功记录（新表为空）→ unknown，不冒充 ok；
 *  - 24h 内有成功且无未读失败 → ok；
 *  - 否则（24h 内无成功，或有已读失败记录）→ warning。
 */
export function classifySyncState(
  state: SyncState,
  unreadFailures: number,
  now = Date.now(),
): SafetyStatus {
  if (state.lastFailureAt != null && now - state.lastFailureAt <= SYNC_FAILURE_CRITICAL_MS) {
    return "critical";
  }
  if (state.lastSuccessAt == null) return "unknown";
  if (now - state.lastSuccessAt <= SYNC_SUCCESS_WINDOW_MS && unreadFailures === 0) return "ok";
  return "warning";
}

/** overall 取最差项（critical > warning > unknown > ok）。 */
export function worstStatus(statuses: SafetyStatus[]): SafetyStatus {
  const rank: Record<SafetyStatus, number> = { critical: 3, warning: 2, unknown: 1, ok: 0 };
  let worst: SafetyStatus = "ok";
  for (const s of statuses) if (rank[s] > rank[worst]) worst = s;
  return worst;
}

/**
 * 失败原因只给有限枚举：按 HTTP 状态 / 异常文本特征映射，
 * 映射不到一律 unknown。UI 写“原因未知”，不许猜一个具体原因。
 */
export function mapSyncErrorCode(err: unknown): SyncErrorCode {
  const status =
    typeof err === "object" && err !== null && "status" in err
      ? Number((err as { status?: unknown }).status)
      : NaN;
  if (Number.isFinite(status)) {
    if (status === 408 || status === 504) return "timeout";
    if (status >= 500) return "server_5xx";
    if (status >= 400) return "validation_4xx";
  }
  const text = String(
    (typeof err === "object" && err !== null && "message" in err
      ? (err as { message?: unknown }).message
      : err) ?? "",
  ).toLowerCase();
  if (/timed?\s?out|etimedout|timeout|504|408/.test(text)) return "timeout";
  if (/econnrefused|enotfound|eai_again|network|fetch failed|econnreset|econnaborted|offline/.test(text)) {
    return "network";
  }
  const codeMatch = /status[:\s]*(\d{3})/.exec(text);
  if (codeMatch) {
    const code = Number(codeMatch[1]);
    if (code >= 500) return "server_5xx";
    if (code >= 400) return "validation_4xx";
  }
  if (/5\d\d/.test(text)) return "server_5xx";
  if (/4\d\d/.test(text)) return "validation_4xx";
  return "unknown";
}

/**
 * 审计 diff 解析：rowToAuditLog 已把合法 JSON 解析成对象，损坏的保留原字符串。
 * 缺失/坏 JSON 时不抛错、字段为 null——调用方按“未知”处理。
 */
export function parseAuditDiff(diff: unknown): Record<string, unknown> {
  if (diff != null && typeof diff === "object" && !Array.isArray(diff)) {
    return diff as Record<string, unknown>;
  }
  if (typeof diff === "string" && diff) {
    try {
      const parsed: unknown = JSON.parse(diff);
      if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // 坏 JSON：按无记录处理，不让一次解析失败卡住整次聚合
    }
  }
  return {};
}

export async function getUserSyncState(
  repo: Repository,
  identity: string,
  domain: SyncDomain,
): Promise<SyncState> {
  const row = (
    await repo.raw(
      "SELECT last_success_at, last_failure_at, last_error_code FROM user_sync_state WHERE identity = ? AND domain = ? LIMIT 1",
      [identity, domain],
    )
  )[0];
  if (!row) return { lastSuccessAt: null, lastFailureAt: null, lastErrorCode: null };
  const code = row.last_error_code == null ? null : String(row.last_error_code);
  return {
    lastSuccessAt: row.last_success_at == null ? null : Number(row.last_success_at),
    lastFailureAt: row.last_failure_at == null ? null : Number(row.last_failure_at),
    lastErrorCode:
      code === "timeout" || code === "network" || code === "server_5xx" || code === "validation_4xx" || code === "unknown"
        ? code
        : "unknown",
  };
}

/** 只记时间戳与错误码，不记内容。 */
export async function recordSyncSuccess(
  repo: Repository,
  identity: string,
  domain: SyncDomain,
  at = Date.now(),
): Promise<void> {
  await repo.run(
    `INSERT INTO user_sync_state (identity, domain, last_success_at, last_failure_at, last_error_code, updated_at)
     VALUES (?,?,?,NULL,NULL,?)
     ON CONFLICT(identity, domain) DO UPDATE SET last_success_at = excluded.last_success_at, updated_at = excluded.updated_at`,
    [identity, domain, at, at],
  );
}

export async function recordSyncFailure(
  repo: Repository,
  identity: string,
  domain: SyncDomain,
  errorCode: SyncErrorCode,
  at = Date.now(),
): Promise<void> {
  await repo.run(
    `INSERT INTO user_sync_state (identity, domain, last_success_at, last_failure_at, last_error_code, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?)
     ON CONFLICT(identity, domain) DO UPDATE SET last_failure_at = excluded.last_failure_at, last_error_code = excluded.last_error_code, updated_at = excluded.updated_at`,
    [identity, domain, at, errorCode, at],
  );
}

/**
 * 未读同步失败数：只数 notifications 表（kind='sync_failed'），
 * 与 /me/notifications 里用户看到的同一张表。outbox 里尚未中继的行
 * 用户还看不到，不计入——否则数字与通知页对不上。
 */
export async function countUnreadSyncFailures(repo: Repository, identity: string): Promise<number> {
  const row = (
    await repo.raw(
      "SELECT COUNT(*) AS c FROM notifications WHERE identity = ? AND kind = 'sync_failed' AND read_at IS NULL",
      [identity],
    )
  )[0];
  return Number(row?.c ?? 0);
}

/** 24h 内 user.sync_failed 审计条数（diagnostics sync_failures 检查用）。 */
export async function countRecentSyncFailures(
  repo: Repository,
  identity: string,
  sinceMs: number,
): Promise<number> {
  const page = await listAuditLogs(repo, { actor: identity, action: "user.sync_failed", limit: 200 });
  return page.items.filter((r) => r.createdAt >= sinceMs).length;
}

function parseExportAudit(row: AuditLogRecord | undefined): DataSafety["lastExport"] {
  if (!row) return null;
  const diff = parseAuditDiff(row.diff);
  const format = diff.format === "netscape" ? "netscape" : "json";
  let truncated: boolean | null = null;
  if (typeof diff.truncated === "boolean") truncated = diff.truncated;
  else if (diff.truncated != null && typeof diff.truncated === "object") {
    const t = diff.truncated as Record<string, unknown>;
    if (typeof t.favorites === "boolean" || typeof t.history === "boolean") {
      truncated = Boolean(t.favorites) || Boolean(t.history);
    }
  }
  return {
    at: row.createdAt,
    format,
    counts: {
      favorites: Number(diff.favorites ?? 0),
      folders: Number(diff.folders ?? 0),
      searches: Number(diff.searches ?? 0),
    },
    truncated,
    sizeBytes: null,
  };
}

function parseImportAudit(row: AuditLogRecord | undefined): DataSafety["lastImport"] {
  if (!row) return null;
  const diff = parseAuditDiff(row.diff);
  return {
    at: row.createdAt,
    imported: {
      folders: Number(diff.foldersImported ?? 0),
      favorites: Number(diff.favoritesImported ?? 0),
      searches: Number(diff.searchesImported ?? 0),
    },
    skipped:
      Number(diff.favoritesSkippedMissingSite ?? 0) +
      Number(diff.searchesTruncated ?? 0) +
      (typeof diff.settingsError === "string" && diff.settingsError ? 1 : 0),
  };
}

/** 失败原因三档文案（只给分类，绝不展示审计 diff.error 的原始异常文本）。 */
export function describeSyncErrorCode(code: SyncErrorCode | null): string {
  switch (code) {
    case "timeout":
      return "请求超时";
    case "network":
      return "网络波动";
    case "server_5xx":
      return "服务端暂时不可用";
    case "validation_4xx":
      return "请求数据未被接受";
    default:
      return "原因未知";
  }
}

export function buildSafetyChecks(safety: DataSafety): SafetyCheck[] {
  const exportStatus = classifyExportFreshness(safety.lastExport?.at ?? null, safety.checkedAt);
  const favStatus = classifySyncState(safety.sync.favorites, safety.sync.unreadSyncFailures, safety.checkedAt);
  const watchStatus = classifySyncState(safety.sync.watchlist, safety.sync.unreadSyncFailures, safety.checkedAt);
  const syncStatus = worstStatus([favStatus, watchStatus]);
  const vaultOk = safety.sync.vault.exists || safety.sync.crdt.exists;

  const exportDetail = safety.lastExport?.at
    ? `上次导出在 ${new Date(safety.lastExport.at).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })}` +
      (safety.lastExport.truncated === true
        ? "，且该次导出被截断过（不完整）"
        : safety.lastExport.truncated === false
          ? "，该次导出完整"
          : "，该次导出是否完整未知（历史导出未记录截断）")
    : "近一年内没有导出记录（审计只保留 365 天）";
  const syncDetail =
    syncStatus === "critical"
      ? `1 小时内有同步失败（${describeSyncErrorCode(safety.sync.favorites.lastErrorCode ?? safety.sync.watchlist.lastErrorCode)}），请稍后重试`
      : syncStatus === "unknown"
        ? "同步成功时间尚未记录——水位表刚上线，同步一次后就有"
        : syncStatus === "ok"
          ? "24 小时内同步成功，且没有未读的同步失败通知"
          : "24 小时内没有成功同步记录，或有已读的同步失败记录";
  return [
    {
      id: "export_freshness",
      label: "导出新鲜度",
      status: exportStatus,
      detail: `${exportDetail}。来源：你的导出记录。`,
    },
    {
      id: "sync_failures",
      label: "云端同步失败",
      status: syncStatus,
      detail:
        `${syncDetail}。` +
        (safety.sync.unreadSyncFailures > 0
          ? `另有 ${safety.sync.unreadSyncFailures} 条未读同步失败通知。`
          : "没有未读同步失败通知。") +
        "来源：同步失败通知。",
    },
    {
      id: "vault_and_crdt",
      label: "金库与跨端排版日志",
      status: vaultOk ? "ok" : "unknown",
      detail: vaultOk
        ? `金库${safety.sync.vault.exists ? `已创建（v${safety.sync.vault.version ?? 1}）` : "未创建"}；` +
          `跨端排版日志${safety.sync.crdt.exists ? "在云端" : "未建立"}。来源：云端金库记录。`
        : "金库未创建，跨端排版日志也未建立——这两项不用不代表数据不安全。来源：云端金库记录。",
    },
  ];
}

/**
 * 一次聚合：概览 + 三次 listAuditLogs（各取最新 1 条）+ user_sync_state 两行
 * + user_vault_sync 的 crdt:<id> 行 + 未读 sync_failed 计数。
 * 全部是已有查询原语的组合，不新写查询。
 */
export async function getUserSafetyStatus(
  repo: Repository,
  identity: string,
  now = Date.now(),
): Promise<DataSafety> {
  const [overview, exportLogs, importLogs, syncFailedLogs, favState, watchState, examState, crdtRow, unread] =
    await Promise.all([
      getUserCenterOverview(repo, identity),
      listAuditLogs(repo, { actor: identity, action: "user.export", limit: 1 }),
      listAuditLogs(repo, { actor: identity, action: "user.import", limit: 1 }),
      listAuditLogs(repo, { actor: identity, action: "user.sync_failed", limit: 1 }),
      getUserSyncState(repo, identity, "favorites"),
      getUserSyncState(repo, identity, "watchlist"),
      getUserSyncState(repo, identity, "exams"),
      repo.raw("SELECT version, updated_at FROM user_vault_sync WHERE user_id = ? LIMIT 1", [
        "crdt:" + identity,
      ]),
      countUnreadSyncFailures(repo, identity),
    ]);

  // user_sync_state 是失败时间的权威来源；审计只作回填：新写入的审计 diff
  // 带 domain，历史行没有——没有 domain 的审计失败不归属到任一域，不编造。
  const auditFailed = syncFailedLogs.items[0];
  const auditDiff = auditFailed ? parseAuditDiff(auditFailed.diff) : {};
  const fillFailure = (state: SyncState, domain: SyncDomain): SyncState => {
    if (state.lastFailureAt != null) return state;
    if (auditFailed && auditDiff.domain === domain) {
      return { ...state, lastFailureAt: auditFailed.createdAt };
    }
    return state;
  };
  const favorites = fillFailure(favState, "favorites");
  const watchlist = fillFailure(watchState, "watchlist");
  const exams = fillFailure(examState, "exams");

  const lastExport = parseExportAudit(exportLogs.items[0]);
  const lastImport = parseImportAudit(importLogs.items[0]);
  const crdt = crdtRow[0];

  const partial: DataSafety = {
    checkedAt: now,
    overall: "ok",
    lastExport,
    lastImport,
    sync: {
      favorites,
      watchlist,
      exams,
      vault: overview.vault,
      crdt: {
        exists: Boolean(crdt),
        updatedAt: crdt ? Number(crdt.updated_at) : null,
      },
      unreadSyncFailures: unread,
    },
    localCounts: {
      favorites: overview.counts.favorites,
      folders: overview.counts.folders,
      searches: overview.counts.searches,
      recentEvents: overview.counts.recentEvents,
    },
    // Phase 1 不向普通用户展示全站冷备新鲜度：没有任何数据库记录、
    // 没有任何 API 能告诉前端“上次全站备份是什么时候”。只给 unknown
    // 占位并说明原因（not-instrumented），且不参与 overall 计算，
    // 否则所有用户恒红。
    serverBackup: { status: "unknown", reason: "not-instrumented" },
    checks: [],
  };
  partial.checks = buildSafetyChecks(partial);
  // overall 取最差项，但只算“用户自己的数据”这两项：
  // serverBackup.unknown 不参与（见上）；vault_and_crdt 也不参与——
  // 金库/排版日志没建立是“没用这项功能”，不是数据风险。
  partial.overall = worstStatus([
    classifyExportFreshness(lastExport?.at ?? null, now),
    classifySyncState(favorites, unread, now),
    classifySyncState(watchlist, unread, now),
  ]);
  return partial;
}
