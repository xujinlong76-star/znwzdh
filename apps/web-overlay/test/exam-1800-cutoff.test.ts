/**
 * 18:00 时刻门控（考试峰值日包 W5 测试先行 → W9 按最终设计对齐改写）：
 *
 * 最终设计（coordinator 裁决，2026-11-18）：不给 ExamNode 加时刻字段、
 * 不改 examNodeStatus、不改 todayNodes（W6 的 A1 守卫成立；todayNodes
 * 保持日期口径，18:30 仍 7 项）。时刻判定只在渲染层按表查：
 *  - 新增纯函数 todayNodeDeadlineMs(item: TodayNodeItem): number | undefined
 *    （放 src/lib/exam-calendar.ts），查表 key 为 `${exam.id}:${node.label}`，
 *    只覆盖 11-18 的 7 个已核实目标时刻：成考江西成绩查询 09:00、成考新疆
 *    成绩查询 12:00、成考广东成绩查询 16:20、江苏自考成绩查询 10:00、广东自考成绩查询 15:00、京考报名 18:00、军队文职缴费
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
 * 仍为 'active'（日期口径不变的回归钉），todayNodes 在 18:30 仍 7 项。
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
 *  - §5 重写为回归断言：18:30 时 todayNodes 仍 7 项、isNodeActionable
 *    仍 true、nextExamNode 仍返回报名/缴费；注释写明关注/勾选门控仍按
 *    日期口径、午夜才翻，18:00–24:00 可关注是已接受的设计取舍（与既往
 *    所有当日截止节点一致），不在本轮改；
 *  - 新增一节断言 todayNodeDeadlineMs 的七项目标时刻毫秒值、成考三省
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
 *
 * U-144 追加（广东自考，2026-11-18）：查表加一行——成绩查询 11-18 15:00
 * （查分行，hideWhenPassed=是）；复核无全省统一窗口，不设节点、不进表。
 * 目标时刻：11-18 15:00 = Date.UTC(2026, 10, 18, 7, 0, 0)。15:00 绝不是
 * 成考广东 16:20，也不是江苏 10:00。
 *
 * U-158 追加（成考三省复核，2026-11-18）：查表加三行——广东成绩复核
 * 11-20 15:00（单日节点，kind today，过期 chip 消失）、新疆成绩复核
 * 11-20 12:00、江西成绩复核 11-20 17:00（两多日窗口末日，kind endsToday，
 * 过期显示「已截止」）。三目标时刻：广东 Date.UTC(2026, 10, 20, 7, 0, 0)、
 * 新疆 Date.UTC(2026, 10, 20, 4, 0, 0)、江西 Date.UTC(2026, 10, 20, 9, 0, 0)。
 * 陷阱：广东成考复核 15:00 绝不是广东自考 11-18 15:00（键不同）；新疆复核
 * 12:00 绝不是新疆查分 11-18 12:00（date 不同）；江西复核 17:00 绝不是
 * 11-18 17:00。
 *
 * U-162 追加（天津成考复核，2026-11-19）：查表加一行——天津成绩复核
 * 11-19 18:00（单日节点，kind today，过期 chip 消失）；11-19 18:00 是截止
 * 时刻（转载级：hqwx 环球青藤 2026-11-18 资讯梳理，非官方公告原文），与
 * 海南 17:00、上海 10:00 的开通时刻性质相反；结果窗口 11-25 09:00 是开通时刻、
 * 不入表，11-30 17:00 是结果窗口末端、入 PEAK 表（U-279，见下）。目标时刻：
 * 11-19 18:00 = Date.UTC(2026, 10, 19, 10, 0, 0)。陷阱：绝不是京考/文职 11-18 18:00
 * （date 不同）；eol.cn 2025 口径（11-19 09:00–11-20 12:00 现场办理）
 * 与 2026 三处实质冲突，绝不复刻。
 *
 * U-222 追加（12 月峰值周末，2026-11-19）：查表加七行——浙江志愿确认
 * 11-29 17:00、上海省考准考证 12-05 18:00、京考准考证 12-06 16:30、
 * 山东准考证 12-06 14:15、浙江准考证 12-06 17:00、江苏准考证 12-06
 * 15:00、文职准考证 12-13 14:00（七者 detail 原文所载窗口末时刻）。
 * 上海自考成绩查询 12-18 16:00 不入表（U-163 定论：入表会在 11-19 当天
 * 渲染「剩 700+ 小时」chip）。七目标时刻：11-29 17:00 =
 * Date.UTC(2026, 10, 29, 9, 0, 0)；12-05 18:00 = Date.UTC(2026, 11, 5,
 * 10, 0, 0)；12-06 16:30 = Date.UTC(2026, 11, 6, 8, 30, 0)；12-06
 * 14:15 = Date.UTC(2026, 11, 6, 6, 15, 0)；12-06 17:00 =
 * Date.UTC(2026, 11, 6, 9, 0, 0)；12-06 15:00 = Date.UTC(2026, 11, 6,
 * 7, 0, 0)；12-13 14:00 = Date.UTC(2026, 11, 13, 6, 0, 0)。
 * 陷阱：浙江志愿 17:00 绝不是浙江准考证 17:00（键与日期均不同）；京考
 * 16:30 绝不是国考 11-29 15:00；山东 14:15 / 浙江 17:00 / 江苏 15:00
 * 同场不同 label，键不同。
 *
 * U-279 追加（天津成考成绩复核结果查询，2026-11-20）：查表加一行——天津成绩复核
 * 结果查询 11-30 17:00（多日窗口 11-25→11-30 末日，kind endsToday，过期显示
 * 「已截止」，与浙江志愿确认 11-29 17:00 同款）；11-25 09:00 是开通时刻、不入表。
 * 节点转载级（官方原文复核未通过：browser.open 上游抓取失败、VM curl 超时、
 * site:zhaokao.net 零结果），不挂 url。目标时刻：11-30 17:00 =
 * Date.UTC(2026, 10, 30, 9, 0, 0)。陷阱：绝不是天津成绩复核 11-19 18:00
 * （键与日期均不同）；绝不是结果窗口 11-25 09:00 开通时刻。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ExamInfo, ExamNode } from '../src/lib/exam-calendar'
import {
  EXAMS,
  EXAM_NODE_STATUS_LABEL,
  JINGKAO_APPLY_URL,
  admissionReminderFor,
  examNodeDeadlineLabel,
  examNodeStatus,
  guokaoAdmissionPhase,
  isNodeActionable,
  nextExamNode,
  todayFollowUpNodes,
  todayNodeDeadlineMs,
  todayNodes,
} from '../src/lib/exam-calendar'

const jingkao = EXAMS.find((e) => e.id === 'jingkao')!
const jundui = EXAMS.find((e) => e.id === 'jundui-wenzhi')!
const guokao = EXAMS.find((e) => e.id === 'guokao')!
const chengkao = EXAMS.find((e) => e.id === 'chengkao')!

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')
const jingkaoApply = jingkao.nodes.find((n) => n.label === '报名')!
const jingkaoFee = jingkao.nodes.find((n) => n.label === '缴费')!
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

  it('京考缴费窗口 11-21→11-23，detail 写明 11 月 23 日 24:00 与自动放弃（U-395）', () => {
    expect(jingkaoFee.startISO).toBe('2026-11-21')
    expect(jingkaoFee.endISO).toBe('2026-11-23')
    expect(jingkaoFee.url).toBe(JINGKAO_APPLY_URL)
    expect(jingkaoFee.detail).toContain('11 月 23 日 24:00')
    expect(jingkaoFee.detail).toContain('自动放弃')
    expect(jingkaoFee.detail).toContain('北京市人事考试通用平台')
    // 公告未写费用数额：detail 不得出现金额
    expect(jingkaoFee.detail).not.toMatch(/每人|人民币|元/)
  })

  it('国考准考证窗口 11-23→11-29，detail 写明 11 月 29 日 15:00（回归锚点）', () => {
    expect(guokaoAdmit.startISO).toBe('2026-11-23')
    expect(guokaoAdmit.endISO).toBe('2026-11-29')
    expect(guokaoAdmit.detail).toContain('11 月 29 日 15:00')
  })
})

describe('京考缴费日期边界（U-395：截止是 11-23 24:00 自然日末，纯日期口径）', () => {
  /** 2026-11-21 08:00 北京时间（缴费窗口首日） */
  const NOV_21_0800_CST = Date.UTC(2026, 10, 21, 0, 0, 0)
  /** 2026-11-23 08:00 北京时间（缴费窗口末日） */
  const NOV_23_0800_CST = Date.UTC(2026, 10, 23, 0, 0, 0)
  /** 2026-11-24 08:00 北京时间（窗口次日） */
  const NOV_24_0800_CST = Date.UTC(2026, 10, 24, 0, 0, 0)

  it('11-21 首日与 11-23 末日均为进行中：examNodeStatus 为 active，文案为「进行中」', () => {
    expect(examNodeStatus(jingkaoFee, NOV_21_0800_CST)).toBe('active')
    expect(examNodeStatus(jingkaoFee, NOV_23_0800_CST)).toBe('active')
    expect(EXAM_NODE_STATUS_LABEL[examNodeStatus(jingkaoFee, NOV_23_0800_CST)]).toBe('进行中')
  })

  it('11-21 与 11-23 缴费进今日行，11-24 不再进今日行/接续区', () => {
    const key = (t: { exam: ExamInfo; node: ExamNode }) => `${t.exam.id}:${t.node.label}`
    expect(todayNodes(NOV_21_0800_CST).map(key)).toContain('jingkao:缴费')
    expect(todayNodes(NOV_23_0800_CST).map(key)).toContain('jingkao:缴费')
    expect(todayNodes(NOV_24_0800_CST).map(key)).not.toContain('jingkao:缴费')
    expect(todayFollowUpNodes(NOV_24_0800_CST).map(key)).not.toContain('jingkao:缴费')
  })

  it('11-24 节点状态翻已结束（done），且缴费不进 PEAK 截止时刻表', () => {
    expect(examNodeStatus(jingkaoFee, NOV_24_0800_CST)).toBe('done')
    expect(examNodeDeadlineLabel(jingkao, jingkaoFee, NOV_23_0800_CST)).toBeNull()
    expect(examNodeDeadlineLabel(jingkao, jingkaoFee, NOV_24_0800_CST)).toBeNull()
    expect(
      todayNodeDeadlineMs({ exam: jingkao, node: jingkaoFee, kind: 'endsToday' }),
    ).toBeUndefined()
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
  it('18:30 今日行仍 7 项：两 endsToday 项不下线，与 08:00 同序同项（U-234：按目标时刻升序，江西 09:00 → 江苏 10:00 → 新疆 12:00 → 广东自考 15:00 → 广东成考 16:20 → 文职/京考 18:00 同刻保原序）', () => {
    const expected = [
      '成考/江西成绩查询/today',
      '江苏自考/成绩查询/today',
      '成考/新疆成绩查询/today',
      '广东自考/成绩查询/today',
      '成考/广东成绩查询/today',
      '军队文职/缴费/endsToday',
      '京考/报名/endsToday',
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

describe('todayNodeDeadlineMs：七项目标时刻与日期守卫', () => {
  it('七项目标时刻毫秒值：江西 09:00 / 新疆 12:00 / 广东 16:20 / 江苏自考 10:00 / 广东自考 15:00 / 京考报名与文职缴费 18:00（均为北京时间 11-18）', () => {
    const byKey = new Map(
      todayNodes(NOV_18_0800_CST).map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    expect(todayNodeDeadlineMs(byKey.get('chengkao:江西成绩查询')!)).toBe(Date.UTC(2026, 10, 18, 1, 0, 0))
    expect(todayNodeDeadlineMs(byKey.get('chengkao:新疆成绩查询')!)).toBe(Date.UTC(2026, 10, 18, 4, 0, 0))
    expect(todayNodeDeadlineMs(byKey.get('chengkao:广东成绩查询')!)).toBe(Date.UTC(2026, 10, 18, 8, 20, 0))
    expect(todayNodeDeadlineMs(byKey.get('jiangsu-zikao:成绩查询')!)).toBe(Date.UTC(2026, 10, 18, 2, 0, 0))
    expect(todayNodeDeadlineMs(byKey.get('guangdong-zikao:成绩查询')!)).toBe(Date.UTC(2026, 10, 18, 7, 0, 0))
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
    // U-222：京考准考证打印已入表（12-06 16:30），不再作表外例；改用教资面试
    // 准考证打印（11-30→12-06，仅北京口径 16:00、各省不一，无全省统一截止）作表外例。
    const jiaoshi = EXAMS.find((e) => e.id === 'jiaoshi-mianshi')!
    const jiaoshiAdmit = jiaoshi.nodes.find((n) => n.label === '准考证打印')!
    expect(todayNodeDeadlineMs({ exam: jiaoshi, node: jiaoshiAdmit, kind: 'endsToday' })).toBeUndefined()
    expect(examNodeDeadlineLabel(jiaoshi, jiaoshiAdmit, NOV_18_180000_CST)).toBeNull()
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

describe('U-144 广东自考成绩查询时刻门控（todayNodeDeadlineMs / examNodeDeadlineLabel）', () => {
  // 查找包成函数：实现未落盘时顶层 find 会在收集期抛错、整文件 0 跑；
  // 各 it 内调用，失败只落本 it。
  const guangdong = () => EXAMS.find((e) => e.id === 'guangdong-zikao')!
  const queryNode = () => guangdong().nodes.find((n) => n.label === '成绩查询')!
  /** 2026-11-18 14:59:59 北京时间 = UTC 06:59:59（查分边界前 1 秒） */
  const NOV_18_145959_CST = Date.UTC(2026, 10, 18, 6, 59, 59)
  /** 2026-11-18 15:00:00 北京时间 = UTC 07:00:00（查分目标时刻） */
  const NOV_18_150000_CST = Date.UTC(2026, 10, 18, 7, 0, 0)
  /** 2026-11-18 15:00:01 北京时间 = UTC 07:00:01（查分边界后 1 秒） */
  const NOV_18_150001_CST = Date.UTC(2026, 10, 18, 7, 0, 1)

  it('目标时刻毫秒值：成绩查询 11-18 15:00（自考）', () => {
    const byKey18 = new Map(
      todayNodes(NOV_18_0800_CST).map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    expect(todayNodeDeadlineMs(byKey18.get('guangdong-zikao:成绩查询')!)).toBe(
      Date.UTC(2026, 10, 18, 7, 0, 0),
    )
  })

  it('陷阱守卫：目标是自考 15:00，绝不是成考广东 16:20，也不是江苏 10:00', () => {
    const byKey18 = new Map(
      todayNodes(NOV_18_0800_CST).map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    const ms = todayNodeDeadlineMs(byKey18.get('guangdong-zikao:成绩查询')!)
    expect(ms).toBe(Date.UTC(2026, 10, 18, 7, 0, 0))
    expect(ms).not.toBe(Date.UTC(2026, 10, 18, 8, 20, 0))
    expect(ms).not.toBe(Date.UTC(2026, 10, 18, 2, 0, 0))
  })

  it('查分边界：14:59:59 为 null、15:00:00 整点「已截止」、15:00:01 仍「已截止」', () => {
    expect(examNodeDeadlineLabel(guangdong(), queryNode(), NOV_18_145959_CST)).toBeNull()
    expect(examNodeDeadlineLabel(guangdong(), queryNode(), NOV_18_150000_CST)).toBe('已截止')
    expect(examNodeDeadlineLabel(guangdong(), queryNode(), NOV_18_150001_CST)).toBe('已截止')
    // 查分是单日 today 节点：14:59:59 组合文案走状态文案「今天」，不是「进行中」
    expect(nodeDeadlineDisplayLabel(guangdong(), queryNode(), NOV_18_145959_CST)).toBe('今天')
    expect(nodeDeadlineDisplayLabel(guangdong(), queryNode(), NOV_18_150000_CST)).toBe('已截止')
  })

  it('时刻门控只在渲染层：15:00 时 examNodeStatus 仍按日期口径（查分 11-18 当天 today）', () => {
    expect(examNodeStatus(queryNode(), NOV_18_150000_CST)).toBe('today')
    expect(examNodeStatus(queryNode(), NOV_18_150001_CST)).toBe('today')
  })

  it('11-18 今日行含广东自考成绩查询（today）', () => {
    const items18 = todayNodes(NOV_18_0800_CST)
    const query = items18.find((t) => t.exam.id === 'guangdong-zikao')
    expect(query?.node.label).toBe('成绩查询')
    expect(query?.kind).toBe('today')
  })
})

describe('U-163 上海自考成绩查询时刻门控（todayNodeDeadlineMs / examNodeDeadlineLabel）', () => {
  // 查找包成函数：实现未落盘时顶层 find 会在收集期抛错、整文件 0 跑；
  // 各 it 内调用，失败只落本 it。
  const shanghai = () => EXAMS.find((e) => e.id === 'shanghai-zikao')!
  const queryNode = () => shanghai().nodes.find((n) => n.label === '成绩查询')!
  const reviewNode = () => shanghai().nodes.find((n) => n.label === '成绩复核')!
  /** 2026-11-19 08:00 北京时间（查分首日白天） */
  const NOV_19_0800_CST = Date.UTC(2026, 10, 19, 0, 0, 0)
  /** 2026-11-19 09:59:59 北京时间 = UTC 01:59:59（查分边界前 1 秒） */
  const NOV_19_095959_CST = Date.UTC(2026, 10, 19, 1, 59, 59)
  /** 2026-11-19 10:00:00 北京时间 = UTC 02:00:00（查分目标时刻） */
  const NOV_19_100000_CST = Date.UTC(2026, 10, 19, 2, 0, 0)
  /** 2026-11-19 10:00:01 北京时间 = UTC 02:00:01（查分边界后 1 秒） */
  const NOV_19_100001_CST = Date.UTC(2026, 10, 19, 2, 0, 1)
  /** 2026-11-20 08:00 北京时间（复核首日白天） */
  const NOV_20_0800_CST = Date.UTC(2026, 10, 20, 0, 0, 0)

  it('查分不入 PEAK 表：todayNodeDeadlineMs 为 undefined（11-19 10:00 是开通时刻、不是截止时刻）', () => {
    // U-163 复审必改 1：该节点是 11-19–12-18 多日窗口，11-19 kind 为 startsToday，
    // home-today-zone 只给 kind today 传 hideWhenPassed；入表会在 10:00 后谎报
    // 「已截止」，与同行「可查至 12 月 18 日 16:00」自相矛盾（抵触 W10 定论）。
    // 改成真截止 12-18 16:00 也不可行：11-19 当天 chip 会渲染「剩 700+ 小时」。
    const byKey19 = new Map(
      todayNodes(NOV_19_0800_CST).map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    expect(todayNodeDeadlineMs(byKey19.get('shanghai-zikao:成绩查询')!)).toBeUndefined()
  })

  it('U-136 守卫：徽章改动不得误伤 PEAK 表——上海查分仍不入表、江西复核目标仍为 11-20 17:00', () => {
    const byKey19 = new Map(
      todayNodes(NOV_19_0800_CST).map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    expect(todayNodeDeadlineMs(byKey19.get('shanghai-zikao:成绩查询')!)).toBeUndefined()
    const byKey20 = new Map(
      todayNodes(NOV_20_0800_CST).map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    expect(todayNodeDeadlineMs(byKey20.get('chengkao:江西成绩复核')!)).toBe(
      Date.UTC(2026, 10, 20, 9, 0, 0),
    )
  })

  it('表外守卫：查分与复核均不入表，helper 恒为 null（复核无截止时刻，不得编造）', () => {
    expect(examNodeDeadlineLabel(shanghai(), queryNode(), NOV_19_0800_CST)).toBeNull()
    expect(examNodeDeadlineLabel(shanghai(), queryNode(), NOV_19_100000_CST)).toBeNull()
    expect(examNodeDeadlineLabel(shanghai(), queryNode(), NOV_19_100001_CST)).toBeNull()
    // 复核 11-20–22 只有日期区间、无截止时刻：表外节点 helper 恒为 null，
    // 不得编造 17:00 之类时刻
    expect(examNodeDeadlineLabel(shanghai(), reviewNode(), NOV_20_0800_CST)).toBeNull()
    expect(examNodeDeadlineLabel(shanghai(), reviewNode(), Date.UTC(2026, 10, 22, 9, 0, 0))).toBeNull()
  })

  it('查分无时刻门控：10:00 前后 helper 恒为 null，文案回落为状态文案「进行中」', () => {
    expect(examNodeDeadlineLabel(shanghai(), queryNode(), NOV_19_095959_CST)).toBeNull()
    expect(examNodeDeadlineLabel(shanghai(), queryNode(), NOV_19_100000_CST)).toBeNull()
    expect(examNodeDeadlineLabel(shanghai(), queryNode(), NOV_19_100001_CST)).toBeNull()
    // 查分是多日窗口首日 startsToday：10:00 前后组合文案均走状态文案「进行中」，
    // 不显示「已截止」（与单日 today 查分行 10:00 后 chip 消失不同——本行无 chip）
    expect(nodeDeadlineDisplayLabel(shanghai(), queryNode(), NOV_19_095959_CST)).toBe('进行中')
    expect(nodeDeadlineDisplayLabel(shanghai(), queryNode(), NOV_19_100000_CST)).toBe('进行中')
    expect(nodeDeadlineDisplayLabel(shanghai(), queryNode(), NOV_19_100001_CST)).toBe('进行中')
  })

  it('时刻门控只在渲染层：10:00 时 examNodeStatus 仍按日期口径（查分 11-19 当天 active、复核 11-20 当天 active）', () => {
    expect(examNodeStatus(queryNode(), NOV_19_100000_CST)).toBe('active')
    expect(examNodeStatus(queryNode(), NOV_19_100001_CST)).toBe('active')
    expect(examNodeStatus(reviewNode(), NOV_20_0800_CST)).toBe('active')
  })

  it('11-19 今日行含上海自考成绩查询（startsToday），11-20 今日行含上海自考成绩复核（startsToday）', () => {
    const items19 = todayNodes(NOV_19_0800_CST)
    const query = items19.find((t) => t.exam.id === 'shanghai-zikao')
    expect(query?.node.label).toBe('成绩查询')
    expect(query?.kind).toBe('startsToday')
    const items20 = todayNodes(NOV_20_0800_CST)
    const review = items20.find((t) => t.exam.id === 'shanghai-zikao')
    expect(review?.node.label).toBe('成绩复核')
    expect(review?.kind).toBe('startsToday')
  })
})

describe('U-164 海南成考成绩查询时刻门控（todayNodeDeadlineMs / examNodeDeadlineLabel）', () => {
  // 查找包成函数：实现未落盘时顶层 find 会在收集期抛错、整文件 0 跑；
  // 各 it 内调用，失败只落本 it。
  const hainanNode = () => chengkao.nodes.find((n) => n.label === '海南成绩查询')!
  /** 2026-11-19 16:59:59 北京时间 = UTC 08:59:59（公布时刻前 1 秒） */
  const NOV_19_165959_CST = Date.UTC(2026, 10, 19, 8, 59, 59)
  /** 2026-11-19 17:00:00 北京时间 = UTC 09:00:00（公布时刻） */
  const NOV_19_170000_CST = Date.UTC(2026, 10, 19, 9, 0, 0)
  /** 2026-11-19 17:00:01 北京时间 = UTC 09:00:01（公布时刻后 1 秒） */
  const NOV_19_170001_CST = Date.UTC(2026, 10, 19, 9, 0, 1)
  /** 2026-11-20 08:00 北京时间（公布次日） */
  const NOV_20_0800_CST = Date.UTC(2026, 10, 20, 0, 0, 0)

  it('海南不入 PEAK 表：todayNodeDeadlineMs 为 undefined（11-19 17:00 是开通时刻、不是截止时刻）', () => {
    const byKey19 = new Map(
      todayNodes(NOV_19_0800_CST).map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    expect(todayNodeDeadlineMs(byKey19.get('chengkao:海南成绩查询')!)).toBeUndefined()
  })

  it('表外守卫：examNodeDeadlineLabel 在 16:59:59 / 17:00 / 17:00:01 三点恒为 null，永不显示「已截止」', () => {
    expect(examNodeDeadlineLabel(chengkao, hainanNode(), NOV_19_165959_CST)).toBeNull()
    expect(examNodeDeadlineLabel(chengkao, hainanNode(), NOV_19_170000_CST)).toBeNull()
    expect(examNodeDeadlineLabel(chengkao, hainanNode(), NOV_19_170001_CST)).toBeNull()
  })

  it('无时刻门控：三时刻组合文案恒为「今天」（单日节点 today，与上海行的「进行中」不同）', () => {
    expect(nodeDeadlineDisplayLabel(chengkao, hainanNode(), NOV_19_165959_CST)).toBe('今天')
    expect(nodeDeadlineDisplayLabel(chengkao, hainanNode(), NOV_19_170000_CST)).toBe('今天')
    expect(nodeDeadlineDisplayLabel(chengkao, hainanNode(), NOV_19_170001_CST)).toBe('今天')
  })

  it('时刻门控只在渲染层：17:00 时 examNodeStatus 仍按日期口径（11-19 当天 today、11-20 已 done）', () => {
    expect(examNodeStatus(hainanNode(), NOV_19_170000_CST)).toBe('today')
    expect(examNodeStatus(hainanNode(), NOV_20_0800_CST)).toBe('done')
  })

  it('11-19 今日行含海南成绩查询（today，无 url）', () => {
    const items19 = todayNodes(NOV_19_0800_CST)
    const query = items19.find((t) => t.exam.id === 'chengkao' && t.node.label === '海南成绩查询')
    expect(query?.node.label).toBe('海南成绩查询')
    expect(query?.kind).toBe('today')
    expect(query?.node.url).toBeUndefined()
  })
})

describe('U-160 山西成考成绩复核（转载级，不入 PEAK 表）', () => {
  // 查找包成函数：实现未落盘时顶层 find 会在收集期抛错、整文件 0 跑；
  // 各 it 内调用，失败只落本 it。
  const shanxiNode = () => chengkao.nodes.find((n) => n.label === '山西成绩复核')!
  /** 2026-11-19 08:00 北京时间（复核窗口首日） */
  const NOV_19_0800_CST = Date.UTC(2026, 10, 19, 0, 0, 0)
  /** 2026-11-20 08:00 北京时间（复核窗口末日） */
  const NOV_20_0800_CST = Date.UTC(2026, 10, 20, 0, 0, 0)
  /** 2026-11-21 08:00 北京时间（复核窗口已过） */
  const NOV_21_0800_CST = Date.UTC(2026, 10, 21, 0, 0, 0)

  it('节点落库：11-19→11-20 多日窗口，无 url；detail 逐字口径 + 转载级标注', () => {
    const node = shanxiNode()
    expect(node.startISO).toBe('2026-11-19')
    expect(node.endISO).toBe('2026-11-20')
    expect(node.url).toBeUndefined()
    expect(node.detail).toContain('成绩已于 11 月 18 日公布')
    expect(node.detail).toContain('11 月 19 日、20 日的工作时间内')
    expect(node.detail).toContain('到考试所在市的招生考试机构办理成绩复核手续，逾期不予受理')
    expect(node.detail).toContain('11 月 27 日前，各市招生考试机构通知考生成绩复核结果')
    // 转载级如实标注：写明来源通知与两路转载一致，并写明未在官方站直读到原文
    expect(node.detail).toContain('转载级')
    expect(node.detail).toContain('山西省招生考试管理中心 2026-11-16 通知')
    expect(node.detail).toContain('凤凰网与新浪财经转载一致')
    expect(node.detail).toContain('本站未在山西招生考试网直读到官方原文')
  })

  it('底线守卫：不写「据官网公告」、不写「现场办理」、不写 sxkszx.cn、不补时刻与分数线', () => {
    const node = shanxiNode()
    expect(node.detail).not.toContain('官网公告')
    expect(node.detail).not.toContain('现场办理')
    expect(node.detail).not.toContain('sxkszx.cn')
    expect(node.detail).not.toContain('分数线')
    expect(node.detail).not.toContain('录取时间')
    expect(node.detail).not.toMatch(/9:00|17:00/)
  })

  it('山西不入 PEAK 表：todayNodeDeadlineMs 为 undefined（复核窗口只写「工作时间内」、无截止时刻；11 月 27 日是结果通知日、不是节点截止时刻）', () => {
    expect(
      todayNodeDeadlineMs({ exam: chengkao, node: shanxiNode(), kind: 'startsToday' }),
    ).toBeUndefined()
    expect(
      todayNodeDeadlineMs({ exam: chengkao, node: shanxiNode(), kind: 'endsToday' }),
    ).toBeUndefined()
  })

  it('表外守卫：examNodeDeadlineLabel 在窗口首日 / 末日 / 窗口后恒为 null，永不显示「已截止」', () => {
    expect(examNodeDeadlineLabel(chengkao, shanxiNode(), NOV_19_0800_CST)).toBeNull()
    expect(examNodeDeadlineLabel(chengkao, shanxiNode(), NOV_20_0800_CST)).toBeNull()
    expect(examNodeDeadlineLabel(chengkao, shanxiNode(), NOV_21_0800_CST)).toBeNull()
  })

  it('时刻门控只在渲染层：examNodeStatus 按日期口径（11-19 / 11-20 active、11-21 done）', () => {
    expect(examNodeStatus(shanxiNode(), NOV_19_0800_CST)).toBe('active')
    expect(examNodeStatus(shanxiNode(), NOV_20_0800_CST)).toBe('active')
    expect(examNodeStatus(shanxiNode(), NOV_21_0800_CST)).toBe('done')
  })

  it('11-19 今日行 3 项（U-162 天津单日 today 进今日行；山西首日 startsToday 被海南直接节点抑制、退接续区）；11-20 山西以 endsToday 进今日行（第一遍不抑制），无 PEAK 表项故全天「进行中」', () => {
    const items19 = todayNodes(NOV_19_0800_CST)
    expect(items19).toHaveLength(3)
    // U-234：按目标时刻升序——上海自考 10:00 开通排首位、海南 17:00、天津 18:00；
    // startsToday 不再无条件沉底。
    expect(items19.map((t) => t.node.label)).toEqual(['成绩查询', '海南成绩查询', '天津成绩复核'])
    expect(items19.map((t) => t.node.label)).not.toContain('山西成绩复核')
    expect(todayFollowUpNodes(NOV_19_0800_CST).map((t) => t.node.label)).toContain('山西成绩复核')
    // 11-20：山西末日 endsToday 进今日行，不再进接续区；今日行 6 项（广东 today +
    // 江西/新疆/山西/江苏 endsToday + 上海 startsToday）
    const items20 = todayNodes(NOV_20_0800_CST)
    expect(items20).toHaveLength(6)
    const shanxi20 = items20.find((t) => t.exam.id === 'chengkao' && t.node.label === '山西成绩复核')
    expect(shanxi20?.kind).toBe('endsToday')
    expect(todayFollowUpNodes(NOV_20_0800_CST).map((t) => t.node.label)).not.toContain('山西成绩复核')
    // 无表项：末日全天 examNodeDeadlineLabel 为 null，组合文案恒为状态文案「进行中」
    expect(examNodeDeadlineLabel(chengkao, shanxiNode(), NOV_20_0800_CST)).toBeNull()
    expect(todayNodeDeadlineMs(shanxi20!)).toBeUndefined()
  })
})

describe('U-162 天津成考成绩复核（转载级，入 PEAK 表 11-19 18:00）', () => {
  // 查找包成函数：实现未落盘时顶层 find 会在收集期抛错、整文件 0 跑；
  // 各 it 内调用，失败只落本 it。
  const tianjinNode = () => chengkao.nodes.find((n) => n.label === '天津成绩复核')!
  /** 2026-11-19 08:00 北京时间（复核单日） */
  const NOV_19_0800_CST = Date.UTC(2026, 10, 19, 0, 0, 0)
  /** 2026-11-19 17:59:59 北京时间 = UTC 09:59:59（18:00 边界前 1 秒） */
  const NOV_19_175959_CST = Date.UTC(2026, 10, 19, 9, 59, 59)
  /** 2026-11-19 18:00:00 北京时间 = UTC 10:00:00（复核截止目标时刻） */
  const NOV_19_180000_CST = Date.UTC(2026, 10, 19, 10, 0, 0)
  /** 2026-11-19 18:00:01 北京时间 = UTC 10:00:01（边界后 1 秒） */
  const NOV_19_180001_CST = Date.UTC(2026, 10, 19, 10, 0, 1)
  /** 2026-11-20 08:00 北京时间（复核单日已过） */
  const NOV_20_0800_CST = Date.UTC(2026, 10, 20, 0, 0, 0)
  /** 2026-11-21 08:00 北京时间（复核单日已过次日） */
  const NOV_21_0800_CST = Date.UTC(2026, 10, 21, 0, 0, 0)

  it('节点落库：单日 11-19，无 url；detail 逐字口径 + 转载级标注', () => {
    const node = tianjinNode()
    expect(node.startISO).toBe('2026-11-19')
    expect(node.endISO).toBe('2026-11-19')
    expect(node.url).toBeUndefined()
    expect(node.detail).toBe(
      '11 月 19 日 9:00 至 18:00 网上申请缴费；复核结果 11 月 25 日 9:00 至 11 月 30 日 17:00 可查（转载级、未见官方原文，待官方原文核实后升级）',
    )
    expect(node.detail).toContain('转载级')
    expect(node.detail).toContain('未见官方原文')
    expect(node.detail).toContain('待官方原文核实后升级')
  })

  it('底线守卫：不写「据官网公告」、不写「逾期不予受理」、不写「现场办理」、不写 2025 口径、不写来源 URL 与移动端限制', () => {
    const node = tianjinNode()
    expect(node.detail).not.toContain('官网公告')
    expect(node.detail).not.toContain('逾期不予受理')
    expect(node.detail).not.toContain('现场办理')
    // eol.cn 2025 口径（11-19 09:00–11-20 12:00 现场办理）绝不复刻：
    // 2026 节点是单日，不写 11 月 20 日
    expect(node.detail).not.toContain('11 月 20 日')
    expect(node.detail).not.toMatch(/11 月 20 日 12:00/)
    // 来源 URL 与移动端限制只进源码注释，不进面向用户的 detail
    expect(node.detail).not.toContain('hqwx')
    expect(node.detail).not.toContain('zhaokao')
    expect(node.detail).not.toContain('移动端')
    expect(node.detail).not.toContain('招考资讯网')
  })

  it('天津入 PEAK 表：todayNodeDeadlineMs 为 11-19 18:00（北京时间 = UTC 10:00）', () => {
    const byKey19 = new Map(
      todayNodes(NOV_19_0800_CST).map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    expect(todayNodeDeadlineMs(byKey19.get('chengkao:天津成绩复核')!)).toBe(
      Date.UTC(2026, 10, 19, 10, 0, 0),
    )
    // 陷阱守卫：绝不是京考/文职 11-18 18:00（date 不同）；绝不是海南 11-19
    // 17:00 开通时刻；绝不是结果窗口 11-25 09:00 开通时刻与 11-30 17:00 末端
    const ms = todayNodeDeadlineMs(byKey19.get('chengkao:天津成绩复核')!)
    expect(ms).not.toBe(Date.UTC(2026, 10, 18, 10, 0, 0))
    expect(ms).not.toBe(Date.UTC(2026, 10, 19, 9, 0, 0))
    expect(ms).not.toBe(Date.UTC(2026, 10, 25, 1, 0, 0))
    expect(ms).not.toBe(Date.UTC(2026, 10, 30, 9, 0, 0))
  })

  it('边界三则：17:59:59 null → 18:00:00「已截止」→ 18:00:01「已截止」；组合文案 18:00 前「今天」', () => {
    expect(examNodeDeadlineLabel(chengkao, tianjinNode(), NOV_19_175959_CST)).toBeNull()
    expect(examNodeDeadlineLabel(chengkao, tianjinNode(), NOV_19_180000_CST)).toBe('已截止')
    expect(examNodeDeadlineLabel(chengkao, tianjinNode(), NOV_19_180001_CST)).toBe('已截止')
    expect(nodeDeadlineDisplayLabel(chengkao, tianjinNode(), NOV_19_175959_CST)).toBe('今天')
    // helper 层 18:00 起返回「已截止」；渲染层 kind today + hideWhenPassed，
    // chip 挂载后直接消失、不显示该「已截止」（见 countdown C9 与 zone 接线，
    // 与广东复核 11-20 15:00 同款）
    expect(nodeDeadlineDisplayLabel(chengkao, tianjinNode(), NOV_19_180000_CST)).toBe('已截止')
  })

  it('时刻门控只在渲染层：examNodeStatus 按日期口径（11-19 today、11-20 / 11-21 done）', () => {
    expect(examNodeStatus(tianjinNode(), NOV_19_180000_CST)).toBe('today')
    expect(examNodeStatus(tianjinNode(), NOV_20_0800_CST)).toBe('done')
    expect(examNodeStatus(tianjinNode(), NOV_21_0800_CST)).toBe('done')
  })

  it('11-19 今日行 3 项（U-234：上海 10:00 → 海南 17:00 → 天津 18:00）；天津不进接续区；11-20 今日行仍 6 项、天津已 done 不进', () => {
    const items19 = todayNodes(NOV_19_0800_CST)
    expect(items19).toHaveLength(3)
    expect(items19.map((t) => `${t.exam.id}:${t.node.label}`)).toEqual([
      'shanghai-zikao:成绩查询',
      'chengkao:海南成绩查询',
      'chengkao:天津成绩复核',
    ])
    const tj19 = items19.find((t) => t.exam.id === 'chengkao' && t.node.label === '天津成绩复核')
    expect(tj19?.kind).toBe('today')
    expect(tj19?.node.url).toBeUndefined()
    expect(todayNodeDeadlineMs(tj19!)).toBe(Date.UTC(2026, 10, 19, 10, 0, 0))
    expect(todayFollowUpNodes(NOV_19_0800_CST).map((t) => t.node.label)).not.toContain('天津成绩复核')
    // U-279：天津成绩复核结果查询 11-25 开启，11-19 当天已可办（upcoming）进接续区，接续区 6→7 项
    expect(todayFollowUpNodes(NOV_19_0800_CST)).toHaveLength(7)
    expect(todayFollowUpNodes(NOV_19_0800_CST).map((t) => t.node.label)).toContain('天津成绩复核结果查询')
    const items20 = todayNodes(NOV_20_0800_CST)
    expect(items20).toHaveLength(6)
    expect(items20.map((t) => t.node.label)).not.toContain('天津成绩复核')
    expect(todayFollowUpNodes(NOV_20_0800_CST).map((t) => t.node.label)).not.toContain('天津成绩复核')
  })
})

describe('U-279 天津成考成绩复核结果查询（转载级，入 PEAK 表 11-30 17:00）', () => {
  // 查找包成函数：实现未落盘时顶层 find 会在收集期抛错、整文件 0 跑；
  // 各 it 内调用，失败只落本 it。
  const tjResultNode = () => chengkao.nodes.find((n) => n.label === '天津成绩复核结果查询')!
  /** 2026-11-25 08:00 北京时间（结果查询窗口首日） */
  const NOV_25_0800_CST = Date.UTC(2026, 10, 25, 0, 0, 0)
  /** 2026-11-30 08:00 北京时间（结果查询窗口末日白天） */
  const NOV_30_0800_CST = Date.UTC(2026, 10, 30, 0, 0, 0)
  /** 2026-11-30 16:59:59 北京时间 = UTC 08:59:59（结果查询边界前 1 秒） */
  const NOV_30_165959_CST = Date.UTC(2026, 10, 30, 8, 59, 59)
  /** 2026-11-30 17:00:00 北京时间 = UTC 09:00:00（结果查询截止目标时刻） */
  const NOV_30_170000_CST = Date.UTC(2026, 10, 30, 9, 0, 0)
  /** 2026-11-30 17:00:01 北京时间 = UTC 09:00:01（边界后 1 秒） */
  const NOV_30_170001_CST = Date.UTC(2026, 10, 30, 9, 0, 1)
  /** 2026-12-01 08:00 北京时间（结果查询窗口已过） */
  const DEC_01_0800_CST = Date.UTC(2026, 11, 1, 0, 0, 0)

  it('节点落库：多日 11-25→11-30，无 url；detail 逐字口径 + 转载级标注', () => {
    const node = tjResultNode()
    expect(node.startISO).toBe('2026-11-25')
    expect(node.endISO).toBe('2026-11-30')
    expect(node.url).toBeUndefined()
    expect(node.detail).toBe(
      '11 月 25 日 9:00 至 11 月 30 日 17:00 可查复核结果（招考资讯网公众服务大厅成绩查询页面 /「天津招考」微信小程序；转载级、未见官方原文，待官方原文核实后升级）',
    )
    expect(node.detail).toContain('转载级')
    expect(node.detail).toContain('未见官方原文')
    expect(node.detail).toContain('待官方原文核实后升级')
  })

  it('底线守卫：不写「据官网公告」、不写来源 URL 字符串、不写 2025 口径、不写「现场办理」', () => {
    const node = tjResultNode()
    expect(node.detail).not.toContain('官网公告')
    expect(node.detail).not.toContain('hqwx')
    expect(node.detail).not.toContain('zhaokao')
    expect(node.detail).not.toContain('http')
    expect(node.detail).not.toContain('现场办理')
    expect(node.detail).not.toContain('逾期不予受理')
    // eol.cn 2025 口径（11-19 09:00–11-20 12:00 现场办理）绝不复刻：
    // 2026 结果查询窗口是 11-25→11-30，不写 11 月 20 日
    expect(node.detail).not.toContain('11 月 20 日')
  })

  it('天津结果查询入 PEAK 表：todayNodeDeadlineMs 为 11-30 17:00（北京时间 = UTC 09:00）；11-25 09:00 开通时刻不入表', () => {
    const byKey30 = new Map(
      todayNodes(NOV_30_0800_CST).map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    expect(todayNodeDeadlineMs(byKey30.get('chengkao:天津成绩复核结果查询')!)).toBe(
      Date.UTC(2026, 10, 30, 9, 0, 0),
    )
    // 陷阱守卫：绝不是 U-162 天津成绩复核 11-19 18:00（键与日期均不同）；
    // 绝不是结果窗口 11-25 09:00 开通时刻；绝不是浙江志愿确认 11-29 17:00
    const ms = todayNodeDeadlineMs(byKey30.get('chengkao:天津成绩复核结果查询')!)
    expect(ms).not.toBe(Date.UTC(2026, 10, 19, 10, 0, 0))
    expect(ms).not.toBe(Date.UTC(2026, 10, 25, 1, 0, 0))
    expect(ms).not.toBe(Date.UTC(2026, 10, 29, 9, 0, 0))
    // 11-25 首日 helper 仍指向 11-30 17:00（开通时刻无独立表项）
    const byKey25 = new Map(
      todayNodes(NOV_25_0800_CST).map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    expect(todayNodeDeadlineMs(byKey25.get('chengkao:天津成绩复核结果查询')!)).toBe(
      Date.UTC(2026, 10, 30, 9, 0, 0),
    )
  })

  it('边界三则：11-30 16:59:59 null → 17:00:00「已截止」→ 17:00:01「已截止」；组合文案 16:59:59「进行中」；11-25 全天 helper 为 null', () => {
    expect(examNodeDeadlineLabel(chengkao, tjResultNode(), NOV_30_165959_CST)).toBeNull()
    expect(examNodeDeadlineLabel(chengkao, tjResultNode(), NOV_30_170000_CST)).toBe('已截止')
    expect(examNodeDeadlineLabel(chengkao, tjResultNode(), NOV_30_170001_CST)).toBe('已截止')
    expect(nodeDeadlineDisplayLabel(chengkao, tjResultNode(), NOV_30_165959_CST)).toBe('进行中')
    expect(nodeDeadlineDisplayLabel(chengkao, tjResultNode(), NOV_30_170000_CST)).toBe('已截止')
    expect(examNodeDeadlineLabel(chengkao, tjResultNode(), NOV_25_0800_CST)).toBeNull()
  })

  it('时刻门控只在渲染层：examNodeStatus 按日期口径（11-25 / 11-30 active、12-01 done）', () => {
    expect(examNodeStatus(tjResultNode(), NOV_25_0800_CST)).toBe('active')
    expect(examNodeStatus(tjResultNode(), NOV_30_170000_CST)).toBe('active')
    expect(examNodeStatus(tjResultNode(), DEC_01_0800_CST)).toBe('done')
  })

  it('今日行：11-25 startsToday（与浙江志愿确认同日，目标时刻升序排其后）；11-30 endsToday；12-01 不进今日行', () => {
    const ck25 = todayNodes(NOV_25_0800_CST).filter((t) => t.exam.id === 'chengkao')
    expect(ck25.map((t) => t.node.label)).toEqual(['浙江志愿确认', '天津成绩复核结果查询'])
    expect(ck25.map((t) => t.kind)).toEqual(['startsToday', 'startsToday'])
    const item30 = todayNodes(NOV_30_0800_CST).find(
      (t) => t.exam.id === 'chengkao' && t.node.label === '天津成绩复核结果查询',
    )!
    expect(item30.kind).toBe('endsToday')
    expect(todayNodeDeadlineMs(item30)).toBe(Date.UTC(2026, 10, 30, 9, 0, 0))
    expect(todayNodes(DEC_01_0800_CST).map((t) => t.node.label)).not.toContain('天津成绩复核结果查询')
    expect(todayFollowUpNodes(DEC_01_0800_CST).map((t) => t.node.label)).not.toContain('天津成绩复核结果查询')
  })
})

describe('U-158 成考三省复核 11-20 时刻门控（todayNodeDeadlineMs / examNodeDeadlineLabel）', () => {
  // 查找包成函数：实现未落盘时顶层 find 会在收集期抛错、整文件 0 跑；
  // 各 it 内调用，失败只落本 it。
  const gdReview = () => chengkao.nodes.find((n) => n.label === '广东成绩复核')!
  const xjReview = () => chengkao.nodes.find((n) => n.label === '新疆成绩复核')!
  const jxReview = () => chengkao.nodes.find((n) => n.label === '江西成绩复核')!
  /** 2026-11-19 08:00 北京时间（复核窗口未到末日：三行 helper 均为 null） */
  const NOV_19_0800_CST = Date.UTC(2026, 10, 19, 0, 0, 0)
  /** 2026-11-20 08:00 北京时间（复核末日白天） */
  const NOV_20_0800_CST = Date.UTC(2026, 10, 20, 0, 0, 0)
  /** 2026-11-20 11:59:59 北京时间 = UTC 03:59:59（新疆复核边界前 1 秒） */
  const NOV_20_115959_CST = Date.UTC(2026, 10, 20, 3, 59, 59)
  /** 2026-11-20 12:00:00 北京时间 = UTC 04:00:00（新疆复核目标时刻） */
  const NOV_20_120000_CST = Date.UTC(2026, 10, 20, 4, 0, 0)
  /** 2026-11-20 12:00:01 北京时间 = UTC 04:00:01（新疆复核边界后 1 秒） */
  const NOV_20_120001_CST = Date.UTC(2026, 10, 20, 4, 0, 1)
  /** 2026-11-20 14:59:59 北京时间 = UTC 06:59:59（广东复核边界前 1 秒） */
  const NOV_20_145959_CST = Date.UTC(2026, 10, 20, 6, 59, 59)
  /** 2026-11-20 15:00:00 北京时间 = UTC 07:00:00（广东复核目标时刻） */
  const NOV_20_150000_CST = Date.UTC(2026, 10, 20, 7, 0, 0)
  /** 2026-11-20 15:00:01 北京时间 = UTC 07:00:01（广东复核边界后 1 秒） */
  const NOV_20_150001_CST = Date.UTC(2026, 10, 20, 7, 0, 1)
  /** 2026-11-20 16:59:59 北京时间 = UTC 08:59:59（江西复核边界前 1 秒） */
  const NOV_20_165959_CST = Date.UTC(2026, 10, 20, 8, 59, 59)
  /** 2026-11-20 17:00:00 北京时间 = UTC 09:00:00（江西复核目标时刻） */
  const NOV_20_170000_CST = Date.UTC(2026, 10, 20, 9, 0, 0)
  /** 2026-11-20 17:00:01 北京时间 = UTC 09:00:01（江西复核边界后 1 秒） */
  const NOV_20_170001_CST = Date.UTC(2026, 10, 20, 9, 0, 1)
  /** 2026-11-20 17:30 北京时间 = UTC 09:30:00（三省截止后半小时：门控取舍回归时刻） */
  const NOV_20_173000_CST = Date.UTC(2026, 10, 20, 9, 30, 0)

  it('三目标时刻毫秒值：广东复核 11-20 15:00、新疆复核 11-20 12:00、江西复核 11-20 17:00', () => {
    const byKey20 = new Map(
      todayNodes(NOV_20_0800_CST).map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    expect(todayNodeDeadlineMs(byKey20.get('chengkao:广东成绩复核')!)).toBe(
      Date.UTC(2026, 10, 20, 7, 0, 0),
    )
    expect(todayNodeDeadlineMs(byKey20.get('chengkao:新疆成绩复核')!)).toBe(
      Date.UTC(2026, 10, 20, 4, 0, 0),
    )
    expect(todayNodeDeadlineMs(byKey20.get('chengkao:江西成绩复核')!)).toBe(
      Date.UTC(2026, 10, 20, 9, 0, 0),
    )
  })

  it('陷阱守卫三则：广东复核 ≠ 广东自考 11-18 15:00、≠ 成考广东查分 16:20；新疆复核 ≠ 新疆查分 11-18 12:00；江西复核 ≠ 11-18 17:00', () => {
    const byKey20 = new Map(
      todayNodes(NOV_20_0800_CST).map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    const gd = todayNodeDeadlineMs(byKey20.get('chengkao:广东成绩复核')!)
    expect(gd).toBe(Date.UTC(2026, 10, 20, 7, 0, 0))
    expect(gd).not.toBe(Date.UTC(2026, 10, 18, 7, 0, 0))
    expect(gd).not.toBe(Date.UTC(2026, 10, 18, 8, 20, 0))
    const xj = todayNodeDeadlineMs(byKey20.get('chengkao:新疆成绩复核')!)
    expect(xj).toBe(Date.UTC(2026, 10, 20, 4, 0, 0))
    expect(xj).not.toBe(Date.UTC(2026, 10, 18, 4, 0, 0))
    const jx = todayNodeDeadlineMs(byKey20.get('chengkao:江西成绩复核')!)
    expect(jx).toBe(Date.UTC(2026, 10, 20, 9, 0, 0))
    expect(jx).not.toBe(Date.UTC(2026, 10, 18, 9, 0, 0))
  })

  it('边界三则：新疆 11:59:59 null → 12:00:00「已截止」→ 12:00:01「已截止」；广东 14:59:59 null → 15:00:00「已截止」→ 15:00:01「已截止」；江西 16:59:59 null → 17:00:00「已截止」→ 17:00:01「已截止」', () => {
    expect(examNodeDeadlineLabel(chengkao, xjReview(), NOV_20_115959_CST)).toBeNull()
    expect(examNodeDeadlineLabel(chengkao, xjReview(), NOV_20_120000_CST)).toBe('已截止')
    expect(examNodeDeadlineLabel(chengkao, xjReview(), NOV_20_120001_CST)).toBe('已截止')
    expect(examNodeDeadlineLabel(chengkao, gdReview(), NOV_20_145959_CST)).toBeNull()
    expect(examNodeDeadlineLabel(chengkao, gdReview(), NOV_20_150000_CST)).toBe('已截止')
    expect(examNodeDeadlineLabel(chengkao, gdReview(), NOV_20_150001_CST)).toBe('已截止')
    expect(examNodeDeadlineLabel(chengkao, jxReview(), NOV_20_165959_CST)).toBeNull()
    expect(examNodeDeadlineLabel(chengkao, jxReview(), NOV_20_170000_CST)).toBe('已截止')
    expect(examNodeDeadlineLabel(chengkao, jxReview(), NOV_20_170001_CST)).toBe('已截止')
    // 组合文案：新疆/江西末日 active →「进行中」/「已截止」；广东单日 today →「今天」/「已截止」
    expect(nodeDeadlineDisplayLabel(chengkao, xjReview(), NOV_20_115959_CST)).toBe('进行中')
    expect(nodeDeadlineDisplayLabel(chengkao, xjReview(), NOV_20_120000_CST)).toBe('已截止')
    expect(nodeDeadlineDisplayLabel(chengkao, gdReview(), NOV_20_145959_CST)).toBe('今天')
    expect(nodeDeadlineDisplayLabel(chengkao, gdReview(), NOV_20_150000_CST)).toBe('已截止')
    expect(nodeDeadlineDisplayLabel(chengkao, jxReview(), NOV_20_165959_CST)).toBe('进行中')
    expect(nodeDeadlineDisplayLabel(chengkao, jxReview(), NOV_20_170000_CST)).toBe('已截止')
  })

  it('时刻门控只在渲染层：目标时刻 examNodeStatus 仍按日期口径（广东 today、新疆/江西 active）；11-19 全天三行 helper 均为 null', () => {
    expect(examNodeStatus(gdReview(), NOV_20_150000_CST)).toBe('today')
    expect(examNodeStatus(xjReview(), NOV_20_120000_CST)).toBe('active')
    expect(examNodeStatus(jxReview(), NOV_20_170000_CST)).toBe('active')
    expect(examNodeDeadlineLabel(chengkao, gdReview(), NOV_19_0800_CST)).toBeNull()
    expect(examNodeDeadlineLabel(chengkao, xjReview(), NOV_19_0800_CST)).toBeNull()
    expect(examNodeDeadlineLabel(chengkao, jxReview(), NOV_19_0800_CST)).toBeNull()
  })

  it('11-20 今日行 kind 分流：广东 today、新疆/江西/山西 endsToday（与江苏复核 endsToday 同表）、上海自考成绩复核 startsToday；今日行 6 项', () => {
    const items20 = todayNodes(NOV_20_0800_CST)
    expect(items20).toHaveLength(6)
    const byKey = new Map(
      items20.map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    expect(byKey.get('chengkao:广东成绩复核')?.kind).toBe('today')
    expect(byKey.get('chengkao:新疆成绩复核')?.kind).toBe('endsToday')
    expect(byKey.get('chengkao:江西成绩复核')?.kind).toBe('endsToday')
    // U-160：山西复核 11-19→11-20 多日窗口，末日 endsToday 第一遍不抑制，进今日行；
    // 无 PEAK 表项，全天「进行中」、不翻「已截止」（见 U-160 describe）
    expect(byKey.get('chengkao:山西成绩复核')?.kind).toBe('endsToday')
    expect(byKey.get('jiangsu-zikao:成绩复核')?.kind).toBe('endsToday')
    expect(byKey.get('shanghai-zikao:成绩复核')?.kind).toBe('startsToday')
  })

  it('门控取舍回归：11-20 17:30 三节点仍可办（isNodeActionable true）、下一步仍是本场节点（午夜才翻）', () => {
    expect(isNodeActionable(gdReview(), chengkao, NOV_20_173000_CST)).toBe(true)
    expect(isNodeActionable(xjReview(), chengkao, NOV_20_173000_CST)).toBe(true)
    expect(isNodeActionable(jxReview(), chengkao, NOV_20_173000_CST)).toBe(true)
    // 按 startISO 排序，首个可办的是新疆复核（11-18 起始的三省查分行均已 done）
    expect(nextExamNode(chengkao, NOV_20_173000_CST)?.label).toBe('新疆成绩复核')
  })
})

describe('U-222 12 月峰值周末七节点时刻门控（todayNodeDeadlineMs / examNodeDeadlineLabel）', () => {
  // 查找包成函数：实现未落盘时顶层 find 会在收集期抛错、整文件 0 跑；
  // 各 it 内调用，失败只落本 it。
  const shengkao = () => EXAMS.find((e) => e.id === 'shengkao')!
  const shanghaiZikao = () => EXAMS.find((e) => e.id === 'shanghai-zikao')!
  const zhejiangVolunteer = () => chengkao.nodes.find((n) => n.label === '浙江志愿确认')!
  const shanghaiAdmit = () => shengkao().nodes.find((n) => n.label === '上海准考证打印')!
  const shandongAdmit = () => shengkao().nodes.find((n) => n.label === '山东准考证打印')!
  const zhejiangAdmit = () => shengkao().nodes.find((n) => n.label === '浙江准考证打印')!
  const jiangsuAdmit = () => shengkao().nodes.find((n) => n.label === '江苏准考证打印')!
  const jingkaoAdmit = () => jingkao.nodes.find((n) => n.label === '准考证打印')!
  const junduiAdmit = () => jundui.nodes.find((n) => n.label === '准考证打印')!
  const shanghaiQuery = () => shanghaiZikao().nodes.find((n) => n.label === '成绩查询')!
  /** 2026-11-29 08:00 北京时间（浙江志愿确认末日白天） */
  const NOV_29_0800_CST = Date.UTC(2026, 10, 29, 0, 0, 0)
  /** 2026-11-29 16:59:59 北京时间 = UTC 08:59:59（浙江志愿确认边界前 1 秒） */
  const NOV_29_165959_CST = Date.UTC(2026, 10, 29, 8, 59, 59)
  /** 2026-11-29 17:00:00 北京时间 = UTC 09:00:00（浙江志愿确认目标时刻） */
  const NOV_29_170000_CST = Date.UTC(2026, 10, 29, 9, 0, 0)
  /** 2026-11-29 17:00:01 北京时间 = UTC 09:00:01（浙江志愿确认边界后 1 秒） */
  const NOV_29_170001_CST = Date.UTC(2026, 10, 29, 9, 0, 1)
  /** 2026-12-05 08:00 北京时间（上海省考准考证末日白天） */
  const DEC_05_0800_CST = Date.UTC(2026, 11, 5, 0, 0, 0)
  /** 2026-12-05 17:59:59 北京时间 = UTC 09:59:59（上海省考准考证边界前 1 秒） */
  const DEC_05_175959_CST = Date.UTC(2026, 11, 5, 9, 59, 59)
  /** 2026-12-05 18:00:00 北京时间 = UTC 10:00:00（上海省考准考证目标时刻） */
  const DEC_05_180000_CST = Date.UTC(2026, 11, 5, 10, 0, 0)
  /** 2026-12-05 18:00:01 北京时间 = UTC 10:00:01（上海省考准考证边界后 1 秒） */
  const DEC_05_180001_CST = Date.UTC(2026, 11, 5, 10, 0, 1)
  /** 2026-12-06 08:00 北京时间（12-06 峰值日白天） */
  const DEC_06_0800_CST = Date.UTC(2026, 11, 6, 0, 0, 0)
  /** 2026-12-06 14:14:59 北京时间 = UTC 06:14:59（山东准考证边界前 1 秒） */
  const DEC_06_141459_CST = Date.UTC(2026, 11, 6, 6, 14, 59)
  /** 2026-12-06 14:15:00 北京时间 = UTC 06:15:00（山东准考证目标时刻） */
  const DEC_06_141500_CST = Date.UTC(2026, 11, 6, 6, 15, 0)
  /** 2026-12-06 14:15:01 北京时间 = UTC 06:15:01（山东准考证边界后 1 秒） */
  const DEC_06_141501_CST = Date.UTC(2026, 11, 6, 6, 15, 1)
  /** 2026-12-06 14:59:59 北京时间 = UTC 06:59:59（江苏准考证边界前 1 秒） */
  const DEC_06_145959_CST = Date.UTC(2026, 11, 6, 6, 59, 59)
  /** 2026-12-06 15:00:00 北京时间 = UTC 07:00:00（江苏准考证目标时刻） */
  const DEC_06_150000_CST = Date.UTC(2026, 11, 6, 7, 0, 0)
  /** 2026-12-06 15:00:01 北京时间 = UTC 07:00:01（江苏准考证边界后 1 秒） */
  const DEC_06_150001_CST = Date.UTC(2026, 11, 6, 7, 0, 1)
  /** 2026-12-06 16:29:59 北京时间 = UTC 08:29:59（京考准考证边界前 1 秒） */
  const DEC_06_162959_CST = Date.UTC(2026, 11, 6, 8, 29, 59)
  /** 2026-12-06 16:30:00 北京时间 = UTC 08:30:00（京考准考证目标时刻） */
  const DEC_06_163000_CST = Date.UTC(2026, 11, 6, 8, 30, 0)
  /** 2026-12-06 16:30:01 北京时间 = UTC 08:30:01（京考准考证边界后 1 秒） */
  const DEC_06_163001_CST = Date.UTC(2026, 11, 6, 8, 30, 1)
  /** 2026-12-06 16:59:59 北京时间 = UTC 08:59:59（浙江准考证边界前 1 秒） */
  const DEC_06_165959_CST = Date.UTC(2026, 11, 6, 8, 59, 59)
  /** 2026-12-06 17:00:00 北京时间 = UTC 09:00:00（浙江准考证目标时刻） */
  const DEC_06_170000_CST = Date.UTC(2026, 11, 6, 9, 0, 0)
  /** 2026-12-06 17:00:01 北京时间 = UTC 09:00:01（浙江准考证边界后 1 秒） */
  const DEC_06_170001_CST = Date.UTC(2026, 11, 6, 9, 0, 1)
  /** 2026-12-13 08:00 北京时间（文职准考证末日白天） */
  const DEC_13_0800_CST = Date.UTC(2026, 11, 13, 0, 0, 0)
  /** 2026-12-13 13:59:59 北京时间 = UTC 05:59:59（文职准考证边界前 1 秒） */
  const DEC_13_135959_CST = Date.UTC(2026, 11, 13, 5, 59, 59)
  /** 2026-12-13 14:00:00 北京时间 = UTC 06:00:00（文职准考证目标时刻） */
  const DEC_13_140000_CST = Date.UTC(2026, 11, 13, 6, 0, 0)
  /** 2026-12-13 14:00:01 北京时间 = UTC 06:00:01（文职准考证边界后 1 秒） */
  const DEC_13_140001_CST = Date.UTC(2026, 11, 13, 6, 0, 1)
  /** 2026-12-18 08:00 北京时间（上海自考成绩查询末日白天） */
  const DEC_18_0800_CST = Date.UTC(2026, 11, 18, 0, 0, 0)
  /** 2026-12-18 16:00:00 北京时间 = UTC 08:00:00（上海自考成绩查询窗口关闭时刻，不入表） */
  const DEC_18_160000_CST = Date.UTC(2026, 11, 18, 8, 0, 0)

  it('七目标时刻毫秒值：浙江志愿 11-29 17:00、上海省考 12-05 18:00、京考 12-06 16:30、山东 12-06 14:15、浙江 12-06 17:00、江苏 12-06 15:00、文职 12-13 14:00', () => {
    const byKey29 = new Map(
      todayNodes(NOV_29_0800_CST).map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    expect(todayNodeDeadlineMs(byKey29.get('chengkao:浙江志愿确认')!)).toBe(
      Date.UTC(2026, 10, 29, 9, 0, 0),
    )
    const byKey05 = new Map(
      todayNodes(DEC_05_0800_CST).map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    expect(todayNodeDeadlineMs(byKey05.get('shengkao:上海准考证打印')!)).toBe(
      Date.UTC(2026, 11, 5, 10, 0, 0),
    )
    const byKey06 = new Map(
      todayNodes(DEC_06_0800_CST).map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    expect(todayNodeDeadlineMs(byKey06.get('jingkao:准考证打印')!)).toBe(
      Date.UTC(2026, 11, 6, 8, 30, 0),
    )
    expect(todayNodeDeadlineMs(byKey06.get('shengkao:山东准考证打印')!)).toBe(
      Date.UTC(2026, 11, 6, 6, 15, 0),
    )
    expect(todayNodeDeadlineMs(byKey06.get('shengkao:浙江准考证打印')!)).toBe(
      Date.UTC(2026, 11, 6, 9, 0, 0),
    )
    expect(todayNodeDeadlineMs(byKey06.get('shengkao:江苏准考证打印')!)).toBe(
      Date.UTC(2026, 11, 6, 7, 0, 0),
    )
    const byKey13 = new Map(
      todayNodes(DEC_13_0800_CST).map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    expect(todayNodeDeadlineMs(byKey13.get('jundui-wenzhi:准考证打印')!)).toBe(
      Date.UTC(2026, 11, 13, 6, 0, 0),
    )
  })

  it('陷阱守卫四则：浙江志愿 17:00 ≠ 浙江准考证 17:00；京考 16:30 ≠ 国考 11-29 15:00；山东 14:15 / 浙江 17:00 / 江苏 15:00 键不同；上海省考 12-05 18:00 ≠ 上海自考 12-18 16:00（后者不入表）', () => {
    const byKey29 = new Map(
      todayNodes(NOV_29_0800_CST).map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    const volunteer = todayNodeDeadlineMs(byKey29.get('chengkao:浙江志愿确认')!)
    expect(volunteer).toBe(Date.UTC(2026, 10, 29, 9, 0, 0))
    // 同为 17:00、不同键不同日期：志愿确认 11-29，准考证 12-06
    expect(volunteer).not.toBe(Date.UTC(2026, 11, 6, 9, 0, 0))
    const byKey06 = new Map(
      todayNodes(DEC_06_0800_CST).map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    const jingkaoMs = todayNodeDeadlineMs(byKey06.get('jingkao:准考证打印')!)
    expect(jingkaoMs).toBe(Date.UTC(2026, 11, 6, 8, 30, 0))
    // 京考 12-06 16:30 绝不是国考准考证 11-29 15:00（键与日期均不同）
    expect(jingkaoMs).not.toBe(Date.UTC(2026, 10, 29, 7, 0, 0))
    const shandong = todayNodeDeadlineMs(byKey06.get('shengkao:山东准考证打印')!)
    const zhejiang = todayNodeDeadlineMs(byKey06.get('shengkao:浙江准考证打印')!)
    const jiangsu = todayNodeDeadlineMs(byKey06.get('shengkao:江苏准考证打印')!)
    expect(shandong).toBe(Date.UTC(2026, 11, 6, 6, 15, 0))
    expect(zhejiang).toBe(Date.UTC(2026, 11, 6, 9, 0, 0))
    expect(jiangsu).toBe(Date.UTC(2026, 11, 6, 7, 0, 0))
    expect(shandong).not.toBe(zhejiang)
    expect(shandong).not.toBe(jiangsu)
    expect(zhejiang).not.toBe(jiangsu)
    // 上海省考 12-05 18:00 与上海自考 12-18 16:00 是两场考试的两个窗口
    const byKey05 = new Map(
      todayNodes(DEC_05_0800_CST).map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    expect(todayNodeDeadlineMs(byKey05.get('shengkao:上海准考证打印')!)).toBe(
      Date.UTC(2026, 11, 5, 10, 0, 0),
    )
    const byKey18 = new Map(
      todayNodes(DEC_18_0800_CST).map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    expect(todayNodeDeadlineMs(byKey18.get('shanghai-zikao:成绩查询')!)).toBeUndefined()
  })

  it('边界七则：浙江志愿 16:59:59 null → 17:00:00「已截止」；上海省考 17:59:59 null → 18:00:00「已截止」；山东 14:14:59 null → 14:15:00「已截止」；江苏 14:59:59 null → 15:00:00「已截止」；京考 16:29:59 null → 16:30:00「已截止」；浙江 16:59:59 null → 17:00:00「已截止」；文职 13:59:59 null → 14:00:00「已截止」（各含后 1 秒）', () => {
    expect(examNodeDeadlineLabel(chengkao, zhejiangVolunteer(), NOV_29_165959_CST)).toBeNull()
    expect(examNodeDeadlineLabel(chengkao, zhejiangVolunteer(), NOV_29_170000_CST)).toBe('已截止')
    expect(examNodeDeadlineLabel(chengkao, zhejiangVolunteer(), NOV_29_170001_CST)).toBe('已截止')
    expect(examNodeDeadlineLabel(shengkao(), shanghaiAdmit(), DEC_05_175959_CST)).toBeNull()
    expect(examNodeDeadlineLabel(shengkao(), shanghaiAdmit(), DEC_05_180000_CST)).toBe('已截止')
    expect(examNodeDeadlineLabel(shengkao(), shanghaiAdmit(), DEC_05_180001_CST)).toBe('已截止')
    expect(examNodeDeadlineLabel(shengkao(), shandongAdmit(), DEC_06_141459_CST)).toBeNull()
    expect(examNodeDeadlineLabel(shengkao(), shandongAdmit(), DEC_06_141500_CST)).toBe('已截止')
    expect(examNodeDeadlineLabel(shengkao(), shandongAdmit(), DEC_06_141501_CST)).toBe('已截止')
    expect(examNodeDeadlineLabel(shengkao(), jiangsuAdmit(), DEC_06_145959_CST)).toBeNull()
    expect(examNodeDeadlineLabel(shengkao(), jiangsuAdmit(), DEC_06_150000_CST)).toBe('已截止')
    expect(examNodeDeadlineLabel(shengkao(), jiangsuAdmit(), DEC_06_150001_CST)).toBe('已截止')
    expect(examNodeDeadlineLabel(jingkao, jingkaoAdmit(), DEC_06_162959_CST)).toBeNull()
    expect(examNodeDeadlineLabel(jingkao, jingkaoAdmit(), DEC_06_163000_CST)).toBe('已截止')
    expect(examNodeDeadlineLabel(jingkao, jingkaoAdmit(), DEC_06_163001_CST)).toBe('已截止')
    expect(examNodeDeadlineLabel(shengkao(), zhejiangAdmit(), DEC_06_165959_CST)).toBeNull()
    expect(examNodeDeadlineLabel(shengkao(), zhejiangAdmit(), DEC_06_170000_CST)).toBe('已截止')
    expect(examNodeDeadlineLabel(shengkao(), zhejiangAdmit(), DEC_06_170001_CST)).toBe('已截止')
    expect(examNodeDeadlineLabel(jundui, junduiAdmit(), DEC_13_135959_CST)).toBeNull()
    expect(examNodeDeadlineLabel(jundui, junduiAdmit(), DEC_13_140000_CST)).toBe('已截止')
    expect(examNodeDeadlineLabel(jundui, junduiAdmit(), DEC_13_140001_CST)).toBe('已截止')
    // 组合文案：七者皆为多日窗口末日 active → 边界前「进行中」、整点起「已截止」
    expect(nodeDeadlineDisplayLabel(chengkao, zhejiangVolunteer(), NOV_29_165959_CST)).toBe('进行中')
    expect(nodeDeadlineDisplayLabel(chengkao, zhejiangVolunteer(), NOV_29_170000_CST)).toBe('已截止')
    expect(nodeDeadlineDisplayLabel(shengkao(), shanghaiAdmit(), DEC_05_175959_CST)).toBe('进行中')
    expect(nodeDeadlineDisplayLabel(shengkao(), shanghaiAdmit(), DEC_05_180000_CST)).toBe('已截止')
    expect(nodeDeadlineDisplayLabel(jingkao, jingkaoAdmit(), DEC_06_162959_CST)).toBe('进行中')
    expect(nodeDeadlineDisplayLabel(jingkao, jingkaoAdmit(), DEC_06_163000_CST)).toBe('已截止')
    expect(nodeDeadlineDisplayLabel(jundui, junduiAdmit(), DEC_13_135959_CST)).toBe('进行中')
    expect(nodeDeadlineDisplayLabel(jundui, junduiAdmit(), DEC_13_140000_CST)).toBe('已截止')
  })

  it('上海自考成绩查询 12-18 16:00 不入表（U-163 定论，U-222 复核）：11-19 与 12-18 两日 todayNodeDeadlineMs 均为 undefined；12-18 16:00 helper 仍为 null', () => {
    // U-163 复审必改 1 已定论：11-19 当天 chip 会渲染「剩 700+ 小时」；
    // 12-18 16:00 虽是查询窗口真截止，但须先把 chip 改为仅目标日渲染方可入表。
    const byKey19 = new Map(
      todayNodes(NOV_19_0800_CST).map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    expect(todayNodeDeadlineMs(byKey19.get('shanghai-zikao:成绩查询')!)).toBeUndefined()
    const byKey18 = new Map(
      todayNodes(DEC_18_0800_CST).map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    expect(todayNodeDeadlineMs(byKey18.get('shanghai-zikao:成绩查询')!)).toBeUndefined()
    expect(examNodeDeadlineLabel(shanghaiZikao(), shanghaiQuery(), DEC_18_160000_CST)).toBeNull()
    expect(nodeDeadlineDisplayLabel(shanghaiZikao(), shanghaiQuery(), DEC_18_160000_CST)).toBe('进行中')
  })

  it('四日今日行 kind 分流：11-29 3 项、12-05 5 项、12-06 8 项、12-13 2 项（七节点末日皆为 endsToday；C4：12-05 多广东自考·1月网上缴费末日）', () => {
    const items29 = todayNodes(NOV_29_0800_CST)
    expect(items29).toHaveLength(3)
    const byKey29 = new Map(
      items29.map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    expect(byKey29.get('chengkao:浙江志愿确认')?.kind).toBe('endsToday')
    const items05 = todayNodes(DEC_05_0800_CST)
    expect(items05).toHaveLength(5)
    const byKey05 = new Map(
      items05.map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    expect(byKey05.get('shengkao:上海准考证打印')?.kind).toBe('endsToday')
    expect(byKey05.get('guangdong-zikao-2027-01:网上缴费')?.kind).toBe('endsToday')
    const items06 = todayNodes(DEC_06_0800_CST)
    expect(items06).toHaveLength(8)
    const byKey06 = new Map(
      items06.map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    expect(byKey06.get('jingkao:准考证打印')?.kind).toBe('endsToday')
    expect(byKey06.get('shengkao:山东准考证打印')?.kind).toBe('endsToday')
    expect(byKey06.get('shengkao:浙江准考证打印')?.kind).toBe('endsToday')
    expect(byKey06.get('shengkao:江苏准考证打印')?.kind).toBe('endsToday')
    const items13 = todayNodes(DEC_13_0800_CST)
    expect(items13).toHaveLength(2)
    const byKey13 = new Map(
      items13.map((t) => [`${t.exam.id}:${t.node.label}`, t] as const),
    )
    expect(byKey13.get('jundui-wenzhi:准考证打印')?.kind).toBe('endsToday')
  })

  it('时刻门控只在渲染层：目标时刻 examNodeStatus 仍按日期口径（七节点末日皆为 active）', () => {
    expect(examNodeStatus(zhejiangVolunteer(), NOV_29_170000_CST)).toBe('active')
    expect(examNodeStatus(shanghaiAdmit(), DEC_05_180000_CST)).toBe('active')
    expect(examNodeStatus(shandongAdmit(), DEC_06_141500_CST)).toBe('active')
    expect(examNodeStatus(jiangsuAdmit(), DEC_06_150000_CST)).toBe('active')
    expect(examNodeStatus(jingkaoAdmit(), DEC_06_163000_CST)).toBe('active')
    expect(examNodeStatus(zhejiangAdmit(), DEC_06_170000_CST)).toBe('active')
    expect(examNodeStatus(junduiAdmit(), DEC_13_140000_CST)).toBe('active')
  })
})

/**
 * 国考广东考区模拟核验（2026-11-27 用户裁决：只加国考广东这一条）：
 * post_4985097，广东省人事考试局 2026-11-26 发布，2026-11-27
 * browser.open 直读逐字：模拟核验 11-26 9:00 至 11-28 10:00，微信扫码
 * 登录考生报到小程序；正式核验为考试当天开考前 90 分钟到考点扫码。
 * 遴选/选调广东考区是另一篇 post_4985108（至 11-27 17:00，已截止），
 * 不加，两篇不得混同。目标时刻：11-28 10:00 = Date.UTC(2026, 10, 28, 2, 0, 0)。
 */
describe('国考广东考区模拟核验 10:00 时刻门控（post_4985097）', () => {
  const mockVerify = guokao.nodes.find((n) => n.label === '广东考区模拟核验')!

  it('节点窗口 11-26→11-28，detail 写明 11 月 28 日 10:00 截止与小程序扫码', () => {
    expect(mockVerify.startISO).toBe('2026-11-26')
    expect(mockVerify.endISO).toBe('2026-11-28')
    expect(mockVerify.detail).toContain('11 月 28 日 10:00')
    expect(mockVerify.detail).toContain('考生报到小程序')
    expect(mockVerify.url).toBe(
      'https://rsks.gd.gov.cn/zwgk/gzdt/content/post_4985097.html',
    )
  })

  it('PEAK 表目标时刻为 11-28 10:00', () => {
    expect(
      todayNodeDeadlineMs({ exam: guokao, node: mockVerify, kind: 'endsToday' }),
    ).toBe(Date.UTC(2026, 10, 28, 2, 0, 0))
  })

  it('边界前 1 秒仍进行中：11-28 09:59:59 helper 为 null', () => {
    expect(
      examNodeDeadlineLabel(guokao, mockVerify, Date.UTC(2026, 10, 28, 1, 59, 59)),
    ).toBeNull()
  })

  it('边界整点已截止：11-28 10:00:00 helper 返回「已截止」', () => {
    expect(
      examNodeDeadlineLabel(guokao, mockVerify, Date.UTC(2026, 10, 28, 2, 0, 0)),
    ).toBe('已截止')
  })

  it('截止日深夜已截止：11-28 23:59:59 helper 返回「已截止」', () => {
    expect(
      examNodeDeadlineLabel(guokao, mockVerify, Date.UTC(2026, 10, 28, 15, 59, 59)),
    ).toBe('已截止')
  })
})

/**
 * 2026-11-28 修复：徽标「已截止」时行首圆点曾仍为绿（进行中色），与文案
 * 口径分裂。修法只在渲染层：tracker 由 examNodeDeadlineLabel 派生圆点，
 * 返回「已截止」时取 done 灰（bg-muted-foreground/40），其余沿用日期口径
 * NODE_DOT_CLASS；examNodeStatus / 今日行 / 禁用逻辑一律不动。
 * 圆点渲染断言见 test/exam-tracker-label-u237.test.ts（fake 时刻渲染）。
 */
describe('圆点与徽标同一口径：源码守卫（2026-11-28 修复不回潮）', () => {
  const mockVerify = guokao.nodes.find((n) => n.label === '广东考区模拟核验')!

  it('tracker 圆点由 deadlineLabel 派生：已截止取 done 灰，否则沿用状态色', () => {
    const src = read('src/app/exam/my-exam-tracker.tsx')
    expect(src).toContain('const deadlineLabel = examNodeDeadlineLabel(exam, node, now)')
    expect(src).toContain(
      "deadlineLabel === '已截止' ? NODE_DOT_CLASS.done : NODE_DOT_CLASS[status]",
    )
    expect(src).toContain('className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`}')
    // 徽标与圆点共用同一份 deadlineLabel，不各算各的。
    expect(src).toContain('{deadlineLabel ?? EXAM_NODE_STATUS_LABEL[status]}')
  })

  it('状态机不动：10:00 后 examNodeStatus 仍按日期口径（当天 active、次日 done）', () => {
    expect(examNodeStatus(mockVerify, Date.UTC(2026, 10, 28, 2, 0, 0))).toBe('active')
    expect(examNodeStatus(mockVerify, Date.UTC(2026, 10, 28, 15, 59, 59))).toBe('active')
    expect(examNodeStatus(mockVerify, Date.UTC(2026, 10, 29, 0, 0, 0))).toBe('done')
  })
})
