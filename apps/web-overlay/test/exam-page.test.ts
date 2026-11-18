/**
 * 考试日历页（/exam）红线测试：
 *  - 倒计时天数按北京时间自然日算，午夜边界正确；
 *  - 考试/节点状态只按已核实的日期翻转，预计日期（考研准考证）不自动标「已结束」；
 *  - 国考卡片挂准考证打印提醒岛（只在 11-22–11-29 15:00 渲染，官方链接在
 *    exam-calendar 常量里，不在页面写死域名；15:00 准点下线靠客户端岛，
 *    服务端页 revalidate 1 小时会迟到 1 小时）；
 *  - 考试清单只含已核实的十一场：国考、四六级、省考、京考、考研、成考、军队文职、教资面试、江苏自考、广东自考、上海自考，不含已考完的
 *    经济师（11-07–08）等过期场次；省考文案不写「联考」；
 *    成考是例外：统考 10-17–18 已结束，但成绩节点 11-18 未过，故列入清单。
 *    江苏自考是第二个例外：考期 10-24–25 已结束，但成绩节点 11-18 未过，故列入清单。
 *    广东自考是第三个例外：考期 10-24–25 已结束，但成绩节点 11-18 未过，故列入清单。
 *    上海自考是第四个例外：考期 10-24–25 已结束，但成绩节点 11-19 未过，故列入清单。
 *  - 页面外链一律过 safeHref，备考站点从 navigation.json 现读、页面不硬编码
 *    12 条站点地址；canonical 自指 /exam；
 *  - 小字链接不用 text-primary（深色/三皮肤下仅 3.33–4.46:1，不达 AA），
 *    不用 11px 小字与锌灰低对比文字。
 * 真 SSR 直出由端到端实测（临时实例）覆盖。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  EXAMS,
  GUANGDONG_ZIKAO_SCORE_URL,
  JIAOSHI_MIANSHI_URL,
  JINGKAO_APPLY_URL,
  JINGKAO_NOTICE_URL,
  JUNDUANWENZHI_ADMISSION_URL,
  JUNDUANWENZHI_PORTAL_URL,
  countdownParts,
  daysUntil,
  examNodeStatus,
  examStatus,
  firstExamDay,
} from '../src/lib/exam-calendar'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

/** 2026-11-13 08:00 北京时间（UTC 午夜） */
const NOV_13_0800_CST = Date.UTC(2026, 10, 13, 0, 0, 0)

describe('daysUntil（北京时间自然日）', () => {
  it('十一场考试距 11-13 的天数与日历一致', () => {
    expect(daysUntil('2026-11-29', NOV_13_0800_CST)).toBe(16)
    expect(daysUntil('2026-12-06', NOV_13_0800_CST)).toBe(23)
    expect(daysUntil('2026-12-12', NOV_13_0800_CST)).toBe(29)
    expect(daysUntil('2026-12-19', NOV_13_0800_CST)).toBe(36)
    // 京考按首考日算：公安专业科目 12-05 距 11-13 为 22 天（公共科目 12-06 为 23 天，与省考同值）；
    // 教资面试首日也是 12-05，距 11-13 同为 22 天
    expect(daysUntil('2026-12-05', NOV_13_0800_CST)).toBe(22)
    // 军队文职笔试 12-13 距 11-13 为 30 天
    expect(daysUntil('2026-12-13', NOV_13_0800_CST)).toBe(30)
    // 成考统考 10-17 已过 27 天（负值），成绩节点 11-18 仍在将来
    expect(daysUntil('2026-10-17', NOV_13_0800_CST)).toBe(-27)
    // 江苏自考考期 10-24 已过 20 天（负值），成绩节点 11-18 仍在将来
    expect(daysUntil('2026-10-24', NOV_13_0800_CST)).toBe(-20)
    // 广东自考考期 10-24 已过 20 天（负值），成绩节点 11-18 仍在将来（与江苏自考同日同值）
    expect(daysUntil('2026-10-24', NOV_13_0800_CST)).toBe(-20)
    // 上海自考考期 10-24 已过 20 天（负值），成绩节点 11-19 仍在将来（与江苏/广东自考同日同值）
    expect(daysUntil('2026-10-24', NOV_13_0800_CST)).toBe(-20)
  })

  it('午夜边界：11-28 深夜算 1 天，11-29 零点算 0 天', () => {
    expect(daysUntil('2026-11-29', Date.UTC(2026, 10, 28, 15, 30))).toBe(1)
    expect(daysUntil('2026-11-29', Date.UTC(2026, 10, 28, 16, 0))).toBe(0)
  })

  it('已过的日期为负数', () => {
    expect(daysUntil('2026-11-07', NOV_13_0800_CST)).toBeLessThan(0)
  })
})

describe('examStatus', () => {
  it('考前 upcoming、考试当天 today、考后 ended', () => {
    const guokao = EXAMS.find((e) => e.id === 'guokao')!
    expect(examStatus(guokao, NOV_13_0800_CST)).toBe('upcoming')
    expect(examStatus(guokao, Date.UTC(2026, 10, 29, 2, 0))).toBe('today')
    expect(examStatus(guokao, Date.UTC(2026, 10, 30, 0, 0))).toBe('ended')
  })

  it('国考首考日 11-28 已是 today（专业科目先考），不是 upcoming', () => {
    const guokao = EXAMS.find((e) => e.id === 'guokao')!
    expect(firstExamDay(guokao)).toBe('2026-11-28')
    expect(examStatus(guokao, Date.UTC(2026, 10, 28, 0, 0))).toBe('today')
    expect(examStatus(guokao, Date.UTC(2026, 10, 27, 0, 0))).toBe('upcoming')
  })

  it('京考首考日 12-05 已是 today（公安专业科目先考），不是 upcoming', () => {
    const jingkao = EXAMS.find((e) => e.id === 'jingkao')!
    expect(firstExamDay(jingkao)).toBe('2026-12-05')
    expect(examStatus(jingkao, Date.UTC(2026, 11, 4, 0, 0))).toBe('upcoming')
    expect(examStatus(jingkao, Date.UTC(2026, 11, 5, 0, 0))).toBe('today')
    expect(examStatus(jingkao, Date.UTC(2026, 11, 6, 0, 0))).toBe('today')
    expect(examStatus(jingkao, Date.UTC(2026, 11, 7, 0, 0))).toBe('ended')
  })

  it('多日考试中间天为 ongoing', () => {
    const kaoyan = EXAMS.find((e) => e.id === 'kaoyan')!
    expect(examStatus(kaoyan, Date.UTC(2026, 11, 19, 2, 0))).toBe('ongoing')
    expect(examStatus(kaoyan, Date.UTC(2026, 11, 21, 0, 0))).toBe('ended')
  })
})

