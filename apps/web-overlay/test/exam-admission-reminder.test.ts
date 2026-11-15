/**
 * 国考准考证打印提醒红线测试：
 *  - 门控只按北京时间翻：11-22 预热、11-23–11-26 已开放、11-27–11-29 15:00
 *    末班，11-22 之前与 11-29 15:00 之后一律不显示；
 *  - 只有国考有提醒，其余三场任何时刻都返回 null（不打扰非考生）；
 *  - 文案全部取自已核实的提醒准备稿 A 版：窗口、报名序号、多打两份备用、
 *    笔试时间一个不少；官方链接是 http://bm.scs.gov.cn/kl2027（2026-11-14
 *    curl 核实 200，https 版为空回复，不许写成 https）；
 *  - 链接唯一事实源在 exam-calendar 常量里，提醒组件与页面不写死域名，
 *    外链一律过 safeHref、target _blank + noopener。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  EXAMS,
  GUOKAO_ADMISSION_URL,
  admissionReminderFor,
  guokaoAdmissionPhase,
} from '../src/lib/exam-calendar'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

/** 北京时间 2026-11-21 12:00（UTC 11-21 04:00）：预热前一天 */
const NOV_21_NOON_CST = Date.UTC(2026, 10, 21, 4, 0, 0)
/** 北京时间 2026-11-22 00:00（UTC 11-21 16:00）：预热开始 */
const NOV_22_0000_CST = Date.UTC(2026, 10, 21, 16, 0, 0)
/** 北京时间 2026-11-22 23:59 */
const NOV_22_LATE_CST = Date.UTC(2026, 10, 22, 15, 59, 0)
/** 北京时间 2026-11-23 00:00 */
const NOV_23_0000_CST = Date.UTC(2026, 10, 22, 16, 0, 0)
/** 北京时间 2026-11-26 23:59 */
const NOV_26_LATE_CST = Date.UTC(2026, 10, 26, 15, 59, 0)
/** 北京时间 2026-11-27 00:00 */
const NOV_27_0000_CST = Date.UTC(2026, 10, 26, 16, 0, 0)
/** 北京时间 2026-11-29 14:59 */
const NOV_29_1459_CST = Date.UTC(2026, 10, 29, 6, 59, 0)
/** 北京时间 2026-11-29 15:00：截止时刻整，提醒下线 */
const NOV_29_1500_CST = Date.UTC(2026, 10, 29, 7, 0, 0)
/** 北京时间 2026-11-30 08:00 */
const NOV_30_0800_CST = Date.UTC(2026, 10, 30, 0, 0, 0)

describe('guokaoAdmissionPhase（北京时间门控）', () => {
  it('11-22 预热、11-23–11-26 已开放、11-27–11-29 15:00 末班，之外不显示', () => {
    expect(guokaoAdmissionPhase(NOV_21_NOON_CST)).toBeNull()
    expect(guokaoAdmissionPhase(NOV_22_0000_CST)).toBe('warmup')
    expect(guokaoAdmissionPhase(NOV_22_LATE_CST)).toBe('warmup')
    expect(guokaoAdmissionPhase(NOV_23_0000_CST)).toBe('open')
    expect(guokaoAdmissionPhase(NOV_26_LATE_CST)).toBe('open')
    expect(guokaoAdmissionPhase(NOV_27_0000_CST)).toBe('last-call')
    expect(guokaoAdmissionPhase(NOV_29_1459_CST)).toBe('last-call')
  })

  it('11-29 15:00 整点下线，之前一分钟仍在末班', () => {
    expect(guokaoAdmissionPhase(NOV_29_1500_CST)).toBeNull()
    expect(guokaoAdmissionPhase(NOV_30_0800_CST)).toBeNull()
  })
})

