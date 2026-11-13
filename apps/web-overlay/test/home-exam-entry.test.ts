/**
 * 首页「考试季」运营条（HomeExamStrip）红线测试：
 *  - 最近一场与「下一步」节点只按 exam-calendar 事实源算，不硬编码日期；
 *  - 四场全结束时整条不渲染（考试季结束自然下线）；
 *  - 倒计时走 ExamCountdown 客户端岛，服务端 JSX 里不直出天数；
 *  - 条内唯一链接指向 /exam；小字不用 text-primary、不用 11px、
 *    不用锌灰低对比；徽章用 bg-sky-500/5 + text-sky-700 配方；
 *  - 挂载位置：首页简报条之后、连胜条之前（首屏顶部）。
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
/** 2026-12-21 08:00 北京时间：四场全过 */
const DEC_21_0800_CST = Date.UTC(2026, 11, 21, 0, 0, 0)

describe('nearestExam（最近一场）', () => {
  it('11-13 最近是国考，11-30 最近是省考，12-21 四场全过返回 undefined', () => {
    expect(nearestExam(NOV_13_0800_CST)?.id).toBe('guokao')
    expect(nearestExam(NOV_30_0800_CST)?.id).toBe('shengkao')
    expect(nearestExam(DEC_21_0800_CST)).toBeUndefined()
  })

  it('考试当天仍算最近一场（daysUntil 为 0），考后才切下一场', () => {
    expect(nearestExam(Date.UTC(2026, 10, 29, 2, 0))?.id).toBe('guokao')
    expect(nearestExam(Date.UTC(2026, 10, 30, 0, 0))?.id).toBe('shengkao')
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

  it('复用事实源：最近一场与下一步节点都走 exam-calendar，不硬编码日期', () => {
    expect(strip).toContain("from '@/lib/exam-calendar'")
    expect(strip).toContain('nearestExam()')
    expect(strip).toContain('nextExamNode(nearest)')
    expect(strip).not.toContain('2026-11-29')
    expect(strip).not.toContain('2026-12-12')
    expect(strip).not.toContain('2026-12-06')
    expect(strip).not.toContain('2026-12-19')
  })

  it('四场全结束时整条不渲染', () => {
    expect(strip).toContain('if (!nearest) return null')
  })

  it('倒计时走 ExamCountdown 客户端岛，服务端不直出天数', () => {
    expect(strip).toContain("import { ExamCountdown } from '@/app/exam/exam-countdown'")
    expect(strip).toContain('<ExamCountdown exam={nearest} />')
    expect(strip).not.toMatch(/\{daysUntil\(/)
  })

  it('条内唯一链接指向 /exam，无外链', () => {
    expect(strip.match(/href="\/exam"/g)?.length).toBe(1)
    expect(strip).not.toContain('http')
  })

  it('小字不用 text-primary、不用 11px、不用锌灰低对比与透明度变体', () => {
    expect(strip).not.toContain('text-primary')
    expect(strip).not.toContain('text-[11px]')
    expect(strip).not.toMatch(/text-zinc-\d/)
    expect(strip).not.toContain('text-muted-foreground/')
  })

  it('徽章与入口用 bg-sky-500/5 + text-sky-700 配方，不用旧 text-sky-600', () => {
    expect(strip).toContain('bg-sky-500/5')
    expect(strip).toContain('text-sky-700')
    expect(strip).not.toContain('text-sky-600')
  })

  it('入口可点击目标 44px（min-h-11），条带无障碍名称', () => {
    expect(strip).toContain('min-h-11')
    expect(strip).toContain('aria-label="考试季"')
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
