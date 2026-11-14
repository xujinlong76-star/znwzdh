/**
 * 短剧开播日历：搜短剧预约榜解析 + 快照 + 视图。
 *
 * 数据源（2026-11-14 实测，见可行性报告）：
 *   https://www.soduanju.com/paihang/yuyue.html
 *   SSR、无登录、robots 全站 Allow；每条待上线剧含剧名 + 预约人数 +
 *   “预计 M 月 D 日 / 预计 M 月”上线日期。榜单随日期滚动，已开播剧
 *   会从榜单消失；预计日期频繁改档（含跨月），只能按“预计”呈现。
 *
 * 诚实口径（本文件只处理事实，不编数据）：
 *   - 仅“预计 M 月 D 日”的条目进按日日历；仅“预计 M 月”的进“月份待定”区；
 *   - “即将上线”（无日期）与非档期卡片不进日历，但保留在快照里备查；
 *   - 日期已过 → 移出日历，进“过期未兑现”区，不静默删除；
 *   - 同一剧名预计日期变化 → 记一条改档记录（旧值 → 新值）；
 *   - 本轮解析条目过少（< 20，正常约 95–100）视为疑似改版，不覆盖快照。
 *
 * 全部日期按 Asia/Shanghai 日历算：源站是中国站，榜单日期是北京时间。
 */
import { normalizeDramaTitle } from "./featured.ts";

/** 预约榜源站。 */
export const YUYUE_URL = "https://www.soduanju.com/paihang/yuyue.html";
export const YUYUE_SOURCE_NAME = "搜短剧预约榜";
/** 快照在 system_states 里的键。 */
export const DRAMA_CALENDAR_SNAPSHOT_KEY = "drama:calendar:snapshot";
/** 解析条目过少的疑似改版阈值（正常约 95–100 条）。 */
export const YUYUE_MIN_ENTRIES = 20;
/** 日历向前展示的天数。 */
export const CALENDAR_WINDOW_DAYS = 14;
/** 改档记录与下榜记录各自保留上限。 */
export const CALENDAR_HISTORY_CAP = 50;

export type YuyueDateKind = "day" | "month" | "unknown";

export interface YuyueEntry {
  /** 剧名（榜单原文，去空白）。 */
  title: string;
  /** 归一化剧名（去重与改档比对的键，与 featured.ts 口径一致）。 */
  key: string;
  dateKind: YuyueDateKind;
  /** 预计月份 1–12；unknown 时为 0。 */
  month: number;
  /** 解析出的年份（与 resolvePremiereDate 同一跨年规则）；unknown 时为 0。 */
  year: number;
  /** 预计日；仅 day 精确时有值。 */
  day: number | null;
  /** 解析到的完整日期（YYYY-MM-DD，上海时区）；仅 day 精确时有值。 */
  premiereDate: string | null;
  /** 预约人数（万人）；榜单没写时为 null，不编。 */
  reservations: number | null;
  /** 榜单原文标签，如“预计11月30日上线”。 */
  rawLabel: string;
}

/** 一条改档记录：同一剧名的预计日期变了，旧值 → 新值。 */
export interface DramaCalendarChange {
  title: string;
  from: string | null;
  to: string | null;
  at: number;
}

/** 上一轮还在榜、这一轮消失的条目（已开播或掉出榜单，不静默删除）。 */
export interface DramaCalendarDropped {
  title: string;
  /** 最后一次在榜时看到的预计标签。 */
  lastLabel: string | null;
  /** 最后一次在榜时的完整日期（day 精确时才有）。 */
  lastDate: string | null;
  at: number;
}

export interface DramaCalendarSnapshot {
  version: 1;
  source: "soduanju-yuyue";
  sourceUrl: string;
  sourceName: string;
  /** 本次成功抓取时间（毫秒）。 */
  fetchedAt: number;
  /** 源站 JSON-LD dateModified（榜单自身的更新时间），抓不到为 null。 */
  sourceDateModified: string | null;
  /** 本轮解析到的全部条目（含 month / unknown）。 */
  entries: YuyueEntry[];
  /** 改档记录（最新在前，上限 50 条）。 */
  changes: DramaCalendarChange[];
  /** 下榜记录（最新在前，上限 50 条）。 */
  dropped: DramaCalendarDropped[];
  /** 最近一次失败原因；成功时为 null。失败不清空 entries。 */
  lastError: string | null;
  /** 最近一次成功抓取时间（毫秒）；从未成功为 null。 */
  lastOkAt: number | null;
}

