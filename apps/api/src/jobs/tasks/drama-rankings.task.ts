/**
 * 短剧真榜单刷新任务（drama_rankings_refresh）。
 *
 * 职责：每天跑一轮（DEFAULT_CRON_SCHEDULES intervalMs 86_400_000，
 * 与 drama_calendar_refresh 同频），用 hotlist 同款 guardedFetch 取搜短剧
 * 热播榜 / 热搜榜 / 收藏榜，解析后存快照进 system_states；三榜相互独立——
 * 单榜失败只记该榜 lastError、保留上一日快照，不拖垮其余两榜、不中断整轮。
 *
 * 失败口径（与 drama_calendar_refresh 一致）：单源失败只记 last_error、
 * 保留上一日快照，不清空榜单、不抛错、不中断整轮；整轮结果记进事件流。
 * 本任务永不抛错——失败本身就是要记录的状态。
 */
import type { AppContext } from "../../context.ts";
import { makeGuardedHotlistFetch, type HotlistFetch } from "../../hotlist/refresh.ts";
import {
  buildRankingsSnapshot,
  DRAMA_RANKINGS_SNAPSHOT_KEY,
  extractRankingsDateModified,
  parseRankingList,
  RANKING_LISTS,
  RANKINGS_MIN_ENTRIES,
  type DramaRankingsSnapshot,
  type RankingEntry,
  type RankingListKind,
} from "../../drama/ranking-lists.ts";

export interface DramaRankingsDeps {
  fetchImpl?: HotlistFetch;
  now?: () => number;
}

export interface DramaRankingsListSummary {
  entries?: number;
  dropped?: number;
  error?: string;
}

export interface DramaRankingsSummary {
  /** 三榜全部成功才为 true；任一榜失败即 false（其余榜仍已更新）。 */
  ok: boolean;
  lists: Record<RankingListKind, DramaRankingsListSummary>;
  fetchedAt: number;
  keptEntries?: number;
  error?: string;
}

/** 读当前快照；损坏或缺失返回 null（不抛错，首轮即无快照）。 */
export async function loadDramaRankingsSnapshot(
  ctx: AppContext,
): Promise<DramaRankingsSnapshot | null> {
  try {
    return await ctx.repo.getSystemState<DramaRankingsSnapshot>(DRAMA_RANKINGS_SNAPSHOT_KEY);
  } catch {
    return null;
  }
}

export async function handleDramaRankingsRefresh(
  ctx: AppContext,
  deps: DramaRankingsDeps = {},
): Promise<DramaRankingsSummary> {
  const now = (deps.now ?? Date.now)();
  const fetchImpl = deps.fetchImpl ?? makeGuardedHotlistFetch(ctx);
  const prev = await loadDramaRankingsSnapshot(ctx);
  const parsed: Partial<
    Record<RankingListKind, { entries: RankingEntry[]; droppedTitles: number } | null>
  > = {};
  const dateModified: Partial<Record<RankingListKind, string | null>> = {};
  const errors: Partial<Record<RankingListKind, string>> = {};
  const listSummaries = {} as Record<RankingListKind, DramaRankingsListSummary>;

  for (const config of RANKING_LISTS) {
    try {
      const res = await fetchImpl(config.url, {
        "User-Agent": ctx.config.fetch.userAgent,
        "Accept-Language": "zh-CN,zh;q=0.9",
        Accept: "text/html,application/xhtml+xml",
      });
      if (res.status !== 200) throw new Error(`${config.label}返回 HTTP ${res.status}`);
      const result = parseRankingList(res.body, config.kind);
      if (result.entries.length < RANKINGS_MIN_ENTRIES) {
        throw new Error(
          `${config.label}解析条目过少（${result.entries.length} 条），疑似改版，保留上一日快照`,
        );
      }
      parsed[config.kind] = result;
      dateModified[config.kind] = extractRankingsDateModified(res.body);
      listSummaries[config.kind] = {
        entries: result.entries.length,
        dropped: result.droppedTitles,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      errors[config.kind] = reason;
      parsed[config.kind] = null;
      listSummaries[config.kind] = { error: reason };
    }
  }

  const allOk = RANKING_LISTS.every((c) => !errors[c.kind]);
  let summary: DramaRankingsSummary = {
    ok: allOk,
    lists: listSummaries,
    fetchedAt: now,
  };
  try {
    const next = buildRankingsSnapshot(prev, parsed, now, dateModified, errors);
    await ctx.repo.setSystemState(DRAMA_RANKINGS_SNAPSHOT_KEY, next);
    if (!allOk) {
      summary = {
        ...summary,
        keptEntries: RANKING_LISTS.reduce(
          (sum, c) => sum + (next.lists[c.kind]?.entries.length ?? 0),
          0,
        ),
      };
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    summary = {
      ok: false,
      lists: listSummaries,
      fetchedAt: now,
      keptEntries: RANKING_LISTS.reduce(
        (sum, c) => sum + (prev?.lists[c.kind]?.entries.length ?? 0),
        0,
      ),
      error: `快照落库失败：${reason}`,
    };
  }
  await ctx.repo
    .recordEvent("drama_rankings_refresh", { meta: summary })
    .catch(() => {
      // 审计/遥测类写库是尽力而为：失败不阻断主操作，写失败即丢弃。
    });
  return summary;
}
