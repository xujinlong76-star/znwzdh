/**
 * 首页「考试季」运营条（HomeExamStrip）红线测试：
 *  - 最近一场与「下一步」节点只按 exam-calendar 事实源算，不硬编码日期；
 *  - 多日考试末日仍算最近一场（考研 12-20 当天条带仍在）；
 *  - 十二场全结束时渲染静态空态条带（保留考试日历入口），不再整条消失；
 *    空态不挂倒计时岛、不挂客户端视图、不读存储、不含未公布日期；
 *  - 倒计时走 ExamCountdown 客户端岛，服务端 JSX 里不直出天数；
 *  - 条内常驻链接唯一指向 /exam；准考证打印提醒期（11-22–11-29 15:00）
 *    另有一条经核实的官方专题站外链（走 exam-calendar 常量，不在视图写
 *    死 http 字面量、不写死考试 id 与日期）；小字不用 text-primary、不用 11px、
 *    不用锌灰低对比；徽章用 bg-sky-500/5 + text-sky-700 配方；
 *  - 挂载位置（U-24 起）：考试条收进首页「更多今日内容」折叠区，
 *    位于简报条之后、接力卡之前；折叠区在今日区之后、导航之前。
 *    旧口径“考试条挂在简报条之后、连胜条之前（首屏顶部）”随 U-24 定义
 *    作废：今日区已把考试倒计时与下一步节点提上首屏第一位，完整考试条
 *    折叠收起不等于信息丢失。
 *  - 结构：外壳（home-exam-strip.tsx，U-358 起为客户端组件、由导航中心
 *    dynamic(ssr:false) 按需加载）只挑全局最近场；个性化由客户端视图
 *    （home-exam-strip-view.tsx）挂载后接手——挂载前渲染与服务端直出一致，
 *    关注了未结束考试才切到已关注场。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  EXAMS,
  nearestExam,
  nearestExamCountdown,
  nextExamNode,
  type ExamInfo,
} from '../src/lib/exam-calendar'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

/** 2026-11-13 08:00 北京时间（UTC 午夜） */
const NOV_13_0800_CST = Date.UTC(2026, 10, 13, 0, 0, 0)
/** 2026-11-30 08:00 北京时间：国考已过，教资面试最近（首考日 12-05 与京考同日、数组在前） */
const NOV_30_0800_CST = Date.UTC(2026, 10, 30, 0, 0, 0)
/** 2026-12-13 08:00 北京时间：军队文职笔试日 */
const DEC_13_0800_CST = Date.UTC(2026, 11, 13, 0, 0, 0)
/** 2026-12-19 08:00 北京时间：考研第一天，已开考 */
const DEC_19_0800_CST = Date.UTC(2026, 11, 19, 0, 0, 0)
/** 2026-12-20 08:00 北京时间：考研第二天，仍在进行中 */
const DEC_20_0800_CST = Date.UTC(2026, 11, 20, 0, 0, 0)
/** 2026-12-21 08:00 北京时间：考研已过，最近场切到广东自考·1月（2027-01-09） */
const DEC_21_0800_CST = Date.UTC(2026, 11, 21, 0, 0, 0)
/** 2027-01-11 08:00 北京时间：十二场全过（广东自考·1月 2027-01-10 已结束） */
const JAN_11_0800_CST = Date.UTC(2027, 0, 11, 0, 0, 0)