describe('U-107 首日文案（firstDayLabel）', () => {
  /** 2026-11-28 08:00 北京时间：国考首考日（专业科目 14:00 开考） */
  const NOV_28_0800_CST = Date.UTC(2026, 10, 28, 0, 0, 0)
  /** 2026-11-29 08:00 北京时间：国考公共科目日 */
  const NOV_29_0800_CST = Date.UTC(2026, 10, 29, 0, 0, 0)
  /** 2026-12-05 08:00 北京时间：京考首考日（公安专业科目 14:00 开考） */
  const DEC_05_0800_CST = Date.UTC(2026, 11, 5, 0, 0, 0)
  /** 2026-12-06 08:00 北京时间：京考公共科目日 */
  const DEC_06_0800_CST = Date.UTC(2026, 11, 6, 0, 0, 0)
  /** 2026-12-13 08:00 北京时间：军队文职笔试日（无 firstDayLabel） */
  const DEC_13_0800_CST = Date.UTC(2026, 11, 13, 0, 0, 0)

  it('11-28 国考首考日：today 分支取 firstDayLabel，精确文案', () => {
    const guokao = EXAMS.find((e) => e.id === 'guokao')!
    expect(examStatus(guokao, NOV_28_0800_CST)).toBe('today')
    // today 分支取首日文案的门控：距首考日 0 天
    expect(daysUntil(firstExamDay(guokao), NOV_28_0800_CST)).toBe(0)
    expect(guokao.firstDayLabel).toBe('今天国考 · 专业科目 14:00 开考')
  })

  it('12-05 京考首考日：today 分支取 firstDayLabel，精确文案', () => {
    const jingkao = EXAMS.find((e) => e.id === 'jingkao')!
    expect(examStatus(jingkao, DEC_05_0800_CST)).toBe('today')
    expect(daysUntil(firstExamDay(jingkao), DEC_05_0800_CST)).toBe(0)
    expect(jingkao.firstDayLabel).toBe('今天京考 · 公安专业科目 14:00 开考')
  })

  it('11-29 国考公共科目日与 12-06 京考公共科目日：首考日已过，today 分支回落「今天考试」', () => {
    const guokao = EXAMS.find((e) => e.id === 'guokao')!
    const jingkao = EXAMS.find((e) => e.id === 'jingkao')!
    // 两日仍是 today（单日 startISO === endISO），但距首考日已 -1 天，
    // today 分支「距首考日 === 0」的门控不成立，firstDayLabel 不取
    expect(examStatus(guokao, NOV_29_0800_CST)).toBe('today')
    expect(daysUntil(firstExamDay(guokao), NOV_29_0800_CST)).toBe(-1)
    expect(examStatus(jingkao, DEC_06_0800_CST)).toBe('today')
    expect(daysUntil(firstExamDay(jingkao), DEC_06_0800_CST)).toBe(-1)
  })

  it('无 firstDayLabel 的考试：首考日当天 today 分支仍是「今天考试」', () => {
    const jundui = EXAMS.find((e) => e.id === 'jundui-wenzhi')!
    expect(jundui.firstDayLabel).toBeUndefined()
    expect(examStatus(jundui, DEC_13_0800_CST)).toBe('today')
    expect(daysUntil(firstExamDay(jundui), DEC_13_0800_CST)).toBe(0)
  })
})

describe('examNodeStatus', () => {
  it('准考证打印窗口内为进行中，窗口前后翻转', () => {
    const guokao = EXAMS.find((e) => e.id === 'guokao')!
    const admit = guokao.nodes[0]
    expect(examNodeStatus(admit, Date.UTC(2026, 10, 22, 0, 0))).toBe('upcoming')
    expect(examNodeStatus(admit, Date.UTC(2026, 10, 25, 0, 0))).toBe('active')
    expect(examNodeStatus(admit, Date.UTC(2026, 10, 30, 0, 0))).toBe('done')
  })

  it('预计节点（考研准考证）不按日期自动翻转，恒为 estimated', () => {
    const kaoyan = EXAMS.find((e) => e.id === 'kaoyan')!
    const admit = kaoyan.nodes[0]
    expect(admit.estimated).toBe(true)
    expect(examNodeStatus(admit, NOV_13_0800_CST)).toBe('estimated')
    expect(examNodeStatus(admit, Date.UTC(2026, 11, 15, 0, 0))).toBe('estimated')
  })
})

describe('countdownParts', () => {
  it('25 小时 1 分 1 秒拆成 1 天 1 时 1 分 1 秒', () => {
    expect(countdownParts(90061000, 0)).toEqual({ days: 1, hours: 1, minutes: 1, seconds: 1 })
  })

  it('目标时刻已过则全 0', () => {
    expect(countdownParts(1000, 2000)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 })
  })
})