describe('admissionReminderFor（只对国考）', () => {
  const guokao = EXAMS.find((e) => e.id === 'guokao')!

  it('窗口内返回三档文案：预热说明天开放、开放期说已开放、末班说无法补打', () => {
    const warmup = admissionReminderFor(guokao, NOV_22_0000_CST)!
    expect(warmup.phase).toBe('warmup')
    expect(warmup.stripLine).toContain('明天 0:00 开放打印')
    expect(warmup.cardLine).toContain('11 月 23 日')
    const open = admissionReminderFor(guokao, NOV_23_0000_CST)!
    expect(open.phase).toBe('open')
    expect(open.stripLine).toContain('打印已开放')
    const last = admissionReminderFor(guokao, NOV_27_0000_CST)!
    expect(last.phase).toBe('last-call')
    expect(last.stripLine).toContain('末班提醒')
    expect(last.cardLine).toContain('无法补打')
  })

  it('三档文案都含已核实的要素：截止、报名序号、多打两份、笔试时间', () => {
    for (const t of [NOV_22_0000_CST, NOV_23_0000_CST, NOV_27_0000_CST]) {
      const r = admissionReminderFor(guokao, t)!
      expect(r.stripLine).toContain('11 月 29 日 15:00 截止')
      expect(r.cardLine).toContain('11 月 29 日 15:00 截止')
      expect(r.cardLine).toContain('报名序号')
      expect(r.cardLine).toContain('多打两份备用')
      expect(r.cardLine).toContain('行测 9:00–11:00')
      expect(r.cardLine).toContain('申论 14:00–17:00')
    }
  })

  it('三档 card 均含 15 分钟入场规则：新规、去年 30 分钟、最晚入场、不得退场', () => {
    for (const t of [NOV_22_0000_CST, NOV_23_0000_CST, NOV_27_0000_CST]) {
      const r = admissionReminderFor(guokao, t)!
      expect(r.cardLine).toContain('开考 15 分钟后不得入场')
      expect(r.cardLine).toContain('去年为 30 分钟')
      expect(r.cardLine).toContain('行测最晚 8:45')
      expect(r.cardLine).toContain('申论、专业科目最晚 13:45')
      expect(r.cardLine).toContain('不得提前退场')
      expect(r.cardLine).toContain('国家公务员局 2027 年度招考公告')
    }
  })

  it('仅末班档 strip 含入场规则短句，预热/开放档 strip 不含（规则只在考前 3 天上首页条带）', () => {
    const warmup = admissionReminderFor(guokao, NOV_22_0000_CST)!
    expect(warmup.stripLine).not.toContain('15 分钟后不得入场')
    const open = admissionReminderFor(guokao, NOV_23_0000_CST)!
    expect(open.stripLine).not.toContain('15 分钟后不得入场')
    const last = admissionReminderFor(guokao, NOV_27_0000_CST)!
    expect(last.stripLine).toContain('开考 15 分钟后不得入场')
    expect(last.stripLine).toContain('行测最晚 8:45')
    expect(last.stripLine).toContain('申论 13:45')
  })

  it('官方链接是 http://bm.scs.gov.cn/kl2027，不许写成 https', () => {
    expect(GUOKAO_ADMISSION_URL).toBe('http://bm.scs.gov.cn/kl2027')
    const r = admissionReminderFor(guokao, NOV_23_0000_CST)!
    expect(r.url).toBe('http://bm.scs.gov.cn/kl2027')
    expect(r.url).not.toContain('https://')
  })

  it('其余三场任何时刻都没有提醒', () => {
    for (const exam of EXAMS.filter((e) => e.id !== 'guokao')) {
      expect(admissionReminderFor(exam, NOV_23_0000_CST)).toBeNull()
      expect(admissionReminderFor(exam, NOV_27_0000_CST)).toBeNull()
    }
  })

  it('国考在窗口外也没有提醒（11-15 与 11-29 15:00 后）', () => {
    expect(admissionReminderFor(guokao, Date.UTC(2026, 10, 15, 0, 0, 0))).toBeNull()
    expect(admissionReminderFor(guokao, NOV_29_1500_CST)).toBeNull()
  })
})

describe('准考证提醒源码守卫', () => {
  const reminder = read('src/components/guokao-admission-reminder.tsx')
  const page = read('src/app/exam/page.tsx')

  it('提醒组件：链接只走 exam-calendar 常量，不写死域名；外链过 safeHref 且带 noopener', () => {
    expect(reminder).toContain("from '@/lib/exam-calendar'")
    expect(reminder).toContain('safeHref')
    expect(reminder).toContain('rel="noopener noreferrer"')
    expect(reminder).toContain('target="_blank"')
    expect(reminder).not.toContain('bm.scs.gov.cn')
    expect(reminder).not.toContain('kl2027')
    // 组件注释里只许出现「http://」一词（说明用 http 而非 https 的原因），
    // 不许出现任何完整 URL 字面量：完整 URL 的 // 后必跟字母数字
    expect(reminder).not.toMatch(/https?:\/\/[a-zA-Z0-9]/)
  })

  it('提醒组件：挂载前渲染 null（防 SSR/水合午夜边界错位），窗口外渲染 nothing', () => {
    expect(reminder).toContain('useState<number | null>(null)')
    expect(reminder).toContain('if (now === null) return null')
    expect(reminder).toContain('if (!reminder) return null')
  })

  it('/exam 页：只有国考卡片挂提醒岛，官方域名不在页面写死', () => {
    expect(page).toContain('GuokaoAdmissionReminderIsland')
    expect(page).toContain("exam.id === 'guokao' ? <GuokaoAdmissionReminderIsland exam={exam} />")
    expect(page).not.toContain('scs.gov.cn')
    expect(page).not.toContain('bm.scs.gov.cn')
  })
})
