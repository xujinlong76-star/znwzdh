/**
 * 考试倒计时紧迫度分档测试（/exam 第三轮）：
 *  - 纯规则层 exam-calendar.ts：urgencyTier / reminderTier /
 *    nearestExamCountdown 只读派生，档位互斥、边界固定 nowMs 注入、
 *    不依赖真实今天；
 *  - 源码守卫：倒计时岛与首页条带按档位上色、提醒文案只对已关注考试
 *    显示、未关注只变色不出文案；时钟卡倒计时行只读 nearestExamCountdown、
 *    点按跳 /exam、十二场全结束隐藏。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  EXAM_NODE_STATUS_LABEL,
  EXAM_REMINDERS,
  EXAM_REMINDER_TIER_LABEL,
  EXAMS,
  activeExamReminders,
  examNodeStatus,
  nearestExamCountdown,
  reminderTier,
  urgencyTier,
} from '../src/lib/exam-calendar'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

const guokao = EXAMS.find((e) => e.id === 'guokao')!
const jingkao = EXAMS.find((e) => e.id === 'jingkao')!
const kaoyan = EXAMS.find((e) => e.id === 'kaoyan')!
const chengkao = EXAMS.find((e) => e.id === 'chengkao')!

/** 2026-11-13 08:00 北京时间（UTC 午夜）：距国考首考日 15 天 */
const NOV_13_0800_CST = Date.UTC(2026, 10, 13, 0, 0, 0)
/** 2026-11-14 08:00 北京时间：距国考首考日 14 天（本轮验收日） */
const NOV_14_0800_CST = Date.UTC(2026, 10, 14, 0, 0, 0)
/** 2026-11-20 08:00 北京时间：距国考首考日 8 天 */
const NOV_20_0800_CST = Date.UTC(2026, 10, 20, 0, 0, 0)
/** 2026-11-21 08:00 北京时间：距国考首考日 7 天 */
const NOV_21_0800_CST = Date.UTC(2026, 10, 21, 0, 0, 0)
/** 2026-11-22 08:00 北京时间：距国考首考日 6 天 */
const NOV_22_0800_CST = Date.UTC(2026, 10, 22, 0, 0, 0)
/** 2026-11-24 08:00 北京时间：距国考首考日 4 天 */
const NOV_24_0800_CST = Date.UTC(2026, 10, 24, 0, 0, 0)
/** 2026-11-25 08:00 北京时间：距国考首考日 3 天 */
const NOV_25_0800_CST = Date.UTC(2026, 10, 25, 0, 0, 0)
/** 2026-11-26 08:00 北京时间：距国考首考日 2 天 */
const NOV_26_0800_CST = Date.UTC(2026, 10, 26, 0, 0, 0)
/** 2026-11-27 08:00 北京时间：距国考首考日 1 天 */
const NOV_27_0800_CST = Date.UTC(2026, 10, 27, 0, 0, 0)
/** 2026-11-28 08:00 北京时间：国考首考日（专业科目 14:00 开考） */
const NOV_28_0800_CST = Date.UTC(2026, 10, 28, 0, 0, 0)
/** 2026-11-29 08:00 北京时间：国考公共科目日 */
const NOV_29_0800_CST = Date.UTC(2026, 10, 29, 0, 0, 0)
/** 2026-11-30 08:00 北京时间：国考已过 */
const NOV_30_0800_CST = Date.UTC(2026, 10, 30, 0, 0, 0)
/** 2026-12-04 08:00 北京时间：京考首考日前一天 */
const DEC_04_0800_CST = Date.UTC(2026, 11, 4, 0, 0, 0)
/** 2026-12-05 08:00 北京时间：京考首考日（公安专业科目 14:00 开考） */
const DEC_05_0800_CST = Date.UTC(2026, 11, 5, 0, 0, 0)
/** 2026-12-06 08:00 北京时间：省考公共科目日（撞期提醒有效期最后一天） */
const DEC_06_0800_CST = Date.UTC(2026, 11, 6, 0, 0, 0)
/** 2026-12-07 08:00 北京时间：省考已过，省考两条撞期提醒应下线 */
const DEC_07_0800_CST = Date.UTC(2026, 11, 7, 0, 0, 0)
/** 2026-12-12 08:00 北京时间：四六级笔试日（军队文职 12-13 不抢最近场） */
const DEC_12_0800_CST = Date.UTC(2026, 11, 12, 0, 0, 0)
/** 2026-12-13 08:00 北京时间：军队文职笔试日 */
const DEC_13_0800_CST = Date.UTC(2026, 11, 13, 0, 0, 0)
/** 2026-12-19 08:00 北京时间：考研首日 */
const DEC_19_0800_CST = Date.UTC(2026, 11, 19, 0, 0, 0)
/** 2026-12-20 08:00 北京时间：考研末日（进行中） */
const DEC_20_0800_CST = Date.UTC(2026, 11, 20, 0, 0, 0)
/** 2026-12-21 08:00 北京时间：考研已过，最近场切到广东自考·1月（2027-01-09） */
const DEC_21_0800_CST = Date.UTC(2026, 11, 21, 0, 0, 0)
/** 2027-01-11 08:00 北京时间：十二场全过（广东自考·1月 2027-01-10 已结束） */
const JAN_11_0800_CST = Date.UTC(2027, 0, 11, 0, 0, 0)