describe('考试清单只含已核实的十一场', () => {
  it('恰好十一场，首日与核实日期一致', () => {
    expect(EXAMS.map((e) => e.id)).toEqual(['guokao', 'cet', 'shengkao', 'jiaoshi-mianshi', 'jundui-wenzhi', 'jingkao', 'kaoyan', 'chengkao', 'jiangsu-zikao', 'guangdong-zikao', 'shanghai-zikao'])
    expect(EXAMS.map((e) => e.startISO)).toEqual([
      '2026-11-29',
      '2026-12-12',
      '2026-12-06',
      '2026-12-05',
      '2026-12-13',
      '2026-12-06',
      '2026-12-19',
      '2026-10-17',
      '2026-10-24',
      '2026-10-24', // 广东自考（与江苏自考同日）
      '2026-10-24', // 上海自考（与江苏/广东自考同日）
    ])
  })

  it('成考是例外：统考已结束，但成绩节点 11-18 未过，故列入清单', () => {
    const chengkao = EXAMS.find((e) => e.id === 'chengkao')!
    expect(examStatus(chengkao, NOV_13_0800_CST)).toBe('ended')
    expect(chengkao.nodes.map((n) => n.label)).toEqual(['江西成绩查询', '江西成绩复核', '广东成绩查询', '广东成绩复核', '新疆成绩查询', '新疆成绩复核', '海南成绩查询', '浙江成绩查询', '浙江志愿确认'])
    expect(chengkao.nodes.map((n) => [n.label, n.startISO, n.endISO])).toEqual([
      ['江西成绩查询', '2026-11-18', '2026-11-18'],
      ['江西成绩复核', '2026-11-19', '2026-11-20'],
      ['广东成绩查询', '2026-11-18', '2026-11-18'],
      ['广东成绩复核', '2026-11-20', '2026-11-20'],
      ['新疆成绩查询', '2026-11-18', '2026-11-18'],
      ['新疆成绩复核', '2026-11-18', '2026-11-20'],
      ['海南成绩查询', '2026-11-19', '2026-11-19'],
      ['浙江成绩查询', '2026-11-20', '2026-11-20'],
      ['浙江志愿确认', '2026-11-25', '2026-11-29'],
    ])
  })

  it('不含已考完的经济师（11-07–08）等过期场次', () => {
    expect(EXAMS.map((e) => e.startISO)).not.toContain('2026-11-07')
    expect(EXAMS.map((e) => e.startISO)).not.toContain('2026-11-08')
  })

  it('省考文案不写「联考」：七省均为单独招考', () => {
    // 守的是面向用户的文案（考试名/节点/备注/提醒），不是模块注释里的说明句
    const userFacing = [
      ...EXAMS.flatMap((e) => [e.name, e.tagline, e.examDateLabel, e.note ?? '']),
      ...EXAMS.flatMap((e) => e.nodes.flatMap((n) => [n.label, n.detail])),
    ].join('')
    expect(userFacing).not.toContain('联考')
    expect(EXAMS.find((e) => e.id === 'shengkao')?.note).toContain('单独招考')
  })

  it('省考 note 写全七省报名截止日，不只点浙江一名（2026-11-17 R-2/R-3）', () => {
    // 七省报名均已截止（D 线 2026-11-17 核实六省；山东经 C 线同日核实补入，
    // 口径由六省升级为七省，断言随之升级——“写全”的意图不变，只是清单多了一省）；
    // 旧文案只写浙江截止，用户可能误以为其余省份报名还开着，故七省日期一个不能少
    const note = EXAMS.find((e) => e.id === 'shengkao')?.note ?? ''
    expect(note).toContain('七省均为单独招考')
    expect(note).toContain('报名均已截止')
    for (const part of ['山东 11 月 6–9 日', '四川 11 月 4 日', '广东 11 月 6 日', '上海 11 月 7 日', '江苏/天津 11 月 9 日', '浙江 11 月 11 日']) {
      expect(note).toContain(part)
    }
  })

  it('省考公共科目节点列出七省，含山东（2026-11-17 R-3）', () => {
    // 山东 12-06 公共科目笔试与六省同日、单独招考（C 线核实：山东省公务员局
    // 2027 年度公告 2026-11-04 发布，多源转载一致）；节点 detail 须与 note 的七省口径一致
    const shengkao = EXAMS.find((e) => e.id === 'shengkao')!
    const pub = shengkao.nodes.find((n) => n.label === '公共科目笔试')!
    expect(pub.detail).toContain('山东')
    expect(pub.detail).toBe('12 月 6 日：四川、江苏、广东、上海、天津、浙江、山东')
  })
})

