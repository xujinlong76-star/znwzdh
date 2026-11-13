/**
 * 考试倒计时紧迫度分档测试（/exam 第三轮）：
 *  - 纯规则层 exam-calendar.ts：urgencyTier / reminderTier 只读派生，
 *    档位互斥、边界固定 nowMs 注入、不依赖真实今天；
 *  - 源码守卫：倒计时岛与首页条带按档位上色、提醒文案只对已关注考试
 *    显示、未关注只变色不出文案。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  EXAM_REMINDER_TIER_LABEL,
  EXAMS,
  reminderTier,
  urgencyTier,
} from '../src/lib/exam-calendar'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

const guokao = EXAMS.find((e) => e.id === 'guokao')!
const kaoyan = EXAMS.find((e) => e.id === 'kaoyan')!

/** 2026-11-13 08:00 北京时间（UTC 午夜）：距国考 16 天 */
const NOV_13_0800_CST = Date.UTC(2026, 10, 13, 0, 0, 0)
/** 2026-11-21 08:00 北京时间：距国考 8 天 */
const NOV_21_0800_CST = Date.UTC(2026, 10, 21, 0, 0, 0)
/** 2026-11-22 08:00 北京时间：距国考 7 天 */
const NOV_22_0800_CST = Date.UTC(2026, 10, 22, 0, 0, 0)
/** 2026-11-25 08:00 北京时间：距国考 4 天 */
const NOV_25_0800_CST = Date.UTC(2026, 10, 25, 0, 0, 0)
/** 2026-11-26 08:00 北京时间：距国考 3 天 */
const NOV_26_0800_CST = Date.UTC(2026, 10, 26, 0, 0, 0)
/** 2026-11-27 08:00 北京时间：距国考 2 天 */
const NOV_27_0800_CST = Date.UTC(2026, 10, 27, 0, 0, 0)
/** 2026-11-28 08:00 北京时间：距国考 1 天 */
const NOV_28_0800_CST = Date.UTC(2026, 10, 28, 0, 0, 0)
/** 2026-11-29 08:00 北京时间：国考当天 */
const NOV_29_0800_CST = Date.UTC(2026, 10, 29, 0, 0, 0)
/** 2026-11-30 08:00 北京时间：国考已过 */
const NOV_30_0800_CST = Date.UTC(2026, 10, 30, 0, 0, 0)
/** 2026-12-19 08:00 北京时间：考研首日 */
const DEC_19_0800_CST = Date.UTC(2026, 11, 19, 0, 0, 0)
/** 2026-12-20 08:00 北京时间：考研末日（进行中） */
const DEC_20_0800_CST = Date.UTC(2026, 11, 20, 0, 0, 0)
/** 2026-12-21 08:00 北京时间：四场全过 */
const DEC_21_0800_CST = Date.UTC(2026, 11, 21, 0, 0, 0)

describe('urgencyTier（倒计时紧迫度分档）', () => {
  it('8 天以上 relaxed：16 天与 8 天无差别', () => {
    expect(urgencyTier(guokao, NOV_13_0800_CST)).toBe('relaxed')
    expect(urgencyTier(guokao, NOV_21_0800_CST)).toBe('relaxed')
  })

  it('7 天与 4 天 soon（琥珀档）', () => {
    expect(urgencyTier(guokao, NOV_22_0800_CST)).toBe('soon')
    expect(urgencyTier(guokao, NOV_25_0800_CST)).toBe('soon')
  })

  it('3 天与 2 天 urgent（红档）', () => {
    expect(urgencyTier(guokao, NOV_26_0800_CST)).toBe('urgent')
    expect(urgencyTier(guokao, NOV_27_0800_CST)).toBe('urgent')
  })

  it('1 天 tomorrow、考试当天 today', () => {
    expect(urgencyTier(guokao, NOV_28_0800_CST)).toBe('tomorrow')
    expect(urgencyTier(guokao, NOV_29_0800_CST)).toBe('today')
  })

  it('多日考试进行中也是 today，不叠加 urgency 色', () => {
    expect(urgencyTier(kaoyan, DEC_19_0800_CST)).toBe('today')
    expect(urgencyTier(kaoyan, DEC_20_0800_CST)).toBe('today')
  })

  it('已结束的考试不参与任何档位', () => {
    expect(urgencyTier(guokao, NOV_30_0800_CST)).toBeNull()
    expect(urgencyTier(kaoyan, DEC_21_0800_CST)).toBeNull()
  })

  it('午夜边界：23:59 还是明天、00:00 已是今天', () => {
    // 2026-11-28 23:30 北京时间（UTC 15:30）→ 距国考 1 天
    expect(urgencyTier(guokao, Date.UTC(2026, 10, 28, 15, 30))).toBe('tomorrow')
    // 2026-11-29 00:00 北京时间（UTC 16:00）→ 国考当天
    expect(urgencyTier(guokao, Date.UTC(2026, 10, 28, 16, 0))).toBe('today')
  })

  it('跨年与闰年：只按首日计天，不做特殊处理', () => {
    const newYear = { startISO: '2027-01-01', endISO: '2027-01-01' }
    expect(urgencyTier(newYear, Date.UTC(2026, 11, 25, 0, 0, 0))).toBe('soon')
    const leapDay = { startISO: '2028-02-29', endISO: '2028-02-29' }
    expect(urgencyTier(leapDay, Date.UTC(2028, 1, 22, 0, 0, 0))).toBe('soon')
  })

  it('同一考试同一天重复计算结果一致（去重天然成立）', () => {
    expect(urgencyTier(guokao, NOV_22_0800_CST)).toBe(urgencyTier(guokao, NOV_22_0800_CST))
    expect(reminderTier(guokao, NOV_22_0800_CST)).toBe(reminderTier(guokao, NOV_22_0800_CST))
  })
})

