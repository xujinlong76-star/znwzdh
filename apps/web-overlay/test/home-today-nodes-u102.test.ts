/**
 * U-102 今日提醒横幅（裁剪版）：纯函数层测试（A1 / A2 / A5 纯函数部分 / A6）。
 *
 * todayNodes 的判定口径（实际三段口径：单日 `today` + 窗口末日 `endsToday`
 * + 窗口首日 `startsToday`，仅当本场当天无更直接今日节点时）：
 *  - 单日节点当天（kind `today`）：examNodeStatus === 'today'；
 *  - 多日窗口末日当天（kind `endsToday`）：status 为 active 且 endISO 就是今天（「今日截止」，
 *    如京考报名、文职缴费在 11-18）——只按自然日判，不新造时刻门控；
 *  - 多日窗口首日当天（kind `startsToday`）：status 为 active 且 startISO 就是今天，但只在
 *    本场考试当天没有更直接的今日节点（today / endsToday）时才收录
 *    （如江西成绩复核在 11-19；新疆成绩复核在 11-18 不收——成考当天
 *    已有三省查询三个今日节点，复核进接续区，不抢今日行）；
 *  - estimated 节点永不进今日集合（A2）。
 * 抑制规则（startsToday 仅当本场无 today / endsToday 时收录）是 11-18「恰好 5 项」的
 * 承重条件：若无该抑制，新疆成绩复核会在 11-18 多收 1 项，变成 6 项。
 * 11-18 恰好 5 项，11-19 只剩江西成绩复核 1 项，11-20 不含浙江成绩查询。
 * 接续节点（A5）与今日节点都取自节点数据，不写死日期、不新造节点。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  EXAMS,
  todayFollowUpNodes,
  todayNodes,
} from '../src/lib/exam-calendar'
import {
  EMPTY_MY_EXAMS,
  toggleFollow,
  toggleNodeCheck,
  type MyExamsState,
} from '../src/lib/my-exams'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

/** 2026-11-18 08:00 北京时间（UTC 午夜）：成考三省查分日、京考报名与文职缴费末日 */
const NOV_18_0800_CST = Date.UTC(2026, 10, 18, 0, 0, 0)
/** 2026-11-19 08:00 北京时间：江西成绩复核首日 */
const NOV_19_0800_CST = Date.UTC(2026, 10, 19, 0, 0, 0)
/** 2026-11-20 08:00 北京时间：浙江成绩查询预计日、广东成绩复核日 */
const NOV_20_0800_CST = Date.UTC(2026, 10, 20, 0, 0, 0)
/** 2026-11-25 08:00 北京时间：浙江成绩查询预计日已过，仍是 estimated */
const NOV_25_0800_CST = Date.UTC(2026, 10, 25, 0, 0, 0)

const labels = (items: { node: { label: string } }[]) => items.map((i) => i.node.label)