describe('江苏自考节点（U-144）', () => {
  // 查找包成函数：实现未落盘时 describe 体内直接 find 会在收集期抛错、
  // 整文件 0 跑；各 it 内调用，失败只落本 it。
  const jiangsu = () => EXAMS.find((e) => e.id === 'jiangsu-zikao')!

  it('只列已核实的两节点：成绩查询、成绩复核；报名与准考证节点不收', () => {
    const exam = jiangsu()
    expect(exam.name).toBe('2026 年 10 月江苏省高等教育自学考试')
    expect(exam.shortName).toBe('江苏自考')
    expect(exam.tagline).toBe('成绩 11 月 18 日公布')
    expect(exam.examDateLabel).toBe('10 月 24–25 日')
    expect(exam.startISO).toBe('2026-10-24')
    expect(exam.endISO).toBe('2026-10-25')
    expect(exam.nodes.map((n) => n.label)).toEqual(['成绩查询', '成绩复核'])
    expect(exam.nodes.map((n) => [n.label, n.startISO, n.endISO])).toEqual([
      ['成绩查询', '2026-11-18', '2026-11-18'],
      ['成绩复核', '2026-11-18', '2026-11-20'],
    ])
    // 两节点不挂 url、不设 estimated：查分走官网栏目、无网页查分直链可挂；
    // 复核是线下登记、无 URL 可挂；两节点日期均已核实，非预计。
    const byLabel = new Map(exam.nodes.map((n) => [n.label, n]))
    expect(byLabel.get('成绩查询')?.url).toBeUndefined()
    expect(byLabel.get('成绩复核')?.url).toBeUndefined()
    expect(byLabel.get('成绩查询')?.estimated).toBeUndefined()
    expect(byLabel.get('成绩复核')?.estimated).toBeUndefined()
    // 报名/准考证节点不收（考期已过）；label 里出现即红。
    expect(exam.nodes.map((n) => n.label).join('')).not.toContain('报名')
    expect(exam.nodes.map((n) => n.label).join('')).not.toContain('准考证')
  })

  it('detail 逐字：查分 11-18 10:00 起 + 官网栏目路径；复核三日 17:00 截止 + 身份证/准考证 + 区县考办登记 + 逾期不予受理', () => {
    const byLabel = new Map(jiangsu().nodes.map((n) => [n.label, n]))
    expect(byLabel.get('成绩查询')?.detail).toBe(
      '11 月 18 日 10:00 起可查（江苏省教育考试院门户网站 www.jseea.cn「招考业务」栏目「自学考试」页面）',
    )
    expect(byLabel.get('成绩复核')?.detail).toBe(
      '11 月 18 日、19 日、20 日（17:00 截止）持本人身份证、准考证到所属区县考办登记并提交复核申请，逾期不予受理',
    )
  })

  it('考期已过但成绩节点未过（与成考同款例外）：11-13 时考试状态已结束，节点仍按日期翻转', () => {
    const exam = jiangsu()
    expect(examStatus(exam, NOV_13_0800_CST)).toBe('ended')
    const byLabel = new Map(exam.nodes.map((n) => [n.label, n]))
    const query = byLabel.get('成绩查询')!
    const review = byLabel.get('成绩复核')!
    expect(examNodeStatus(query, Date.UTC(2026, 10, 17, 0, 0))).toBe('upcoming')
    expect(examNodeStatus(query, Date.UTC(2026, 10, 18, 0, 0))).toBe('today')
    expect(examNodeStatus(query, Date.UTC(2026, 10, 19, 0, 0))).toBe('done')
    expect(examNodeStatus(review, Date.UTC(2026, 10, 17, 0, 0))).toBe('upcoming')
    expect(examNodeStatus(review, Date.UTC(2026, 10, 18, 0, 0))).toBe('active')
    expect(examNodeStatus(review, Date.UTC(2026, 10, 20, 0, 0))).toBe('active')
    expect(examNodeStatus(review, Date.UTC(2026, 10, 21, 0, 0))).toBe('done')
  })
})


describe('广东自考节点（U-144）', () => {
  // 查找包成函数：实现未落盘时 describe 体内直接 find 会在收集期抛错、
  // 整文件 0 跑；各 it 内调用，失败只落本 it。
  const guangdong = () => EXAMS.find((e) => e.id === 'guangdong-zikao')!

  it('只列已核实的一节点：成绩查询；报名、准考证与复核节点不收', () => {
    const exam = guangdong()
    expect(exam.name).toBe('2026 年 10 月广东省高等教育自学考试')
    expect(exam.shortName).toBe('广东自考')
    expect(exam.tagline).toBe('成绩 11 月 18 日公布')
    expect(exam.examDateLabel).toBe('10 月 24–25 日')
    expect(exam.startISO).toBe('2026-10-24')
    expect(exam.endISO).toBe('2026-10-25')
    expect(exam.nodes.map((n) => n.label)).toEqual(['成绩查询'])
    expect(exam.nodes.map((n) => [n.label, n.startISO, n.endISO])).toEqual([
      ['成绩查询', '2026-11-18', '2026-11-18'],
    ])
    // 成绩查询挂线上系统直链（U-87 规则：公告原文给出可直接登录办理的
    // 线上系统 URL 才挂链）；日期与时刻均已核实，不设 estimated。
    expect(exam.nodes[0]!.url).toBe(GUANGDONG_ZIKAO_SCORE_URL)
    expect(GUANGDONG_ZIKAO_SCORE_URL).toBe('https://www.eeagd.edu.cn/selfec/')
    expect(exam.nodes[0]!.estimated).toBeUndefined()
    // 报名/准考证/复核节点不收：考期已过；复核无全省统一窗口（各市自考办
    // 在成绩公布后 10 个工作日内安排），不设日期节点。label 里出现即红。
    expect(exam.nodes.map((n) => n.label).join('')).not.toContain('报名')
    expect(exam.nodes.map((n) => n.label).join('')).not.toContain('准考证')
    expect(exam.nodes.map((n) => n.label).join('')).not.toContain('复核')
    // 域名只认 eea.gd.gov.cn；ee.gd.gov.cn 不得出现（雷达第 30 轮定论）。
    expect([exam.note ?? '', ...exam.nodes.map((n) => `${n.detail}${n.url ?? ''}`)].join('')).not.toContain('ee.gd.gov.cn')
  })

  it('detail 逐字：查分 11-18 15:00 起 + 四种入口 + 系统查合格成绩与当次违规处理情况；复核写进 entry note（无全省统一窗口）', () => {
    const query = guangdong().nodes[0]!
    expect(query.detail).toBe(
      '11 月 18 日 15:00 起可查：官微小程序（gdsksy）、支付宝小程序、百度智能小程序、广东省自学考试管理系统（查合格成绩与当次违规处理情况）',
    )
    expect(guangdong().note).toBe(
      '统考 10 月 24–25 日已结束，条目存在只为承载成绩节点；成绩复核无全省统一窗口，各市自考办在成绩公布后 10 个工作日内安排具体受理时间与地点，以所在市公布为准，须本人持身份证、准考证到参加考试所在市自考办申请，逾期不予受理，仅限漏评、漏记分、错记分、加错分四种情形。',
    )
  })

  it('考期已过但成绩节点未过（与成考、江苏自考同款例外）：11-13 时考试状态已结束，节点仍按日期翻转', () => {
    const exam = guangdong()
    expect(examStatus(exam, NOV_13_0800_CST)).toBe('ended')
    const query = exam.nodes[0]!
    expect(examNodeStatus(query, Date.UTC(2026, 10, 17, 0, 0))).toBe('upcoming')
    expect(examNodeStatus(query, Date.UTC(2026, 10, 18, 0, 0))).toBe('today')
    expect(examNodeStatus(query, Date.UTC(2026, 10, 19, 0, 0))).toBe('done')
  })
})

