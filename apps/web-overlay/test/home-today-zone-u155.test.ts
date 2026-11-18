/**
 * U-155 首页今日行挂行内直达链接：渲染断言。
 *
 * 环境与桩同 home-today-zone-u102.test.ts（node 环境 renderToString，
 * next/link 替成直通 <a>，DailyFocus / BriefResurface / 短剧桩隔离，
 * 只测今日行与接续区本身）。
 *
 * 口径：只有节点数据里带已核实官方 url 的行才出 <a>（U-31 配方）；
 * 查分行与邮箱/线下复核行永远纯文本，不编链接。URL 取自节点数据，
 * 不在今日区源码里写死。
 */
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import {
  GUOKAO_ADMISSION_URL,
  JIANGXI_CHENGKAO_REVIEW_URL,
  todayFollowUpNodes,
  todayNodes,
} from '../src/lib/exam-calendar'
import { HomeTodayZone } from '../src/components/home-today-zone'

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

/** 2026-11-18 08:00 北京时间：今日行 7 项，其中 2 项带 url（京考报名、广东自考成绩查询） */
const NOV_18_0800_CST = Date.UTC(2026, 10, 18, 0, 0, 0)
/** 2026-11-19 08:00 北京时间：今日行海南成绩查询 + 上海自考成绩查询 2 项，江西成绩复核退接续区 */
const NOV_19_0800_CST = Date.UTC(2026, 10, 19, 0, 0, 0)
/** 2026-11-19 09:30 北京时间：江西复核开窗后半小时 */
const NOV_19_0930_CST = Date.UTC(2026, 10, 19, 1, 30, 0)

const renderZone = (nowMs: number) =>
  renderToString(createElement(HomeTodayZone, { nowMs }))

/** renderToString 会转义引号与 &：断言原文前先还原，与源码逐字比对。 */
const unesc = (html: string) =>
  html.replaceAll('&quot;', '"').replaceAll('&#x27;', "'").replaceAll('&amp;', '&')

/** 该行 label 不在任何 <a> 内（纯文本行断言，与 u102 的 A4 同配方）。
 *  用「考试简称 · 节点 label」全串比对，避免「成绩查询」这类同名 label
 *  在另一行链接里撞上（11-18：江苏自考成绩查询是纯文本，广东自考成绩查询是链接）。 */
const expectPlainTextRow = (html: string, displayLabel: string) => {
  expect(html).not.toMatch(new RegExp(`<a[^>]*>[^<]*${displayLabel}`))
}

