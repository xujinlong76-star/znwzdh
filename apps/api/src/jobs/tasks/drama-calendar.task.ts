/**
 * 短剧开播日历刷新任务（drama_calendar_refresh）。
 *
 * 职责：每天跑一轮（DEFAULT_CRON_SCHEDULES intervalMs 86_400_000，
 * 与 drama_update_check 同频），用 hotlist 同款 guardedFetch 取搜短剧
 * 预约榜，解析（剧名， 预计日期， 预约人数）后存快照进 system_states；
 * 改档与下榜留痕、过期由视图层按日下线。
 *
 * 失败口径（与 drama_update_check / hotlist_refresh 一致）：单源失败
 * 只记 last_error、保留上一日快照，不清空日历、不抛错、不中断整轮；
 * 整轮结果记进事件流。本任务永不抛错——失败本身就是要记录的状态。
 */
import type { AppContext } from "../../context.ts";
import { makeGuardedHotlistFetch, type HotlistFetch } from "../../hotlist/refresh.ts";
import {
  buildCalendarSnapshot,
  DRAMA_CALENDAR_SNAPSHOT_KEY,
  extractYuyueDateModified,
  parseYuyueList,
  YUYUE_MIN_ENTRIES,
  YUYUE_URL,
  type DramaCalendarSnapshot,
} from "../../drama/calendar.ts";

export interface DramaCalendarDeps {
  fetchImpl?: HotlistFetch;
  now?: () => number;
}

export interface DramaCalendarSummary {
  ok: boolean;
  entries?: number;
  dayPrecise?: number;
  monthOnly?: number;
  changed?: number;
  dropped?: number;
  fetchedAt?: number;
  keptEntries?: number;
  error?: string;
}

/** 读当前快照；损坏或缺失返回 null（不抛错，首轮即无快照）。 */
export async function loadDramaCalendarSnapshot(
  ctx: AppContext,
): Promise<DramaCalendarSnapshot | null> {
  try {
    return await ctx.repo.getSystemState<DramaCalendarSnapshot>(DRAMA_CALENDAR_SNAPSHOT_KEY);
  } catch {
    return null;
  }
}

export async function handleDramaCalendarRefresh(
  ctx: AppContext,
  deps: DramaCalendarDeps = {},
): Promise<DramaCalendarSummary> {
  const now = (deps.now ?? Date.now)();
  const fetchImpl = deps.fetchImpl ?? makeGuardedHotlistFetch(ctx);
  const prev = await loadDramaCalendarSnapshot(ctx);
  let summary: DramaCalendarSummary;
  try {
    const res = await fetchImpl(YUYUE_URL, {
      "User-Agent": ctx.config.fetch.userAgent,
      "Accept-Language": "zh-CN,zh;q=0.9",
      Accept: "text/html,application/xhtml+xml",
    });
    if (res.status !== 200) throw new Error(`预约榜返回 HTTP ${res.status}`);
    const parsed = parseYuyueList(res.body, now);
    if (parsed.length < YUYUE_MIN_ENTRIES) {
      throw new Error(
        `预约榜解析条目过少（${parsed.length} 条，正常约 95–100 条），疑似改版，保留上一日快照`,
      );
    }
    const next = buildCalendarSnapshot(
      prev,
      parsed,
      now,
      extractYuyueDateModified(res.body),
    );
    await ctx.repo.setSystemState(DRAMA_CALENDAR_SNAPSHOT_KEY, next);
    summary = {
      ok: true,
      entries: parsed.length,
      dayPrecise: parsed.filter((e) => e.dateKind === "day").length,
      monthOnly: parsed.filter((e) => e.dateKind === "month").length,
      changed: next.changes.length,
      dropped: next.dropped.length,
      fetchedAt: now,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // 失败保留上一日快照：只更新 lastError，不动 entries/fetchedAt。
    if (prev) {
      await ctx.repo
        .setSystemState(DRAMA_CALENDAR_SNAPSHOT_KEY, { ...prev, lastError: reason })
        .catch(() => undefined);
    }
    summary = { ok: false, keptEntries: prev?.entries.length ?? 0, error: reason };
  }
  await ctx.repo
    .recordEvent("drama_calendar_refresh", { meta: summary })
    .catch(() => undefined);
  return summary;
}
