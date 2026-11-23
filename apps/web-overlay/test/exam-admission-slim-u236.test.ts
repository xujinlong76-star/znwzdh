/**
 * U-236：/exam 国考卡片内，提醒块与时间轴节点行重复同一窗口与同一入口
 * （11-23–11-29 开放期）。修法：开放期（open / last-call）提醒块收敛为
 * 一行瘦身提示，只保留节点行没有的增量（入场新规 + 多打两份），窗口与
 * 入口不再全文重复；11-15–11-22（countdown / warmup）行为不变。
 * 验收：11-23–11-29 视角下「11 月 29 日 15:00 截止」与打印入口在提醒块
 * 内不再出现（只剩节点行一次完整表达）；11-15–11-22 提醒块行为不变。
 * 订正（U-421）：瘦身行仍须带「去打印准考证」直达链——开窗在即，用户在
 * 提醒块就应一点直达；只加一条打印链（reminder.url），窗口文案与门户
 * 备用链仍不重复。下述「无 <a>」断言按新行为改写为「恰一条打印链」，
 * 其余 U-236 断言（无截止时刻、无门户域名）不变。
 */
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GuokaoAdmissionReminder } from '../src/components/guokao-admission-reminder'
import { EXAMS, GUOKAO_ADMISSION_URL, admissionReminderFor } from '../src/lib/exam-calendar'
import { safeHref } from '../src/lib/safe-url'

const guokao = EXAMS.find((e) => e.id === 'guokao')!

/** 北京时间：11-15 倒计时 / 11-22 预热 / 11-23 已开放 / 11-27 末班 */
const NOV_15_NOON_CST = Date.UTC(2026, 10, 15, 4, 0, 0)
const NOV_22_NOON_CST = Date.UTC(2026, 10, 22, 4, 0, 0)
const NOV_23_NOON_CST = Date.UTC(2026, 10, 23, 4, 0, 0)
const NOV_27_NOON_CST = Date.UTC(2026, 10, 27, 4, 0, 0)

const cardHtml = (nowMs: number) =>
  renderToString(
    createElement(GuokaoAdmissionReminder, {
      reminder: admissionReminderFor(guokao, nowMs),
      variant: 'card',
    }),
  )

describe('U-236：瘦身行只在开放期出现，11-15–11-22 不设', () => {
  it('open 与 last-call 有 slimCardLine；countdown 与 warmup 没有', () => {
    expect(admissionReminderFor(guokao, NOV_23_NOON_CST)?.slimCardLine).toBeDefined()
    expect(admissionReminderFor(guokao, NOV_27_NOON_CST)?.slimCardLine).toBeDefined()
    expect(admissionReminderFor(guokao, NOV_15_NOON_CST)?.slimCardLine).toBeUndefined()
    expect(admissionReminderFor(guokao, NOV_22_NOON_CST)?.slimCardLine).toBeUndefined()
  })

  it('瘦身行只留增量（入场新规 + 多打两份），不含窗口、入口与笔试时间', () => {
    const slim = admissionReminderFor(guokao, NOV_23_NOON_CST)?.slimCardLine ?? ''
    expect(slim).toContain('多打两份备用')
    expect(slim).toContain('开考 15 分钟后不得入场')
    expect(slim).toContain('行测最晚 8:45')
    expect(slim).toContain('不得提前退场')
    expect(slim).not.toContain('11 月 29 日 15:00')
    expect(slim).not.toContain('11 月 23 日')
    expect(slim).not.toContain('gwy.cpta.com.cn')
    expect(slim).not.toContain('bm.scs.gov.cn')
    expect(slim).not.toContain('报名序号')
    expect(slim).not.toContain('行测 9:00–11:00')
  })

  it('11-15–11-22 全句卡片文案不变（仍含窗口、入口与新规）', () => {
    const warmup = admissionReminderFor(guokao, NOV_22_NOON_CST)!
    expect(warmup.cardLine).toContain('11 月 29 日 15:00 截止')
    expect(warmup.cardLine).toContain('多打两份备用')
    expect(warmup.cardLine).toContain('开考 15 分钟后不得入场')
  })
})

describe('U-236：开放期卡片真渲染为瘦身块（U-421：瘦身行带一条打印链）', () => {
  it('11-23 卡片渲染：标题 + 瘦身行 + 恰一条打印链，无截止时刻、无门户域名', () => {
    const html = cardHtml(NOV_23_NOON_CST)
    expect(html).toContain('准考证打印提醒')
    expect(html).toContain('多打两份备用')
    expect(html).toContain('开考 15 分钟后不得入场')
    // U-421：瘦身行带「去打印准考证」直达链（恰一条 <a>，目标为 GUOKAO_ADMISSION_URL）；
    // 窗口文案与门户备用链仍不重复（U-236 口径不变）。
    expect(html).toContain('去打印准考证')
    expect(html).toContain(`href="${safeHref(GUOKAO_ADMISSION_URL)}"`)
    expect(html.match(/<a /g)?.length).toBe(1)
    expect(html).not.toContain('11 月 29 日 15:00')
    // U-421：打印链 href 本身就是 gwy.cpta.com.cn（目标常量），故此处只禁门户域名；
    // 入口域名是否恰为打印系统，由上方的 href 全等断言锁定。
    expect(html).not.toContain('bm.scs.gov.cn')
    expect(html).not.toContain('专题网站门户')
  })

  it('11-27 末班卡片同样收敛为瘦身块（U-421：同样带一条打印链）', () => {
    const html = cardHtml(NOV_27_NOON_CST)
    expect(html).toContain('多打两份备用')
    expect(html).toContain('去打印准考证')
    expect(html).toContain(`href="${safeHref(GUOKAO_ADMISSION_URL)}"`)
    expect(html.match(/<a /g)?.length).toBe(1)
    expect(html).not.toContain('11 月 29 日 15:00')
  })

  it('11-22 预热期卡片仍是全句 + 打印入口（行为不变）', () => {
    const html = cardHtml(NOV_22_NOON_CST)
    expect(html).toContain('11 月 29 日 15:00 截止')
    expect(html).toContain('去打印准考证')
    expect(html).toContain('<a ')
    expect(html).toContain('多打两份备用')
  })

  it('条带形态不受 U-236 影响：开放期 strip 仍是短句 + 打印入口（首页无节点行可去重）', () => {
    const html = renderToString(
      createElement(GuokaoAdmissionReminder, {
        reminder: admissionReminderFor(guokao, NOV_23_NOON_CST),
        variant: 'strip',
      }),
    )
    expect(html).toContain('去打印准考证')
    expect(html).toContain('<a ')
  })
})