describe('nearestExam（最近一场）', () => {
  it('11-13 最近是国考，11-30 最近是教资面试，12-13 最近是军队文职，12-20 考研末日仍是考研，12-21 最近是广东自考·1月，2027-01-11 十二场全过返回 undefined', () => {
    expect(nearestExam(NOV_13_0800_CST)?.id).toBe('guokao')
    // 教资面试首考日 12-05 与京考同日、且在 EXAMS 数组中排在京考之前，
    // stable sort 平局数组在前者胜出，故国考过后最近场是教资面试而非京考
    expect(nearestExam(NOV_30_0800_CST)?.id).toBe('jiaoshi-mianshi')
    // 12-13 四六级已过，军队文职当天 today；此前同一天最近场是考研
    expect(nearestExam(DEC_13_0800_CST)?.id).toBe('jundui-wenzhi')
    expect(nearestExam(DEC_20_0800_CST)?.id).toBe('kaoyan')
    // C4（D2 定稿接受 nearest 改写）：考研结束后最近场切到广东自考·1月
    expect(nearestExam(DEC_21_0800_CST)?.id).toBe('guangdong-zikao-2027-01')
    expect(nearestExam(JAN_11_0800_CST)).toBeUndefined()
  })

  it('考试当天仍算最近一场（daysUntil 为 0），考后才切下一场', () => {
    expect(nearestExam(Date.UTC(2026, 10, 29, 2, 0))?.id).toBe('guokao')
    expect(nearestExam(Date.UTC(2026, 10, 30, 0, 0))?.id).toBe('jiaoshi-mianshi')
  })

  it('多日考试末日仍算最近一场（12-19 首日与 12-20 末日都是考研），12-21 最近场切到广东自考·1月，2027-01-11 才返回 undefined', () => {
    expect(nearestExam(Date.UTC(2026, 11, 19, 0, 0, 0))?.id).toBe('kaoyan')
    expect(nearestExam(Date.UTC(2026, 11, 20, 0, 0, 0))?.id).toBe('kaoyan')
    expect(nearestExam(Date.UTC(2026, 11, 20, 15, 59, 59))?.id).toBe('kaoyan')
    expect(nearestExam(Date.UTC(2026, 11, 21, 0, 0, 0))?.id).toBe('guangdong-zikao-2027-01')
    expect(nearestExam(Date.UTC(2027, 0, 11, 0, 0, 0))).toBeUndefined()
  })

  it('排序按首考日：加试考试（首考日早、公共科目首日晚）排在无加试考试之前', () => {
    // 2026-11-16 0922 C 线：合成数据——A 公共科目首日 12-01 但有加试、
    // 首考日 11-20；B 无加试、首日 11-25。按 startISO 排会先挑 B，
    // 按首考日排应先挑 A；两种传入顺序都应挑 A。真实数据里国考与京考
    // 首考日 ≠ startISO（京考首考日 12-05 早于省考 12-06；11-30 起
    // 最近场现为教资面试，与京考同日首考、数组在前）；这条断言钉住
    // 排序键本身，防将来第三场加试考试排错。
    const examA: ExamInfo = {
      id: 'exam-a',
      name: '合成考试 A',
      shortName: 'A',
      tagline: '',
      examDateLabel: '12 月 1 日',
      startISO: '2026-12-01',
      endISO: '2026-12-01',
      firstExamDayISO: '2026-11-20',
      nodes: [],
    }
    const examB: ExamInfo = {
      id: 'exam-b',
      name: '合成考试 B',
      shortName: 'B',
      tagline: '',
      examDateLabel: '11 月 25 日',
      startISO: '2026-11-25',
      endISO: '2026-11-25',
      nodes: [],
    }
    expect(nearestExam(NOV_13_0800_CST, [examB, examA])?.id).toBe('exam-a')
    expect(nearestExam(NOV_13_0800_CST, [examA, examB])?.id).toBe('exam-a')
  })

  it('U-107：11-28 同一时刻，首页条带与 /exam 国考卡片岛文案一致（都是 firstDayLabel）', () => {
    // 条带侧：nearestExamCountdown 首考日当天取 firstDayLabel
    const strip = nearestExamCountdown(Date.UTC(2026, 10, 28, 0, 0, 0))!
    expect(strip.exam.id).toBe('guokao')
    expect(strip.label).toBe('今天国考 · 专业科目 14:00 开考')
    // 卡片岛侧：ExamCountdown 是客户端组件，node 环境不挂载——以源码守卫
    // 钉住 today 分支取同一 firstDayLabel（表达式见 exam-page.test.ts
    //「倒计时岛源码守卫」），此处只比对条带文案等于该考试的 firstDayLabel
    expect(strip.label).toBe(EXAMS.find((e) => e.id === 'guokao')!.firstDayLabel)
    const island = read('src/app/exam/exam-countdown.tsx')
    expect(island).toContain('firstDayLabelActive(exam, now)')
  })

  it('U-107：11-28 16:00 后条带与 /exam 国考卡片岛同落各自既有 fallback（2026-11-28 1922 轮）', () => {
    // 15:59:59 北京时间 = UTC 07:59:59；16:00:00 = UTC 08:00:00。
    // 条带侧回落「今天国考」；岛侧回落「今天考试」（两者 fallback 用词
    // 本就不一致，不得强求同字，此处只断各自 fallback）。
    const before = nearestExamCountdown(Date.UTC(2026, 10, 28, 7, 59, 59))!
    expect(before.exam.id).toBe('guokao')
    expect(before.label).toBe('今天国考 · 专业科目 14:00 开考')
    const after = nearestExamCountdown(Date.UTC(2026, 10, 28, 8, 0, 0))!
    expect(after.exam.id).toBe('guokao')
    expect(after.label).toBe('今天国考')
    const island = read('src/app/exam/exam-countdown.tsx')
    expect(island).toContain('firstDayLabelActive(exam, now)')
    expect(island).toContain(": '今天考试'")
  })
})

