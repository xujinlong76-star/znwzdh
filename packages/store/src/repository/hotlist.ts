import type { Repository } from "../repository.ts";
import type {
  DailyBriefRecord,
  HotlistEntryRecord,
  HotlistSourceRecord,
} from "./records.ts";
import { rowToDailyBrief, rowToHotlistEntry, rowToHotlistSource } from "./dialect.ts";

/**
 * 全网热榜缓存 + 每日简报的仓储层。
 *
 * 口径：
 * - 热榜只存标题 + 链接 + 热度值（各源口径不同，只并列展示、绝不跨源混算），
 *   不存正文、不存图片；每源整表替换（一次抓取 = 一份完整榜单），
 *   抓取失败时**不动**已有条目，只把源状态标 failed —— 前端据此展示
 *   「上次成功缓存 + 已过期」而不是拿空榜冒充实时。
 * - 简报按天一行（date 主键），生成即落库，读时直接取缓存，
 *   不在请求路径上现算；个性化部分（在追提醒）不进这张表，按用户现算。
 */

/** 一次成功抓取后整表替换该源的条目，并把源状态置 ok */
export async function replaceHotlistSource(
  repo: Repository,
  source: string,
  items: Array<Omit<HotlistEntryRecord, "source" | "fetchedAt">>,
  fetchedAt: number,
): Promise<void> {
  await repo.withTransaction(async () => {
    await repo.run("DELETE FROM hotlist_entries WHERE source = ?", [source]);
    for (const item of items) {
      await repo.run(
        `INSERT INTO hotlist_entries (source, rank, title, url, hot_value, hot_label, fetched_at)
         VALUES (?,?,?,?,?,?,?)`,
        [source, item.rank, item.title, item.url, item.hotValue, item.hotLabel, fetchedAt],
      );
    }
    await repo.run(
      `INSERT INTO hotlist_sources (source, status, last_ok_at, last_attempt_at, last_error, item_count)
       VALUES (?, 'ok', ?, ?, NULL, ?)
       ON CONFLICT(source) DO UPDATE SET
         status = 'ok', last_ok_at = excluded.last_ok_at,
         last_attempt_at = excluded.last_attempt_at, last_error = NULL,
         item_count = excluded.item_count`,
      [source, fetchedAt, fetchedAt, items.length],
    );
  });
}

/** 抓取失败：条目原样保留（降级读缓存），只更新源状态与失败原因 */
export async function markHotlistSourceFailed(
  repo: Repository,
  source: string,
  error: string,
  attemptedAt: number,
): Promise<void> {
  await repo.run(
    `INSERT INTO hotlist_sources (source, status, last_ok_at, last_attempt_at, last_error, item_count)
     VALUES (?, 'failed', NULL, ?, ?, 0)
     ON CONFLICT(source) DO UPDATE SET
       status = 'failed', last_attempt_at = excluded.last_attempt_at,
       last_error = excluded.last_error`,
    [source, attemptedAt, error.slice(0, 500)],
  );
}

export async function listHotlistSources(repo: Repository): Promise<HotlistSourceRecord[]> {
  const rows = await repo.raw("SELECT * FROM hotlist_sources ORDER BY source ASC");
  return rows.map(rowToHotlistSource);
}

export async function listHotlistEntries(repo: Repository, source: string): Promise<HotlistEntryRecord[]> {
  const rows = await repo.raw(
    "SELECT * FROM hotlist_entries WHERE source = ? ORDER BY rank ASC",
    [source],
  );
  return rows.map(rowToHotlistEntry);
}

/** 全部源的条目一次取回（按源分组在调用方做），供热榜页与简报组版共用 */
export async function listAllHotlistEntries(repo: Repository): Promise<HotlistEntryRecord[]> {
  const rows = await repo.raw("SELECT * FROM hotlist_entries ORDER BY source ASC, rank ASC");
  return rows.map(rowToHotlistEntry);
}

export async function upsertDailyBrief(repo: Repository, brief: DailyBriefRecord): Promise<void> {
  await repo.run(
    `INSERT INTO daily_briefs (date, generated_at, opening, opening_mode, payload)
     VALUES (?,?,?,?,?)
     ON CONFLICT(date) DO UPDATE SET
       generated_at = excluded.generated_at, opening = excluded.opening,
       opening_mode = excluded.opening_mode, payload = excluded.payload`,
    [brief.date, brief.generatedAt, brief.opening, brief.openingMode, brief.payload],
  );
}

export async function getDailyBrief(repo: Repository, date: string): Promise<DailyBriefRecord | null> {
  const row = (await repo.raw("SELECT * FROM daily_briefs WHERE date = ? LIMIT 1", [date]))[0];
  return row ? rowToDailyBrief(row) : null;
}

/** 最近一份简报（今天还没生成时，前端拿它并如实标注日期，不冒充今日） */
export async function getLatestDailyBrief(repo: Repository): Promise<DailyBriefRecord | null> {
  const row = (await repo.raw("SELECT * FROM daily_briefs ORDER BY date DESC LIMIT 1"))[0];
  return row ? rowToDailyBrief(row) : null;
}