describe('京考节点（U-76）', () => {
  const jingkao = EXAMS.find((e) => e.id === 'jingkao')!

  it('只列已核实的四节点：报名、准考证打印、公安专业科目、公共科目；成绩与缴费节点不收', () => {
    expect(jingkao.name).toBe('2027 年度北京市公务员考试')
    expect(jingkao.shortName).toBe('京考')
    expect(jingkao.tagline).toBe('公安专业科目 12 月 5 日 · 公共科目 12 月 6 日')
    expect(jingkao.examDateLabel).toBe('12 月 5–6 日')
    expect(jingkao.firstExamDayISO).toBe('2026-12-05')
    expect(jingkao.nodes.map((n) => n.label)).toEqual(['报名', '准考证打印', '公安专业科目笔试', '公共科目笔试'])
    expect(jingkao.nodes.map((n) => [n.label, n.startISO, n.endISO])).toEqual([
      ['报名', '2026-11-12', '2026-11-18'],
      ['准考证打印', '2026-12-01', '2026-12-06'],
      ['公安专业科目笔试', '2026-12-05', '2026-12-05'],
      ['公共科目笔试', '2026-12-06', '2026-12-06'],
    ])
    // 报名与准考证打印挂北京市人事考试通用平台（公告原文内嵌 URL，http 原文）；
    // 公共科目挂首都之窗官方公告；公安专业科目无入口不挂。
    expect(JINGKAO_APPLY_URL).toBe('http://rsj.beijing.gov.cn/bm/ztzl/gwy/')
    expect(JINGKAO_NOTICE_URL).toBe(
      'https://www.beijing.gov.cn/gongkai/rsxx/gwyzk/202611/t20261109_4938196.html',
    )
    const byLabel = new Map(jingkao.nodes.map((n) => [n.label, n]))
    expect(byLabel.get('报名')?.url).toBe(JINGKAO_APPLY_URL)
    expect(byLabel.get('准考证打印')?.url).toBe(JINGKAO_APPLY_URL)
    expect(byLabel.get('公安专业科目笔试')?.url).toBeUndefined()
    expect(byLabel.get('公共科目笔试')?.url).toBe(JINGKAO_NOTICE_URL)
    // 成绩节点不收（官方只写「2027 年 1 月」，无确切日）；缴费节点不收
    // （文件无缴费类节点先例）。label 里出现即红。
    expect(jingkao.nodes.map((n) => n.label).join('')).not.toContain('成绩')
    expect(jingkao.nodes.map((n) => n.label).join('')).not.toContain('缴费')
  })

  it('节点状态按日期翻转：报名窗口内进行中、11-19 已结束；准考证窗口内进行中、12-07 已结束；两科笔试当天为今天、次日已结束', () => {
    const byLabel = new Map(jingkao.nodes.map((n) => [n.label, n]))
    const apply = byLabel.get('报名')!
    const admit = byLabel.get('准考证打印')!
    const police = byLabel.get('公安专业科目笔试')!
    const pub = byLabel.get('公共科目笔试')!
    // 报名是 11-12–11-18 多日窗口：11-12 开放当天即进行中（不是单日「今天」）
    expect(examNodeStatus(apply, Date.UTC(2026, 10, 11, 0, 0))).toBe('upcoming')
    expect(examNodeStatus(apply, Date.UTC(2026, 10, 12, 0, 0))).toBe('active')
    expect(examNodeStatus(apply, Date.UTC(2026, 10, 17, 0, 0))).toBe('active')
    expect(examNodeStatus(apply, Date.UTC(2026, 10, 18, 0, 0))).toBe('active')
    expect(examNodeStatus(apply, Date.UTC(2026, 10, 19, 0, 0))).toBe('done')
    expect(examNodeStatus(admit, Date.UTC(2026, 10, 30, 0, 0))).toBe('upcoming')
    expect(examNodeStatus(admit, Date.UTC(2026, 11, 1, 0, 0))).toBe('active')
    expect(examNodeStatus(admit, Date.UTC(2026, 11, 6, 0, 0))).toBe('active')
    expect(examNodeStatus(admit, Date.UTC(2026, 11, 7, 0, 0))).toBe('done')
    expect(examNodeStatus(police, Date.UTC(2026, 11, 5, 0, 0))).toBe('today')
    expect(examNodeStatus(police, Date.UTC(2026, 11, 6, 0, 0))).toBe('done')
    expect(examNodeStatus(pub, Date.UTC(2026, 11, 6, 0, 0))).toBe('today')
    expect(examNodeStatus(pub, Date.UTC(2026, 11, 7, 0, 0))).toBe('done')
  })

  it('detail 写明时刻与渠道：报名 18:00 截止、准考证窗口时刻、公安仅面向公安职位、公共科目行测/申论时刻', () => {
    const byLabel = new Map(jingkao.nodes.map((n) => [n.label, n]))
    expect(byLabel.get('报名')?.detail).toContain('11 月 18 日 18:00')
    expect(byLabel.get('报名')?.detail).toContain('北京市人事考试通用平台')
    expect(byLabel.get('准考证打印')?.detail).toContain('12 月 1 日 9:00')
    expect(byLabel.get('准考证打印')?.detail).toContain('12 月 6 日 16:30')
    expect(byLabel.get('公安专业科目笔试')?.detail).toContain('14:00–16:00')
    expect(byLabel.get('公安专业科目笔试')?.detail).toContain('仅公安机关人民警察职位')
    expect(byLabel.get('公共科目笔试')?.detail).toContain('9:00–11:00')
    expect(byLabel.get('公共科目笔试')?.detail).toContain('14:00–16:30')
  })
})