describe('nextExamNode（下一步节点）', () => {
  it('国考 11-13 下一步是准考证打印，考后全部节点 done 返回 undefined', () => {
    const guokao = EXAMS.find((e) => e.id === 'guokao')!
    expect(nextExamNode(guokao, NOV_13_0800_CST)?.label).toBe('准考证打印')
    expect(nextExamNode(guokao, NOV_30_0800_CST)).toBeUndefined()
  })

  it('省考 11-30 下一步是天津准考证打印（U-30：七省节点按开始日排，天津 11-28 最早）', () => {
    const shengkao = EXAMS.find((e) => e.id === 'shengkao')!
    expect(nextExamNode(shengkao, NOV_30_0800_CST)?.label).toBe('天津准考证打印')
  })

  it('省考 12-07 下一步返回 undefined：七省节点全过，预计节点开考后不再算待办', () => {
    const shengkao = EXAMS.find((e) => e.id === 'shengkao')!
    expect(nextExamNode(shengkao, Date.UTC(2026, 11, 7, 0, 0))).toBeUndefined()
  })

  it('考研的预计节点（准考证下载）也算下一步，不因 estimated 被跳过', () => {
    const kaoyan = EXAMS.find((e) => e.id === 'kaoyan')!
    expect(nextExamNode(kaoyan, NOV_13_0800_CST)?.label).toBe('准考证下载')
  })

  it('考研开考后预计节点不再算下一步：12-19 与 12-20 都是「初试」', () => {
    const kaoyan = EXAMS.find((e) => e.id === 'kaoyan')!
    expect(nextExamNode(kaoyan, DEC_19_0800_CST)?.label).toBe('初试')
    expect(nextExamNode(kaoyan, DEC_20_0800_CST)?.label).toBe('初试')
  })
})

