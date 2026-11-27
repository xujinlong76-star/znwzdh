"use client";

import { useDramaCalendar } from "@/hooks/useDramaData";
import { useWatchlist } from "@/hooks/useWatchlist";
import { isReservedEntry } from "@/lib/watchlist";
import type { DramaCalendarResponse } from "@/lib/rest-contracts.generated";

/**
 * 开播日历区块（/drama 内）。
 *
 * 数据来自 GET /api/drama/calendar（drama_calendar_refresh 任务每日抓
 * 搜短剧预约榜存快照），与页内搜索共用 useDramaCalendar（同一页只拉一次）。
 * 客户端取数、失败不挂页：
 * - 抓取失败时后端下发上次成功快照并标 stale，这里如实写“展示上次成功快照”；
 * - 从未抓到过时 status empty，这里只留一行说明，不编日期。
 *
 * 诚实口径：
 * - 顶部写明“档期为平台预计，以官方为准 · 数据日期 · 来源”；
 * - 只放榜单抓到的真实数据：精确到日的进按日分组，仅到月的进“月份待定”，
 *   无日期的不展示；过期未兑现的单列，不静默删除；
 * - 日历不给单剧外链：榜单没给剧在哪个平台播，乱指一个平台入口是误导。
 *   但可以一键预约（U-377）：按钮只按剧名把剧放进追剧清单预约态
 *   （键 reserved::归一化剧名，平台待确认），不预填平台、不链平台入口；
 *   已预约 / 已在追的剧按钮置灰，不重复加。
 * - “刚开播”区是推断：离开预约榜 ≠ 确认开播，文案写清这一点；
 *   日历剧没有平台信息，预约后在清单里等开播日提醒，开播后平台确认了再补。
 */

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
 * 日历剧的一键预约按钮（U-377）：只按剧名预约，不指向平台入口。
 * 已预约（预约态）/ 已在追（平台态）时置灰，不重复加。
 */
function ReserveButton({ title, premiereDate }: { title: string; premiereDate: string | null }) {
  const watchlist = useWatchlist();
  const existing = watchlist.findByTitle(title);
  if (existing && isReservedEntry(existing)) {
    return (
      <span className="mt-2 inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        已预约 · 平台待确认
      </span>
    );
  }
  if (existing) {
    return (
      <span className="mt-2 inline-flex rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
        已在追
      </span>
    );
  }
  return (
    <button
      type="button"
      disabled={Boolean(watchlist.storageBlocked)}
      onClick={() => watchlist.addReserved(title, premiereDate)}
      className="mt-2 inline-flex rounded-full bg-rose-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-rose-700 disabled:opacity-50"
    >
      预约追剧
    </button>
  );
}

export function DramaCalendarSection() {
  const state = useDramaCalendar();

  return (
    <section aria-label="开播日历" className="mt-10">
      <h2 className="text-xl font-semibold">开播日历</h2>
      {state.kind === "loading" ? (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400" aria-busy="true">
          正在加载开播日历…
        </p>
      ) : state.kind === "failed" ? (
        <p className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900 p-4 text-sm text-zinc-600 dark:text-zinc-400">
          开播日历这次没加载出来，刷新页面再试；平台入口与热门剧不受影响。
        </p>
      ) : (
        <CalendarBody data={state.data} />
      )}
    </section>
  );
}

