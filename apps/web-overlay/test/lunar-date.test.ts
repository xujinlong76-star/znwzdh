/**
 * 农历换算（lib/lunar-date.ts）单测。
 *
 * 双源设计，测试也按源分开断言：
 *
 * 1. 同步入口 `formatLunarDate` 只走 Intl（`zh-CN-u-ca-chinese`），
 *    时区无关，在任何 TZ 下结果相同——本文件默认档（UTC）测的就是它。
 * 2. 精确入口 `formatLunarDateExact` 在东八区走 lunar-javascript
 *    （官方口径），其余时区回落 Intl。东八区断言只在
 *    `getTimezoneOffset() === -480` 时跑：`TZ=Asia/Shanghai pnpm vitest run test/lunar-date.test.ts`。
 * 3. 已知偏差钉死：ICU 把 2027 正月初一算成 2 月 7 日（朔在
 *    2 月 6 日 23:56 北京时，擦着午夜），官方农历（香港天文台、
 *    国务院国办发明电〔2026〕10 号）是 2 月 6 日。同步入口在
 *    2027-02-06 返回「农历腊月三十」是 ICU 的已知偏差、不是 bug；
 *    若 Node 的 ICU 数据日后修正，此断言会红，正好提醒删钉。
 *
 * 锚点日期另有三重来源：挂件 FESTIVALS 表（见末节一致性断言）、
 * 香港天文台公历与农历对照表、国务院 2027 春节放假通知。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  formatLunarDate,
  formatLunarDateExact,
  lunarPartsFromLibrary,
} from '@/lib/lunar-date'

const IN_PLUS_8 = new Date().getTimezoneOffset() === -480

/** 中午构造，避开午夜边界与夏令时切换日。 */
function noon(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d, 12, 0, 0)
}

describe('formatLunarDate（Intl 同步源，时区无关）', () => {
  it.each([
    [2026, 2, 17, '农历正月初一 · 春节'],
    [2026, 3, 3, '农历正月十五 · 元宵节'],
    [2026, 6, 19, '农历五月初五 · 端午节'],
    [2026, 8, 19, '农历七月初七 · 七夕'],
    [2026, 9, 25, '农历八月十五 · 中秋节'],
    [2026, 10, 18, '农历九月初九 · 重阳节'],
    [2028, 1, 26, '农历正月初一 · 春节'],
    [2026, 2, 16, '农历腊月廿九 · 除夕'],
    [2026, 11, 14, '农历十月初六'],
    [2028, 6, 23, '农历闰五月初一'],
  ])('%d-%d-%d → %s', (y, m, d, expected) => {
    expect(formatLunarDate(noon(y, m, d))).toBe(expected)
  })

  it('换算失败不抛错、返回空串', () => {
    expect(formatLunarDate(new Date(Number.NaN))).toBe('')
  })
})

describe('2027 正月：ICU 与官方农历的已知偏差（钉死）', () => {
  it('同步入口在 2027-02-06 返回腊月三十 · 除夕（ICU 偏差，见文件头注释）', () => {
    // ICU 体系内自洽：它认为次日 2027-02-07 才是正月初一，所以
    // 2027-02-06 在它眼里既是腊月三十、也是除夕。
    expect(formatLunarDate(noon(2027, 2, 6))).toBe('农历腊月三十 · 除夕')
  })

  it('非东八区时精确入口回落 Intl，与同步入口一致', async () => {
    if (IN_PLUS_8) return
    await expect(formatLunarDateExact(noon(2026, 2, 17))).resolves.toBe('农历正月初一 · 春节')
  })
})

describe('formatLunarDateExact（东八区官方口径）', () => {
  it.skipIf(!IN_PLUS_8)('2027-02-06 是正月初一 · 春节（官方农历）', async () => {
    await expect(formatLunarDateExact(noon(2027, 2, 6))).resolves.toBe('农历正月初一 · 春节')
  })

  it.skipIf(!IN_PLUS_8)('2027-02-05 是腊月廿九 · 除夕', async () => {
    await expect(formatLunarDateExact(noon(2027, 2, 5))).resolves.toBe('农历腊月廿九 · 除夕')
  })

  it.skipIf(!IN_PLUS_8)('2027-03-07 是正月三十，次日恢复二月初一', async () => {
    await expect(formatLunarDateExact(noon(2027, 3, 7))).resolves.toBe('农历正月三十')
    await expect(formatLunarDateExact(noon(2027, 3, 8))).resolves.toBe('农历二月初一')
  })

  it.skipIf(!IN_PLUS_8)('lunar-javascript 源与 Intl 源在 2026 年锚点一致', async () => {
    const parts = await lunarPartsFromLibrary(noon(2026, 2, 17))
    expect(parts).toEqual({ month: 1, day: 1, leap: false })
  })
})

describe('挂件 FESTIVALS 表锚点一致性', () => {
  it('6 个农历节日锚点的公历日期与小猫挂件 FESTIVALS 表逐一吻合', () => {
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../public/xiaomaomao/xiaomaomao.js'),
      'utf8',
    )
    const anchors: Array<[string, string]> = [
      ['2026-02-17', '春节'],
      ['2026-03-03', '元宵节'],
      ['2026-06-19', '端午节'],
      ['2026-08-19', '七夕'],
      ['2026-09-25', '中秋节'],
      ['2027-02-06', '春节'],
      ['2028-01-26', '春节'],
      ['2026-10-18', '重阳节'],
    ]
    for (const [ymd, name] of anchors) {
      expect(src).toContain(`{ ymd: '${ymd}', name: '${name}'`)
    }
  })
})
