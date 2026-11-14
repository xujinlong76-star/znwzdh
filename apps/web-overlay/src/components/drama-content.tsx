"use client";

import Link from "next/link";
import type { DramaSite } from "@/lib/drama-sites";
import {
  featuredDramaKey,
  type DramaFeatured,
} from "@/lib/drama-featured";
import { WatchlistAddButton } from "@/components/watchlist-add-button";
import { DramaCalendarSection } from "@/components/drama-calendar-section";
import { safeHref } from "@/lib/safe-url";

/**
 * 短剧专区内容岛：平台区 + 剧目区。
 * 诚实口径：
 * - 平台卡只写导航文案里有的话：文案里写了“需在 App 内观看”的平台
 *   （抖音、快手、爱奇艺、腾讯视频、优酷、芒果 TV、央视频）就明确标出来，
 *   不写“点开即看”。这些平台没有可直达的短剧频道页，点开是平台首页，
 *   需要在 App 内搜来看。
 * - 剧目卡：榜单 / 报道页 / 百科页链接明确标出来，不是正片；
 *   集数只写核实过的，没核实的写“集数未核实”，不编。
 * - 每部剧卡挂 WatchlistAddButton（剧名预填），点“我的追剧”去管理。
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

export function DramaContent({
  sites,
  dramas,
}: {
  sites: DramaSite[];
  dramas: DramaFeatured[];
}) {
  const appOnlyIds = new Set(sites.filter(isAppOnlySite).map((s) => s.id));
  return (
    // 注意：根节点是普通 div 不是 <main>——主内容地标在 page.tsx（<main id="main-content">），
    // 这里再套一层 main 会造成嵌套地标。
    <div className="mx-auto w-full max-w-7xl px-4 py-8">
      <header className="max-w-3xl">
        <h1 className="text-3xl font-bold">短剧专区</h1>
        <p className="mt-3 text-zinc-600">
          12 个短剧平台入口与热门剧追剧清单。平台卡只带你到平台入口：标了
          “需在 App 内观看”的平台没有可直达的短剧频道页，点开是平台首页，
          需要在 App 内搜来看。
        </p>
        <p className="mt-3">
          <Link
            href="/me/watchlist"
            className="inline-flex items-center rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
          >
            我的追剧
          </Link>
        </p>
      </header>

      <section aria-label="短剧平台" className="mt-10">
        <h2 className="text-xl font-semibold">平台入口</h2>
        <p className="mt-2 text-sm text-zinc-600">
          点卡片去平台首页；标了“需在 App 内观看”的，剧不在网页播。
        </p>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sites.map((site) => (
            <li
              key={site.id}
              className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
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
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      需在 App 内观看
                    </span>
                  )}
                </span>
                {site.description && (
                  <span className="mt-2 block text-sm text-zinc-600">
                    {site.description}
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <DramaCalendarSection />

      <section aria-label="热门剧" className="mt-10">
        <h2 className="text-xl font-semibold">热门剧</h2>
        <p className="mt-2 text-sm text-zinc-600">
          榜单页、报道页、百科页链接不是正片，只作来源；集数只写核实过的。
        </p>
        {dramas.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white p-4 text-sm text-zinc-600">
            首批热门剧正在整理，稍后上新。先逛逛上面的平台入口，或去
            <Link href="/category/duanju" className="underline">
              短剧分类
            </Link>
            看看。
          </p>
        ) : (
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {dramas.map((drama) => (
              <li
                key={featuredDramaKey(drama)}
                className="flex flex-col rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
              >
                <h3 className="text-base font-semibold leading-snug">
                  {drama.title}
                </h3>
                <p className="mt-1 text-sm text-zinc-600">
                  {drama.platformTitle} · {episodeText(drama)}
                </p>
                {drama.linkNote !== "剧目页" && (
                  <p className="mt-2 text-xs text-zinc-500">
                    该链接是{drama.linkNote}，不是正片；剧在{drama.platformTitle}
                    播出。
                  </p>
                )}
                {appOnlyIds.has(drama.platformSiteId) && (
                  <p className="mt-2">
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      需在 App 内观看
                    </span>
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <a
                    href={safeHref(drama.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-zinc-700 underline hover:text-zinc-900"
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
      </section>

      <p className="mt-10 text-xs text-zinc-500">
        追剧清单只记你自己填的集数与节奏；关闭弹窗不会丢数据。已关注的剧
        在“我的追剧”里管理，未登录时只保存在本机。
      </p>
    </div>
  );
}
