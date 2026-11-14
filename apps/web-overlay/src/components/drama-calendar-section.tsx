"use client";

import { useEffect, useState } from "react";
import type { DramaCalendarResponse } from "@/lib/rest-contracts.generated";

/**
 * 开播日历区块（/drama 内）。
 *
 * 数据来自 GET /api/drama/calendar（drama_calendar_refresh 任务每日抓
 * 搜短剧预约榜存快照）。客户端取数、失败不挂页：
 * - 抓取失败时后端下发上一日快照并标 stale，这里如实写“展示上一日快照”；
 * - 从未抓到过时 status empty，这里只留一行说明，不编日期。
 *
 * 诚实口径：
 * - 顶部写明“档期为平台预计，以官方为准 · 数据日期 · 来源”；
 * - 只放榜单抓到的真实数据：精确到日的进按日分组，仅到月的进“月份待定”，
 *   无日期的不展示；过期未兑现的单列，不静默删除；
 * - 日历不给单剧外链：榜单没给剧在哪个平台播，乱指一个平台入口是误导。
 */

type CalendarState =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "ready"; data: DramaCalendarResponse };

function formatDataDate(fetchedAt: number | null): string {
  if (!fetchedAt) return "暂无";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(fetchedAt));
}

const MONTH_DISPLAY_CAP = 12;

export function DramaCalendarSection() {
  const [state, setState] = useState<CalendarState>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    fetch("/api/hub/drama/calendar", { headers: { Accept: "application/json" } })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<DramaCalendarResponse>;
      })
      .then((data) => {
        if (alive) setState({ kind: "ready", data });
      })
      .catch(() => {
        if (alive) setState({ kind: "failed" });
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section aria-label="开播日历" className="mt-10">
      <h2 className="text-xl font-semibold">开播日历</h2>
      {state.kind === "loading" ? (
        <p className="mt-2 text-sm text-zinc-600" aria-busy="true">
          正在加载开播日历…
        </p>
      ) : state.kind === "failed" ? (
        <p className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white p-4 text-sm text-zinc-600">
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
      <p className="mt-2 text-sm text-zinc-600">
        档期为平台预计，以官方为准 · 数据日期 {dataDate} · 来源：
        {data.sourceName}（预约热门待上线剧，非全部新剧）
      </p>
      {data.status === "stale" && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          今日数据源未更新，展示上一日快照（数据日期 {dataDate}），日期可能已改档。
        </p>
      )}
      {data.status === "empty" ? (
        <p className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white p-4 text-sm text-zinc-600">
          开播日历暂无数据（今日抓取尚未成功），稍后再来。
        </p>
      ) : (
        <>
          {daysWithItems.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white p-4 text-sm text-zinc-600">
              未来 14 天暂无精确到日的待上线剧；下面是只精确到月的档期。
            </p>
          ) : (
            <ul className="mt-4 space-y-4">
              {daysWithItems.map((day) => (
                <li key={day.date}>
                  <h3 className="text-base font-semibold">
                    {day.label}
                    <span className="ml-2 text-sm font-normal text-zinc-500">
                      {day.date}
                    </span>
                  </h3>
                  <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {day.items.map((item) => (
                      <li
                        key={item.title}
                        className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm"
                      >
                        <span className="block text-sm font-medium">{item.title}</span>
                        <span className="mt-1 block text-xs text-zinc-500">{item.rawLabel}</span>
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
              <p className="mt-1 text-sm text-zinc-600">
                榜单只给了月份、没给具体日期的待上线剧。
              </p>
              <ul className="mt-3 space-y-3">
                {data.monthPending.map((group) => (
                  <li key={group.month}>
                    <p className="text-sm font-medium">
                      {group.label}
                      {group.overdue && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                          已过预计月份，待确认
                        </span>
                      )}
                      <span className="ml-2 text-xs font-normal text-zinc-500">
                        {group.items.length} 部
                      </span>
                    </p>
                    <p className="mt-1 text-sm text-zinc-600">
                      {group.items
                        .slice(0, MONTH_DISPLAY_CAP)
                        .map((i) => i.title)
                        .join("、")}
                      {group.items.length > MONTH_DISPLAY_CAP &&
                        ` 等 ${group.items.length} 部`}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.recentChanges.length > 0 && (
            <div className="mt-6">
              <h3 className="text-base font-semibold">最近改档</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-600">
                {data.recentChanges.slice(0, 3).map((c) => (
                  <li key={`${c.title}-${c.at}`}>
                    《{c.title}》原定 {c.from ?? "未定"} → 改至 {c.to ?? "未定"}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.expired.length > 0 && (
            <details className="mt-6">
              <summary className="cursor-pointer text-sm font-medium text-zinc-700">
                档期未兑现（{data.expired.length} 部）：预计日期已过，榜单仍未更新
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-600">
                {data.expired.map((item) => (
                  <li key={item.title}>
                    《{item.title}》原定 {item.premiereDate} 上线
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