const TITLE_RE =
  /<div class="text-base font-semibold leading-6[^>]*>([^<]+)<\/div>/g;
const META_RE = /<div class="mt-2 line-clamp-1[^>]*>([^<]+)<\/div>/;
const DAY_RE = /预计(\d{1,2})月(\d{1,2})日/;
const MONTH_RE = /预计(\d{1,2})月(?!\d)/;
const RESERVATIONS_RE = /([\d.]+)万人预约/;
const DATE_MODIFIED_RE = /"dateModified"\s*:\s*"([^"]+)"/;

function shanghaiParts(ms: number): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [year, month, day] = fmt.format(new Date(ms)).split("-").map(Number);
  return { year: year ?? 1970, month: month ?? 1, day: day ?? 1 };
}

/** 上海时区的 YYYY-MM-DD。 */
export function shanghaiDateKey(ms: number): string {
  const { year, month, day } = shanghaiParts(ms);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * 把“预计 M 月（D 日）”解析成年份。
 *
 * 规则：月份 >= 抓取当月 → 当年；月份只落后 1 个月 → 仍算当年（日期已过，
 * 由视图层标为过期/待确认，而不是伪装成明年）；落后 2 个月以上 → 次年
 * （如 11 月看到“预计 2 月”，是明年 2 月的计划）。
 * 反例警示：11 月看到“预计 10 月”若滚到次年 10 月，会把已过期的档期
 * 伪装成未来，是编数据。
 */
export function resolveYear(month: number, fetchedAt: number): number {
  const { year, month: nowMonth } = shanghaiParts(fetchedAt);
  if (month >= nowMonth || nowMonth - month <= 1) return year;
  return year + 1;
}

/**
 * 把“预计 M 月 D 日”解析成完整日期（年份规则见 resolveYear）。
 * 同月但日已过时不往后滚——那是“过期未兑现”，由视图层单独展示。
 */
export function resolvePremiereDate(month: number, day: number, fetchedAt: number): string {
  const y = resolveYear(month, fetchedAt);
  return `${y}-${pad2(month)}-${pad2(day)}`;
}

/**
 * 解析预约榜 HTML。
 *
 * 卡片结构（实测）：标题 div 后紧跟一行 `mt-2 line-clamp-1` 的档期行，
 * 如“预告 / 546.1万人预约 / 预计11月30日上线”。同一卡片的海报浮层
 * 里也有一份相同档期行，但在标题之前，不会误配。
 * 非档期卡片（体裁/演员行）第一行 mt-2 不含“预计/即将上线/万人预约”，
 * 直接跳过，不拿下一张卡片的档期去配。
 * 同一剧名在榜单里只取第一次出现（榜首位置）。
 */
export function parseYuyueList(html: string, fetchedAt: number): YuyueEntry[] {
  if (!html) return [];
  const entries: YuyueEntry[] = [];
  const seen = new Set<string>();
  TITLE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TITLE_RE.exec(html)) !== null) {
    const title = (m[1] ?? "").trim();
    if (!title) continue;
    const key = normalizeDramaTitle(title);
    if (seen.has(key)) continue;
    // 标题之后 1500 字符内的第一行 mt-2 就是本卡的档期行；再远就是下一张卡。
    const window = html.slice(m.index, m.index + 1500);
    const meta = META_RE.exec(window);
    if (!meta) continue;
    const rawLabel = (meta[1] ?? "").trim();
    if (!/预计|即将上线|万人预约/.test(rawLabel)) continue;
    seen.add(key);
    const dayMatch = DAY_RE.exec(rawLabel);
    const monthMatch = dayMatch ? null : MONTH_RE.exec(rawLabel);
    const resMatch = RESERVATIONS_RE.exec(rawLabel);
    const month = dayMatch
      ? Number(dayMatch[1])
      : monthMatch
        ? Number(monthMatch[1])
        : 0;
    const day = dayMatch ? Number(dayMatch[2]) : null;
    // 月份的年份与 resolvePremiereDate 同一规则（见 resolveYear）。
    const year = month === 0 ? 0 : resolveYear(month, fetchedAt);
    entries.push({
      title,
      key,
      dateKind: dayMatch ? "day" : monthMatch ? "month" : "unknown",
      month,
      year,
      day,
      premiereDate:
        dayMatch && day !== null ? resolvePremiereDate(month, day, fetchedAt) : null,
      reservations: resMatch ? Number(resMatch[1]) : null,
      rawLabel,
    });
  }
  return entries;
}

