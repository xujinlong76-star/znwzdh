/**
 * lunar-javascript@1.2.5 的最小类型声明：该包不自带 .d.ts，
 * 直接 import 会报 TS7016（本仓前端类型棘轮阈值 0，不许放宽）。
 *
 * 只声明本仓实际用到的表面（Solar.fromYmd → Lunar），其余 API
 * 不在此列，用到时再补。闰月约定已实测：getMonth() 在闰月返回
 * 负数（如闰五月为 -5）。
 */
declare module 'lunar-javascript' {
  export interface Lunar {
    /** 农历月：1–12；闰月为负数（如闰五月返回 -5）。 */
    getMonth(): number
    /** 农历日：1–30。 */
    getDay(): number
    /** 中文月名，如「正」「冬」「腊」「闰五」。 */
    getMonthInChinese(): string
    /** 中文日名，如「初一」「十五」「三十」。 */
    getDayInChinese(): string
    /** 当日农历节日名，如 ['春节']；无节日为空数组。 */
    getFestivals(): string[]
    toString(): string
  }

  export interface Solar {
    getLunar(): Lunar
  }

  export const Solar: {
    fromYmd(year: number, month: number, day: number): Solar
  }
}
