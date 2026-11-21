/**
 * /drama「继续追」区上方的轻量统计（全部本地算、零新增请求）。
 *
 * - 在追 X 部：清单里节奏不是“已完结”的条目数（已完结的留着补看，不叫在追）。
 * - 本周看了 Y 集：本地进度日志里本周（周一 00:00 起）正向增量合计；
 *   日志只从本功能上线后才有数，上线前看过的不计入。
 * - 有新集 Z 部：服务端检查状态里最新集数大于“看到第几集”的在追剧数；
 *   只在服务端确实有基线数据时才给数——没基线（匿名、或关注的剧都没
 *   有可查的检查）时返回 null，调用方整段不显示，不编 0。
 * “有新集”只数在追剧：已完结的剧最新集数再大也不是“新集”。
 */
import type { WatchEntry } from "./watchlist";
import { isReservedEntry } from "./watchlist";
import {
  episodesWatchedThisWeek,
  type WatchProgressLogEntry,
} from "./watch-progress-log";

/** 一部剧的服务端新集检查状态（与 GET /api/me/drama-check-states 的 states[] 同形）。 */
export interface DramaCheckState {
  dramaKey: string;
  latestEpisode: number | null;
  lastCheckedAt: number;
  lastError: string | null;
}

export interface DramaWatchStats {
  /** 在追的部数（节奏非“已完结”）。 */
  tracking: number;
  /** 本周看了的集数（本地进度日志合计）。 */
  watchedThisWeek: number;
  /** 有新集的部数；无服务端基线时为 null（不显示）。 */
  hasNew: number | null;
}

export function computeDramaWatchStats(
  entries: WatchEntry[],
  checkStates: ReadonlyMap<string, DramaCheckState>,
  progressLog: WatchProgressLogEntry[],
  now: Date = new Date(),
): DramaWatchStats {
  // 在追的部数：已完结不算，预约态（还没开播、无平台）也不算在追。
  const trackingEntries = entries.filter((e) => e.cadence.kind !== "finished" && !isReservedEntry(e));
  const hasNew =
    checkStates.size === 0
      ? null
      : trackingEntries.filter((e) => {
          const state = checkStates.get(e.key);
          return (
            state !== undefined &&
            state.latestEpisode !== null &&
            state.latestEpisode > e.episode
          );
        }).length;
  return {
    tracking: trackingEntries.length,
    watchedThisWeek: episodesWatchedThisWeek(progressLog, now),
    hasNew,
  };
}

/** 清单行“已更至第 X 集”文案：有基线才有数；无基线时调用方按 featured 检查决定是否写“未查到最新集数”。 */
export function latestEpisodeText(
  state: DramaCheckState | undefined,
): string | null {
  if (state === undefined) return null;
  if (state.latestEpisode === null) return "未查到最新集数";
  return `已更至第 ${state.latestEpisode} 集`;
}

/** 该行是否该贴“有新集”角标：只数在追剧（已完结不贴）。预约态永不贴：
 * 预约态不进新集检查、没有检查基线，latestEpisodeText(undefined) 本就是
 * null；这里再显式守一道，免得以后检查口径变化时把“未查到最新集数”
 * 噪音带进预约行。 */
export function hasNewEpisodes(
  entry: WatchEntry,
  state: DramaCheckState | undefined,
): boolean {
  if (entry.cadence.kind === "finished") return false;
  if (isReservedEntry(entry)) return false;
  return (
    state !== undefined &&
    state.latestEpisode !== null &&
    state.latestEpisode > entry.episode
  );
}