describe('教资面试节点（2026-11-18 01:22 轮）', () => {
  const jiaoshi = EXAMS.find((e) => e.id === 'jiaoshi-mianshi')!

  it('只列已核实的两节点：准考证打印、面试；报名与成绩节点不收', () => {
    expect(jiaoshi.name).toBe('2026 年下半年中小学教师资格面试')
    expect(jiaoshi.shortName).toBe('教资面试')
    expect(jiaoshi.tagline).toBe('面试 12 月 5–6 日')
    expect(jiaoshi.examDateLabel).toBe('12 月 5–6 日')
    expect(jiaoshi.startISO).toBe('2026-12-05')
    expect(jiaoshi.endISO).toBe('2026-12-06')
    expect(jiaoshi.nodes.map((n) => n.label)).toEqual(['准考证打印', '面试'])
    expect(jiaoshi.nodes.map((n) => [n.label, n.startISO, n.endISO])).toEqual([
      ['准考证打印', '2026-11-30', '2026-12-06'],
      ['面试', '2026-12-05', '2026-12-06'],
    ])
    // 准考证挂中小学教师资格考试网统一入口；面试节点本身无单独入口，
    // 不重复挂同一链接（跟踪岛按节点类型映射链接文案：准考证类节点渲染「去官网打印准考证」，报名/笔试公告/成绩复核三类另有文案，见 U-124）。
    expect(JIAOSHI_MIANSHI_URL).toBe('https://ntce.neea.edu.cn')
    const byLabel = new Map(jiaoshi.nodes.map((n) => [n.label, n]))
    expect(byLabel.get('准考证打印')?.url).toBe(JIAOSHI_MIANSHI_URL)
    expect(byLabel.get('面试')?.url).toBeUndefined()
    // 报名节点不收（已过期、省际截止时刻不一）；成绩节点不收
    //（2027-01-08，部分省写「预计」，口径有省际差异）。label 里出现即红。
    expect(jiaoshi.nodes.map((n) => n.label).join('')).not.toContain('报名')
    expect(jiaoshi.nodes.map((n) => n.label).join('')).not.toContain('成绩')
  })

  it('考试状态按日期翻转：12-04 未开始、12-05–06 进行中（多日）、12-07 已结束', () => {
    expect(examStatus(jiaoshi, Date.UTC(2026, 11, 4, 0, 0))).toBe('upcoming')
    expect(examStatus(jiaoshi, Date.UTC(2026, 11, 5, 0, 0))).toBe('ongoing')
    expect(examStatus(jiaoshi, Date.UTC(2026, 11, 6, 0, 0))).toBe('ongoing')
    expect(examStatus(jiaoshi, Date.UTC(2026, 11, 7, 0, 0))).toBe('ended')
  })

  it('节点状态按日期翻转：准考证 11-30 进行中、12-07 已结束；面试两日均为进行中（多日节点不走单日 today）', () => {
    const byLabel = new Map(jiaoshi.nodes.map((n) => [n.label, n]))
    const admit = byLabel.get('准考证打印')!
    const interview = byLabel.get('面试')!
    expect(examNodeStatus(admit, Date.UTC(2026, 10, 29, 0, 0))).toBe('upcoming')
    expect(examNodeStatus(admit, Date.UTC(2026, 10, 30, 0, 0))).toBe('active')
    expect(examNodeStatus(admit, Date.UTC(2026, 11, 6, 0, 0))).toBe('active')
    expect(examNodeStatus(admit, Date.UTC(2026, 11, 7, 0, 0))).toBe('done')
    expect(examNodeStatus(interview, Date.UTC(2026, 11, 4, 0, 0))).toBe('upcoming')
    expect(examNodeStatus(interview, Date.UTC(2026, 11, 5, 0, 0))).toBe('active')
    expect(examNodeStatus(interview, Date.UTC(2026, 11, 6, 0, 0))).toBe('active')
    expect(examNodeStatus(interview, Date.UTC(2026, 11, 7, 0, 0))).toBe('done')
  })

  it('detail 写明窗口与渠道：准考证北京时刻、各省以本省公告为准、面试以准考证为准', () => {
    const byLabel = new Map(jiaoshi.nodes.map((n) => [n.label, n]))
    expect(byLabel.get('准考证打印')?.detail).toContain('11 月 30 日 10:00')
    expect(byLabel.get('准考证打印')?.detail).toContain('12 月 6 日 16:00')
    expect(byLabel.get('准考证打印')?.detail).toContain('各省以本省公告为准')
    expect(byLabel.get('准考证打印')?.detail).toContain('中小学教师资格考试网')
    expect(byLabel.get('面试')?.detail).toContain('12 月 5–6 日')
    expect(byLabel.get('面试')?.detail).toContain('以准考证为准')
  })
})