describe('urgencyTier（倒计时紧迫度分档）', () => {
  it('8 天以上 relaxed：15 天与 8 天无差别', () => {
    expect(urgencyTier(guokao, NOV_13_0800_CST)).toBe('relaxed')
    expect(urgencyTier(guokao, NOV_20_0800_CST)).toBe('relaxed')
  })

  it('7 天与 4 天 soon（琥珀档）', () => {
    expect(urgencyTier(guokao, NOV_21_0800_CST)).toBe('soon')
    expect(urgencyTier(guokao, NOV_24_0800_CST)).toBe('soon')
  })

  it('3 天与 2 天 urgent（红档）', () => {
    expect(urgencyTier(guokao, NOV_25_0800_CST)).toBe('urgent')
    expect(urgencyTier(guokao, NOV_26_0800_CST)).toBe('urgent')
  })

  it('首考日前 1 天 tomorrow、首考日与公共科目日都是 today', () => {
    expect(urgencyTier(guokao, NOV_27_0800_CST)).toBe('tomorrow')
    expect(urgencyTier(guokao, NOV_28_0800_CST)).toBe('today')
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

  it('午夜边界：首考日前一天 23:59 还是明天、00:00 已是首考日', () => {
    // 2026-11-27 23:30 北京时间（UTC 15:30）→ 距国考首考日 1 天
    expect(urgencyTier(guokao, Date.UTC(2026, 10, 27, 15, 30))).toBe('tomorrow')
    // 2026-11-28 00:00 北京时间（UTC 16:00）→ 国考首考日当天
    expect(urgencyTier(guokao, Date.UTC(2026, 10, 27, 16, 0))).toBe('today')
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
  it('只在考前 7 / 3 / 1 天与考试当天命中（天数按首考日 11-28 算）', () => {
    expect(reminderTier(guokao, NOV_21_0800_CST)).toBe('7d')
    expect(reminderTier(guokao, NOV_25_0800_CST)).toBe('3d')
    expect(reminderTier(guokao, NOV_27_0800_CST)).toBe('1d')
    expect(reminderTier(guokao, NOV_28_0800_CST)).toBe('today')
    expect(reminderTier(guokao, NOV_29_0800_CST)).toBe('today')
  })

  it('非档位日不命中：8 天、4 天、2 天均为 null', () => {
    expect(reminderTier(guokao, NOV_20_0800_CST)).toBeNull()
    expect(reminderTier(guokao, NOV_24_0800_CST)).toBeNull()
    expect(reminderTier(guokao, NOV_26_0800_CST)).toBeNull()
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

describe('nearestExamCountdown（时钟卡倒计时行）', () => {
  it('国考数据按首考日说事：examDateLabel 两日、tagline 提专业科目、首考日 11-28', () => {
    expect(guokao.examDateLabel).toBe('11 月 28–29 日')
    expect(guokao.tagline).toContain('专业科目 11 月 28 日')
    expect(guokao.tagline).toContain('公共科目 11 月 29 日')
    expect(guokao.firstExamDayISO).toBe('2026-11-28')
  })

  it('11-13 距国考首考日 15 天、11-14 距 14 天：relaxed 档，文案与天数与考试条带一致', () => {
    const a = nearestExamCountdown(NOV_13_0800_CST)!
    expect(a.exam.id).toBe('guokao')
    expect(a.days).toBe(15)
    expect(a.tier).toBe('relaxed')
    expect(a.label).toBe('距国考 15 天')
    const b = nearestExamCountdown(NOV_14_0800_CST)!
    expect(b.exam.id).toBe('guokao')
    expect(b.days).toBe(14)
    expect(b.tier).toBe('relaxed')
    expect(b.label).toBe('距国考 14 天')
  })

  it('档位与文案随临近变化：6 天 soon、首考日前一天 tomorrow、首考日与公共科目日 today', () => {
    expect(nearestExamCountdown(NOV_22_0800_CST)).toMatchObject({
      days: 6,
      tier: 'soon',
      label: '距国考 6 天',
    })
    expect(nearestExamCountdown(NOV_27_0800_CST)).toMatchObject({
      days: 1,
      tier: 'tomorrow',
      label: '明天国考（专业科目先考 11 月 28 日）',
    })
    expect(nearestExamCountdown(NOV_28_0800_CST)).toMatchObject({
      days: 0,
      tier: 'today',
      label: '今天国考 · 专业科目 14:00 开考',
    })
    expect(nearestExamCountdown(NOV_29_0800_CST)).toMatchObject({
      days: -1,
      tier: 'today',
      label: '今天国考',
    })
  })

  it('京考数据按首考日说事：examDateLabel 两日、tagline 提公安专业科目、首考日 12-05', () => {
    expect(jingkao.examDateLabel).toBe('12 月 5–6 日')
    expect(jingkao.tagline).toContain('公安专业科目 12 月 5 日')
    expect(jingkao.tagline).toContain('公共科目 12 月 6 日')
    expect(jingkao.firstExamDayISO).toBe('2026-12-05')
    // 首考日文案仍在数据层（当前被同日首考的教资面试遮蔽，nearest 轮不到
    // 京考；条目移除后自动恢复，故字段本身不能删）
    expect(jingkao.firstDayLabel).toBe('今天京考 · 公安专业科目 14:00 开考')
    expect(jingkao.eveLabel).toBe('明天京考（公安专业科目先考 12 月 5 日）')
  })

  it('国考过后切到教资面试：11-30 距教资面试首考日 5 天，soon 档', () => {
    // 教资面试首考日 12-05 与京考同日、且在 EXAMS 数组中排在京考之前，
    // stable sort 平局数组在前者胜出，故国考过后最近场是教资面试而非京考
    expect(nearestExamCountdown(NOV_30_0800_CST)).toMatchObject({
      exam: expect.objectContaining({ id: 'jiaoshi-mianshi' }),
      days: 5,
      tier: 'soon',
      label: '距教资面试 5 天',
    })
  })

  it('教资面试首考日前一天 tomorrow、首考日与次日进行中（多日面试不走单日 today）', () => {
    expect(nearestExamCountdown(DEC_04_0800_CST)).toMatchObject({
      days: 1,
      tier: 'tomorrow',
      label: '明天教资面试',
    })
    expect(nearestExamCountdown(DEC_05_0800_CST)).toMatchObject({
      days: 0,
      tier: 'today',
      label: '教资面试进行中 · 第 1 天',
    })
    expect(nearestExamCountdown(DEC_06_0800_CST)).toMatchObject({
      days: -1,
      tier: 'today',
      label: '教资面试进行中 · 第 2 天',
    })
  })

  it('12-07 起最近场回到四六级，12-13 切到军队文职（此前为考研）', () => {
    // 12-07–12-12 最近仍是四六级（12-12 首考日早于军队文职 12-13）
    expect(nearestExamCountdown(DEC_07_0800_CST)).toMatchObject({
      exam: expect.objectContaining({ id: 'cet' }),
      days: 5,
      tier: 'soon',
      label: '距四六级 5 天',
    })
    expect(nearestExamCountdown(DEC_12_0800_CST)).toMatchObject({
      exam: expect.objectContaining({ id: 'cet' }),
      days: 0,
      tier: 'today',
      label: '今天四六级',
    })
    // 12-13 四六级已过，军队文职当天 today；此前同一天最近场是考研
    expect(nearestExamCountdown(DEC_13_0800_CST)).toMatchObject({
      exam: expect.objectContaining({ id: 'jundui-wenzhi' }),
      days: 0,
      tier: 'today',
      label: '今天军队文职',
    })
  })

  it('多日考试：考研首日进行中第 1 天，末日第 2 天（与 /exam 岛同口径）', () => {
    expect(nearestExamCountdown(DEC_19_0800_CST)).toMatchObject({
      days: 0,
      tier: 'today',
      label: '考研进行中 · 第 1 天',
    })
    expect(nearestExamCountdown(DEC_20_0800_CST)).toMatchObject({
      days: -1,
      tier: 'today',
      label: '考研进行中 · 第 2 天',
    })
  })

  it('十二场全结束返回 undefined：2027-01-11 时钟卡该行隐藏，不写未公布日期', () => {
    expect(nearestExamCountdown(JAN_11_0800_CST)).toBeUndefined()
  })
})

describe('源码守卫：按档位上色、提醒只对已关注显示', () => {
  it('倒计时岛按 urgencyTier 上色，不再写死 text-foreground', () => {
    const countdown = read('src/app/exam/exam-countdown.tsx')
    expect(countdown).toContain('urgencyTier(')
    expect(countdown).toContain('text-red-600')
    expect(countdown).toContain('text-amber-700')
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

  it('时钟卡倒计时行只读 nearestExamCountdown、点按跳 /exam、十二场全结束隐藏', () => {
    const widget = read('src/components/modular/modules/clock-widget.tsx')
    expect(widget).toContain('nearestExamCountdown(')
    expect(widget).toContain('href="/exam"')
    // 按档位上色：小字配方与条带一致（red-700 / amber-700 / sky-700），不用 11px、不用锌灰
    expect(widget).toContain('text-red-700')
    expect(widget).toContain('text-amber-700')
    expect(widget).toContain('text-sky-700')
    // 全结束时该行隐藏：渲染端以 countdown 为空为条件，不写兜底文案
    expect(widget).toContain('{countdown && (')
    // 不写死考试日期：日期只从 exam-calendar 事实源来
    expect(widget).not.toContain('2026-11-29')
    expect(widget).not.toContain('2026-12-19')
  })
})

describe('activeExamReminders（撞期提醒过期哨兵，2026-11-17 R-1）', () => {
  it('每条提醒都有明确过期日：省考两条到 12-06，考研衔接到 12-19', () => {
    expect(EXAM_REMINDERS.map((r) => r.validUntilISO)).toEqual([
      '2026-12-06',
      '2026-12-06',
      '2026-12-19',
    ])
  })

  it('11-17 三条全在：撞期未到，不过期', () => {
    expect(activeExamReminders(NOV_14_0800_CST).map((r) => r.title)).toEqual(
      EXAM_REMINDERS.map((r) => r.title),
    )
  })

  it('12-06 当天三条仍在：有效期含当日', () => {
    expect(activeExamReminders(DEC_06_0800_CST)).toHaveLength(3)
  })

  it('12-07 省考两条下线，只剩考研衔接一条', () => {
    const titles = activeExamReminders(DEC_07_0800_CST).map((r) => r.title)
    expect(titles).toEqual(['四六级之后一周就是考研'])
  })

  it('12-19 当天考研衔接仍在，12-20 三条全下线', () => {
    expect(activeExamReminders(DEC_19_0800_CST).map((r) => r.title)).toEqual([
      '四六级之后一周就是考研',
    ])
    expect(activeExamReminders(DEC_20_0800_CST)).toEqual([])
  })

  it('/exam 页只读派生结果 activeExamReminders，不直接渲染 EXAM_REMINDERS 原数组', () => {
    const page = read('src/app/exam/page.tsx')
    expect(page).toContain('activeExamReminders(')
    expect(page).not.toContain('EXAM_REMINDERS.map')
    // 三条全过期时整区隐藏，不留空壳
    expect(page).toContain('reminders.length > 0')
  })
})

describe('浙江成绩查询预计节点（U-109）', () => {
  it('estimated 落库：start/end 仍为 2026-11-20，detail 仍写「左右」', () => {
    const node = chengkao.nodes.find((n) => n.label === '浙江成绩查询')!
    expect(node.estimated).toBe(true)
    expect(node.startISO).toBe('2026-11-20')
    expect(node.endISO).toBe('2026-11-20')
    expect(node.detail).toContain('11 月 20 日左右')
  })

  it('以 2026-11-21 为今天：状态 estimated、显示「预计」非「已结束」', () => {
    const node = chengkao.nodes.find((n) => n.label === '浙江成绩查询')!
    expect(examNodeStatus(node, NOV_21_0800_CST)).toBe('estimated')
    expect(EXAM_NODE_STATUS_LABEL.estimated).toBe('预计')
    expect(EXAM_NODE_STATUS_LABEL.estimated).not.toBe('已结束')
    // 预计日当天与预计日之后都不翻：11-20 与 11-25 仍是 estimated
    expect(examNodeStatus(node, NOV_20_0800_CST)).toBe('estimated')
    expect(examNodeStatus(node, NOV_25_0800_CST)).toBe('estimated')
  })
})
