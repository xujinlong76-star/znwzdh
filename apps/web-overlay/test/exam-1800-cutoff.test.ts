/**
 * 18:00 时刻门控（考试峰值日包 W5 测试先行 → W9 按最终设计对齐改写）：
 *
 * 最终设计（coordinator 裁决，2026-11-18）：不给 ExamNode 加时刻字段、
 * 不改 examNodeStatus、不改 todayNodes（W6 的 A1 守卫成立；todayNodes
 * 保持日期口径，18:30 仍 5 项）。时刻判定只在渲染层按表查：
 *  - 新增纯函数 todayNodeDeadlineMs(item: TodayNodeItem): number | undefined
 *    （放 src/lib/exam-calendar.ts），查表 key 为 `${exam.id}:${node.label}`，
 *    只覆盖 11-18 的 5 个已核实目标时刻：成考江西成绩查询 09:00、成考新疆
 *    成绩查询 12:00、成考广东成绩查询 16:20、京考报名 18:00、军队文职缴费
 *    18:00（均为北京时间 2026-11-18；shanghaiMidnightMs('2026-11-18') +
 *    小时数算毫秒）。守卫：节点日期须覆盖 2026-11-18（查 node.startISO /
 *    endISO），不以 label 裸匹配；其他节点一律 undefined。
 *  - 新增纯函数 examNodeDeadlineLabel(exam, node, nowMs = Date.now()):
 *    '已截止' | null，用同一张表取目标时刻，nowMs >= 目标时刻返回
 *    「已截止」，否则 null。调用方用
 *    `deadlineLabel ?? EXAM_NODE_STATUS_LABEL[status]` 取最终文案。
 *  - exam-calendar.ts 京考节点注释已按新设计重写（时刻判定只在渲染层
 *    按表查，不动节点状态机）；todayNodes 的注释仍成立，未动。
 *
 * 行为契约——京考报名节点（报名 11-12→11-18 18:00）与军队文职缴费节点
 * （缴费 11-17–11-18 18:00，每门 50 元）在 11-18 18:00 之前 helper 返回
 * null、显示「进行中」，18:00 整点及之后 helper 返回「已截止」；边界
 * 17:59:59 为 null、18:00:00 为「已截止」。examNodeStatus 在 18:00:00
 * 仍为 'active'（日期口径不变的回归钉），todayNodes 在 18:30 仍 5 项。
 * 国考准考证 11-23 0:00–11-29 15:00 的现有门控（guokaoAdmissionPhase /
 * admissionReminderFor）不受影响，只作回归断言。
 *
 * 改写说明（W9，2026-11-18 基底 3ba09a48）：
 *  - 17 个绿回归 it 一字不动（§1 全部 3 个；§2 的 08:00 / 17:59:59 /
 *    次日 3 个；§3 的 11-17 / 08:00 / 17:59:59 / 次日 4 个；§4 的
 *    17:59:59「进行中」1 个；§6 全部 2 个；§7 国考回归全部 4 个）；
 *  - §2/§3 的红断言改调新 helper（18:00:00 起「已截止」，17:59:59 为
 *    null），并新增一 it 钉住 examNodeStatus 在 18:00:00 仍为 'active'；
 *  - §4 的红断言改调新 helper，新增一 it 断言 17:59:59 helper 为 null；
 *  - §5 重写为回归断言：18:30 时 todayNodes 仍 5 项、isNodeActionable
 *    仍 true、nextExamNode 仍返回报名/缴费；注释写明关注/勾选门控仍按
 *    日期口径、午夜才翻，18:00–24:00 可关注是已接受的设计取舍（与既往
 *    所有当日截止节点一致），不在本轮改；
 *  - 新增一节断言 todayNodeDeadlineMs 的五项目标时刻毫秒值、成考三省
 *    边界与日期守卫（表外 / 同 label 不同日期返回 undefined / null）。
 *  - 旧版文件头「ExamNode 新增截止时刻字段」「examNodeStatus 末日按时刻
 *    翻 done」的接口说明已被最终设计推翻，不再保留。
 *
 * 时间注入：已存在，不用新造。examNodeStatus / todayNodes / nextExamNode /
 * isNodeActionable / guokaoAdmissionPhase / admissionReminderFor /
 * examNodeDeadlineLabel 全部接受 nowMs（毫秒时间戳）参数；todayNodeDeadlineMs
 * 只取条目、不读时间。本文件所有时刻都用参数注入，不读真实系统时间，
 * 不用 vi.useFakeTimers、不依赖 Date.now()。
 *
 * 本文件无跨模块 vi.mock，故不涉及 mock-hygiene 门禁（vi.resetModules）。
 * 只 import 已存在的导出。
 *
 * U-144 追加（江苏自考，2026-11-18）：查表加两行——成绩查询 11-18 10:00
 * （查分行，hideWhenPassed=是）、成绩复核 11-20 17:00（截止行，
 * hideWhenPassed=否）。断言只锁毫秒值与行为，不锁表内字面数字：复核若按
 * 现表写法是 shanghaiMidnightMs('2026-11-18') + 3900 分钟，绝不能写成
 * 1020（会错成 11-18 17:00）；实现轮若改走 ('2026-11-20', 1020) 的推广
 * helper，本文件断言同样成立。两目标时刻：11-18 10:00 =
 * Date.UTC(2026, 10, 18, 2, 0, 0)；11-20 17:00 = Date.UTC(2026, 10, 20, 9, 0, 0)。
 */
