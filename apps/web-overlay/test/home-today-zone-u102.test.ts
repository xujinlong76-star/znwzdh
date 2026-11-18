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
  GUOKAO_ADMISSION_URL,
  todayFollowUpNodes,
  todayNodes,
} from '../src/lib/exam-calendar'
import { HomeTodayZone } from '../src/components/home-today-zone'

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
