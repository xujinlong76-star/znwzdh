/**
 * 每日专注（Momentum 式：今天只定一件事）。
 *
 * 审阅结论（2026-11-13，P1 #7 建前复核，写死在这里免得后人误读）：
 *
 *   - 简报已有的三块个人内容（在追提醒、今日重温、热榜精选）都是现成的，
 *     真正缺的是「今天的一件事」——用户自己定的、一天只一条的目标。
 *   - 「关注分类的新收录」不在本轮做：中枢下发的 HubBriefNewSite 根本没有
 *     分类字段，代码库里也没有「关注分类」这个概念；没有分类可筛，硬做一
 *     个关注开关就只是换标签的假功能（当初 workspace switcher 就是这么
 *     被删掉的）。要做它得先让中枢在 newSites 里带分类，那是另一轮的事。
 *   - 专注只存在本机（localStorage），不进云端、不进 SSR：/brief 是服务端
 *     渲染的中枢缓存页，SSR 壳里不出现任何用户数据（brief-page.test.ts
 *     的红线），专注只能是客户端岛。
 *   - 昨天没做完的专注不带进今天：每天从空白开始，免得一条旧目标
 *     赖在简报顶上冒充今天的计划。
 *
 * 本文件只放纯函数 + 存储读写：`now` / `today` 一律由调用方传入
 * （可测、不依赖真实时钟）；存储不可用时返回 null / false，不抛。
 */

/** 专注的存储键。独立键，不与收藏、追剧等既有键混在一起。 */
export const DAILY_FOCUS_STORAGE_KEY = 'navhub.brief.dailyFocus.v1'
/** 一条专注最多这么多字：扫一眼能读完，太长就不是「一件事」。 */
export const DAILY_FOCUS_MAX_LENGTH = 80

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export interface DailyFocus {
  /** 本地日期 YYYY-MM-DD：只认当天，跨天即失效 */
  date: string
  text: string
  done: boolean
  updatedAt: number
}

/** 本地日期键（YYYY-MM-DD）。用本地时区，不用 UTC——「今天」是用户的日子。 */
export function todayKey(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 清洗一条专注：去首尾空白、连续空白折成一个空格、超长截断。空串 = 没内容。 */
export function cleanFocusText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, DAILY_FOCUS_MAX_LENGTH)
}

export function isValidFocusText(raw: string): boolean {
  return cleanFocusText(raw).length > 0
}

/** 新建一条专注：空内容或坏日期返回 null（调用方据此不写存储）。 */
export function createDailyFocus(text: string, date: string, nowMs: number): DailyFocus | null {
  const cleaned = cleanFocusText(text)
  if (!cleaned || !DATE_RE.test(date)) return null
  return { date, text: cleaned, done: false, updatedAt: nowMs }
}

/** 解析存储里的专注：坏 JSON、缺字段、空内容、坏类型一律返回 null，不抛。 */
export function parseDailyFocus(raw: unknown): DailyFocus | null {
  if (typeof raw !== 'string' || !raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const { date, text, done, updatedAt } = parsed as Record<string, unknown>
  if (typeof date !== 'string' || !DATE_RE.test(date)) return null
  if (typeof text !== 'string') return null
  const cleaned = cleanFocusText(text)
  if (!cleaned) return null
  if (typeof done !== 'boolean') return null
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return null
  return { date, text: cleaned, done, updatedAt }
}

export function serializeDailyFocus(focus: DailyFocus): string {
  return JSON.stringify(focus)
}

/** 只认当天的专注：昨天的（或任意非今天的）返回 null，不漏进今天。 */
export function focusForToday(raw: unknown, today: string): DailyFocus | null {
  const parsed = parseDailyFocus(raw)
  if (!parsed || parsed.date !== today) return null
  return parsed
}

/** 标记完成 / 取消完成（只改 done 与 updatedAt，不动文字与日期）。 */
export function withDone(focus: DailyFocus, done: boolean, nowMs: number): DailyFocus {
  return { ...focus, done, updatedAt: nowMs }
}

/** 改文字：空内容返回 null（调用方据此保留旧专注，不写空串进去）。 */
export function withText(focus: DailyFocus, text: string, nowMs: number): DailyFocus | null {
  const cleaned = cleanFocusText(text)
  if (!cleaned) return null
  return { ...focus, text: cleaned, updatedAt: nowMs }
}

/** 读本机专注（服务端渲染 / 存储不可用时返回 null，不抛）。 */
export function readDailyFocus(): DailyFocus | null {
  try {
    if (typeof window === 'undefined') return null
    return parseDailyFocus(window.localStorage.getItem(DAILY_FOCUS_STORAGE_KEY))
  } catch {
    return null
  }
}

/** 读今天的专注：不是今天的按没有算（昨天的专注不漏进今天）。 */
export function readDailyFocusForToday(today: string): DailyFocus | null {
  try {
    if (typeof window === 'undefined') return null
    return focusForToday(window.localStorage.getItem(DAILY_FOCUS_STORAGE_KEY), today)
  } catch {
    return null
  }
}

/** 写本机专注：写不进去返回 false（调用方据此提示，不静默丢专注）。 */
export function writeDailyFocus(focus: DailyFocus): boolean {
  try {
    if (typeof window === 'undefined') return false
    window.localStorage.setItem(DAILY_FOCUS_STORAGE_KEY, serializeDailyFocus(focus))
    return true
  } catch {
    return false
  }
}

/** 清掉本机专注：写不进去返回 false。 */
export function clearDailyFocus(): boolean {
  try {
    if (typeof window === 'undefined') return false
    window.localStorage.removeItem(DAILY_FOCUS_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}
