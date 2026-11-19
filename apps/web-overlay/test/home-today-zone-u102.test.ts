/**
 * U-102 今日提醒横幅（裁剪版）：渲染断言（A3 / A4 / A5 渲染部分 / A9）。
 *
 * 环境：仓库 vitest 是 node 环境、无 jsdom——用 react-dom/server 的
 * renderToString 做服务端渲染断言（不挂载，effect 不跑，正好对应 SSR 输出）。
 * HomeTodayZone 接可选 nowMs（只为测试注入 fake now；page.tsx 不传，
 * 默认 Date.now()）。DailyFocus / BriefResurface / 短剧榜首用桩隔离，
 * 只测今日行本身；next/link 替成直通 <a>，只保留 href / 文案。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import {
  examNodeDeadlineLabel,
  GUOKAO_ADMISSION_URL,
  todayFollowUpNodes,
  todayNodeDeadlineMs,
  todayNodes,
} from '../src/lib/exam-calendar'
import { formatRemaining } from '../src/components/home-today-countdown'
import { computeHomeTodayBadge } from '../src/lib/home-today-summary'
import { HomeTodayZone } from '../src/components/home-today-zone'
import { withEligibleVerificationFor } from './exam-verification-fixture'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

// next/link 在 node 测试环境没有 Next 运行时：替成直通 <a>，只保留 href/文案。
vi.mock('next/link', async () => {
  const React = await import('react')
  return {
    default: ({ href, children, ...props }: { href?: string; children?: React.ReactNode }) =>
      React.createElement(
        'a',
        { href: typeof href === 'string' ? href : '#', ...props },
        children,
      ),
  }
})

// 今日专注与今日重温是客户端岛：渲染期返回 null，只测今日行本身。
vi.mock('@/components/daily-focus', () => ({ default: () => null }))
vi.mock('@/app/brief/brief-resurface', () => ({ default: () => null }))
// 短剧榜首固定为空：卡片是否渲染只取决于倒计时与今日节点，不依赖榜单数据。
vi.mock('@/lib/drama-featured', () => ({ loadDramaFeatured: () => ({ dramas: [] }) }))

// mock-hygiene 守卫：跨模块 vi.mock 须带 vi.resetModules() 清理（isolate:false 下模块缓存会跨文件驻留）。
afterAll(() => {
  vi.resetModules()
})

/** 2026-11-18 08:00 北京时间（UTC 午夜）：成考三省查分日、京考报名与文职缴费末日 */
const NOV_18_0800_CST = Date.UTC(2026, 10, 18, 0, 0, 0)
/** 2026-11-24 08:00 北京时间：无今日节点（复核窗口进行中，但既非单日也非起止日） */
const NOV_24_0800_CST = Date.UTC(2026, 10, 24, 0, 0, 0)
/** 2026-12-21 08:00 北京时间：十一场全过，无今日节点、无倒计时 */
const DEC_21_0800_CST = Date.UTC(2026, 11, 21, 0, 0, 0)

const renderZone = (nowMs: number) =>
  renderToString(createElement(HomeTodayZone, { nowMs }))

/** renderToString 会转义引号与 &：断言原文前先还原，与源码逐字比对。 */
const unesc = (html: string) =>
  html.replaceAll('&quot;', '"').replaceAll('&#x27;', "'").replaceAll('&amp;', '&')

