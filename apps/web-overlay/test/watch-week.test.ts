import { describe, expect, it } from 'vitest'
import { buildWeekSchedule, formatWeekDay, mondayOfWeek } from '../src/lib/watch-week'
import { dramaKeyFor, type WatchEntry } from '../src/lib/watchlist'

// 固定一周：2026-11-16 是周一，2026-11-18 是周三（now 落在周三）
const MON = new Date(2026, 10, 16, 10, 0, 0)
const WED = new Date(2026, 10, 18, 10, 0, 0)
const DAY_MS = 24 * 60 * 60 * 1000

const entry = (over: Partial<WatchEntry> & { title: string }): WatchEntry => ({
  key: dramaKeyFor('nav-hongguo', over.title),
  platformSiteId: 'nav-hongguo',
  platformTitle: '红果短剧',
  playUrl: 'https://www.hongguo.com',
  episode: 3,
  priority: 'normal',
  cadence: { kind: 'unknown' },
  remind: true,
  lastProgressAt: WED.getTime() - 3 * DAY_MS,
  createdAt: WED.getTime() - 10 * DAY_MS,
  updatedAt: WED.getTime() - 3 * DAY_MS,
  ...over,
})

describe('mondayOfWeek / formatWeekDay', () => {
  it('周一起点：周三、周日传入都归一到同一周的周一', () => {
    expect(mondayOfWeek(WED).getDay()).toBe(1)
    expect(mondayOfWeek(WED).getDate()).toBe(16)
    expect(mondayOfWeek(new Date(2026, 10, 22, 10, 0, 0)).getDate()).toBe(16) // 周日回上周一
    expect(mondayOfWeek(new Date(2026, 10, 23, 10, 0, 0)).getDate()).toBe(23) // 下周一是新一周
  })

  it('表头写明日期与星期，不留周起点歧义', () => {
    expect(formatWeekDay(new Date(2026, 10, 16))).toBe('11月16日 周一')
    expect(formatWeekDay(new Date(2026, 10, 22))).toBe('11月22日 周日')
  })
})