describe('reminderTier（7/3/1 天提醒档位）', () => {
  it('只在考前 7 / 3 / 1 天与当天命中', () => {
    expect(reminderTier(guokao, NOV_22_0800_CST)).toBe('7d')
    expect(reminderTier(guokao, NOV_26_0800_CST)).toBe('3d')
    expect(reminderTier(guokao, NOV_28_0800_CST)).toBe('1d')
    expect(reminderTier(guokao, NOV_29_0800_CST)).toBe('today')
  })

  it('非档位日不命中：8 天、4 天、2 天均为 null', () => {
    expect(reminderTier(guokao, NOV_21_0800_CST)).toBeNull()
    expect(reminderTier(guokao, NOV_25_0800_CST)).toBeNull()
    expect(reminderTier(guokao, NOV_27_0800_CST)).toBeNull()
  })

  it('多日考试进行中命中 today，已结束不命中', () => {
    expect(reminderTier(kaoyan, DEC_19_0800_CST)).toBe('today')
    expect(reminderTier(kaoyan, DEC_20_0800_CST)).toBe('today')
    expect(reminderTier(guokao, NOV_30_0800_CST)).toBeNull()
    expect(reminderTier(kaoyan, DEC_21_0800_CST)).toBeNull()
  })

  it('提醒文案：7/3 天用「考前 N 天」，1 天与当天用人话', () => {
    expect(EXAM_REMINDER_TIER_LABEL['7d']).toBe('考前 7 天')
    expect(EXAM_REMINDER_TIER_LABEL['3d']).toBe('考前 3 天')
    expect(EXAM_REMINDER_TIER_LABEL['1d']).toBe('明天考试')
    expect(EXAM_REMINDER_TIER_LABEL.today).toBe('今天考试')
  })
})

describe('源码守卫：按档位上色、提醒只对已关注显示', () => {
  it('倒计时岛按 urgencyTier 上色，不再写死 text-foreground', () => {
    const countdown = read('src/app/exam/exam-countdown.tsx')
    expect(countdown).toContain('urgencyTier(')
    expect(countdown).toContain('text-red-600')
    expect(countdown).toContain('text-amber-600')
    expect(countdown).not.toContain('tracking-tight text-foreground')
  })

  it('首页条带徽章按档位变色、提醒前缀只对已关注考试显示', () => {
    const view = read('src/components/home-exam-strip-view.tsx')
    expect(view).toContain('urgencyTier(')
    expect(view).toContain('reminderTier(')
    expect(view).toContain('EXAM_REMINDER_TIER_LABEL')
    // 提醒档位只在 personal（已关注）且挂载后计算，未关注只变色、不出文案
    expect(view).toContain('personal && mounted ? reminderTier(')
    // relaxed 仍沿用 sky 配方（home-exam-entry 的徽章配方断言继续成立）
    expect(view).toContain('bg-sky-500/5')
    expect(view).not.toContain('text-sky-600')
  })
})
