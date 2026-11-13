/**
 * 公历日期 → 农历中文串，如「农历正月初一 · 春节」「农历十月初六」。
 *
 * 双源换算（2026–2028 全量 1096 天逐日比对过）：
 *
 * 1. `Intl.DateTimeFormat('zh-CN-u-ca-chinese')`：时区无关、零依赖，
 *    是首屏同步渲染与非东八区用户的默认源。只有一个已知偏差：
 *    2027 年正月——朔在 2027-02-06 23:56 北京时，擦着午夜，
 *    ICU 把正月初一算成 2 月 7 日，官方农历（香港天文台、国务院
 *    2027 春节放假通知）是 2 月 6 日；整月 2027-02-06~03-07
 *    全部差一天。东八区用户走第 2 条源，不会撞上这个偏差。
 * 2. `lunar-javascript`：与官方农历逐日一致（含 2027 正月），
 *    但源码把日期钉在 GMT+0800，只在运行环境时区为东八区时才准
 *    （UTC 下系统性慢 2 天）。只在 `getTimezoneOffset() === -480`
 *    时用它，且用动态 import，不进首屏包（原文件 304KB）。
 *
 * 节日只取纯农历节日（春节、元宵、端午、七夕、中秋、重阳、除夕）；
 * 清明是节气节日、不能从农历月日推导，仍由小猫挂件的 FESTIVALS 表
 * 单独负责，这里不标。换算失败返回空串，调用方不显示农历，
 * 时钟本身不受影响。
 */

const MONTH_NAMES = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月']
const DAY_NAMES = [
  '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十',
]
const MONTH_NAME_TO_NUMBER: Record<string, number> = {
  '正': 1, '正月': 1,
  '二': 2, '二月': 2,
  '三': 3, '三月': 3,
  '四': 4, '四月': 4,
  '五': 5, '五月': 5,
  '六': 6, '六月': 6,
  '七': 7, '七月': 7,
  '八': 8, '八月': 8,
  '九': 9, '九月': 9,
  '十': 10, '十月': 10,
  '十一': 11, '十一月': 11,
  '十二': 12, '十二月': 12,
  '冬': 11, '冬月': 11,
  '腊': 12, '腊月': 12,
}
const FESTIVALS: Record<string, string> = {
  '1-1': '春节',
  '1-15': '元宵节',
  '5-5': '端午节',
  '7-7': '七夕',
  '8-15': '中秋节',
  '9-9': '重阳节',
}

export type LunarParts = { month: number; day: number; leap: boolean }

function parseMonthName(name: string): { month: number; leap: boolean } | null {
  let leap = false
  let key = name
  if (key.startsWith('闰')) {
    leap = true
    key = key.slice(1)
  }
  const month = MONTH_NAME_TO_NUMBER[key]
  return month === undefined ? null : { month, leap }
}

/** Intl 源：同步、时区无关。 */
export function lunarPartsFromIntl(date: Date): LunarParts | null {
  try {
    const parts = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
      month: 'long',
      day: 'numeric',
    }).formatToParts(date)
    const monthPart = parts.find((p) => p.type === 'month')?.value
    const dayPart = parts.find((p) => p.type === 'day')?.value
    if (!monthPart || !dayPart) return null
    const parsed = parseMonthName(monthPart)
    const day = Number.parseInt(dayPart, 10)
    if (!parsed || !Number.isInteger(day) || day < 1 || day > 30) return null
    return { month: parsed.month, day, leap: parsed.leap }
  } catch {
    return null
  }
}

/** lunar-javascript 源：异步动态 import；只在东八区才准，调用方负责判断时区。 */
export async function lunarPartsFromLibrary(date: Date): Promise<LunarParts | null> {
  try {
    const { Solar } = await import('lunar-javascript')
    const lunar = Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate()).getLunar()
    // 闰月时 getMonth() 返回负数（如闰五月为 -5），以此判定闰月。
    const rawMonth = lunar.getMonth()
    const month = Math.abs(rawMonth)
    const day = lunar.getDay()
    if (!Number.isInteger(rawMonth) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > 30) {
      return null
    }
    return { month, day, leap: rawMonth < 0 }
  } catch {
    return null
  }
}

function nextDayParts(date: Date, source: (d: Date) => LunarParts | null): LunarParts | null {
  // 中午构造次日，避开夏令时切换日的 23/25 小时问题。
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 12, 0, 0)
  return source(next)
}

function formatParts(parts: LunarParts, date: Date, source: (d: Date) => LunarParts | null): string {
  const monthName = (parts.leap ? '闰' : '') + MONTH_NAMES[parts.month - 1]
  const base = `农历${monthName}${DAY_NAMES[parts.day - 1]}`
  if (parts.leap) return base
  const festival = FESTIVALS[`${parts.month}-${parts.day}`]
  if (festival) return `${base} · ${festival}`
  // 除夕：腊月最后一天（廿九或三十），即次日是正月初一。
  if (parts.month === 12) {
    const next = nextDayParts(date, source)
    if (next && !next.leap && next.month === 1 && next.day === 1) return `${base} · 除夕`
  }
  return base
}

/** 同步入口：Intl 源（首屏直出、非东八区默认）。换算失败返回 ''。 */
export function formatLunarDate(date: Date): string {
  const parts = lunarPartsFromIntl(date)
  return parts ? formatParts(parts, date, lunarPartsFromIntl) : ''
}

/** 精确入口：东八区用 lunar-javascript（官方口径），其余时区用 Intl。 */
export async function formatLunarDateExact(date: Date): Promise<string> {
  if (date.getTimezoneOffset() === -480) {
    const parts = await lunarPartsFromLibrary(date)
    if (parts) return formatPartsWithAsyncNext(parts, date)
  }
  return formatLunarDate(date)
}

async function formatPartsWithAsyncNext(parts: LunarParts, date: Date): Promise<string> {
  const monthName = (parts.leap ? '闰' : '') + MONTH_NAMES[parts.month - 1]
  const base = `农历${monthName}${DAY_NAMES[parts.day - 1]}`
  if (parts.leap) return base
  const festival = FESTIVALS[`${parts.month}-${parts.day}`]
  if (festival) return `${base} · ${festival}`
  if (parts.month === 12) {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 12, 0, 0)
    const nextParts = await lunarPartsFromLibrary(next)
    if (nextParts && !nextParts.leap && nextParts.month === 1 && nextParts.day === 1) {
      return `${base} · 除夕`
    }
  }
  return base
}