import { describe, expect, it } from 'vitest'
import type { ExamInfo, ExamNode } from '../src/lib/exam-calendar'
import {
  EXAMS,
  EXAM_NODE_STATUS_LABEL,
  admissionReminderFor,
  examNodeDeadlineLabel,
  examNodeStatus,
  guokaoAdmissionPhase,
  isNodeActionable,
  nextExamNode,
  todayNodeDeadlineMs,
  todayNodes,
} from '../src/lib/exam-calendar'

const jingkao = EXAMS.find((e) => e.id === 'jingkao')!
const jundui = EXAMS.find((e) => e.id === 'jundui-wenzhi')!
const guokao = EXAMS.find((e) => e.id === 'guokao')!
const chengkao = EXAMS.find((e) => e.id === 'chengkao')!
const jingkaoApply = jingkao.nodes.find((n) => n.label === '报名')!
const junduiFee = jundui.nodes.find((n) => n.label === '缴费')!
const guokaoAdmit = guokao.nodes.find((n) => n.label === '准考证打印')!

/** 2026-11-17 08:00 北京时间（文职缴费窗口首日 8:00 开放） */
const NOV_17_0800_CST = Date.UTC(2026, 10, 17, 0, 0, 0)
/** 2026-11-18 08:00 北京时间（截止日白天，两节点都应进行中） */
const NOV_18_0800_CST = Date.UTC(2026, 10, 18, 0, 0, 0)
/** 2026-11-18 17:59:59 北京时间 = UTC 09:59:59（边界前 1 秒：进行中） */
const NOV_18_175959_CST = Date.UTC(2026, 10, 18, 9, 59, 59)
/** 2026-11-18 18:00:00 北京时间 = UTC 10:00:00（边界整点：已截止） */
const NOV_18_180000_CST = Date.UTC(2026, 10, 18, 10, 0, 0)
/** 2026-11-18 18:00:01 北京时间 = UTC 10:00:01（边界后 1 秒：已截止） */
const NOV_18_180001_CST = Date.UTC(2026, 10, 18, 10, 0, 1)
/** 2026-11-18 18:30 北京时间 = UTC 10:30:00（截止后半小时：今日行/可办/下一步的回归时刻） */
const NOV_18_183000_CST = Date.UTC(2026, 10, 18, 10, 30, 0)
/** 2026-11-18 23:59:59 北京时间 = UTC 15:59:59（截止日深夜：已截止，不是次日 0 点才翻） */
const NOV_18_235959_CST = Date.UTC(2026, 10, 18, 15, 59, 59)
/** 2026-11-19 08:00 北京时间（次日：按日期也已结束） */
const NOV_19_0800_CST = Date.UTC(2026, 10, 19, 0, 0, 0)