/** 源站 JSON-LD 的 dateModified（榜单自身更新时间）。 */
export function extractYuyueDateModified(html: string): string | null {
  const m = DATE_MODIFIED_RE.exec(html);
  return m?.[1] ?? null;
}

/** 预计标签：day 精确用完整日期，month 只写月份，unknown 写原标签。 */
export function entryDateLabel(entry: YuyueEntry): string | null {
  if (entry.dateKind === "day") return entry.premiereDate;
  if (entry.dateKind === "month") return `${entry.month}月`;
  return null;
}

function byReservations(a: YuyueEntry, b: YuyueEntry): number {
  return (b.reservations ?? -1) - (a.reservations ?? -1);
}

/**
 * 用新一轮解析结果生成快照：改档留痕 + 下榜留痕。
 *
 * - 同 key 且 dateKind/date 变化 → 记一条改档（from 为上一轮标签，to 为本轮标签）；
 * - 上一轮有、本轮无的条目 → 记一条下榜（含最后一次看到的日期）；
 * - changes/dropped 各保留最新 50 条；其余字段照实更新。
 */
export function buildCalendarSnapshot(
  prev: DramaCalendarSnapshot | null,
  parsed: YuyueEntry[],
  fetchedAt: number,
  sourceDateModified: string | null,
): DramaCalendarSnapshot {
  const prevByKey = new Map((prev?.entries ?? []).map((e) => [e.key, e]));
  const changes: DramaCalendarChange[] = [...(prev?.changes ?? [])];
  const dropped: DramaCalendarDropped[] = [...(prev?.dropped ?? [])];
  const nextKeys = new Set(parsed.map((e) => e.key));
  for (const entry of parsed) {
    const old = prevByKey.get(entry.key);
    if (!old) continue;
    const from = entryDateLabel(old);
    const to = entryDateLabel(entry);
    if (from !== to) {
      changes.unshift({ title: entry.title, from, to, at: fetchedAt });
    }
  }
  for (const old of prev?.entries ?? []) {
    if (nextKeys.has(old.key)) continue;
    dropped.unshift({
      title: old.title,
      lastLabel: old.rawLabel,
      lastDate: old.premiereDate,
      at: fetchedAt,
    });
  }
  return {
    version: 1,
    source: "soduanju-yuyue",
    sourceUrl: YUYUE_URL,
    sourceName: YUYUE_SOURCE_NAME,
    fetchedAt,
    sourceDateModified,
    entries: parsed,
    changes: changes.slice(0, CALENDAR_HISTORY_CAP),
    dropped: dropped.slice(0, CALENDAR_HISTORY_CAP),
    lastError: null,
    lastOkAt: fetchedAt,
  };
}

/* --------------------------- 视图层（供 /api/drama/calendar） --------------------------- */

export interface CalendarDayEntry {
  title: string;
  premiereDate: string;
  reservations: number | null;
  rawLabel: string;
}

export interface CalendarDay {
  date: string;
  /** 今天 / 明天 / 周几（上海时区）。 */
  label: string;
  items: CalendarDayEntry[];
}

export interface CalendarMonthGroup {
  month: number;
  label: string;
  /** 预计月份已过（榜单没更新），展示时要标“待确认”，不能当未来档期卖。 */
  overdue: boolean;
  items: Array<{ title: string; reservations: number | null; rawLabel: string }>;
}

export interface DramaCalendarView {
  /** ok = 最新快照成功；stale = 最近一次失败、下发上一日快照；empty = 从未抓到过。 */
  status: "ok" | "stale" | "empty";
  fetchedAt: number | null;
  sourceDateModified: string | null;
  sourceName: string;
  sourceUrl: string;
  lastError: string | null;
  /** 未来 14 天（含今天）按日分组。 */
  days: CalendarDay[];
  /** 仅精确到月的条目，按月份分组。 */
  monthPending: CalendarMonthGroup[];
  /** 预计日期已过、仍未在榜单消失的条目：档期未兑现，待确认。 */
  expired: CalendarDayEntry[];
  /** 近 7 天内下榜、且最后一次看到的日期还在未来的条目（可能已开播）。 */
  recentlyDropped: DramaCalendarDropped[];
  /** 最近改档记录（最新在前，最多 10 条）。 */
  recentChanges: DramaCalendarChange[];
}

const WEEKDAY = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function addDays(dateKey: string, n: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const t = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) + n * 86_400_000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function dayLabel(dateKey: string, todayKey: string): string {
  if (dateKey === todayKey) return "今天";
  if (dateKey === addDays(todayKey, 1)) return "明天";
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  return `${m}月${d}日 ${WEEKDAY[dt.getUTCDay()] ?? ""}`;
}