describe('A3：有今日节点时渲染今日行，7 项 label 与 detail 原文逐字出现', () => {
  it('11-18 今日行渲染：行标记与 7 项 label / detail 逐字在 SSR HTML 里', () => {
    const html = unesc(renderZone(NOV_18_0800_CST))
    expect(html).toContain('aria-label="今日节点"')
    expect(html).toContain('今日提醒')
    const items = todayNodes(NOV_18_0800_CST)
    expect(items).toHaveLength(7)
    for (const { node } of items) {
      expect(html).toContain(node.label)
      expect(html).toContain(node.detail)
    }
  })

  it('11-18 七项 label 即验收清单所列（江西/广东/新疆成绩查询 + 京考报名 + 文职缴费 + 江苏成绩查询 + 广东成绩查询（自考））', () => {
    const html = unesc(renderZone(NOV_18_0800_CST))
    for (const label of ['江西成绩查询', '广东成绩查询', '新疆成绩查询']) {
      expect(html).toContain(label)
    }
    expect(html).toContain('京考')
    expect(html).toContain('报名')
    expect(html).toContain('军队文职')
    expect(html).toContain('缴费')
    expect(html).toContain('江苏自考')
    expect(html).toContain('成绩查询')
    expect(html).toContain('11 月 18 日 10:00 起可查')
    expect(html).toContain('广东自考')
    expect(html).toContain('11 月 18 日 15:00 起可查')
  })

  it('无今日节点的日子整行不渲染、不挂空态占位（11-24 倒计时行仍在，12-21 整卡消失）', () => {
    const nov24 = renderZone(NOV_24_0800_CST)
    expect(nov24).not.toContain('aria-label="今日节点"')
    expect(nov24).not.toContain('今日提醒')
    expect(nov24).not.toContain('今日截止')
    expect(nov24).toContain('距国考 4 天')
    const dec21 = renderZone(DEC_21_0800_CST)
    expect(dec21).not.toContain('aria-label="今日节点"')
    expect(dec21).not.toContain('今日提醒')
    expect(dec21).not.toContain('今日截止')
  })
})

describe('A4：站内 CTA 只指 /exam，三省查分行无外链（U-155：有已核实 URL 的行挂直链）', () => {
  it('U-155：有已核实 URL 的今日行/接续行挂行内直链，href 集合即数据派生值', () => {
    const html = renderZone(NOV_18_0800_CST)
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1])
    // 期望集合从数据派生，不手写 URL：站内 CTA /exam、国考准考证直链
    // （倒计时行下一步），以及当日今日行/接续行里带 url 的节点。
    const expected = [
      '/exam',
      GUOKAO_ADMISSION_URL,
      ...todayNodes(NOV_18_0800_CST)
        .filter((t) => t.node.url)
        .map((t) => t.node.url!),
      ...todayFollowUpNodes(NOV_18_0800_CST)
        .filter((t) => t.node.url)
        .map((t) => t.node.url!),
    ]
    expect([...new Set(hrefs)].sort()).toEqual([...new Set(expected)].sort())
    expect(hrefs.filter((h) => h === '/exam')).toHaveLength(2)
  })

  it('三省查分行是纯文本：label 不在任何 <a> 内', () => {
    const html = renderZone(NOV_18_0800_CST)
    for (const label of ['江西成绩查询', '广东成绩查询', '新疆成绩查询']) {
      expect(html).not.toMatch(new RegExp(`<a[^>]*>[^<]*${label}`))
    }
  })

  it('今日行不写死任何 URL：源码无 http 字面量，CTA 只指 /exam', () => {
    const zone = read('src/components/home-today-zone.tsx')
    expect(zone).not.toContain('http')
    expect(zone).toContain('href="/exam"')
  })
})

describe('A5 渲染：今日行展开区展示接续节点（文职 / 京考，取自节点数据）', () => {
  it('11-18 接续区含文职准考证 + 笔试、京考准考证 + 公共科目，label 与 detail 原文逐字出现', () => {
    const html = unesc(renderZone(NOV_18_0800_CST))
    expect(html).toContain('接续安排')
    const ups = todayFollowUpNodes(NOV_18_0800_CST)
    for (const { node } of ups) {
      expect(html).toContain(node.label)
      expect(html).toContain(node.detail)
    }
    expect(html).toContain('12 月 7 日 9:00 至 12 月 13 日 14:00')
    expect(html).toContain('12 月 1 日 9:00 至 12 月 6 日 16:30')
  })

  it('「京考缴费 11-21–23」不出现', () => {
    const html = unesc(renderZone(NOV_18_0800_CST))
    expect(html).not.toContain('京考缴费')
  })
})