/**
 * 渲染层取文案的组合（与 W10 接线用同一表达式）：时刻截止优先，否则走
 * 节点状态文案。18:00 前 helper 为 null → 进行中；18:00 起 helper 为
 * 「已截止」→ 已截止。
 */
function nodeDeadlineDisplayLabel(exam: ExamInfo, node: ExamNode, nowMs: number): string {
  return examNodeDeadlineLabel(exam, node, nowMs) ?? EXAM_NODE_STATUS_LABEL[examNodeStatus(node, nowMs)]
}

describe('事实锚点：两节点的窗口与 18:00 截止写在数据里', () => {
  it('京考报名窗口 11-12→11-18，detail 写明 11 月 18 日 18:00 截止', () => {
    expect(jingkaoApply.startISO).toBe('2026-11-12')
    expect(jingkaoApply.endISO).toBe('2026-11-18')
    expect(jingkaoApply.detail).toContain('11 月 18 日 18:00')
  })

  it('文职缴费窗口 11-17–11-18，detail 写明 18 日 18:00 与每门 50 元', () => {
    expect(junduiFee.startISO).toBe('2026-11-17')
    expect(junduiFee.endISO).toBe('2026-11-18')
    expect(junduiFee.detail).toContain('2026 年 11 月 17 日 8:00 至 18 日 18:00')
    expect(junduiFee.detail).toContain('每门考试科目人民币 50 元')
  })

  it('国考准考证窗口 11-23→11-29，detail 写明 11 月 29 日 15:00（回归锚点）', () => {
    expect(guokaoAdmit.startISO).toBe('2026-11-23')
    expect(guokaoAdmit.endISO).toBe('2026-11-29')
    expect(guokaoAdmit.detail).toContain('11 月 29 日 15:00')
  })
})

describe('京考报名 18:00 时刻门控（examNodeDeadlineLabel）', () => {
  it('截止日白天进行中：11-18 08:00 为 active', () => {
    expect(examNodeStatus(jingkaoApply, NOV_18_0800_CST)).toBe('active')
  })

  it('边界前 1 秒仍进行中：11-18 17:59:59 为 active', () => {
    expect(examNodeStatus(jingkaoApply, NOV_18_175959_CST)).toBe('active')
  })

  it('边界整点已截止：11-18 18:00:00 helper 返回「已截止」', () => {
    expect(examNodeDeadlineLabel(jingkao, jingkaoApply, NOV_18_180000_CST)).toBe('已截止')
  })

  it('边界后 1 秒已截止：11-18 18:00:01 helper 返回「已截止」', () => {
    expect(examNodeDeadlineLabel(jingkao, jingkaoApply, NOV_18_180001_CST)).toBe('已截止')
  })

  it('截止日深夜已截止：11-18 23:59:59 helper 返回「已截止」，不等到次日 0 点才翻', () => {
    expect(examNodeDeadlineLabel(jingkao, jingkaoApply, NOV_18_235959_CST)).toBe('已截止')
  })

  it('次日仍是 done：11-19 按日期翻转不变', () => {
    expect(examNodeStatus(jingkaoApply, NOV_19_0800_CST)).toBe('done')
  })

  it('时刻门控只在渲染层：11-18 18:00:00 起 examNodeStatus 仍为 active（日期口径不变）；17:59:59 helper 为 null', () => {
    expect(examNodeStatus(jingkaoApply, NOV_18_180000_CST)).toBe('active')
    expect(examNodeStatus(jingkaoApply, NOV_18_180001_CST)).toBe('active')
    expect(examNodeStatus(jingkaoApply, NOV_18_235959_CST)).toBe('active')
    expect(examNodeDeadlineLabel(jingkao, jingkaoApply, NOV_18_175959_CST)).toBeNull()
  })
})

