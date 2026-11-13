/**
 * 首页「考试季」运营条（HomeExamStrip）红线测试：
 *  - 最近一场与「下一步」节点只按 exam-calendar 事实源算，不硬编码日期；
 *  - 多日考试末日仍算最近一场（考研 12-20 当天条带仍在）；
 *  - 四场全结束时渲染静态空态条带（保留考试日历入口），不再整条消失；
 *    空态不挂倒计时岛、不挂客户端视图、不读存储、不含未公布日期；
 *  - 倒计时走 ExamCountdown 客户端岛，服务端 JSX 里不直出天数；
 *  - 条内唯一链接指向 /exam；小字不用 text-primary、不用 11px、
 *    不用锌灰低对比；徽章用 bg-sky-500/5 + text-sky-700 配方；
 *  - 挂载位置：首页简报条之后、连胜条之前（首屏顶部）。
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
} from '../src/lib/exam-calendar'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

/** 2026-11-13 08:00 北京时间（UTC 午夜） */
const NOV_13_0800_CST = Date.UTC(2026, 10, 13, 0, 0, 0)
/** 2026-11-30 08:00 北京时间：国考已过，省考最近 */
const NOV_30_0800_CST = Date.UTC(2026, 10, 30, 0, 0, 0)
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

  it('客户端视图：条内唯一链接指向 /exam，无外链', () => {
    expect(view.match(/href="\/exam"/g)?.length).toBe(1)
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

describe('首页挂载位置守卫', () => {
  const home = read('src/app/page.tsx')

  it('考试条挂在简报条之后、连胜条之前（首屏顶部）', () => {
    expect(home).toContain('import { HomeExamStrip } from "@/components/home-exam-strip"')
    const brief = home.indexOf('<HomeBriefStrip />')
    const exam = home.indexOf('<HomeExamStrip />')
    const streak = home.indexOf('<StreakBar />')
    expect(brief).toBeGreaterThan(-1)
    expect(exam).toBeGreaterThan(brief)
    expect(exam).toBeLessThan(streak)
  })
})