describe('A1：todayNodes（11-18 恰好 5 项，11-19 只剩江西成绩复核）', () => {
  it('11-18 返回恰好 5 项：三省成绩查询 + 京考报名 + 文职缴费', () => {
    const items = todayNodes(NOV_18_0800_CST)
    expect(items).toHaveLength(5)
    expect([...labels(items)].sort()).toEqual(
      ['江西成绩查询', '广东成绩查询', '新疆成绩查询', '报名', '缴费'].sort(),
    )
    const byLabel = new Map(items.map((i) => [i.node.label, i]))
    expect(byLabel.get('江西成绩查询')?.exam.id).toBe('chengkao')
    expect(byLabel.get('广东成绩查询')?.exam.id).toBe('chengkao')
    expect(byLabel.get('新疆成绩查询')?.exam.id).toBe('chengkao')
    expect(byLabel.get('报名')?.exam.id).toBe('jingkao')
    expect(byLabel.get('缴费')?.exam.id).toBe('jundui-wenzhi')
  })

  it('11-18 三省查询是单日 today，京考报名与文职缴费是窗口末日 endsToday', () => {
    const items = todayNodes(NOV_18_0800_CST)
    const byLabel = new Map(items.map((i) => [i.node.label, i]))
    expect(byLabel.get('江西成绩查询')?.kind).toBe('today')
    expect(byLabel.get('广东成绩查询')?.kind).toBe('today')
    expect(byLabel.get('新疆成绩查询')?.kind).toBe('today')
    expect(byLabel.get('报名')?.kind).toBe('endsToday')
    expect(byLabel.get('缴费')?.kind).toBe('endsToday')
  })

  it('11-18 新疆成绩复核不进今日行（成考当天已有三个今日节点，复核进接续区）', () => {
    expect(labels(todayNodes(NOV_18_0800_CST))).not.toContain('新疆成绩复核')
  })

  it('11-19 不再含 11-18 的 5 项，但含江西成绩复核（窗口首日 startsToday）', () => {
    const items = todayNodes(NOV_19_0800_CST)
    expect(items).toHaveLength(1)
    expect(labels(items)).toEqual(['江西成绩复核'])
    expect(items[0]?.exam.id).toBe('chengkao')
    expect(items[0]?.kind).toBe('startsToday')
    for (const gone of ['江西成绩查询', '广东成绩查询', '新疆成绩查询', '报名', '缴费']) {
      expect(labels(items)).not.toContain(gone)
    }
  })

  it('今日节点只复用 examNodeStatus 的日期口径，不新造时刻门控函数、不给 ExamNode 加时刻字段', () => {
    expect(todayNodes.toString()).not.toContain('getHours')
    expect(todayNodes.toString()).not.toContain('getMinutes')
    expect(todayNodes.toString()).not.toContain('18:00')
    expect(todayFollowUpNodes.toString()).not.toContain('getHours')
    // exam-calendar.ts:454-456 一带「不新造时刻门控函数」的决策原样保留
    expect(read('src/lib/exam-calendar.ts')).toContain('不新造时刻门控函数')
    const iface = read('src/lib/exam-calendar.ts').split('export interface ExamNode {')[1]!
    const ifaceBody = iface.split('\n}')[0]!
    expect(ifaceBody).toContain('label: string')
    expect(ifaceBody).toContain('detail: string')
    expect(ifaceBody).toContain('startISO: string')
    expect(ifaceBody).toContain('endISO: string')
    expect(ifaceBody).toContain('estimated?: boolean')
    expect(ifaceBody).not.toMatch(/hour|minute|deadline|cutoff/i)
  })
})

describe('A2：estimated 节点永不进今日集合', () => {
  it('浙江成绩查询 estimated:true，11-18 / 11-19 / 11-20 / 11-25 哪天都不出现', () => {
    for (const now of [NOV_18_0800_CST, NOV_19_0800_CST, NOV_20_0800_CST, NOV_25_0800_CST]) {
      expect(labels(todayNodes(now))).not.toContain('浙江成绩查询')
    }
    const zhejiang = EXAMS.find((e) => e.id === 'chengkao')!.nodes.find(
      (n) => n.label === '浙江成绩查询',
    )!
    expect(zhejiang.estimated).toBe(true)
  })

  it('11-20 今日集合只有广东复核（单日）与两省复核（窗口末日），仍无浙江查询', () => {
    const items = todayNodes(NOV_20_0800_CST)
    expect([...labels(items)].sort()).toEqual(['广东成绩复核', '江西成绩复核', '新疆成绩复核'].sort())
  })
})