describe('军队文职缴费 18:00 时刻门控（examNodeDeadlineLabel）', () => {
  it('窗口首日进行中：11-17 08:00 为 active', () => {
    expect(examNodeStatus(junduiFee, NOV_17_0800_CST)).toBe('active')
  })

  it('截止日白天进行中：11-18 08:00 为 active', () => {
    expect(examNodeStatus(junduiFee, NOV_18_0800_CST)).toBe('active')
  })

  it('边界前 1 秒仍进行中：11-18 17:59:59 为 active', () => {
    expect(examNodeStatus(junduiFee, NOV_18_175959_CST)).toBe('active')
  })

  it('边界整点已截止：11-18 18:00:00 helper 返回「已截止」', () => {
    expect(examNodeDeadlineLabel(jundui, junduiFee, NOV_18_180000_CST)).toBe('已截止')
  })

  it('边界后 1 秒已截止：11-18 18:00:01 helper 返回「已截止」', () => {
    expect(examNodeDeadlineLabel(jundui, junduiFee, NOV_18_180001_CST)).toBe('已截止')
  })

  it('截止日深夜已截止：11-18 23:59:59 helper 返回「已截止」，不等到次日 0 点才翻', () => {
    expect(examNodeDeadlineLabel(jundui, junduiFee, NOV_18_235959_CST)).toBe('已截止')
  })

  it('次日仍是 done：11-19 按日期翻转不变', () => {
    expect(examNodeStatus(junduiFee, NOV_19_0800_CST)).toBe('done')
  })

  it('时刻门控只在渲染层：11-18 18:00:00 起 examNodeStatus 仍为 active（日期口径不变）；17:59:59 helper 为 null', () => {
    expect(examNodeStatus(junduiFee, NOV_18_180000_CST)).toBe('active')
    expect(examNodeStatus(junduiFee, NOV_18_180001_CST)).toBe('active')
    expect(examNodeStatus(junduiFee, NOV_18_235959_CST)).toBe('active')
    expect(examNodeDeadlineLabel(jundui, junduiFee, NOV_18_175959_CST)).toBeNull()
  })
})

describe('显示文案：18:00 前「进行中」，18:00 起「已截止」', () => {
  it('17:59:59 两节点都显示「进行中」', () => {
    expect(EXAM_NODE_STATUS_LABEL[examNodeStatus(jingkaoApply, NOV_18_175959_CST)]).toBe('进行中')
    expect(EXAM_NODE_STATUS_LABEL[examNodeStatus(junduiFee, NOV_18_175959_CST)]).toBe('进行中')
  })

  it('18:00:00 两节点 helper 都返回「已截止」，组合文案也是「已截止」', () => {
    expect(examNodeDeadlineLabel(jingkao, jingkaoApply, NOV_18_180000_CST)).toBe('已截止')
    expect(examNodeDeadlineLabel(jundui, junduiFee, NOV_18_180000_CST)).toBe('已截止')
    expect(nodeDeadlineDisplayLabel(jingkao, jingkaoApply, NOV_18_180000_CST)).toBe('已截止')
    expect(nodeDeadlineDisplayLabel(jundui, junduiFee, NOV_18_180000_CST)).toBe('已截止')
  })

  it('18:00:01 与 23:59:59 也显示「已截止」', () => {
    expect(examNodeDeadlineLabel(jingkao, jingkaoApply, NOV_18_180001_CST)).toBe('已截止')
    expect(examNodeDeadlineLabel(jingkao, jingkaoApply, NOV_18_235959_CST)).toBe('已截止')
    expect(examNodeDeadlineLabel(jundui, junduiFee, NOV_18_180001_CST)).toBe('已截止')
    expect(examNodeDeadlineLabel(jundui, junduiFee, NOV_18_235959_CST)).toBe('已截止')
    expect(nodeDeadlineDisplayLabel(jingkao, jingkaoApply, NOV_18_180001_CST)).toBe('已截止')
    expect(nodeDeadlineDisplayLabel(jingkao, jingkaoApply, NOV_18_235959_CST)).toBe('已截止')
    expect(nodeDeadlineDisplayLabel(jundui, junduiFee, NOV_18_180001_CST)).toBe('已截止')
    expect(nodeDeadlineDisplayLabel(jundui, junduiFee, NOV_18_235959_CST)).toBe('已截止')
  })

  it('17:59:59 helper 为 null：未到截止时刻，显示仍走状态文案「进行中」（见本节第一个 it）', () => {
    expect(examNodeDeadlineLabel(jingkao, jingkaoApply, NOV_18_175959_CST)).toBeNull()
    expect(examNodeDeadlineLabel(jundui, junduiFee, NOV_18_175959_CST)).toBeNull()
    expect(nodeDeadlineDisplayLabel(jingkao, jingkaoApply, NOV_18_175959_CST)).toBe('进行中')
    expect(nodeDeadlineDisplayLabel(jundui, junduiFee, NOV_18_175959_CST)).toBe('进行中')
  })
})

