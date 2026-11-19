/**
 * U-234：今日行按目标时刻排序（todayNodes 返回前按 todayNodeTargetMs 升序）。
 *  - 有 PEAK 表项按表内时刻；无表项按 detail 里当天已核实时刻；仍无时刻的沉底保原序；
 *  - startsToday 不再无条件沉底；同刻保持原相对次序；入选口径与项数不变。
 */
import { describe, expect, it } from 'vitest'
import {
  EXAMS,
  todayNodeTargetMs,
  todayNodes,
  type ExamInfo,
  type TodayNodeItem,
} from '../src/lib/exam-calendar'

/** 2026-11-18 / 11-19 / 11-20 08:00 北京时间（UTC 午夜） */
const NOV_18_0800_CST = Date.UTC(2026, 10, 18, 0, 0, 0)
const NOV_19_0800_CST = Date.UTC(2026, 10, 19, 0, 0, 0)
const NOV_20_0800_CST = Date.UTC(2026, 10, 20, 0, 0, 0)

const key = (t: TodayNodeItem) => `${t.exam.id}:${t.node.label}`

describe('U-234：11-18 今日行按时刻升序（PEAK 表时刻）', () => {
  it('7 项顺序为江西 09:00 → 江苏 10:00 → 新疆 12:00 → 广东自考 15:00 → 广东成考 16:20 → 文职/京考 18:00 同刻保原序', () => {
    const items = todayNodes(NOV_18_0800_CST)
    expect(items.map(key)).toEqual([
      'chengkao:江西成绩查询',
      'jiangsu-zikao:成绩查询',
      'chengkao:新疆成绩查询',
      'guangdong-zikao:成绩查询',
      'chengkao:广东成绩查询',
      'jundui-wenzhi:缴费',
      'jingkao:报名',
    ])
    expect(items.map((t) => todayNodeTargetMs(t, NOV_18_0800_CST))).toEqual([
      Date.UTC(2026, 10, 18, 1, 0, 0),
      Date.UTC(2026, 10, 18, 2, 0, 0),
      Date.UTC(2026, 10, 18, 4, 0, 0),
      Date.UTC(2026, 10, 18, 7, 0, 0),
      Date.UTC(2026, 10, 18, 8, 20, 0),
      Date.UTC(2026, 10, 18, 10, 0, 0),
      Date.UTC(2026, 10, 18, 10, 0, 0),
    ])
  })
})

describe('U-234：11-19 今日行按时刻升序（startsToday 不再沉底）', () => {
  it('3 项顺序为上海自考 10:00（detail 开通时刻）→ 海南 17:00（detail 公布时刻）→ 天津 18:00（PEAK 表）', () => {
    const items = todayNodes(NOV_19_0800_CST)
    expect(items.map(key)).toEqual([
      'shanghai-zikao:成绩查询',
      'chengkao:海南成绩查询',
      'chengkao:天津成绩复核',
    ])
    expect(items.map((t) => todayNodeTargetMs(t, NOV_19_0800_CST))).toEqual([
      Date.UTC(2026, 10, 19, 2, 0, 0),
      Date.UTC(2026, 10, 19, 9, 0, 0),
      Date.UTC(2026, 10, 19, 10, 0, 0),
    ])
  })

  it('排序键来源：天津取 PEAK 表，海南与上海取 detail 当天时刻', () => {
    const items = todayNodes(NOV_19_0800_CST)
    const byKey = new Map(items.map((t) => [key(t), t] as const))
    // 天津 18:00 在 PEAK 表内；海南 17:00 / 上海 10:00 不在表内、取自 detail 原文。
    expect(todayNodeTargetMs(byKey.get('chengkao:天津成绩复核')!, NOV_19_0800_CST)).toBe(
      Date.UTC(2026, 10, 19, 10, 0, 0),
    )
    expect(byKey.get('chengkao:海南成绩查询')!.node.detail).toContain('11 月 19 日 17:00')
    expect(byKey.get('shanghai-zikao:成绩查询')!.node.detail).toContain('11 月 19 日 10:00')
  })
})