/**
 * 由快照算出 /drama 展示用的视图（纯函数）。
 *
 * 规则：
 * - day 精确且日期在未来 14 天内 → 按日分组；日期已过 → expired；
 * - day 精确但超出 14 天窗口 → 不进日历格（不丢数据，快照里仍在），
 *   也不进 monthPending（它有精确日期，月份待定区只收“仅到月”的）；
 * - month 精确 → 按月份分组；月份已过（< 抓取当月）标 overdue；
 * - unknown 不进任何展示区。
 */
export function buildDramaCalendarView(
  snapshot: DramaCalendarSnapshot | null,
  nowMs: number,
): DramaCalendarView {
  const base: Omit<DramaCalendarView, "status"> = {
    fetchedAt: snapshot?.fetchedAt ?? null,
    sourceDateModified: snapshot?.sourceDateModified ?? null,
    sourceName: YUYUE_SOURCE_NAME,
    sourceUrl: YUYUE_URL,
    lastError: snapshot?.lastError ?? null,
    days: [],
    monthPending: [],
    expired: [],
    recentlyDropped: [],
    recentChanges: (snapshot?.changes ?? []).slice(0, 10),
  };
  if (!snapshot || snapshot.entries.length === 0) {
    return { ...base, status: "empty" };
  }
  const todayKey = shanghaiDateKey(nowMs);
  const { month: nowMonth, year: nowYear } = shanghaiParts(nowMs);
  const windowKeys: string[] = [];
  for (let i = 0; i < CALENDAR_WINDOW_DAYS; i++) windowKeys.push(addDays(todayKey, i));
  const windowSet = new Set(windowKeys);
  const dayBuckets = new Map<string, YuyueEntry[]>();
  const monthBuckets = new Map<number, YuyueEntry[]>();
  const expired: YuyueEntry[] = [];
  for (const entry of snapshot.entries) {
    if (entry.dateKind === "day" && entry.premiereDate) {
      if (entry.premiereDate < todayKey) {
        expired.push(entry);
      } else if (windowSet.has(entry.premiereDate)) {
        const list = dayBuckets.get(entry.premiereDate) ?? [];
        list.push(entry);
        dayBuckets.set(entry.premiereDate, list);
      }
      // 超出 14 天窗口的精确日期：快照里留着，日历格不展示。
    } else if (entry.dateKind === "month" && entry.month > 0) {
      const list = monthBuckets.get(entry.month) ?? [];
      list.push(entry);
      monthBuckets.set(entry.month, list);
    }
  }
  const days: CalendarDay[] = windowKeys.map((date) => {
    const items = (dayBuckets.get(date) ?? []).sort(byReservations);
    return {
      date,
      label: dayLabel(date, todayKey),
      items: items.map((e) => ({
        title: e.title,
        premiereDate: e.premiereDate ?? date,
        reservations: e.reservations,
        rawLabel: e.rawLabel,
      })),
    };
  });
  const monthPending: CalendarMonthGroup[] = [...monthBuckets.entries()]
    .sort((a, b) => {
      // 按“离现在最近的月份”排序：当年月份在前，跨年月份在后。
      const keyOf = (m: number): number => (m >= nowMonth ? m : m + 12);
      return keyOf(a[0]) - keyOf(b[0]);
    })
    .map(([month, items]) => ({
      month,
      label: `${month}月`,
      // 同一快照里同一月份的年份相同；解析出的年月早于当前年月即已过预计月份。
      overdue: (items[0]?.year ?? nowYear) < nowYear || ((items[0]?.year ?? nowYear) === nowYear && month < nowMonth),
      items: items.sort(byReservations).map((e) => ({
        title: e.title,
        reservations: e.reservations,
        rawLabel: e.rawLabel,
      })),
    }));
  const weekAgo = nowMs - 7 * 86_400_000;
  const recentlyDropped = (snapshot.dropped ?? []).filter(
    (d) => d.at >= weekAgo && (!d.lastDate || d.lastDate >= todayKey),
  );
  return {
    ...base,
    status: snapshot.lastError ? "stale" : "ok",
    days,
    monthPending,
    expired: expired.sort(byReservations).map((e) => ({
      title: e.title,
      premiereDate: e.premiereDate ?? "",
      reservations: e.reservations,
      rawLabel: e.rawLabel,
    })),
    recentlyDropped,
  };
}
