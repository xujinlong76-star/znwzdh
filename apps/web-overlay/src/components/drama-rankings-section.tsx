"use client";

import { useMemo, useState } from "react";
import { useDramaRankings } from "@/hooks/useDramaData";
import { useWatchlist } from "@/hooks/useWatchlist";
import { normalizeDramaTitle } from "@/lib/watchlist";
import { safeHref } from "@/lib/safe-url";
import type { DramaRankingsResponse } from "@/lib/rest-contracts.generated";

/** 一条榜单记录（与 GET /api/drama/rankings 的 entries[] 同形）。 */
export type RankingEntry = DramaRankingsResponse["lists"][number]["entries"][number];

/**
 * 真榜单区块（/drama 内，U-D1）。
 *
 * 数据来自 GET /api/drama/rankings（drama_rankings_refresh 任务每日抓
 * 搜短剧热播 / 热搜 / 收藏榜存快照）。客户端取数、失败不挂页：
 * - 抓取失败时后端下发上次成功快照并标 stale，这里按该榜自己的 fetchedAt
 *   写真实年龄：仅 1 天前写“上一日快照”，更旧的写“N 天前快照”，绝不把
 *   旧榜说成昨天（U-458：热播榜 11-18 的快照曾被标成“上一日”）。
 * - 从未抓到过时 status empty，这里只留一行说明，不编榜单。
 *
 * 诚实口径：
 * - 数字只写榜单页给的：主数字是各榜左下角浮层（热度 / 热搜 / 收藏），
 *   评分、收藏、分享、点赞只写 meta 行里有的，缺失的留空、不拿别的数凑；
 * - 排名就是榜单出现顺序（前三名徽章数字已核对）；行链搜短剧详情页；
 * - 本地清单里在追的剧贴“在追”角标（按归一化剧名匹配）。
 */

const TABS = [
  { kind: "rebo", label: "热播榜" },
  { kind: "reso", label: "热搜榜" },
  { kind: "shoucang", label: "收藏榜" },
] as const;

type RankingKind = (typeof TABS)[number]["kind"];

function formatDataDate(fetchedAt: number | null): string {
  if (!fetchedAt) return "暂无";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(fetchedAt));
}

/**
 * 快照年龄文案（U-458）：只在确实是 1 天前时写“上一日”，更旧的写真实天数。
 * 拿单榜自己的 fetchedAt（上次成功抓取时间）算，不拿顶层 fetchedAt
 * （最近一次刷新尝试的时间——失败刷新也会更新它，不能代表数据日期）。
 * 天数按 24 小时向下取整；同一天内或取不到时间时写“上次成功快照”。
 */