describe('U-234：11-20 今日行按时刻升序（无时刻的沉底保原序）', () => {
  it('6 项顺序为新疆复核 12:00 → 广东复核 15:00 → 江西/江苏复核 17:00 同刻保原序 → 山西复核与上海复核（无当天时刻）沉底保原序', () => {
    const items = todayNodes(NOV_20_0800_CST)
    expect(items.map(key)).toEqual([
      'chengkao:新疆成绩复核',
      'chengkao:广东成绩复核',
      'chengkao:江西成绩复核',
      'jiangsu-zikao:成绩复核',
      'chengkao:山西成绩复核',
      'shanghai-zikao:成绩复核',
    ])
    const targets = items.map((t) => todayNodeTargetMs(t, NOV_20_0800_CST))
    expect(targets.slice(0, 4)).toEqual([
      Date.UTC(2026, 10, 20, 4, 0, 0),
      Date.UTC(2026, 10, 20, 7, 0, 0),
      Date.UTC(2026, 10, 20, 9, 0, 0),
      Date.UTC(2026, 10, 20, 9, 0, 0),
    ])
    expect(targets.slice(4)).toEqual([undefined, undefined])
  })
})

describe('U-234：合成数据——排序只看目标时刻，不看 kind 与原序', () => {
  function exam(
    id: string,
    nodes: Array<{ label: string; detail: string; startISO: string; endISO: string }>,
  ): ExamInfo {
    return {
      id,
      name: id,
      shortName: id,
      tagline: '',
      examDateLabel: '11 月 19 日',
      startISO: '2026-11-19',
      endISO: '2026-11-19',
      nodes,
    }
  }

  it('startsToday 早时刻排在 today 晚时刻之前；无时刻的沉底；同刻保原序', () => {
    const exams = [
      exam('a', [{ label: '晚', detail: '11 月 19 日 20:00 公布', startISO: '2026-11-19', endISO: '2026-11-19' }]),
      exam('b', [{ label: '早', detail: '11 月 19 日 9:00 起可查', startISO: '2026-11-19', endISO: '2026-11-21' }]),
      exam('c', [{ label: '无时刻', detail: '详见公告', startISO: '2026-11-19', endISO: '2026-11-19' }]),
      exam('d', [{ label: '同刻后', detail: '11 月 19 日 9:00 开始', startISO: '2026-11-19', endISO: '2026-11-19' }]),
    ]
    const items = todayNodes(NOV_19_0800_CST, exams)
    // 同刻 09:00 保原相对次序：原序是第一遍直接节点（a、d）在前、第二遍
    // startsToday（b）在后，故 d 在 b 前；无时刻的 c 沉底。
    expect(items.map((t) => `${t.exam.id}:${t.node.label}`)).toEqual([
      'd:同刻后',
      'b:早',
      'a:晚',
      'c:无时刻',
    ])
  })

  it('detail 里只有别日时刻的不取：不把他日时刻当成当天目标时刻', () => {
    const exams = [
      exam('a', [{ label: '他日', detail: '11 月 20 日 17:00 截止', startISO: '2026-11-19', endISO: '2026-11-19' }]),
      exam('b', [{ label: '当天', detail: '11 月 19 日 12:00 公布', startISO: '2026-11-19', endISO: '2026-11-19' }]),
    ]
    const items = todayNodes(NOV_19_0800_CST, exams)
    expect(items.map((t) => `${t.exam.id}:${t.node.label}`)).toEqual(['b:当天', 'a:他日'])
    expect(todayNodeTargetMs(items[1], NOV_19_0800_CST)).toBeUndefined()
  })
})

describe('U-234：排序不改入选（项数与 kind 与旧口径一致）', () => {
  it('11-18 7 项、11-19 3 项、11-20 6 项；EXAMS 本身未动', () => {
    expect(todayNodes(NOV_18_0800_CST)).toHaveLength(7)
    expect(todayNodes(NOV_19_0800_CST)).toHaveLength(3)
    expect(todayNodes(NOV_20_0800_CST)).toHaveLength(6)
    expect(EXAMS).toHaveLength(11)
  })
})
