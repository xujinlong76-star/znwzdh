/**
 * 考试日历页（/exam）红线测试：
 *  - 倒计时天数按北京时间自然日算，午夜边界正确；
 *  - 考试/节点状态只按已核实的日期翻转，预计日期（考研准考证）不自动标「已结束」；
 *  - 国考卡片挂准考证打印提醒岛（只在 11-22–11-29 15:00 渲染，官方链接在
 *    exam-calendar 常量里，不在页面写死域名；15:00 准点下线靠客户端岛，
 *    服务端页 revalidate 1 小时会迟到 1 小时）；
 *  - 考试清单只含已核实的六场：国考、四六级、省考、京考、考研、成考，不含已考完的
 *    经济师（11-07–08）等过期场次；省考文案不写「联考」；
 *    成考是例外：统考 10-17–18 已结束，但成绩节点 11-18 未过，故列入清单。
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
  JINGKAO_APPLY_URL,
  JINGKAO_NOTICE_URL,
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
  it('六场考试距 11-13 的天数与日历一致', () => {
    expect(daysUntil('2026-11-29', NOV_13_0800_CST)).toBe(16)
    expect(daysUntil('2026-12-06', NOV_13_0800_CST)).toBe(23)
    expect(daysUntil('2026-12-12', NOV_13_0800_CST)).toBe(29)
    expect(daysUntil('2026-12-19', NOV_13_0800_CST)).toBe(36)
    // 京考按首考日算：公安专业科目 12-05 距 11-13 为 22 天（公共科目 12-06 为 23 天，与省考同值）
    expect(daysUntil('2026-12-05', NOV_13_0800_CST)).toBe(22)
    // 成考统考 10-17 已过 27 天（负值），成绩节点 11-18 仍在将来
    expect(daysUntil('2026-10-17', NOV_13_0800_CST)).toBe(-27)
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

describe('考试清单只含已核实的六场', () => {
  it('恰好六场，首日与核实日期一致', () => {
    expect(EXAMS.map((e) => e.id)).toEqual(['guokao', 'cet', 'shengkao', 'jingkao', 'kaoyan', 'chengkao'])
    expect(EXAMS.map((e) => e.startISO)).toEqual([
      '2026-11-29',
      '2026-12-12',
      '2026-12-06',
      '2026-12-06',
      '2026-12-19',
      '2026-10-17',
    ])
  })

  it('成考是例外：统考已结束，但成绩节点 11-18 未过，故列入清单', () => {
    const chengkao = EXAMS.find((e) => e.id === 'chengkao')!
    expect(examStatus(chengkao, NOV_13_0800_CST)).toBe('ended')
    expect(chengkao.nodes.map((n) => n.label)).toEqual(['江西成绩查询', '广东成绩查询', '浙江成绩查询', '浙江志愿确认'])
    expect(chengkao.nodes.map((n) => [n.label, n.startISO, n.endISO])).toEqual([
      ['江西成绩查询', '2026-11-18', '2026-11-18'],
      ['广东成绩查询', '2026-11-18', '2026-11-18'],
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
})
