/**
 * 「本周追剧表」静态周视图的纯排布层。
 *
 * 只做一件事：把用户已标注的更新节奏（`WatchEntry.cadence`）按星期排出来。
 * 不新增字段、不改判定口径、不推断平台到底更新了没有——排布规则与
 * `lib/watchlist.ts` 的 `isCadenceDay` 同一口径。
 *
 * 规则（与方案 §3.3 一致）：
 *  - daily → 只进表顶「每天更新」横条，不重复铺进 7 个日期格；
 *  - weekly → 只落进 `weekdays` 标注的那几天（含多日）；
 *  - finished → 不进表（已完结的剧留在清单页既有的「已完结 · 慢慢补」区）；
 *  - unknown → 永不进表，进 `unscheduled`（「还没排进来」区）。
 * 周一起点、今天判定一律用本地时区（复用 `localDateKey`）。
 */
import { isCadenceDay, localDateKey, type WatchEntry } from './watchlist'

export interface WeekScheduleDay {
  /** 当天本地零点 */
  date: Date
  /** 本地日期键 YYYY-MM-DD */
  dateKey: string
  /** getDay()：0 = 周日 … 6 = 周六 */
  weekday: number
  /** 是否今天（按调用方传入的 now 判定，默认此时） */
  isToday: boolean
  /** 落在这一天的剧：想先看（high）在前，其次按最近更新时间倒序 */
  entries: WatchEntry[]
}

export interface WeekSchedule {
  /** 每天更新的剧：只进表顶横条，不进日期格 */
  daily: WatchEntry[]
  /** 周一 → 周日，固定 7 天 */
  days: WeekScheduleDay[]
  /** 没标注更新节奏、排不进来的剧 */
  unscheduled: WatchEntry[]
}

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const

/** 「11月16日 周一」这种表头写法，周一起点、全站统一。 */
export function formatWeekDay(date: Date): string {
  return `${date.getMonth() + 1}月${date.getDate()}日 周${WEEKDAY_LABELS[date.getDay()]}`
}

/** 取某天所在周的周一（本地时区，零点）。传入周日时回到上一个周一。 */
export function mondayOfWeek(at: Date): Date {
  const monday = new Date(at.getFullYear(), at.getMonth(), at.getDate())
  const offset = (monday.getDay() + 6) % 7
  monday.setDate(monday.getDate() - offset)
  return monday
}

const priorityRank = (e: WatchEntry) => (e.priority === 'high' ? 0 : 1)

/** 同日多部时想先看的在前，其次最近有动静的在前（与清单分区排序同口径）。 */
function sortDayEntries(entries: WatchEntry[]): WatchEntry[] {
  return [...entries].sort((a, b) => priorityRank(a) - priorityRank(b) || b.updatedAt - a.updatedAt)
}

/**
 * 按本周一为起点排 7 天。`weekStart` 传任意一天都会先归一到它所在周的周一。
 * `now` 只用来判定今天是哪一格，默认此时；单测可固定传入。
 */
export function buildWeekSchedule(entries: WatchEntry[], weekStart: Date, now: Date = new Date()): WeekSchedule {
  const monday = mondayOfWeek(weekStart)
  const todayKey = localDateKey(now.getTime())
  const daily: WatchEntry[] = []
  const unscheduled: WatchEntry[] = []
  const days: WeekScheduleDay[] = []

  for (let i = 0; i < 7; i++) {
    const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)
    days.push({
      date,
      dateKey: localDateKey(date.getTime()),
      weekday: date.getDay(),
      isToday: localDateKey(date.getTime()) === todayKey,
      entries: [],
    })
  }

  for (const entry of entries) {
    const cadence = entry.cadence
    if (cadence.kind === 'daily') {
      daily.push(entry)
    } else if (cadence.kind === 'weekly') {
      for (const day of days) {
        if (isCadenceDay(cadence, day.date)) day.entries.push(entry)
      }
    } else if (cadence.kind === 'unknown') {
      unscheduled.push(entry)
    }
    // finished：不进表，留在清单页既有的已完结区
  }

  return {
    daily: sortDayEntries(daily),
    days: days.map((day) => ({ ...day, entries: sortDayEntries(day.entries) })),
    unscheduled: sortDayEntries(unscheduled),
  }
}