describe('军队文职节点（2026-11-18 01:22 轮）', () => {
  const jundui = EXAMS.find((e) => e.id === 'jundui-wenzhi')!

  it('只列已核实的三节点：准考证打印、缴费、全军统一笔试；报名/成绩节点不收', () => {
    expect(jundui.name).toBe('2027 年军队文职人员公开招考')
    expect(jundui.shortName).toBe('军队文职')
    expect(jundui.tagline).toBe('全军统一笔试 12 月 13 日')
    expect(jundui.examDateLabel).toBe('12 月 13 日')
    expect(jundui.startISO).toBe('2026-12-13')
    expect(jundui.endISO).toBe('2026-12-13')
    expect(jundui.nodes.map((n) => n.label)).toEqual(['准考证打印', '缴费', '全军统一笔试'])
    expect(jundui.nodes.map((n) => [n.label, n.startISO, n.endISO])).toEqual([
      ['准考证打印', '2026-12-07', '2026-12-13'],
      ['缴费', '2026-11-17', '2026-11-18'],
      ['全军统一笔试', '2026-12-13', '2026-12-13'],
    ])
    // 准考证挂报名系统直达（公告原文所载）；缴费与笔试节点不挂 url：
    // 81rc 公告文章直链未核到，不得编造；门户只作引用（与国考门户同款）。
    expect(JUNDUANWENZHI_ADMISSION_URL).toBe('https://wzryzk.81rc.mil.cn/qjwzwb')
    expect(JUNDUANWENZHI_PORTAL_URL).toBe('http://www.81rc.mil.cn')
    const byLabel = new Map(jundui.nodes.map((n) => [n.label, n]))
    expect(byLabel.get('准考证打印')?.url).toBe(JUNDUANWENZHI_ADMISSION_URL)
    expect(byLabel.get('缴费')?.url).toBeUndefined()
    expect(byLabel.get('全军统一笔试')?.url).toBeUndefined()
    // 报名/成绩节点不收：报名已过期；成绩 2027 年 1 月底左右，无确切日。
    // 缴费节点按公告 §5 通用窗口收（初审通过人员 11-17 8:00–11-18 18:00）。
    // label 里出现即红。
    expect(jundui.nodes.map((n) => n.label).join('')).not.toContain('报名')
    expect(jundui.nodes.map((n) => n.label).join('')).not.toContain('成绩')
  })

  it('考试状态按日期翻转：12-12 未开始、12-13 今天、12-14 已结束', () => {
    expect(examStatus(jundui, Date.UTC(2026, 11, 12, 0, 0))).toBe('upcoming')
    expect(examStatus(jundui, Date.UTC(2026, 11, 13, 0, 0))).toBe('today')
    expect(examStatus(jundui, Date.UTC(2026, 11, 14, 0, 0))).toBe('ended')
  })

  it('节点状态按日期翻转：准考证 12-07 进行中、12-14 已结束；笔试 12-13 当天为今天、次日已结束', () => {
    const byLabel = new Map(jundui.nodes.map((n) => [n.label, n]))
    const admit = byLabel.get('准考证打印')!
    const written = byLabel.get('全军统一笔试')!
    expect(examNodeStatus(admit, Date.UTC(2026, 11, 6, 0, 0))).toBe('upcoming')
    expect(examNodeStatus(admit, Date.UTC(2026, 11, 7, 0, 0))).toBe('active')
    expect(examNodeStatus(admit, Date.UTC(2026, 11, 13, 0, 0))).toBe('active')
    expect(examNodeStatus(admit, Date.UTC(2026, 11, 14, 0, 0))).toBe('done')
    expect(examNodeStatus(written, Date.UTC(2026, 11, 12, 0, 0))).toBe('upcoming')
    expect(examNodeStatus(written, Date.UTC(2026, 11, 13, 0, 0))).toBe('today')
    expect(examNodeStatus(written, Date.UTC(2026, 11, 14, 0, 0))).toBe('done')
  })

  it('detail 写明时刻与渠道：准考证窗口时刻、报名系统、公共/专业科目时刻', () => {
    const byLabel = new Map(jundui.nodes.map((n) => [n.label, n]))
    expect(byLabel.get('准考证打印')?.detail).toContain('12 月 7 日 9:00')
    expect(byLabel.get('准考证打印')?.detail).toContain('12 月 13 日 14:00')
    expect(byLabel.get('准考证打印')?.detail).toContain('军队人才网报名系统')
    expect(byLabel.get('全军统一笔试')?.detail).toContain('公共科目 9:00–11:00')
    expect(byLabel.get('全军统一笔试')?.detail).toContain('专业科目 14:00–16:00')
  })

  it('缴费节点按公告 §5 通用窗口：初审通过人员 11-17 8:00–11-18 18:00，每门 50 元；文体岗同窗、免笔试岗不缴费', () => {
    const fee = jundui.nodes.find((n) => n.label === '缴费')!
    expect(fee.startISO).toBe('2026-11-17')
    expect(fee.endISO).toBe('2026-11-18')
    expect(fee.url).toBeUndefined()
    expect(fee.detail).toContain('2026 年 11 月 17 日 8:00 至 18 日 18:00')
    expect(fee.detail).toContain('每门考试科目人民币 50 元')
    expect(fee.detail).toContain('缴费成功并打印报名回执方为有效报名')
    expect(fee.detail).toContain('文体岗位（艺术、体育、播音）先面试合格人员同一窗口缴费')
    expect(fee.detail).toContain('免笔试直接面试岗位不需要缴纳报名费')
    // 窗口状态按日期翻转：11-16 未开始、11-17/11-18 进行中、11-19 已结束
    expect(examNodeStatus(fee, Date.UTC(2026, 10, 16, 0, 0))).toBe('upcoming')
    expect(examNodeStatus(fee, Date.UTC(2026, 10, 17, 0, 0))).toBe('active')
    expect(examNodeStatus(fee, Date.UTC(2026, 10, 18, 0, 0))).toBe('active')
    expect(examNodeStatus(fee, Date.UTC(2026, 10, 19, 0, 0))).toBe('done')
  })
})