describe('buildWeekSchedule 排布规则', () => {
  it('daily 只进表顶横条，不重复铺进 7 个日期格', () => {
    const daily = entry({ title: '日更短剧', cadence: { kind: 'daily' } })
    const s = buildWeekSchedule([daily], MON, WED)
    expect(s.daily.map((e) => e.title)).toEqual(['日更短剧'])
    expect(s.days.every((d) => d.entries.length === 0)).toBe(true)
  })

  it('weekly 单日只落标注的那一天', () => {
    const wedShow = entry({ title: '周三剧', cadence: { kind: 'weekly', weekdays: [3] } })
    const s = buildWeekSchedule([wedShow], MON, WED)
    expect(s.days.map((d) => d.entries.length)).toEqual([0, 0, 1, 0, 0, 0, 0])
    expect(s.days[2].entries[0].title).toBe('周三剧')
    expect(s.daily).toEqual([])
    expect(s.unscheduled).toEqual([])
  })

  it('weekly 多日落位到每一天（含周日 getDay()=0）', () => {
    const multi = entry({ title: '多日剧', cadence: { kind: 'weekly', weekdays: [1, 5, 0] } })
    const s = buildWeekSchedule([multi], MON, WED)
    expect(s.days.map((d) => d.entries.length)).toEqual([1, 0, 0, 0, 1, 0, 1])
  })

  it('unknown 永不进表，只进 unscheduled（钉死）', () => {
    const unknown = entry({ title: '没标节奏的剧', cadence: { kind: 'unknown' } })
    const s = buildWeekSchedule([unknown], MON, WED)
    expect(s.unscheduled.map((e) => e.title)).toEqual(['没标节奏的剧'])
    expect(s.daily).toEqual([])
    expect(s.days.every((d) => d.entries.length === 0)).toBe(true)
  })

  it('finished 不进表也不进 unscheduled（留在清单页已完结区）', () => {
    const done = entry({ title: '完结剧', cadence: { kind: 'finished' } })
    const s = buildWeekSchedule([done], MON, WED)
    expect(s.daily).toEqual([])
    expect(s.unscheduled).toEqual([])
    expect(s.days.every((d) => d.entries.length === 0)).toBe(true)
  })

  it('周一起点与今天高亮：7 天周一到周日，只有周三是今天', () => {
    const s = buildWeekSchedule([], MON, WED)
    expect(s.days).toHaveLength(7)
    expect(s.days.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5, 6, 0])
    expect(s.days.map((d) => d.dateKey)).toEqual([
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ])
    expect(s.days.map((d) => d.isToday)).toEqual([false, false, true, false, false, false, false])
  })

  it('跨周边界：周日剧落在本周日，不会串到下周一', () => {
    const sunday = entry({ title: '周日剧', cadence: { kind: 'weekly', weekdays: [0] } })
    const monday = entry({ title: '周一剧', cadence: { kind: 'weekly', weekdays: [1] } })
    const s = buildWeekSchedule([sunday, monday], MON, WED)
    expect(s.days[6].entries.map((e) => e.title)).toEqual(['周日剧'])
    expect(s.days[0].entries.map((e) => e.title)).toEqual(['周一剧'])
    // 下一周的周一（11-23）不在本周表里
    expect(s.days.map((d) => d.dateKey)).not.toContain('2026-11-23')
  })

  it('同一天多部撞车：想先看的排前面', () => {
    const normal = entry({ title: '普通剧', priority: 'normal', cadence: { kind: 'weekly', weekdays: [3] } })
    const urgent = entry({ title: '想先看的剧', priority: 'high', cadence: { kind: 'weekly', weekdays: [3] } })
    const s = buildWeekSchedule([normal, urgent], MON, WED)
    expect(s.days[2].entries.map((e) => e.title)).toEqual(['想先看的剧', '普通剧'])
  })

  it('空清单：三区全空，不渲染整段的判定依据', () => {
    const s = buildWeekSchedule([], MON, WED)
    expect(s.daily).toEqual([])
    expect(s.unscheduled).toEqual([])
    expect(s.days.every((d) => d.entries.length === 0)).toBe(true)
  })
})

describe('buildWeekSchedule 过去日期置灰（周日边缘）', () => {
  // 2026-11-22 是周日：固定周一–周日的表当天打开时，周一–周六都已过去
  const SUNDAY = new Date(2026, 10, 22, 10, 0, 0)

  it('周日打开：周一–周六都算过去，周日是今天不算过去', () => {
    const s = buildWeekSchedule([], MON, SUNDAY)
    expect(s.days.map((d) => d.isPast)).toEqual([true, true, true, true, true, true, false])
    expect(s.days.map((d) => d.isToday)).toEqual([false, false, false, false, false, false, true])
  })

  it('周一打开：没有过去的格子', () => {
    const s = buildWeekSchedule([], MON, MON)
    expect(s.days.map((d) => d.isPast)).toEqual([false, false, false, false, false, false, false])
    expect(s.days[0].isToday).toBe(true)
  })

  it('周三打开：周一、周二过去，周三之后不过去', () => {
    const s = buildWeekSchedule([], MON, WED)
    expect(s.days.map((d) => d.isPast)).toEqual([true, true, false, false, false, false, false])
  })

  it('过去的格子里的剧照常排位，只由页面置灰，不丢数据', () => {
    const mondayShow = entry({ title: '周一剧', cadence: { kind: 'weekly', weekdays: [1] } })
    const s = buildWeekSchedule([mondayShow], MON, SUNDAY)
    expect(s.days[0].entries.map((e) => e.title)).toEqual(['周一剧'])
    expect(s.days[0].isPast).toBe(true)
  })
})
