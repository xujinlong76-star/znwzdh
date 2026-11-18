"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { DramaSite } from "@/lib/drama-sites";
import {
  featuredDramaKey,
  type DramaFeatured,
} from "@/lib/drama-featured";
import { WatchlistAddButton } from "@/components/watchlist-add-button";
import { DramaCalendarSection } from "@/components/drama-calendar-section";
import { DramaRankingsSection } from "@/components/drama-rankings-section";
import { useDramaCalendar, useDramaRankings } from "@/hooks/useDramaData";
import { useDramaCheckStates } from "@/hooks/useDramaCheckStates";
import { useWatchlist } from "@/hooks/useWatchlist";
import { safeHref } from "@/lib/safe-url";
import {
  cadenceLabel,
  isReminderDue,
  partitionWatchlist,
  selectContinueWatching,
  type WatchEntry,
} from "@/lib/watchlist";
import {
  computeDramaWatchStats,
  hasNewEpisodes,
  latestEpisodeText,
} from "@/lib/drama-watch-stats";
import {
  collectDramaExtraResults,
  dramaGenreOptions,
  filterFeaturedDramas,
} from "@/lib/drama-search";
import {
  readWatchProgressLog,
  type WatchProgressLogEntry,
} from "@/lib/watch-progress-log";

/**
 * 短剧专区内容岛：榜单区 + 平台区 + 日历区 + 继续追 + 剧目区。
 * 诚实口径：
 * - 平台卡只写导航文案里有的话：文案里写了“需在 App 内观看”的平台
 *   （抖音、快手、爱奇艺、腾讯视频、优酷、芒果 TV、央视频）就明确标出来，
 *   不写“点开即看”。这些平台没有可直达的短剧频道页，点开是平台首页，
 *   需要在 App 内搜来看。
 * - 剧目卡：榜单 / 报道页 / 百科页链接明确标出来，不是正片；
 *   集数只写核实过的，没核实的写“集数未核实”，不编。
 * - 每部剧卡挂 WatchlistAddButton（剧名预填），点“我的追剧”去管理。
 * - 题材筛选 + 站内搜剧（U-D2）：语料 = 热门 18 部（题材只取 featured.json
 *   里核实过的 genres）+ 三榜条目（题材取榜单卡题材行）+ 日历标题
 *   （无题材标签，只参与搜剧名、不参与题材筛选）；筛选与搜索可叠加；
 *   空结果如实写“这个题材暂无收录”/“没找到叫「xxx」的剧”，不拿别的题材凑数。
 * - 继续追（U-D8）：首页 selectContinueWatching 行原样搬过来 + 本地轻量
 *   统计（在追 X 部、本周看了 Y 集、有新集 Z 部）；未登录也一样算，不逼登录；
 *   Z 只在服务端确实有检查基线时显示，匿名不编。
 * - 清单行“已更至第 X 集”（U-D3）：X 来自服务端检查基线；无基线时只对
 *   featured 里可查的剧写“未查到最新集数”，其余行不写。
 */

/** 导航文案里写了“需在……App 内观看”的平台，就是 App-only 平台。 */
const APP_ONLY_RE = /需在.{0,10}App 内观看/;

function isAppOnlySite(site: DramaSite): boolean {
  return site.description !== undefined && APP_ONLY_RE.test(site.description);
}

function episodeText(drama: DramaFeatured): string {
  if (
    drama.totalEpisodes !== null &&
    drama.episodesKnown !== null &&
    drama.totalEpisodes === drama.episodesKnown
  ) {
    return `全 ${drama.totalEpisodes} 集 · 已完结`;
  }
  if (drama.episodesKnown !== null) {
    return drama.totalEpisodes !== null
      ? `已更 ${drama.episodesKnown} 集 / 共 ${drama.totalEpisodes} 集`
      : `已更 ${drama.episodesKnown} 集`;
  }
  return "集数未核实";
}

/** “继续追”行角标：与首页影院区同口径（今日待看 / 可查更新 / 节奏文案）。 */
function continueBadge(entry: WatchEntry, now: Date): string {
  if (isReminderDue(entry, now)) return "今日待看";
  if (entry.cadence.kind === "unknown") return "可查更新";
  return cadenceLabel(entry.cadence);
}