describe('A5 纯函数：接续节点取自节点数据（文职 / 京考）', () => {
  it('11-18 文职接续恰好是准考证打印 + 全军统一笔试，京考接续恰好是准考证打印 + 公安 + 公共科目', () => {
    const ups = todayFollowUpNodes(NOV_18_0800_CST)
    const jundui = ups.filter((u) => u.exam.id === 'jundui-wenzhi')
    const jingkao = ups.filter((u) => u.exam.id === 'jingkao')
    expect(jundui.map((u) => u.node.label)).toEqual(['准考证打印', '全军统一笔试'])
    expect(jingkao.map((u) => u.node.label)).toEqual([
      '准考证打印',
      '公安专业科目笔试',
      '公共科目笔试',
    ])
  })

  it('接续节点 detail 原文即含接续日期（文职准考证 12-07–13 + 笔试 12-13、京考准考证 12-01–06 + 笔试 12-06）', () => {
    const ups = todayFollowUpNodes(NOV_18_0800_CST)
    const byKey = new Map(ups.map((u) => [`${u.exam.id}:${u.node.label}`, u.node]))
    expect(byKey.get('jundui-wenzhi:准考证打印')?.detail).toContain('12 月 7 日 9:00 至 12 月 13 日 14:00')
    expect(byKey.get('jundui-wenzhi:全军统一笔试')?.detail).toContain('12 月 13 日')
    expect(byKey.get('jingkao:准考证打印')?.detail).toContain('12 月 1 日 9:00 至 12 月 6 日 16:30')
    expect(byKey.get('jingkao:公共科目笔试')?.detail).toContain('12 月 6 日')
  })

  it('「京考缴费 11-21–23」不出现：京考接续里没有缴费节点，全部接续节点都是 EXAMS 数据原节点', () => {
    const ups = todayFollowUpNodes(NOV_18_0800_CST)
    expect(ups.filter((u) => u.exam.id === 'jingkao').map((u) => u.node.label)).not.toContain('缴费')
    const dataNodes = new Set(EXAMS.flatMap((e) => e.nodes))
    for (const u of ups) expect(dataNodes.has(u.node)).toBe(true)
  })

  it('成考接续含三省复核与浙江志愿确认，不含 estimated 的浙江成绩查询', () => {
    const ups = todayFollowUpNodes(NOV_18_0800_CST)
    const chengkao = ups.filter((u) => u.exam.id === 'chengkao').map((u) => u.node.label)
    expect(chengkao).toEqual(['新疆成绩复核', '江西成绩复核', '广东成绩复核', '浙江志愿确认'])
  })
})

describe('A6：U-106 回归（11-18 成考可关注、可勾选三省查分）', () => {
  it('11-18 未关注成考可关注：统考已结束但三省查分节点当天仍可办', () => {
    const on = toggleFollow(EMPTY_MY_EXAMS, 'chengkao', NOV_18_0800_CST)
    expect(on.followed).toEqual(['chengkao'])
  })

  it('关注后三省查分节点逐个可勾选', () => {
    let state: MyExamsState = { followed: ['chengkao'], checked: {} }
    for (const label of ['江西成绩查询', '广东成绩查询', '新疆成绩查询']) {
      state = toggleNodeCheck(state, 'chengkao', label, NOV_18_0800_CST)
    }
    expect(state.checked).toEqual({
      chengkao: ['江西成绩查询', '广东成绩查询', '新疆成绩查询'],
    })
  })

  it('跟踪岛 disabled 口径原样不动（按钮与复选框两处，见 my-exam-tracker.tsx:79,104）', () => {
    const island = read('src/app/exam/my-exam-tracker.tsx')
    expect(island).toContain(
      'disabled={storageBlocked !== null || (ended && !hasPendingNodes && !followed)}',
    )
    expect(island).toContain('disabled={ended && !hasPendingNodes}')
  })
})

describe('A7 源码守卫：不新增第三条带，page.tsx 挂载不动', () => {
  const page = read('src/app/page.tsx')

  it('首页考试面仍为两处：HomeTodayZone 内新增行 + HomeExamStrip，不新增条带组件挂载', () => {
    expect(page.match(/<HomeTodayZone \/>/g)?.length).toBe(1)
    expect(page.match(/<HomeExamStrip \/>/g)?.length).toBe(1)
    expect(page).not.toContain('TodayBanner')
    expect(page).not.toContain('today-banner')
    expect(page).not.toContain('HomeTodayBanner')
  })

  it('page.tsx todaySlots 收纳原有四条内容，不额外在正文上方堆叠条带', () => {
    const slots = page.indexOf('todaySlots={{')
    const endSlots = page.indexOf('}}', slots)
    const block = page.slice(slots, endSlots)
    expect(block).toContain('<HomeTodayZone />')
    expect(block).toContain('<HomeBriefStrip />')
    expect(block).toContain('<HomeExamStrip />')
    expect(block).toContain('<HandoffCardWithCloud />')
    expect(block).toContain('<StreakBar />')
  })

  it('今日区不新增条带组件导出：只导出 HomeTodayZone 一个组件', () => {
    const zone = read('src/components/home-today-zone.tsx')
    expect(zone).toContain('export function HomeTodayZone')
    expect(zone.match(/export function /g)?.length).toBe(1)
  })
})
