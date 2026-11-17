/**
 * 首页「考试季」运营条（HomeExamStrip）红线测试：
 *  - 最近一场与「下一步」节点只按 exam-calendar 事实源算，不硬编码日期；
 *  - 多日考试末日仍算最近一场（考研 12-20 当天条带仍在）；
 *  - 四场全结束时渲染静态空态条带（保留考试日历入口），不再整条消失；
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
 *  - 结构：服务端外壳（home-exam-strip.tsx）只挑全局最近场；
 *    个性化由客户端视图（home-exam-strip-view.tsx）挂载后接手——
 *    挂载前渲染与服务端直出一致，关注了未结束考试才切到已关注场。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  EXAMS,
  nearestExam,
  nextExamNode,
  type ExamInfo,
} from '../src/lib/exam-calendar'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

/** 2026-11-13 08:00 北京时间（UTC 午夜） */
const NOV_13_0800_CST = Date.UTC(2026, 10, 13, 0, 0, 0)
/** 2026-11-30 08:00 北京时间：国考已过，省考最近 */
const NOV_30_0800_CST = Date.UTC(2026, 10, 30, 0, 0, 0)
/** 2026-12-19 08:00 北京时间：考研第一天，已开考 */
const DEC_19_0800_CST = Date.UTC(2026, 11, 19, 0, 0, 0)
/** 2026-12-20 08:00 北京时间：考研第二天，仍在进行中 */
const DEC_20_0800_CST = Date.UTC(2026, 11, 20, 0, 0, 0)
/** 2026-12-21 08:00 北京时间：四场全过 */
const DEC_21_0800_CST = Date.UTC(2026, 11, 21, 0, 0, 0)

describe('nearestExam（最近一场）', () => {
  it('11-13 最近是国考，11-30 最近是省考，12-20 考研末日仍是考研，12-21 四场全过返回 undefined', () => {
    expect(nearestExam(NOV_13_0800_CST)?.id).toBe('guokao')
    expect(nearestExam(NOV_30_0800_CST)?.id).toBe('shengkao')
    expect(nearestExam(DEC_20_0800_CST)?.id).toBe('kaoyan')
    expect(nearestExam(DEC_21_0800_CST)).toBeUndefined()
  })

  it('考试当天仍算最近一场（daysUntil 为 0），考后才切下一场', () => {
    expect(nearestExam(Date.UTC(2026, 10, 29, 2, 0))?.id).toBe('guokao')
    expect(nearestExam(Date.UTC(2026, 10, 30, 0, 0))?.id).toBe('shengkao')
  })

  it('多日考试末日仍算最近一场（12-19 首日与 12-20 末日都是考研），12-21 才返回 undefined', () => {
    expect(nearestExam(Date.UTC(2026, 11, 19, 0, 0, 0))?.id).toBe('kaoyan')
    expect(nearestExam(Date.UTC(2026, 11, 20, 0, 0, 0))?.id).toBe('kaoyan')
    expect(nearestExam(Date.UTC(2026, 11, 20, 15, 59, 59))?.id).toBe('kaoyan')
    expect(nearestExam(Date.UTC(2026, 11, 21, 0, 0, 0))).toBeUndefined()
  })

  it('排序按首考日：加试考试（首考日早、公共科目首日晚）排在无加试考试之前', () => {
    // 2026-11-16 0922 C 线：合成数据——A 公共科目首日 12-01 但有加试、
    // 首考日 11-20；B 无加试、首日 11-25。按 startISO 排会先挑 B，
    // 按首考日排应先挑 A；两种传入顺序都应挑 A。真实数据里只有国考
    // 首考日 ≠ startISO 且仍为最早，行为不变；这条断言钉住排序键本身，
    // 防将来第二场加试考试排错。
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
})

describe('nextExamNode（下一步节点）', () => {
  it('国考 11-13 下一步是准考证打印，考后全部节点 done 返回 undefined', () => {
    const guokao = EXAMS.find((e) => e.id === 'guokao')!
    expect(nextExamNode(guokao, NOV_13_0800_CST)?.label).toBe('准考证打印')
    expect(nextExamNode(guokao, NOV_30_0800_CST)).toBeUndefined()
  })

  it('省考 11-30 下一步是 12-05 专业科目笔试', () => {
    const shengkao = EXAMS.find((e) => e.id === 'shengkao')!
    expect(nextExamNode(shengkao, NOV_30_0800_CST)?.label).toBe('专业科目笔试')
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

  it('服务端外壳：最近一场与下一步节点都走 exam-calendar，不硬编码日期', () => {
    expect(strip).toContain("from '@/lib/exam-calendar'")
    expect(strip).toContain('nearestExam()')
    expect(strip).toContain('nextExamNode(nearest)')
    expect(strip).not.toContain('2026-11-29')
    expect(strip).not.toContain('2026-12-12')
    expect(strip).not.toContain('2026-12-06')
    expect(strip).not.toContain('2026-12-19')
  })

  it('服务端外壳保持服务端组件：四场全结束时渲染静态空态条带（不再 return null），只把最近场交给客户端视图', () => {
    expect(strip).not.toContain("'use client'")
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

  it('空态条带：纯服务端静态，不挂倒计时岛、不挂客户端视图、不读存储', () => {
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
    // 提醒，内含一条经核实的官方专题站外链（http://bm.scs.gov.cn/kl2027，
    // 2026-11-14 curl 核实 200，https 不可用）。链接事实源在 exam-calendar
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

  it('今日区第一、折叠区第二、导航第三；考试条在折叠区内简报条之后、接力卡之前', () => {
    expect(home).toContain('import { HomeTodayZone } from "@/components/home-today-zone"')
    expect(home).toContain('import { HomeTodayMore } from "@/components/home-today-more"')
    expect(home).toContain('import { HomeExamStrip } from "@/components/home-exam-strip"')
    const zone = home.indexOf('<HomeTodayZone />')
    const moreOpen = home.indexOf('<HomeTodayMore>')
    const moreClose = home.indexOf('</HomeTodayMore>')
    const nav = home.indexOf('<NavigationContent')
    const brief = home.indexOf('<HomeBriefStrip />')
    const exam = home.indexOf('<HomeExamStrip />')
    const handoff = home.indexOf('<HandoffCardWithCloud />')
    const streak = home.indexOf('<StreakBar />')
    expect(zone).toBeGreaterThan(-1)
    expect(moreOpen).toBeGreaterThan(zone)
    expect(moreClose).toBeGreaterThan(moreOpen)
    expect(nav).toBeGreaterThan(moreClose)
    for (const pos of [brief, exam, handoff, streak]) {
      expect(pos).toBeGreaterThan(moreOpen)
      expect(pos).toBeLessThan(moreClose)
    }
    expect(brief).toBeLessThan(exam)
    expect(exam).toBeLessThan(handoff)
    expect(handoff).toBeLessThan(streak)
  })
})
