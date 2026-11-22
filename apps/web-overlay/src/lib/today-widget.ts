/**
 * 首页「今日」小部件的纯函数（进化轮 2026-11-22-0822，规格书
 * today-widget-spec-0422.md §3.2/§4/§10）。
 *
 * 全部是本机同步计算、零依赖、零请求：
 *  - 公历日期与星座按 Asia/Shanghai 口径算（与 HomeTodayZone.todayLabel 同一时区）；
 *  - 农历换算复用 src/lib/lunar-date.ts（formatLunarDate / formatLunarDateExact），
 *    本文件只解决“按上海日期换算”这一层：lunar-date 的 Intl 源不用 timeZone
 *    选项（按运行期本地时区算），直接传 now 会在非东八区运行期差一天；
 *    这里先取上海年月日、再拼成本地中午 12 点的 Date 传进去（lunar-date.ts
 *    的 nextDayParts 同款“中午构造”手法，避开夏令时切换日的 23/25 小时问题），
 *    任何运行期时区下都得到上海那天的农历。
 *  - 星座是公历月日的纯函数，仓库里没有现成实现（rg 零命中），自带分界表；
 *    采用通用分界表：天蝎 10.24–11.22、射手 11.23–12.21（规格书 §3.2 钉死，
 *    不许按 360hun 的 11.22 起点改表）。
 */

export interface ShanghaiDateParts {
  year: number
  month: number
  day: number
  /** 如「星期日」（Intl weekday:'long' 的 zh-CN 输出） */
  weekday: string
}

/**
 * 热点轮换的最小下发形状（只含部件真正用的两个字段）。
 * 服务端 page.tsx 把 /hot 同口径的 HubSite 投影成这个形状再随 RSC 下发——
 * 完整 SitePayload 约 500B/条，30 条全量下发约 15KB，会吃掉规格 §8 的
 * HTML 增量 <5KB 预算；投影后约 30×~60B ≈ 2KB，预算内。部件不读其他字段。
 */
export interface TodayHotItem {
  title: string
  url: string
}

/** 取某时刻的上海年月日与星期（纯 Intl 计算，不可失败——失败时抛错由调用方处理）。 */
export function shanghaiDateParts(date: Date): ShanghaiDateParts {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'long',
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return {
    year: Number.parseInt(get('year'), 10),
    month: Number.parseInt(get('month'), 10),
    day: Number.parseInt(get('day'), 10),
    weekday: get('weekday'),
  }
}

/**
 * 把某时刻换算成“上海那天中午 12 点”的本地 Date，供 lunar-date 的两个入口使用。
 * 目的见文件头注释：让农历换算与运行期时区无关，永远是上海日期的农历。
 */
export function shanghaiNoonDate(date: Date): Date {
  const { year, month, day } = shanghaiDateParts(date)
  return new Date(year, month - 1, day, 12, 0, 0)
}

/** 公历日期行：`2026年11月22日 星期日`（Asia/Shanghai 口径）。 */
export function formatTodayGregorian(date: Date): string {
  const { year, month, day, weekday } = shanghaiDateParts(date)
  return `${year}年${month}月${day}日 ${weekday}`
}

/** 星座分界表：每段的起始月日（通用表；12.22 起为摩羯座，1.20 之前仍是摩羯座）。 */
const ZODIAC_BOUNDARIES: Array<{ month: number; day: number; name: string }> = [
  { month: 1, day: 20, name: '水瓶座' },
  { month: 2, day: 19, name: '双鱼座' },
  { month: 3, day: 21, name: '白羊座' },
  { month: 4, day: 20, name: '金牛座' },
  { month: 5, day: 21, name: '双子座' },
  { month: 6, day: 22, name: '巨蟹座' },
  { month: 7, day: 23, name: '狮子座' },
  { month: 8, day: 23, name: '处女座' },
  { month: 9, day: 23, name: '天秤座' },
  { month: 10, day: 24, name: '天蝎座' },
  { month: 11, day: 23, name: '射手座' },
  { month: 12, day: 22, name: '摩羯座' },
]

/** 公历月日查表得星座（纯函数；非法月日返回 ''，调用方不显示该段）。 */
export function getZodiacSign(month: number, day: number): string {
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) {
    return ''
  }
  let sign = '摩羯座'
  for (const b of ZODIAC_BOUNDARIES) {
    if (month > b.month || (month === b.month && day >= b.day)) sign = b.name
    else break
  }
  return sign
}

/** 热点换一换：下标 +1 循环；空榜单时回 0（不抛错）。 */
export function nextHotIndex(current: number, length: number): number {
  if (!Number.isInteger(length) || length <= 0) return 0
  const safe = Number.isInteger(current) && current >= 0 ? current : 0
  return (safe + 1) % length
}

/**
 * 日期段完整文案：`2026年11月22日 星期日 · 农历十月十四 · 天蝎座`。
 * lunarLabel 为 ''（换算失败）时省略农历段，不写假农历；节日由 lunar-date 的
 * formatLunarDate 原样带出（如 `农历正月初一 · 春节`），本函数不拼节日。
 */
export function buildTodayDateText(date: Date, lunarLabel: string): string {
  const { month, day } = shanghaiDateParts(date)
  const segments = [formatTodayGregorian(date)]
  if (lunarLabel) segments.push(lunarLabel)
  const zodiac = getZodiacSign(month, day)
  if (zodiac) segments.push(zodiac)
  return segments.join(' · ')
}