function CalendarBody({ data }: { data: DramaCalendarResponse }) {
  const daysWithItems = data.days.filter((d) => d.items.length > 0);
  const dataDate = formatDataDate(data.fetchedAt);
  return (
    <div>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        档期为平台预计，以官方为准 · 数据日期 {dataDate} · 来源：
        {data.sourceName}（预约热门待上线剧，非全部新剧）
      </p>
      {data.status === "stale" && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          今日数据源未更新，展示上次成功快照（数据日期 {dataDate}），日期可能已改档。
        </p>
      )}
      {data.status === "empty" ? (
        <p className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900 p-4 text-sm text-zinc-600 dark:text-zinc-400">
          开播日历暂无数据（今日抓取尚未成功），稍后再来。
        </p>
      ) : (
        <>
          {daysWithItems.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900 p-4 text-sm text-zinc-600 dark:text-zinc-400">
              未来 14 天暂无精确到日的待上线剧；下面是只精确到月的档期。
            </p>
          ) : (
            <ul className="mt-4 space-y-4">
              {daysWithItems.map((day) => (
                <li key={day.date}>
                  <h3 className="text-base font-semibold">
                    {day.label}
                    <span className="ml-2 text-sm font-normal text-zinc-500 dark:text-zinc-400">
                      {day.date}
                    </span>
                  </h3>
                  <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {day.items.map((item, idx) => (
                      <li
                        // 剧名不唯一：同一剧名可在快照里出现多次（如重复下榜），
                        // 裸剧名作 key 会报 duplicate key；下标后缀保证唯一。
                        key={`${item.title}-${idx}`}
                        className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 p-3 shadow-sm"
                      >
                        <span className="block text-sm font-medium">{item.title}</span>
                        <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">{item.rawLabel}</span>
                        <ReserveButton title={item.title} premiereDate={item.premiereDate} />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}

          {data.monthPending.length > 0 && (
            <div className="mt-6">
              <h3 className="text-base font-semibold">月份待定</h3>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                榜单只给了月份、没给具体日期的待上线剧。
              </p>
              <ul className="mt-3 space-y-3">
                {data.monthPending.map((group) => (
                  <li key={group.month}>
                    <p className="text-sm font-medium">
                      {group.label}
                      {group.overdue && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                          已过预计月份，待确认
                        </span>
                      )}
                      <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">
                        {group.items.length} 部
                      </span>
                    </p>
                    <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {group.items.map((i, idx) => (
                        <li
                          // 同上：剧名不唯一，下标后缀保证唯一。
                          key={`${i.title}-${idx}`}
                          className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 p-3 shadow-sm"
                        >
                          <span className="block text-sm font-medium">{i.title}</span>
                          <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">{i.rawLabel}</span>
                          <ReserveButton title={i.title} premiereDate={null} />
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.recentChanges.length > 0 && (
            <div className="mt-6">
              <h3 className="text-base font-semibold">最近改档</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
                {data.recentChanges.slice(0, 3).map((c) => (
                  <li key={`${c.title}-${c.at}`}>
                    《{c.title}》原定 {c.from ?? "未定"} → 改至 {c.to ?? "未定"}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.recentlyDropped.length > 0 && (
            <div className="mt-6">
              <h3 className="text-base font-semibold">刚开播</h3>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                近 7 天离开预约榜的剧——可能是已开播，也可能是下架或改档，
                榜单没给确认信息，以平台为准。想追的剧点「预约追剧」先进清单
                （这里不知道它在哪个平台播，先按剧名预约着，开播后平台确认了再补）。
              </p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data.recentlyDropped.map((item, idx) => (
                  <li
                    // 同一剧名掉榜→重回榜→再掉榜时 dropped 里会累积多条同名记录
                    // （buildCalendarSnapshot 不对 dropped 去重），裸剧名作 key
                    // 必然撞车（实测「早安，林思忆」）；下标后缀保证唯一。
                    key={`${item.title}-${idx}`}
                    className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 p-3 shadow-sm"
                  >
                    <span className="block text-sm font-medium">{item.title}</span>
                    <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
                      {item.lastLabel ?? "离开预约榜"}
                    </span>
                    <ReserveButton title={item.title} premiereDate={item.lastDate} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.expired.length > 0 && (
            <details className="mt-6">
              <summary className="cursor-pointer text-sm font-medium text-zinc-700 dark:text-zinc-300">
                档期未兑现（{data.expired.length} 部）：预计日期已过，榜单仍未更新
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
                {data.expired.map((item, idx) => (
                  <li key={`${item.title}-${idx}`}>
                    《{item.title}》原定 {item.premiereDate} 上线
                    <span className="ml-2 inline-flex align-middle">
                      <ReserveButton title={item.title} premiereDate={item.premiereDate} />
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
