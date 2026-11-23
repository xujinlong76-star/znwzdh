/**
 * U-421：开放期提醒岛瘦身行加「去打印准考证」直达链。
 *
 * 背景：U-236 把开放期（open / last-call）卡片收敛为瘦身行时，提醒块内
 * 不再出现任何链接；国考准考证打印开窗在即（11-23 0:00），用户在提醒块
 * 就应一点直达打印系统，不必再去时间轴节点行找入口。
 * 修法：只在 card 形态的 slimCardLine 分支加一条打印链，目标走
 * reminder.url（即 exam-calendar 的 GUOKAO_ADMISSION_URL 常量，唯一事实
 * 源，不硬编码、不自造常量）；显示条件复用现有门控——slimCardLine 只在
 * open / last-call 才有，窗口外 admissionReminderFor 返回 null、组件
 * 渲染 nothing，链不会在非开放期出现；不加窗口文案与门户备用链，
 * U-236 瘦身口径不变。
 */
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GuokaoAdmissionReminder } from '../src/components/guokao-admission-reminder'
import {
  EXAMS,
  GUOKAO_ADMISSION_URL,
  GUOKAO_PORTAL_URL,
  admissionReminderFor,
} from '../src/lib/exam-calendar'
import { safeHref } from '../src/lib/safe-url'

const guokao = EXAMS.find((e) => e.id === 'guokao')!

/** 北京时间：11-15 倒计时 / 11-22 预热 / 11-23 已开放 / 11-27 末班 / 11-29 15:00 截止后 */
const NOV_15_NOON_CST = Date.UTC(2026, 10, 15, 4, 0, 0)
const NOV_22_NOON_CST = Date.UTC(2026, 10, 22, 4, 0, 0)
const NOV_23_NOON_CST = Date.UTC(2026, 10, 23, 4, 0, 0)
const NOV_27_NOON_CST = Date.UTC(2026, 10, 27, 4, 0, 0)
const NOV_29_AFTER_DEADLINE_CST = Date.UTC(2026, 10, 29, 7, 0, 1)

const cardHtml = (nowMs: number) =>
  renderToString(
    createElement(GuokaoAdmissionReminder, {
      reminder: admissionReminderFor(guokao, nowMs),
      variant: 'card',
    }),
  )

describe('U-421：开放期瘦身行带「去打印准考证」直达链', () => {
  it('11-23 开放期：瘦身行含一条打印链，目标为 GUOKAO_ADMISSION_URL', () => {
    const html = cardHtml(NOV_23_NOON_CST)
    expect(html).toContain('去打印准考证')
    expect(html).toContain(`href="${safeHref(GUOKAO_ADMISSION_URL)}"`)
    expect(html.match(/<a /g)?.length).toBe(1)
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('11-27 末班期：瘦身行同样含一条打印链', () => {
    const html = cardHtml(NOV_27_NOON_CST)
    expect(html).toContain('去打印准考证')
    expect(html).toContain(`href="${safeHref(GUOKAO_ADMISSION_URL)}"`)
    expect(html.match(/<a /g)?.length).toBe(1)
  })

  it('瘦身行只加打印链：不含门户备用链、不含窗口文案', () => {
    const html = cardHtml(NOV_23_NOON_CST)
    expect(html).not.toContain(safeHref(GUOKAO_PORTAL_URL))
    expect(html).not.toContain('专题网站门户')
    expect(html).not.toContain('11 月 29 日 15:00')
  })

  it('非开放期不出现瘦身打印链：11-15 倒计时无 slimCardLine，11-22 预热走全句', () => {
    expect(admissionReminderFor(guokao, NOV_15_NOON_CST)?.slimCardLine).toBeUndefined()
    expect(admissionReminderFor(guokao, NOV_22_NOON_CST)?.slimCardLine).toBeUndefined()
    // 预热期全句卡片仍有一条打印链（行为不变，U-236 已断言，此处只核对目标常量一致）
    const warmupHtml = cardHtml(NOV_22_NOON_CST)
    expect(warmupHtml).toContain('去打印准考证')
    expect(warmupHtml).toContain(`href="${safeHref(GUOKAO_ADMISSION_URL)}"`)
  })

  it('窗口关闭后提醒岛渲染 nothing：11-29 15:00 后无提醒、无打印链', () => {
    expect(admissionReminderFor(guokao, NOV_29_AFTER_DEADLINE_CST)).toBeNull()
    expect(cardHtml(NOV_29_AFTER_DEADLINE_CST)).toBe('')
  })

  it('打印链不硬编码域名：reminder.url 即 GUOKAO_ADMISSION_URL 常量', () => {
    expect(admissionReminderFor(guokao, NOV_23_NOON_CST)?.url).toBe(GUOKAO_ADMISSION_URL)
    expect(GUOKAO_ADMISSION_URL).toBe('http://gwy.cpta.com.cn')
  })
})