describe('首页考试条源码守卫', () => {
  const strip = read('src/components/home-exam-strip.tsx')
  const view = read('src/components/home-exam-strip-view.tsx')

  it('外壳：最近一场与下一步节点都走 exam-calendar，不硬编码日期', () => {
    expect(strip).toContain("from '@/lib/exam-calendar'")
    expect(strip).toContain('nearestExam()')
    expect(strip).toContain('nextExamNode(nearest)')
    expect(strip).not.toContain('2026-11-29')
    expect(strip).not.toContain('2026-12-12')
    expect(strip).not.toContain('2026-12-06')
    expect(strip).not.toContain('2026-12-19')
  })

  // U-358：外壳由服务端组件转为客户端组件（只在「今日中心」小窗打开时才需要，
  // 由导航中心 dynamic(ssr:false) 按需加载）；空态行为不变——十二场全结束时仍渲染
  // 静态空态条带（不再 return null），只把最近场交给客户端视图。
  it('外壳为客户端组件：十二场全结束时渲染静态空态条带（不再 return null），只把最近场交给客户端视图', () => {
    expect(strip).toContain("'use client'")
    expect(strip).not.toContain('if (!nearest) return null')
    expect(strip).toContain('if (!nearest) return <HomeExamStripEmptyState />')
    expect(strip).toContain("import { HomeExamStripView } from './home-exam-strip-view'")
    expect(strip).toContain('<HomeExamStripView exam={nearest} nextNode={nextExamNode(nearest)} />')
  })

  it('空态条带：只说已核实的事实（本轮已结束、2027 日程待公布），不写未公布日期与场次数字', () => {
    expect(strip).toContain('2027 年考试日程陆续公布中')
    expect(strip).toContain('本轮考试已结束')
    expect(strip).toContain('新日程以官方公告为准')
    expect(strip).not.toContain('2027-')
    expect(strip).not.toContain('四场考试已结束')
  })

  // 空态分支本身仍是静态 JSX：不挂倒计时岛、不挂客户端视图、不读存储
  //（外壳文件 U-358 起为客户端组件，但空态分支不因此多挂任何岛）。
  it('空态条带：静态直出，不挂倒计时岛、不挂客户端视图、不读存储', () => {
    expect(strip).not.toContain('ExamCountdown')
    // HomeExamStripView 全文件只出现 2 次（import + 有最近场分支），空态分支里没有
    expect(strip.match(/HomeExamStripView/g)?.length).toBe(2)
    expect(strip).not.toContain('useMyExams')
    expect(strip).not.toMatch(/localStorage\./)
  })

  it('空态条带：唯一链接指向 /exam，无外链；徽章与入口用 sky 配方，小字合规', () => {
    expect(strip.match(/href="\/exam"/g)?.length).toBe(1)
    expect(strip).not.toContain('http')
    expect(strip).toContain('bg-sky-500/5')
    expect(strip).toContain('text-sky-700')
    expect(strip).not.toContain('text-sky-600')
    expect(strip).not.toContain('text-primary')
    expect(strip).not.toContain('text-[11px]')
    expect(strip).not.toMatch(/text-zinc-\d/)
    expect(strip).not.toContain('text-muted-foreground/')
    expect(strip).toContain('min-h-11')
    expect(strip).toContain('aria-label="考试季"')
  })

  it('客户端视图：倒计时走 ExamCountdown 客户端岛，服务端不直出天数', () => {
    expect(view).toContain("'use client'")
    expect(view).toContain("import { ExamCountdown } from '@/app/exam/exam-countdown'")
    expect(view).toContain('<ExamCountdown exam={exam} />')
    expect(view).not.toMatch(/\{daysUntil\(/)
  })

  it('客户端视图：常驻链接唯一指向 /exam；提醒外链只走 exam-calendar 常量', () => {
    // 行为有意变化（2026-11-15 国考准考证打印提醒）：提醒期条带副行切到
    // 提醒，内含一条经核实的官方打印系统直达外链（http://gwy.cpta.com.cn，
    // 官方 2026-10-25 公告所载，写 http）。链接事实源在 exam-calendar
    // 常量里，视图只引提醒组件与门控函数，不写死 http 字面量、不写死
    // 考试 id 与日期；常驻入口仍唯一指向 /exam。
    expect(view.match(/href="\/exam"/g)?.length).toBe(1)
    expect(view).toContain('GuokaoAdmissionReminder')
    expect(view).toContain('admissionReminderFor(exam, now)')
    expect(view).not.toContain('http')
  })

  it('客户端视图：小字不用 text-primary、不用 11px、不用锌灰低对比与透明度变体', () => {
    expect(view).not.toContain('text-primary')
    expect(view).not.toContain('text-[11px]')
    expect(view).not.toMatch(/text-zinc-\d/)
    expect(view).not.toContain('text-muted-foreground/')
  })

  it('客户端视图：徽章与入口用 bg-sky-500/5 + text-sky-700 配方，不用旧 text-sky-600', () => {
    expect(view).toContain('bg-sky-500/5')
    expect(view).toContain('text-sky-700')
    expect(view).not.toContain('text-sky-600')
  })

  it('客户端视图：入口可点击目标 44px（min-h-11），条带无障碍名称', () => {
    expect(view).toContain('min-h-11')
    expect(view).toContain('aria-label="考试季"')
  })

  it('客户端视图：接共享 hook 读关注状态，只读不写，不硬编码考试与存储键', () => {
    expect(view).toContain("from '@/hooks/useMyExams'")
    expect(view).toContain('useMyExams')
    expect(view).not.toMatch(/localStorage\./)
    expect(view).not.toContain("'navhub.my-exams.v1'")
    expect(view).not.toContain('2026-11-29')
    expect(view).not.toContain('2026-12-12')
    expect(view).not.toContain('2026-12-06')
    expect(view).not.toContain('2026-12-19')
    expect(view).not.toContain("'guokao'")
    expect(view).not.toContain("'kaoyan'")
    expect(view).not.toContain('云同步')
    expect(view).not.toContain('登录后同步')
  })

  it('客户端视图：已关注时徽章变「我的考试」，未关注时仍是「考试季」', () => {
    expect(view).toContain("'我的考试'")
    expect(view).toContain("'考试季'")
  })
})

describe('首页挂载位置守卫（U-24）', () => {
  const home = read('src/app/page.tsx')

  // U-358：今日区与考试条不再经 page.tsx todaySlots 注入——两区只在「今日中心」小窗
  // 打开时才需要，现由 NavigationContent 以 dynamic(ssr:false) 按需加载；
  // 首屏不再堆叠挡在导航上方，也不再为它们付首屏 JS 体积。顺序仍为今日→简报→考试→接力。
  it('今日区与考试日历均由导航中心 dynamic(ssr:false) 按需加载进今日中心小窗', () => {
    expect(home).not.toContain('todaySlots')
    expect(home).not.toContain('HomeTodayZone')
    expect(home).not.toContain('HomeExamStrip')
    const nav = read('src/components/navigation-content.tsx')
    expect(nav).toContain("() => import('@/components/home-today-zone')")
    expect(nav).toContain("() => import('@/components/home-exam-strip')")
    expect(nav).toContain('{ ssr: false')
    const todayAt = nav.indexOf('todayContent={<TodayZoneContent />}')
    const briefAt = nav.indexOf('briefContent={<BriefStripContent />}')
    const examAt = nav.indexOf('examContent={<ExamStripContent />}')
    const handoffAt = nav.indexOf('<HandoffCardWithCloudContent />')
    const streakAt = nav.indexOf('<StreakBarContent />')
    expect(todayAt).toBeGreaterThan(-1)
    expect(briefAt).toBeGreaterThan(todayAt)
    expect(examAt).toBeGreaterThan(briefAt)
    expect(handoffAt).toBeGreaterThan(examAt)
    expect(streakAt).toBeGreaterThan(handoffAt)
  })
})