describe('回归：18:00 过后今日行 / 可办 / 下一步仍按日期口径（设计取舍）', () => {
  // 关注/勾选门控（isNodeActionable / todayNodes / nextExamNode）仍按日期口径、
  // 午夜才翻；18:00–24:00 两节点仍可关注、仍在今日行，是已接受的设计取舍
  // （与既往所有当日截止节点一致：时刻截止只改渲染层文案与倒计时，不改可办
  // 判断），不在本轮改。W10 接线后 18:30 的今日行文案显示「已截止」，但行本身不下线。
  it('18:30 今日行仍 6 项：两 endsToday 项不下线，与 08:00 同序同项（U-144 江苏成绩查询追加在末尾）', () => {
    const expected = [
      '军队文职/缴费/endsToday',
      '京考/报名/endsToday',
      '成考/江西成绩查询/today',
      '成考/广东成绩查询/today',
      '成考/新疆成绩查询/today',
      '江苏自考/成绩查询/today',
    ]
    expect(
      todayNodes(NOV_18_0800_CST).map((t) => `${t.exam.shortName}/${t.node.label}/${t.kind}`),
    ).toEqual(expected)
    expect(
      todayNodes(NOV_18_183000_CST).map((t) => `${t.exam.shortName}/${t.node.label}/${t.kind}`),
    ).toEqual(expected)
  })

  it('18:30 两节点仍可办：isNodeActionable 为 true（关注/勾选门控按日期口径，午夜才翻）', () => {
    expect(isNodeActionable(jingkaoApply, jingkao, NOV_18_183000_CST)).toBe(true)
    expect(isNodeActionable(junduiFee, jundui, NOV_18_183000_CST)).toBe(true)
    // 17:59:59 仍可办（绿基线）；18:00 helper 已是「已截止」，但可办判断不变
    expect(isNodeActionable(jingkaoApply, jingkao, NOV_18_175959_CST)).toBe(true)
    expect(isNodeActionable(junduiFee, jundui, NOV_18_175959_CST)).toBe(true)
  })

  it('18:30 下一步仍是本节点：京考下一步是报名，文职下一步是缴费', () => {
    expect(nextExamNode(jingkao, NOV_18_183000_CST)?.label).toBe('报名')
    expect(nextExamNode(jundui, NOV_18_183000_CST)?.label).toBe('缴费')
    // 17:59:59 下一步仍是本节点（绿基线）
    expect(nextExamNode(jingkao, NOV_18_175959_CST)?.label).toBe('报名')
    expect(nextExamNode(jundui, NOV_18_175959_CST)?.label).toBe('缴费')
  })
})

describe('门控不泄漏：没有 18:00 截止的节点不受影响', () => {
  it('成考三省成绩查询是单日节点：11-18 18:00 仍是 today，不被门控带走（现绿，不得变红）', () => {
    for (const label of ['江西成绩查询', '广东成绩查询', '新疆成绩查询']) {
      const node = chengkao.nodes.find((n) => n.label === label)!
      expect(examNodeStatus(node, NOV_18_180000_CST)).toBe('today')
      expect(examNodeStatus(node, NOV_18_235959_CST)).toBe('today')
    }
  })

  it('京考报名 18:00 门控只管末日：11-17 全天仍是 active，不提前翻', () => {
    expect(examNodeStatus(jingkaoApply, NOV_17_0800_CST)).toBe('active')
    expect(examNodeStatus(jingkaoApply, Date.UTC(2026, 10, 17, 15, 59, 59))).toBe('active')
  })
})