export function DramaContent({
  sites,
  dramas,
}: {
  sites: DramaSite[];
  dramas: DramaFeatured[];
}) {
  const appOnlyIds = new Set(sites.filter(isAppOnlySite).map((s) => s.id));
  // 今日待看：与分类横幅、简报、首页影院同口径（partitionWatchlist(...).due.length）。
  // ready=false / 存储被禁时按无待看处理——药丸文案与现状一致，不渲染假信号。
  const { ready, entries, storageBlocked } = useWatchlist();
  const parts =
    ready && !storageBlocked ? partitionWatchlist(entries, new Date()) : null;
  const dueCount = parts?.due.length ?? 0;

  // --- U-D8 继续追：首页同款取行 + 本地统计 + 服务端检查状态 ---
  const checkStates = useDramaCheckStates();
  const [progressLog, setProgressLog] = useState<WatchProgressLogEntry[]>([]);
  useEffect(() => {
    setProgressLog(readWatchProgressLog());
  }, []);
  const now = new Date();
  const continueWatching =
    ready && !storageBlocked ? selectContinueWatching(entries, now) : [];
  const stats =
    ready && !storageBlocked
      ? computeDramaWatchStats(entries, checkStates.byKey, progressLog, now)
      : null;
  // featured 里可查的剧（check.kind !== "none"）：无基线时才写“未查到最新集数”。
  const checkableFeaturedKeys = useMemo(
    () =>
      new Set(
        dramas
          .filter((d) => d.check.kind !== "none")
          .map((d) => featuredDramaKey(d)),
      ),
    [dramas],
  );

  // --- U-D2 题材筛选 + 站内搜剧 ---
  const rankings = useDramaRankings();
  const calendar = useDramaCalendar();
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState("");
  const [filterReady, setFilterReady] = useState(false);
  // 挂载时从 URL 读回筛选状态（mount 后读 location.search，避开 useSearchParams 的 Suspense 问题）。
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setQuery(params.get("q") ?? "");
    setGenre(params.get("genre") ?? "");
    setFilterReady(true);
  }, []);
  // 筛选变化时写回 URL（replaceState，不产生历史记录）；读回前不写，免得冲掉进页参数。
  useEffect(() => {
    if (!filterReady) return;
    const params = new URLSearchParams(window.location.search);
    if (query) params.set("q", query);
    else params.delete("q");
    if (genre) params.set("genre", genre);
    else params.delete("genre");
    const next = params.toString();
    const url = next ? `${window.location.pathname}?${next}` : window.location.pathname;
    window.history.replaceState(null, "", url);
  }, [query, genre, filterReady]);

  // 题材 chips：热门 18 + 三榜条目的题材并集（日历标题无题材，不进 chips）。
  const genreOptions = useMemo(
    () =>
      dramaGenreOptions(dramas, rankings.kind === "ready" ? rankings.data : null),
    [dramas, rankings],
  );

  const filtering = query.trim() !== "" || genre !== "";
  const featuredFiltered = useMemo(
    () => filterFeaturedDramas(dramas, query, genre),
    [dramas, genre, query],
  );

  // 榜单与日历里的相关剧（只在筛选/搜索激活时展示；日历标题无题材，题材筛选时不参与）。
  const extraResults = useMemo(
    () =>
      filtering
        ? collectDramaExtraResults(
            rankings.kind === "ready" ? rankings.data : null,
            calendar.kind === "ready" ? calendar.data : null,
            query,
            genre,
          )
        : { ranking: [], calendar: [] },
    [filtering, query, genre, rankings, calendar],
  );

  const nothingFound =
    filtering && featuredFiltered.length === 0 && extraResults.ranking.length === 0 && extraResults.calendar.length === 0;

  return (
    // 注意：根节点是普通 div 不是 <main>——主内容地标在 page.tsx（<main id="main-content">），
    // 这里再套一层 main 会造成嵌套地标。
    <div className="mx-auto w-full max-w-7xl px-4 py-8">
      <header className="max-w-3xl">
        <h1 className="text-3xl font-bold">短剧专区</h1>
        <p className="mt-3 text-zinc-600 dark:text-zinc-400">
          12 个短剧平台入口与热门剧追剧清单。平台卡只带你到平台入口：标了
          “需在 App 内观看”的平台没有可直达的短剧频道页，点开是平台首页，
          需要在 App 内搜来看。
        </p>
        <p className="mt-3">
          <Link
            href="/me/watchlist"
            className="inline-flex items-center rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {dueCount > 0 ? `今日待看 ${dueCount} 部 · 去追剧清单` : "我的追剧"}
          </Link>
        </p>
      </header>

      <DramaRankingsSection />

      <section aria-label="短剧平台" className="mt-10">
        <h2 className="text-xl font-semibold">平台入口</h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          点卡片去平台首页；标了“需在 App 内观看”的，剧不在网页播。
        </p>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sites.map((site) => (
            <li
              key={site.id}
              className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 p-4 shadow-sm"
            >
              <a
                href={safeHref(site.href)}
                target="_blank"
                rel="noopener noreferrer"
                className="block"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold">{site.title}</span>
                  {isAppOnlySite(site) && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                      需在 App 内观看
                    </span>
                  )}
                </span>
                {site.description && (
                  <span className="mt-2 block text-sm text-zinc-600 dark:text-zinc-400">
                    {site.description}
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <DramaCalendarSection />

      {continueWatching.length > 0 && (
        <section aria-label="继续追" className="mt-10">
          <h2 className="text-xl font-semibold">继续追</h2>
          {stats && (
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              在追 {stats.tracking} 部 · 本周看了 {stats.watchedThisWeek} 集
              {stats.hasNew !== null ? ` · 有新集 ${stats.hasNew} 部` : ""}
            </p>
          )}
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {continueWatching.map((entry) => {
              const state = checkStates.byKey.get(entry.key);
              const latestText = latestEpisodeText(state);
              const showUnknown =
                latestText === null && checkableFeaturedKeys.has(entry.key);
              return (
                <li
                  key={entry.key}
                  className="flex flex-col rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 p-4 shadow-sm"
                >
                  <p className="flex flex-wrap items-center gap-2">
                    <a
                      href={safeHref(entry.playUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-w-0 truncate text-base font-semibold text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-100"
                      title={`${entry.title} · 在${entry.platformTitle}站内打开`}
                    >
                      {entry.title}
                    </a>
                    {hasNewEpisodes(entry, state) && (
                      <span className="shrink-0 rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:text-rose-400">
                        有新集
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    {entry.platformTitle} ·{" "}
                    {entry.episode > 0 ? `看到第 ${entry.episode} 集` : "还没开始看"}
                    {latestText ? ` · ${latestText}` : ""}
                    {showUnknown ? " · 未查到最新集数" : ""}
                  </p>
                  <p className="mt-2">
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                      {continueBadge(entry, now)}
                    </span>
                  </p>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-sm">
            <Link href="/me/watchlist" className="text-zinc-700 underline hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100">
              去我的追剧管理全部清单
            </Link>
          </p>
        </section>
      )}

      <section aria-label="热门剧" className="mt-10">
        <h2 className="text-xl font-semibold">热门剧</h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          榜单页、报道页、百科页链接不是正片，只作来源；集数只写核实过的。
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <div className="relative w-full max-w-md">
            <label className="sr-only" htmlFor="drama-search">
              搜剧名
            </label>
            <input
              id="drama-search"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜剧名，如「红果」「万妖图录」…"
              className="h-11 w-full rounded-full border border-zinc-300 bg-white px-4 pr-11 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-400"
            />
            {query !== "" && (
              <button
                type="button"
                aria-label="清除搜索"
                title="清除搜索"
                onClick={() => setQuery("")}
                className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-zinc-500 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {genreOptions.length > 0 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="按题材筛选">
              <button
                type="button"
                aria-pressed={genre === ""}
                onClick={() => setGenre("")}
                className={
                  genre === ""
                    ? "min-h-[44px] rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "min-h-[44px] rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }
              >
                全部题材
              </button>
              {genreOptions.map((g) => (
                <button
                  key={g.name}
                  type="button"
                  aria-pressed={genre === g.name}
                  onClick={() => setGenre(genre === g.name ? "" : g.name)}
                  className={
                    genre === g.name
                      ? "min-h-[44px] rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "min-h-[44px] rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  }
                >
                  {g.name}（{g.count}）
                </button>
              ))}
            </div>
          )}
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            题材只标核实过的：热门剧里 7 部有题材标签，其余与日历剧暂无题材、不参与题材筛选；搜剧名即时出结果，筛选与搜索可叠加。
          </p>
        </div>

        {nothingFound ? (
          <p className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900 p-4 text-sm text-zinc-600 dark:text-zinc-400">
            {genre !== ""
              ? query.trim() !== ""
                ? `没有同时符合「${genre}」和「${query.trim()}」的剧`
                : "这个题材暂无收录"
              : `没找到叫「${query.trim()}」的剧`}
            。换个题材或剧名试试，或去
            <Link href="/category/duanju" className="underline">
              短剧分类
            </Link>
            看看。
          </p>
        ) : (
          <>
            {dramas.length === 0 ? (
              <p className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900 p-4 text-sm text-zinc-600 dark:text-zinc-400">
                首批热门剧正在整理，稍后上新。先逛逛上面的平台入口，或去
                <Link href="/category/duanju" className="underline">
                  短剧分类
                </Link>
                看看。
              </p>
            ) : featuredFiltered.length === 0 ? (
              <p className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900 p-4 text-sm text-zinc-600 dark:text-zinc-400">
                热门剧里没有符合的，下面是榜单与日历里的相关剧。
              </p>
            ) : (
              <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {featuredFiltered.map((drama) => (
                  <li
                    key={featuredDramaKey(drama)}
                    className="flex flex-col rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 p-4 shadow-sm"
                  >
                    <h3 className="text-balance text-base font-semibold leading-snug">
                      {drama.title}
                    </h3>
                    <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                      {drama.platformTitle} · {episodeText(drama)}
                    </p>
                    {(drama.genres ?? []).length > 0 && (
                      <p className="mt-2 flex flex-wrap gap-1">
                        {(drama.genres ?? []).map((g) => (
                          <span
                            key={g}
                            className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                          >
                            {g}
                          </span>
                        ))}
                      </p>
                    )}
                    {drama.linkNote !== "剧目页" && (
                      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                        该链接是{drama.linkNote}，不是正片；剧在{drama.platformTitle}
                        播出。
                      </p>
                    )}
                    {appOnlyIds.has(drama.platformSiteId) && (
                      <p className="mt-2">
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                          需在 App 内观看
                        </span>
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <a
                        href={safeHref(drama.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-zinc-700 underline hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
                      >
                        查看来源 ({drama.linkNote})
                      </a>
                      <WatchlistAddButton
                        platform={{
                          siteId: drama.platformSiteId,
                          title: drama.platformTitle,
                          href: drama.url,
                        }}
                        defaultTitle={drama.title}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {filtering && (extraResults.ranking.length > 0 || extraResults.calendar.length > 0) && (
              <div className="mt-6">
                <h3 className="text-base font-semibold">榜单与日历里的相关剧</h3>
                <ul className="mt-3 space-y-2">
                  {extraResults.ranking.map((r) => (
                    <li key={`${r.label}-${r.title}`} className="text-sm">
                      <a
                        href={safeHref(r.detailUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-100"
                      >
                        {r.title}
                      </a>
                      <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">
                        {r.label}
                        {r.genre ? ` · ${r.genre}` : ""}
                      </span>
                    </li>
                  ))}
                  {extraResults.calendar.map((c) => (
                    <li key={`cal-${c.title}`} className="text-sm">
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">{c.title}</span>
                      <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">
                        开播日历 · {c.label}
                      </span>
                    </li>
                  ))}
                </ul>
                {genre !== "" && (
                  <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                    日历剧没有题材标签，不参与题材筛选，只参与搜剧名。
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </section>

      <p className="mt-10 text-xs text-zinc-500 dark:text-zinc-400">
        追剧清单只记你自己填的集数与节奏；关闭弹窗不会丢数据。已关注的剧
        在“我的追剧”里管理，未登录时只保存在本机。
      </p>
    </div>
  );
}