export function staleSnapshotLabel(
  listFetchedAt: number | null,
  nowMs: number = Date.now(),
): string {
  if (!listFetchedAt) return "上次成功快照";
  const days = Math.floor((nowMs - listFetchedAt) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "上次成功快照";
  if (days === 1) return "上一日快照";
  return `${days} 天前快照`;
}

/** 一行的副数字：只拼榜单 meta 行里有的，缺失的跳过、不凑数。 */
function secondaryText(entry: RankingEntry): string {
  const parts: string[] = [];
  if (entry.rating !== null) parts.push(`评分 ${entry.rating}`);
  if (entry.favorites !== null) parts.push(`${entry.favorites}万收藏`);
  if (entry.shares !== null) parts.push(`${entry.shares}万分享`);
  if (entry.likes !== null) parts.push(`${entry.likes}万次点赞`);
  if (entry.totalEpisodes !== null) parts.push(`全 ${entry.totalEpisodes} 集`);
  return parts.join(" / ");
}

function RankingRow({
  entry,
  watching,
}: {
  entry: RankingEntry;
  watching: boolean;
}) {
  const top3 = entry.rank <= 3;
  return (
    <li className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <span
        aria-label={`第 ${entry.rank} 名`}
        className={
          top3
            ? "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-sm font-bold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
            : "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-sm font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
        }
      >
        {entry.rank}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <a
            href={safeHref(entry.detailUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 truncate text-sm font-semibold text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-100"
            title={`${entry.title} · 去搜短剧看详情`}
          >
            {entry.title}
          </a>
          {watching && (
            <span className="shrink-0 rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:text-rose-400">
              在追
            </span>
          )}
          {entry.genre && (
            <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              {entry.genre}
            </span>
          )}
        </p>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {entry.metric !== null && entry.metricLabel !== null
            ? `${entry.metric}万${entry.metricLabel}`
            : "热度未公布"}
          {secondaryText(entry) ? ` · ${secondaryText(entry)}` : ""}
        </p>
      </div>
    </li>
  );
}

export function DramaRankingsSection() {
  const rankings = useDramaRankings();
  const { ready, entries } = useWatchlist();
  const [tab, setTab] = useState<RankingKind>("rebo");

  const watchingTitles = useMemo(() => {
    if (!ready) return new Set<string>();
    return new Set(entries.map((e) => normalizeDramaTitle(e.title)));
  }, [ready, entries]);

  return (
    <section aria-label="真榜单" className="mt-10">
      <h2 className="text-xl font-semibold">真榜单</h2>
      {rankings.kind === "loading" ? (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400" aria-busy="true">
          正在加载真榜单…
        </p>
      ) : rankings.kind === "failed" ? (
        <p className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900 p-4 text-sm text-zinc-600 dark:text-zinc-400">
          真榜单这次没加载出来，刷新页面再试；平台入口与热门剧不受影响。
        </p>
      ) : (
        <RankingsBody
          data={rankings.data}
          tab={tab}
          onTab={setTab}
          watchingTitles={watchingTitles}
        />
      )}
    </section>
  );
}

function RankingsBody({
  data,
  tab,
  onTab,
  watchingTitles,
}: {
  data: DramaRankingsResponse;
  tab: RankingKind;
  onTab: (kind: RankingKind) => void;
  watchingTitles: ReadonlySet<string>;
}) {
  const list = data.lists.find((l) => l.kind === tab);
  // U-458：数据日期拿当前 Tab 单榜自己的 fetchedAt（上次成功抓取），
  // 不拿顶层 fetchedAt（最近一次刷新尝试——失败刷新也会更新它，
  // 11-26 的失败刷新曾让 11-18 的热播榜数据被标成“数据日期 11月26日”）。
  const dataDate = formatDataDate(list?.fetchedAt ?? null);
  return (
    <div>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        搜短剧公开榜单 · 数据日期 {dataDate} · 数字缺失留空，不编热度。
      </p>
      {data.status === "stale" && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          部分榜单今日未更新，展示上次成功快照，排名可能已变。各榜真实数据日期见下方。
        </p>
      )}
      {data.status === "empty" ? (
        <p className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900 p-4 text-sm text-zinc-600 dark:text-zinc-400">
          真榜单暂无数据（今日抓取尚未成功），稍后再来。
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="榜单选择">
            {TABS.map((t) => (
              <button
                key={t.kind}
                type="button"
                role="tab"
                aria-selected={tab === t.kind}
                onClick={() => onTab(t.kind)}
                className={
                  tab === t.kind
                    ? "min-h-[44px] rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "min-h-[44px] rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }
              >
                {t.label}
                {data.lists.find((l) => l.kind === t.kind)?.status === "stale" ? "（旧）" : ""}
              </button>
            ))}
          </div>
          {list === undefined || list.entries.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900 p-4 text-sm text-zinc-600 dark:text-zinc-400">
              这个榜今日暂无数据，稍后再来。
            </p>
          ) : (
            <>
              {list.status === "stale" && (
                <p className="mt-3 text-sm text-amber-800 dark:text-amber-200">
                  {list.label}今日未更新，展示{staleSnapshotLabel(list.fetchedAt)}
                  （数据日期 {formatDataDate(list.fetchedAt)}）。
                </p>
              )}
              <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {list.entries.map((entry) => (
                  <RankingRow
                    // entry.key 是归一化剧名：源榜单同一剧名可出现多次，
                    // 裸 key 会撞车；rank 在榜内唯一，后缀保证唯一。
                    key={`${entry.key}-${entry.rank}`}
                    entry={entry}
                    watching={watchingTitles.has(entry.key)}
                  />
                ))}
              </ol>
              <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                共 {list.entries.length} 部 · 来源：
                <a
                  href={safeHref(list.sourceUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {list.sourceName}
                </a>
                {list.droppedTitles > 0
                  ? ` · ${list.droppedTitles} 行疑似截断标题未计入`
                  : ""}
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