describe('U-155：11-19 今日行 2 项（海南成绩查询纯文本 + 上海自考成绩查询纯文本），江西成绩复核退接续区（带官方 URL）', () => {
  it('todayNodes(11-19 08:00) 长度 2：成考·海南成绩查询（today，纯文本）+ 上海自考·成绩查询（startsToday，无 url）', () => {
    const items = todayNodes(NOV_19_0800_CST)
    expect(items).toHaveLength(2)
    const byKey = new Map(items.map((i) => [`${i.exam.id}:${i.node.label}`, i]))
    const hainan = byKey.get('chengkao:海南成绩查询')!
    expect(hainan.exam.shortName).toBe('成考')
    expect(hainan.kind).toBe('today')
    expect(hainan.node.url).toBeUndefined()
    expect(hainan.node.detail).toBe('11 月 19 日 17:00 起可查（海南省成人高考报名系统）')
    const shanghai = byKey.get('shanghai-zikao:成绩查询')!
    expect(shanghai.exam.shortName).toBe('上海自考')
    expect(shanghai.kind).toBe('startsToday')
    expect(shanghai.node.url).toBeUndefined()
    // 江西成绩复核退出今日行、退入接续区，链接随之移动
    const jxFollowUp = todayFollowUpNodes(NOV_19_0800_CST).find(
      (t) => t.exam.id === 'chengkao' && t.node.label === '江西成绩复核',
    )!
    expect(jxFollowUp.node.url).toBe(JIANGXI_CHENGKAO_REVIEW_URL)
  })

  it('11-19 09:30 渲染：复核行直达链接已移入「接续安排」区（href 含末尾斜杠），海南行是纯文本', () => {
    const html = unesc(renderZone(NOV_19_0930_CST))
    // 江西复核链接仍渲染，但位置在接续区（「接续安排」之后），不在今日行内
    const followUpAt = html.indexOf('接续安排')
    expect(followUpAt).toBeGreaterThan(-1)
    expect(html.indexOf('<a href="https://jdyw.jxeea.cn/"')).toBeGreaterThan(followUpAt)
    expect(html.slice(0, followUpAt)).not.toContain('江西成绩复核')
    expect(html).toContain('成考 · 江西成绩复核')
    expect(html).toContain('aria-label="江西成绩复核官方入口（新窗口打开）"')
    expect(html).toContain('target="_blank"')
    // 海南行无 url，是纯文本
    expectPlainTextRow(html, '成考 · 海南成绩查询')
  })

  it('11-19 href 集合：/exam、国考准考证直链、江西复核直链，别无其他', () => {
    const html = renderZone(NOV_19_0930_CST)
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1])
    expect([...new Set(hrefs)].sort()).toEqual(
      ['/exam', GUOKAO_ADMISSION_URL, JIANGXI_CHENGKAO_REVIEW_URL].sort(),
    )
    expect(hrefs.filter((h) => h === '/exam')).toHaveLength(2)
  })

  it('11-19 接续区 6 项：除江西成绩复核（带官方 URL）外其余 5 项均无 URL', () => {
    const ups = todayFollowUpNodes(NOV_19_0800_CST)
    expect(ups).toHaveLength(6)
    for (const { node } of ups.filter((u) => u.node.label !== '江西成绩复核')) {
      expect(node.url).toBeUndefined()
    }
    expect(ups.find((u) => u.node.label === '江西成绩复核')?.node.url).toBe(
      JIANGXI_CHENGKAO_REVIEW_URL,
    )
    const html = unesc(renderZone(NOV_19_0930_CST))
    expect(html).toContain('接续安排')
    for (const { exam, node } of ups.filter((u) => u.node.label !== '江西成绩复核')) {
      expectPlainTextRow(html, `${exam.shortName} · ${node.label}`)
    }
    // 江西复核行是链接，不是纯文本
    expect(html).toContain('<a href="https://jdyw.jxeea.cn/"')
  })
})

describe('U-155：11-18 有 URL 的行挂链、无 URL 的行仍是纯文本', () => {
  it('带 url 的两行（京考报名、广东自考成绩查询）出直达链接，URL 取自节点数据', () => {
    const html = renderZone(NOV_18_0800_CST)
    const linked = todayNodes(NOV_18_0800_CST).filter((t) => t.node.url)
    expect(linked).toHaveLength(2)
    for (const { node } of linked) {
      expect(html).toContain(`<a href="${node.url}"`)
    }
  })

  it('无 url 的 5 行（成考三省查分、文职缴费、江苏自考成绩查询）仍是纯文本', () => {
    const html = unesc(renderZone(NOV_18_0800_CST))
    const plain = todayNodes(NOV_18_0800_CST).filter((t) => !t.node.url)
    expect(plain).toHaveLength(5)
    for (const { exam, node } of plain) {
      expectPlainTextRow(html, `${exam.shortName} · ${node.label}`)
    }
  })

  it('11-18 接续区带 url 的行挂链、无 url 的行纯文本', () => {
    const html = renderZone(NOV_18_0800_CST)
    const ups = todayFollowUpNodes(NOV_18_0800_CST)
    const linked = ups.filter((t) => t.node.url)
    expect(linked.length).toBeGreaterThan(0)
    for (const { node } of linked) {
      expect(html).toContain(`<a href="${node.url}"`)
    }
    for (const { exam, node } of ups.filter((t) => !t.node.url)) {
      expectPlainTextRow(html, `${exam.shortName} · ${node.label}`)
    }
  })
})