describe('todayNodeDeadlineMs：五项目标时刻与日期守卫', () => {
  it('五项目标时刻毫秒值：江西 09:00 / 新疆 12:00 / 广东 16:20 / 京考报名与文职缴费 18:00（均为北京时间 11-18）', () => {
    const byKey = new Map(
      todayNodes(NOV_18_0800_CST).map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    expect(todayNodeDeadlineMs(byKey.get('chengkao:江西成绩查询')!)).toBe(Date.UTC(2026, 10, 18, 1, 0, 0))
    expect(todayNodeDeadlineMs(byKey.get('chengkao:新疆成绩查询')!)).toBe(Date.UTC(2026, 10, 18, 4, 0, 0))
    expect(todayNodeDeadlineMs(byKey.get('chengkao:广东成绩查询')!)).toBe(Date.UTC(2026, 10, 18, 8, 20, 0))
    expect(todayNodeDeadlineMs(byKey.get('jingkao:报名')!)).toBe(Date.UTC(2026, 10, 18, 10, 0, 0))
    expect(todayNodeDeadlineMs(byKey.get('jundui-wenzhi:缴费')!)).toBe(Date.UTC(2026, 10, 18, 10, 0, 0))
  })

  it('成考三省边界：前 1 秒 null、目标时刻「已截止」', () => {
    const jiangxi = chengkao.nodes.find((n) => n.label === '江西成绩查询')!
    const xinjiang = chengkao.nodes.find((n) => n.label === '新疆成绩查询')!
    const guangdong = chengkao.nodes.find((n) => n.label === '广东成绩查询')!
    expect(examNodeDeadlineLabel(chengkao, jiangxi, Date.UTC(2026, 10, 18, 0, 59, 59))).toBeNull()
    expect(examNodeDeadlineLabel(chengkao, jiangxi, Date.UTC(2026, 10, 18, 1, 0, 0))).toBe('已截止')
    expect(examNodeDeadlineLabel(chengkao, xinjiang, Date.UTC(2026, 10, 18, 3, 59, 59))).toBeNull()
    expect(examNodeDeadlineLabel(chengkao, xinjiang, Date.UTC(2026, 10, 18, 4, 0, 0))).toBe('已截止')
    expect(examNodeDeadlineLabel(chengkao, guangdong, Date.UTC(2026, 10, 18, 8, 19, 59))).toBeNull()
    expect(examNodeDeadlineLabel(chengkao, guangdong, Date.UTC(2026, 10, 18, 8, 20, 0))).toBe('已截止')
  })

  it('表外节点与日期守卫：不在表里返回 undefined / null；同 label 但日期不覆盖 11-18 也不命中', () => {
    const jingkaoAdmit = jingkao.nodes.find((n) => n.label === '准考证打印')!
    expect(todayNodeDeadlineMs({ exam: jingkao, node: jingkaoAdmit, kind: 'endsToday' })).toBeUndefined()
    expect(examNodeDeadlineLabel(jingkao, jingkaoAdmit, NOV_18_180000_CST)).toBeNull()
    // 同 label「报名」但窗口在 11-19：守卫按 startISO/endISO 拦，不以 label 裸匹配
    const otherDayApply = { label: '报名', detail: '', startISO: '2026-11-19', endISO: '2026-11-19' }
    expect(todayNodeDeadlineMs({ exam: jingkao, node: otherDayApply, kind: 'today' })).toBeUndefined()
    expect(examNodeDeadlineLabel(jingkao, otherDayApply, NOV_18_180000_CST)).toBeNull()
  })
})

describe('回归：国考准考证 11-23 0:00–11-29 15:00 门控不变', () => {
  it('guokaoAdmissionPhase 档位边界：11-15 之前 null、11-15 起 countdown、11-22 warmup、11-23 0:00 起 open', () => {
    // 11-14 23:59:59 北京时间 = UTC 15:59:59；11-15 0:00 = UTC 16:00
    expect(guokaoAdmissionPhase(Date.UTC(2026, 10, 14, 15, 59, 59))).toBeNull()
    expect(guokaoAdmissionPhase(Date.UTC(2026, 10, 14, 16, 0, 0))).toBe('countdown')
    // 11-22 23:59:59 北京时间 = UTC 15:59:59；11-23 0:00 = UTC 16:00
    expect(guokaoAdmissionPhase(Date.UTC(2026, 10, 22, 15, 59, 59))).toBe('warmup')
    expect(guokaoAdmissionPhase(Date.UTC(2026, 10, 22, 16, 0, 0))).toBe('open')
  })

  it('15:00 截止用时刻算：11-29 14:59:59 仍是 last-call，15:00:00 整点下线为 null', () => {
    // 11-29 14:59:59 北京时间 = UTC 06:59:59；15:00:00 = UTC 07:00:00
    expect(guokaoAdmissionPhase(Date.UTC(2026, 10, 29, 6, 59, 59))).toBe('last-call')
    expect(guokaoAdmissionPhase(Date.UTC(2026, 10, 29, 7, 0, 0))).toBeNull()
    expect(guokaoAdmissionPhase(Date.UTC(2026, 10, 29, 7, 0, 1))).toBeNull()
  })

  it('admissionReminderFor 与 phase 同步：15:00 前有提醒，15:00 后 null；非国考恒为 null', () => {
    expect(admissionReminderFor(guokao, Date.UTC(2026, 10, 29, 6, 59, 59))?.phase).toBe('last-call')
    expect(admissionReminderFor(guokao, Date.UTC(2026, 10, 29, 7, 0, 0))).toBeNull()
    expect(admissionReminderFor(jingkao, Date.UTC(2026, 10, 29, 6, 59, 59))).toBeNull()
    expect(admissionReminderFor(jundui, Date.UTC(2026, 10, 29, 6, 59, 59))).toBeNull()
  })

  it('国考准考证节点状态仍是纯日期口径：11-29 当天 active（15:00 不翻节点状态），11-30 才 done', () => {
    expect(examNodeStatus(guokaoAdmit, Date.UTC(2026, 10, 29, 0, 0, 0))).toBe('active')
    expect(examNodeStatus(guokaoAdmit, Date.UTC(2026, 10, 29, 7, 0, 0))).toBe('active')
    expect(examNodeStatus(guokaoAdmit, Date.UTC(2026, 10, 30, 0, 0, 0))).toBe('done')
  })
})

describe('U-144 江苏自考两节点时刻门控（todayNodeDeadlineMs / examNodeDeadlineLabel）', () => {
  // 查找包成函数：实现未落盘时顶层 find 会在收集期抛错、整文件 0 跑；
  // 各 it 内调用，失败只落本 it。
  const jiangsu = () => EXAMS.find((e) => e.id === 'jiangsu-zikao')!
  const queryNode = () => jiangsu().nodes.find((n) => n.label === '成绩查询')!
  const reviewNode = () => jiangsu().nodes.find((n) => n.label === '成绩复核')!
  /** 2026-11-18 09:59:59 北京时间 = UTC 01:59:59（查分边界前 1 秒） */
  const NOV_18_095959_CST = Date.UTC(2026, 10, 18, 1, 59, 59)
  /** 2026-11-18 10:00:00 北京时间 = UTC 02:00:00（查分目标时刻） */
  const NOV_18_100000_CST = Date.UTC(2026, 10, 18, 2, 0, 0)
  /** 2026-11-20 08:00 北京时间（复核末日白天） */
  const NOV_20_0800_CST = Date.UTC(2026, 10, 20, 0, 0, 0)
  /** 2026-11-20 16:59:59 北京时间 = UTC 08:59:59（复核边界前 1 秒） */
  const NOV_20_165959_CST = Date.UTC(2026, 10, 20, 8, 59, 59)
  /** 2026-11-20 17:00:00 北京时间 = UTC 09:00:00（复核目标时刻） */
  const NOV_20_170000_CST = Date.UTC(2026, 10, 20, 9, 0, 0)
  /** 2026-11-20 17:00:01 北京时间 = UTC 09:00:01（复核边界后 1 秒） */
  const NOV_20_170001_CST = Date.UTC(2026, 10, 20, 9, 0, 1)

  it('两目标时刻毫秒值：成绩查询 11-18 10:00、成绩复核 11-20 17:00', () => {
    const byKey18 = new Map(
      todayNodes(NOV_18_0800_CST).map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    expect(todayNodeDeadlineMs(byKey18.get('jiangsu-zikao:成绩查询')!)).toBe(
      Date.UTC(2026, 10, 18, 2, 0, 0),
    )
    const byKey20 = new Map(
      todayNodes(NOV_20_0800_CST).map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    expect(todayNodeDeadlineMs(byKey20.get('jiangsu-zikao:成绩复核')!)).toBe(
      Date.UTC(2026, 10, 20, 9, 0, 0),
    )
  })

  it('陷阱守卫：复核目标是 11-20 17:00，绝不是 11-18 17:00（表内 1020 分钟的错值）', () => {
    const byKey20 = new Map(
      todayNodes(NOV_20_0800_CST).map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    const ms = todayNodeDeadlineMs(byKey20.get('jiangsu-zikao:成绩复核')!)
    expect(ms).toBe(Date.UTC(2026, 10, 20, 9, 0, 0))
    expect(ms).not.toBe(Date.UTC(2026, 10, 18, 9, 0, 0))
    // 同一节点 11-18 当天查表也应是 11-20 17:00（节点日期覆盖 11-18，
    // 目标时刻本身不在 11-18）：11-18 17:00 前 helper 为 null 不是「已截止」
    expect(examNodeDeadlineLabel(jiangsu(), reviewNode(), Date.UTC(2026, 10, 18, 9, 0, 0))).toBeNull()
    expect(examNodeDeadlineLabel(jiangsu(), reviewNode(), NOV_20_165959_CST)).toBeNull()
  })

  it('查分边界：09:59:59 为 null、10:00:00 整点「已截止」', () => {
    expect(examNodeDeadlineLabel(jiangsu(), queryNode(), NOV_18_095959_CST)).toBeNull()
    expect(examNodeDeadlineLabel(jiangsu(), queryNode(), NOV_18_100000_CST)).toBe('已截止')
    // 查分是单日 today 节点：09:59:59 组合文案走状态文案「今天」，不是「进行中」
    expect(nodeDeadlineDisplayLabel(jiangsu(), queryNode(), NOV_18_095959_CST)).toBe('今天')
    expect(nodeDeadlineDisplayLabel(jiangsu(), queryNode(), NOV_18_100000_CST)).toBe('已截止')
  })

  it('复核边界：11-20 16:59:59 为 null、17:00:00 整点「已截止」、17:00:01 仍「已截止」', () => {
    expect(examNodeDeadlineLabel(jiangsu(), reviewNode(), NOV_20_165959_CST)).toBeNull()
    expect(examNodeDeadlineLabel(jiangsu(), reviewNode(), NOV_20_170000_CST)).toBe('已截止')
    expect(examNodeDeadlineLabel(jiangsu(), reviewNode(), NOV_20_170001_CST)).toBe('已截止')
    expect(nodeDeadlineDisplayLabel(jiangsu(), reviewNode(), NOV_20_165959_CST)).toBe('进行中')
    expect(nodeDeadlineDisplayLabel(jiangsu(), reviewNode(), NOV_20_170000_CST)).toBe('已截止')
  })

  it('时刻门控只在渲染层：目标时刻 examNodeStatus 仍按日期口径（查分 11-18 当天 today、复核 11-20 当天 active）', () => {
    expect(examNodeStatus(queryNode(), NOV_18_100000_CST)).toBe('today')
    expect(examNodeStatus(reviewNode(), NOV_20_170000_CST)).toBe('active')
    expect(examNodeStatus(reviewNode(), NOV_20_170001_CST)).toBe('active')
  })

  it('11-20 今日行含江苏成绩复核（endsToday），11-18 今日行含江苏成绩查询（today）', () => {
    const items18 = todayNodes(NOV_18_0800_CST)
    const query = items18.find((t) => t.exam.id === 'jiangsu-zikao')
    expect(query?.node.label).toBe('成绩查询')
    expect(query?.kind).toBe('today')
    const items20 = todayNodes(NOV_20_0800_CST)
    const review = items20.find((t) => t.exam.id === 'jiangsu-zikao')
    expect(review?.node.label).toBe('成绩复核')
    expect(review?.kind).toBe('endsToday')
  })
})
