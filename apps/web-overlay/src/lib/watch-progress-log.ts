import { mondayOfWeek } from "./watch-week";

/**
 * 追剧进度日志（本地 only，供“本周看了 Y 集”统计用）。
 *
 * 为什么需要：清单条目只记当前看到第几集（episode）与最后进度时间
 * （lastProgressAt），算不出“本周看了几集”——单条记录没有增量历史。
 * 本日志只在 setEpisode 往前推进度时追加一条 {key, at, from, to}，
 * 往回改（纠错）不记；超过 14 天的与超过 500 条的在写入时裁掉。
 * 匿名/未登录一样记（纯本机），不上传、不参与云端同步；读不到或写
 * 不动时静默失败（统计退化为 0，不阻断进度本身）。
 * 注意：统计只从本功能上线后才有数，上线前看过的集数不在日志里。
 */
export const WATCH_PROGRESS_LOG_KEY = "navhub.watch-progress-log.v1";
export const WATCH_PROGRESS_LOG_MAX = 500;
const WATCH_PROGRESS_LOG_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface WatchProgressLogEntry {
  key: string;
  at: number;
  from: number;
  to: number;
}

export function readWatchProgressLog(): WatchProgressLogEntry[] {
  try {
    const raw = localStorage.getItem(WATCH_PROGRESS_LOG_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: WatchProgressLogEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      if (typeof row.key !== "string" || !row.key) continue;
      if (typeof row.at !== "number" || typeof row.from !== "number" || typeof row.to !== "number") continue;
      if (!Number.isFinite(row.at) || !Number.isFinite(row.from) || !Number.isFinite(row.to)) continue;
      out.push({ key: row.key, at: row.at, from: Math.trunc(row.from), to: Math.trunc(row.to) });
    }
    return out;
  } catch {
    return [];
  }
}

function writeWatchProgressLog(entries: WatchProgressLogEntry[]): void {
  try {
    localStorage.setItem(WATCH_PROGRESS_LOG_KEY, JSON.stringify(entries));
  } catch {
    // 本地存储被禁时统计退化为 0，不阻断进度本身。
  }
}

/** 记一次往前追的进度（to <= from 时不记；只记正向增量）。 */
export function recordWatchProgress(key: string, from: number, to: number, at: number = Date.now()): void {
  if (to <= from) return;
  const now = at;
  const kept = readWatchProgressLog().filter((e) => now - e.at <= WATCH_PROGRESS_LOG_TTL_MS);
  kept.push({ key, at: now, from, to });
  writeWatchProgressLog(kept.slice(-WATCH_PROGRESS_LOG_MAX));
}

/** 本周（周一 00:00 本地时间起，口径与 lib/watch-week 的 mondayOfWeek 一致）看过的集数合计：只加正向增量。 */
export function episodesWatchedThisWeek(
  log: WatchProgressLogEntry[],
  now: Date = new Date(),
): number {
  const start = mondayOfWeek(now).getTime();
  let total = 0;
  for (const entry of log) {
    if (entry.at < start) continue;
    if (entry.to > entry.from) total += entry.to - entry.from;
  }
  return total;
}