describe('A9：文案无时刻级状态断言，末日节点只写「今日截止」', () => {
  it('11-18 渲染文案不出现「已可查 / 未开始 / 已截止 / 已结束」', () => {
    const html = renderZone(NOV_18_0800_CST)
    for (const banned of ['已可查', '未开始', '已截止', '已结束']) {
      expect(html).not.toContain(banned)
    }
  })

  it('11-18 两个窗口末日节点各写一个「今日截止」，时点只以节点 detail 原文呈现', () => {
    const html = renderZone(NOV_18_0800_CST)
    expect(html.match(/今日截止/g)?.length).toBe(2)
    expect(html).toContain('11 月 18 日 18:00')
  })

  it('今日区源码同样不含时刻级状态断言', () => {
    const zone = read('src/components/home-today-zone.tsx')
    for (const banned of ['已可查', '未开始', '已截止', '已结束']) {
      expect(zone).not.toContain(banned)
    }
  })
})

describe('U-136：startsToday 行补「今日开始」徽章（徽章 only，不补 chip）', () => {
  /** 2026-11-19 08:00 北京时间：两窗口均未开 */
  const NOV_19_0800_CST = Date.UTC(2026, 10, 19, 0, 0, 0)
  /** 2026-11-19 10:30 北京时间：两窗口均已开 */
  const NOV_19_1030_CST = Date.UTC(2026, 10, 19, 2, 30, 0)
  /** 2026-11-19 18:30 北京时间：18:00 门控已过 */
  const NOV_19_1830_CST = Date.UTC(2026, 10, 19, 10, 30, 0)
  /** 2026-11-20 08:00 北京时间：江西复核末日、上海复核首日 */
  const NOV_20_0800_CST = Date.UTC(2026, 10, 20, 0, 0, 0)
  /** 2026-11-20 17:30 北京时间：江西复核 17:00 截止后半小时 */
  const NOV_20_1730_CST = Date.UTC(2026, 10, 20, 9, 30, 0)

  /** 取含指定 label 的 <li> 块（今日节点行内无嵌套 <li>，非贪婪匹配即整行）。 */
  const liFor = (html: string, label: string): string => {
    const blocks = [...html.matchAll(/<li[\s\S]*?<\/li>/g)].map((m) => m[0])
    const hit = blocks.find((b) => b.includes(label))
    expect(hit).toBeDefined()
    return hit!
  }

  it('11-19 08:00：上海行有 emerald「今日开始」徽章，海南行（today）无徽章、无 chip，天津行（today，U-162）无「今日开始」徽章、有倒计时 chip、旁标「转载」（F1b reprint 已准入）；全页无「今日截止」', () => {
    const items = todayNodes(NOV_19_0800_CST)
    expect(items).toHaveLength(3)
    const html = unesc(renderZone(NOV_19_0800_CST))
    // U-164 之后 11-19 今日行构成变：海南成绩查询（today）+ 上海自考成绩查询（startsToday）；
    // U-162 再加天津成绩复核（today）；江西成绩复核退接续区。
    // 徽章只覆盖 startsToday 行，故「今日开始」恰好 1 个（上海行）。
    expect(html.match(/今日开始/g)?.length).toBe(1)
    expect(html).not.toContain('今日截止')
    const hn = liFor(html, '成考 · 海南成绩查询')
    expect(hn).not.toContain('今日开始')
    expect(hn).not.toContain('bg-emerald-500/10')
    expect(hn).not.toContain('role="timer"')
    expect(hn).toContain('待核实')
    expect(hn).toContain('11 月 19 日 17:00 起可查')
    // U-162：天津行 kind today、无「今日开始」徽章；F1b 已核实 reprint，PEAK 表 18:00 已准入、有 chip、chip 旁标「转载」小字
    const tj = liFor(html, '成考 · 天津成绩复核')
    expect(tj).not.toContain('今日开始')
    expect(tj).not.toContain('bg-emerald-500/10')
    expect(tj).toContain('role="timer"')
    expect(tj).toContain('转载')
    expect(tj).not.toContain('待核实')
    expect(tj).toContain('11 月 19 日 9:00 至 18:00 网上申请缴费')
    const sh = liFor(html, '上海自考 · 成绩查询')
    expect(sh).toContain('今日开始')
    expect(sh).toContain('bg-emerald-500/10')
    expect(sh).toContain('text-emerald-700')
    expect(sh).not.toContain('role="timer"')
    expect(sh).toContain('待核实')
    // 接续区内的江西复核行无徽章：接续区 <li> 只有 TodayNodeLabel + detail，无徽章分支（代码核实）
    const jxFollowUp = liFor(html, '成考 · 江西成绩复核')
    expect(jxFollowUp).not.toContain('今日开始')
    expect(jxFollowUp).not.toContain('bg-emerald-500/10')
  })

  it('11-19 10:30（上海窗口已开、海南 17:00 未到）：上海徽章不变，海南行仍无徽章、无「已截止」，天津行有倒计时 chip、旁标「转载」', () => {
    const html = unesc(renderZone(NOV_19_1030_CST))
    expect(html.match(/今日开始/g)?.length).toBe(1)
    expect(html).not.toContain('今日截止')
    expect(html).not.toContain('已截止')
    expect(liFor(html, '上海自考 · 成绩查询')).toContain('今日开始')
    expect(liFor(html, '成考 · 海南成绩查询')).not.toContain('今日开始')
    // U-162：天津行已核实 reprint（F1b），18:00 未到挂倒计时 chip，旁标「转载」小字
    expect(liFor(html, '成考 · 天津成绩复核')).toContain('role="timer"')
    expect(liFor(html, '成考 · 天津成绩复核')).toContain('转载')
    expect(liFor(html, '成考 · 天津成绩复核')).not.toContain('待核实')
  })

  it('11-19 18:30（海南 17:00、天津 18:00 均已过）：上海徽章仍在，海南行无 chip、天津行 chip 已过期消失（hideWhenPassed）旁标「转载」，无「已截止」；角标只计准入节点、天津已准入故 todayCount 与 urgentCount 均为 1（§7.2，F1b）', () => {
    const html = unesc(renderZone(NOV_19_1830_CST))
    expect(html.match(/今日开始/g)?.length).toBe(1)
    expect(html).not.toContain('今日截止')
    expect(html).not.toContain('已截止')
    expect(liFor(html, '上海自考 · 成绩查询')).toContain('今日开始')
    const hn = liFor(html, '成考 · 海南成绩查询')
    expect(hn).not.toContain('今日开始')
    expect(hn).not.toContain('role="timer"')
    // U-162：天津行已核实 reprint（F1b），SSR 占位 chip 仍在（hideWhenPassed 只在挂载后
    // 生效，见 countdown 文件头）、不显示「已截止」，旁标「转载」小字
    const tj = liFor(html, '成考 · 天津成绩复核')
    expect(tj).not.toContain('今日开始')
    expect(tj).toContain('role="timer"')
    expect(tj).not.toContain('已截止')
    expect(tj).toContain('转载')
    expect(tj).not.toContain('待核实')
    const countdown = read('src/components/home-today-countdown.tsx')
    expect(countdown).toContain('if (hideWhenPassed && targetMs <= nowMs) return null')
    const zone = read('src/components/home-today-zone.tsx')
    expect(zone).toContain("kind === 'today' ? { hideWhenPassed: true }")
    // 11-19 三行今日节点中仅天津已核实，角标只计准入节点（§7.2）：todayCount 1、urgentCount 1。
    const badge = computeHomeTodayBadge(NOV_19_1830_CST)
    expect(badge.todayCount).toBe(1)
    expect(badge.urgentCount).toBe(1)
  })

  it('11-20 回归：江西行变 amber「今日截止」但无 chip、标「待核实」（§7.2 未核实），上海复核行新入今日行带「今日开始」无 chip，山西复核行末日入今日行带「今日截止」无 chip', () => {
    const items = todayNodes(NOV_20_0800_CST)
    expect(items).toHaveLength(6)
    const html = unesc(renderZone(NOV_20_0800_CST))
    const jx = liFor(html, '成考 · 江西成绩复核')
    expect(jx).toContain('今日截止')
    expect(jx).toContain('bg-amber-500/10')
    expect(jx).not.toContain('role="timer"')
    expect(jx).toContain('待核实')
    const shReview = liFor(html, '上海自考 · 成绩复核')
    expect(shReview).toContain('今日开始')
    expect(shReview).toContain('bg-emerald-500/10')
    expect(shReview).not.toContain('role="timer"')
    // U-160：山西复核末日 endsToday 入今日行，amber「今日截止」徽章由 kind 驱动仍显示，
    // 无 PEAK 表项故无倒计时 chip
    const sxReview = liFor(html, '成考 · 山西成绩复核')
    expect(sxReview).toContain('今日截止')
    expect(sxReview).toContain('bg-amber-500/10')
    expect(sxReview).not.toContain('role="timer"')
  })

  it('11-20 17:30：江西真实节点未核实、helper 恒为 null（§7.2）；eligible 包装对照 chip 读「已截止」（helper 层；SSR 只出「倒计时」占位，不直接断言 SSR 文案）', () => {
    const chengkao = todayNodes(NOV_20_1730_CST).find((t) => t.exam.id === 'chengkao')!.exam
    const jxReview = chengkao.nodes.find((n) => n.label === '江西成绩复核')!
    expect(todayNodeDeadlineMs({ exam: chengkao, node: jxReview, kind: 'endsToday' })).toBeUndefined()
    expect(examNodeDeadlineLabel(chengkao, jxReview, NOV_20_1730_CST)).toBeNull()
    // 对照：PEAK 表项仍在，eligible 包装返回 11-20 17:00，helper 读「已截止」。
    const eligible = withEligibleVerificationFor('chengkao', jxReview)
    expect(todayNodeDeadlineMs({ exam: chengkao, node: eligible, kind: 'endsToday' })).toBe(
      Date.UTC(2026, 10, 20, 9, 0, 0),
    )
    expect(formatRemaining(Date.UTC(2026, 10, 20, 9, 0, 0), NOV_20_1730_CST)).toBe('已截止')
    expect(examNodeDeadlineLabel(chengkao, eligible, NOV_20_1730_CST)).toBe('已截止')
  })

  it('390px 不溢出（类守卫，SSR + 源码双重）：徽章 shrink-0、chip whitespace-nowrap、li flex-wrap、detail basis-full', () => {
    const zone = read('src/components/home-today-zone.tsx')
    expect(zone).toContain('shrink-0 rounded-full bg-emerald-500/10')
    expect(zone).toContain('className="flex flex-wrap items-baseline gap-x-2 text-sm"')
    expect(zone).toContain('min-w-0 flex-1 basis-full text-muted-foreground')
    const countdown = read('src/components/home-today-countdown.tsx')
    expect(countdown).toContain('whitespace-nowrap')
    const html = unesc(renderZone(NOV_19_0800_CST))
    expect(html).toContain('bg-emerald-500/10')
  })
})

describe('今日行接线守卫（U-102）', () => {
  const zone = read('src/components/home-today-zone.tsx')

  it('今日行读 todayNodes / todayFollowUpNodes，不写死日期与考试 id', () => {
    expect(zone).toContain('todayNodes(nowMs)')
    expect(zone).toContain('todayFollowUpNodes(nowMs)')
    expect(zone).toContain('aria-label="今日节点"')
    expect(zone).not.toContain('2026-11-')
    expect(zone).not.toContain('2026-12-')
    expect(zone).not.toContain("'jingkao'")
    expect(zone).not.toContain("'jundui-wenzhi'")
    expect(zone).not.toContain("'chengkao'")
  })

  it('今日行无今日节点时整行不渲染：条件守卫 todayItems.length > 0', () => {
    expect(zone).toContain('todayItems.length > 0')
  })
})