describe('考试日历页源码守卫', () => {
  const page = read('src/app/exam/page.tsx')

  it('canonical 自指 /exam，且为相对路径', () => {
    expect(page).toContain("canonical: '/exam'")
    expect(page).not.toMatch(/canonical:\s*'https?:\/\//)
  })

  it('所有外链都过 safeHref，且带 noopener', () => {
    expect(page).toContain("import { safeHref } from '@/lib/safe-url'")
    expect(page).toContain('rel="noopener noreferrer"')
    expect(page).not.toMatch(/href=\{site\.href\}/)
  })

  it('备考站点从 navigation.json 现读，不硬编码 12 条站点地址', () => {
    // 注意：国考卡片的准考证打印提醒也链官方打印系统直达，但那是已核实的单条
    // 提醒入口（事实源在 exam-calendar 常量 GUOKAO_ADMISSION_URL 里），
    // 不属于 12 条备考站点，页面仍不许写死它的域名。
    expect(page).toContain("EXAM_PREP_CATEGORY_ID")
    expect(page).toContain("EXAM_PREP_SUB_ID")
    expect(page).not.toContain('cet.neea.edu.cn')
    expect(page).not.toContain('yz.chsi.com.cn')
    expect(page).not.toContain('scs.gov.cn')
    expect(page).not.toContain('fenbi.com')
  })

  it('倒计时走客户端岛，服务端 JSX 里不直出天数', () => {
    expect(page).toContain('<ExamCountdown exam={exam} />')
    // 服务端只用 daysUntil 挑「最近一场」（不渲染数字）；天数本身只在岛内算
    expect(page).not.toMatch(/\{daysUntil\(/)
  })

  it('小字不用 text-primary、不用 11px、不用锌灰低对比', () => {
    expect(page).not.toContain('text-primary')
    expect(page).not.toContain('text-[11px]')
    expect(page).not.toMatch(/text-zinc-\d/)
  })

  it('徽章不用 bg-*-500/10 + text-*-600 旧配方（实测不足 AA，改 text-*-700）', () => {
    expect(page).not.toContain('text-sky-600')
  })
})

describe('倒计时岛源码守卫', () => {
  const island = read('src/app/exam/exam-countdown.tsx')

  it('挂载前渲染占位（防 SSR/水合 mismatch），基于时间戳倒计时', () => {
    expect(island).toContain('useState<number | null>(null)')
    expect(island).toContain('setInterval')
    expect(island).toContain('Date.now()')
    expect(island).toContain('countdownParts')
  })

  it('第 N 天只在进行中分支算：单日考试恒走 today 分支，不留无条件 dayIndex 死值', () => {
    // 2026-11-16 0922 C 线：此前 `const dayIndex = 1 - daysUntil(...)` 在
    // today/ongoing 合并分支内无条件计算，单日考试（国考 11-28/11-29 恒为
    // today）算出后永不渲染；现只在 ongoing 分支内联计算，考研 12-20
    // 「进行中 · 第 2 天」仍走同一表达式，行为不变。
    expect(island).not.toContain('const dayIndex')
    expect(island).toContain('进行中 · 第 ${1 - daysUntil(firstExamDay(exam), now)} 天')
  })

  it('U-107：today 分支首考日当天用 firstDayLabel、次日回落「今天考试」，ongoing 分支不动', () => {
    // today 分支：距首考日 === 0 天才取 firstDayLabel，否则回落「今天考试」；
    // 首日文案只在 today 分支出现两次（门控 + 取值），ongoing 分支不含它
    expect(island).toContain('daysUntil(firstExamDay(exam), now) === 0 && exam.firstDayLabel')
    expect(island).toContain('? exam.firstDayLabel')
    expect(island).toContain(": '今天考试'")
    expect(island.match(/exam\.firstDayLabel/g)?.length).toBe(2)
    // ongoing 分支仍是「进行中 · 第 N 天」，不取首日文案
    expect(island).toContain('进行中 · 第 ${1 - daysUntil(firstExamDay(exam), now)} 天')
  })
})

describe('备考入口标题（U-108）', () => {
  const page = read('src/app/exam/page.tsx')

  it('标题去「官方」：备考区标题为「备考入口」，副标题同步去「官方」', () => {
    // 备考区 12 站含培训组 4 家（粉笔/华图/中公/新东方在线），标题写
    // 「官方入口」失实；纯文案方案：只改标题与副标题，不做分区渲染。
    expect(page).toContain('备考入口')
    expect(page).toContain('来自站内「考试备考」分类的报名与备考平台，按分类原顺序排列。')
    expect(page).not.toContain('备考官方入口')
    expect(page).not.toContain('官方报名与备考平台')
    // W12 必改项 1：DESCRIPTION「附官方报名与备考入口」与空态
    // 「官方入口清单没能取到」同步去「官方」（12 站含培训组 4 家）。
    expect(page).not.toContain('官方报名与备考入口')
    expect(page).not.toContain('官方入口清单没能取到')
  })

  it('窄屏守卫：备考区 LI 带 min-w-0，390px 下不撑宽（W13b）', () => {
    // 根因：UL 是 grid auto 单列，轨道按 LI min-content 定宽；LI 默认
    // min-width:auto，内层 flex 链接里的 nowrap 截断描述（最长约 649px）
    // 把轨道顶宽，文档横向溢出到 661px、卡片描述在右缘切断。min-w-0 清掉
    // grid 项自动最小宽，轨道才能缩到容器宽；内层 min-w-0 flex-1 +
    // truncate 链本身不动。实测：修前 docScroll 661 / LI 649，修后
    // docScroll 390 / LI 366，1280 下双列 LI 586、描述仍 ellipsis。
    expect(page).toContain('<li key={site.id} className="min-w-0 rounded-xl border border-border bg-card">')
  })

  it('对照：备考区仍现读 navigation.json「考试备考」分类 12 站，不改 navigation.json', () => {
    // 只作对照：12 站 = 官方组 8 家 + 培训组 4 家；分区渲染留待下轮，
    // 此处只数总数，页面仍不硬编码站点地址。
    const nav = JSON.parse(read('src/navsphere/content/navigation.json'))
    const findById = (node: unknown, id: string): Record<string, unknown> | undefined => {
      if (Array.isArray(node)) {
        for (const child of node) {
          const found = findById(child, id)
          if (found) return found
        }
        return undefined
      }
      if (node && typeof node === 'object') {
        const obj = node as Record<string, unknown>
        if (obj.id === id) return obj
        for (const value of Object.values(obj)) {
          const found = findById(value, id)
          if (found) return found
        }
      }
      return undefined
    }
    const sub = findById(nav, 'reg-exam-prep')!
    expect((sub.items as unknown[]).length).toBe(12)
  })
})
