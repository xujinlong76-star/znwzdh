/**
 * 首页「今日一件事」区（U-24）测试：
 *  - 今日区只拼四个已有零件（专注 / 考试倒计时 / 短剧榜 / 简报回访），
 *    不写死日期、考试 id、剧名、URL，不新增外链；
 *  - 折叠区是客户端开关：默认收起、aria 完备、本机只记开关；
 *  - 行为：今天（2026-11-17）最近一场是国考、距首考日 11 天，
 *    featured 清单首部有剧可取（只断言“有”，不断言具体剧名——
 *    剧名是数据，数据变了测试不该红）。
 * 首页挂载顺序（今日区 → 折叠区 → 导航）见本文件末尾 describe，
 * 旧的 home-exam-entry 挂载守卫随 U-24 定义同步更新。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { nearestExamCountdown, nextExamNode } from '../src/lib/exam-calendar'
import { loadDramaFeatured } from '../src/lib/drama-featured'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

/** 2026-11-17 08:00 北京时间（UTC 午夜）：四六级口试准考证打印开放日 */
const NOV_17_0800_CST = Date.UTC(2026, 10, 17, 0, 0, 0)

describe('今日区源码守卫（home-today-zone.tsx）', () => {
  const zone = read('src/components/home-today-zone.tsx')

  it('四个零件都是复用已有实现，不自造数据', () => {
    expect(zone).toContain("from '@/components/daily-focus'")
    expect(zone).toContain("from '@/app/brief/brief-resurface'")
    expect(zone).toContain("from '@/lib/exam-calendar'")
    expect(zone).toContain('nearestExamCountdown()')
    expect(zone).toContain('nextExamNode(')
    expect(zone).toContain("from '@/lib/drama-featured'")
    expect(zone).toContain('loadDramaFeatured()')
  })

  it('不写死日期、考试 id、剧名与 URL', () => {
    expect(zone).not.toContain('2026-11-')
    expect(zone).not.toContain('2026-12-')
    expect(zone).not.toContain("'guokao'")
    expect(zone).not.toContain("'kaoyan'")
    expect(zone).not.toContain('http')
    expect(zone).not.toContain('十八岁太奶奶')
  })

  it('今日区是带无障碍名称的 section，日期行按时区算', () => {
    expect(zone).toContain('aria-label="今日一件事"')
    expect(zone).toContain('Asia/Shanghai')
    expect(zone).toContain('今日一件事')
  })

  it('短剧标题旁如实标链接性质，不写成“点开即看”', () => {
    expect(zone).toContain('{drama.linkNote}')
    expect(zone).not.toContain('点开即看')
  })

  it('今日区内链只指向站内 /exam 与 /drama（专注与重温是本机岛，无外链）', () => {
    expect(zone).toContain('href="/exam"')
    expect(zone).toContain('href="/drama"')
    expect(zone).not.toContain('target="_blank" href="/')
    expect(zone).not.toContain('href="http')
  })

  it('可点目标 44px：考试日历与短剧专区入口 min-h-11', () => {
    expect(zone.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(2)
  })
})

describe('折叠区源码守卫（home-today-more.tsx）', () => {
  const more = read('src/components/home-today-more.tsx')

  it('客户端开关：默认收起，状态只记本机开关', () => {
    expect(more).toContain("'use client'")
    expect(more).toContain('HOME_TODAY_MORE_DEFAULT_OPEN = false')
    expect(more).toContain("HOME_TODAY_MORE_STORAGE_KEY = 'navhub.home.todayMoreOpen.v1'")
    expect(more).toContain('localStorage.getItem(HOME_TODAY_MORE_STORAGE_KEY)')
    expect(more).toContain('localStorage.setItem(HOME_TODAY_MORE_STORAGE_KEY')
  })

  it('开关是带文字的真按钮，aria 完备；折叠用 hidden 切换，不卸载内容', () => {
    expect(more).toContain('aria-expanded={open}')
    expect(more).toContain('aria-controls="home-today-more"')
    expect(more).toContain('id="home-today-more"')
    expect(more).toContain('hidden={!open}')
    expect(more).toContain('更多今日内容')
    expect(more).toContain('min-h-11')
  })

  it('折叠区不渲染任何条带内容：只包 children，不 import 四条', () => {
    expect(more).not.toContain('HomeBriefStrip')
    expect(more).not.toContain('HomeExamStrip')
    expect(more).not.toContain('HandoffCard')
    expect(more).not.toContain('StreakBar')
    expect(more).toContain('{children}')
  })
})

describe('今日区行为：考试倒计时与短剧榜首（只读事实源）', () => {
  it('2026-11-17 最近一场是国考，距首考日 11 天，下一步是准考证打印', () => {
    const line = nearestExamCountdown(NOV_17_0800_CST)
    expect(line?.exam.id).toBe('guokao')
    expect(line?.days).toBe(11)
    expect(line?.label).toContain('国考')
    expect(nextExamNode(line!.exam, NOV_17_0800_CST)?.label).toBe('准考证打印')
  })

  it('featured 清单首部有剧可取（只断言有，不断言具体剧名）', () => {
    const { dramas } = loadDramaFeatured()
    expect(dramas.length).toBeGreaterThan(0)
    const first = dramas[0]!
    expect(first.title.length).toBeGreaterThan(0)
    expect(first.url).toMatch(/^https?:\/\//)
    expect(first.platformTitle.length).toBeGreaterThan(0)
  })
})

describe('首页挂载顺序守卫（U-24）', () => {
  const home = read('src/app/page.tsx')

  it('今日区第一、折叠区第二、导航第三；四条带顶收进折叠区、相对顺序不变', () => {
    expect(home).toContain('import { HomeTodayZone } from "@/components/home-today-zone"')
    expect(home).toContain('import { HomeTodayMore } from "@/components/home-today-more"')
    const zone = home.indexOf('<HomeTodayZone />')
    const moreOpen = home.indexOf('<HomeTodayMore>')
    const moreClose = home.indexOf('</HomeTodayMore>')
    const nav = home.indexOf('<NavigationContent')
    expect(zone).toBeGreaterThan(-1)
    expect(moreOpen).toBeGreaterThan(zone)
    expect(moreClose).toBeGreaterThan(moreOpen)
    expect(nav).toBeGreaterThan(moreClose)
    const brief = home.indexOf('<HomeBriefStrip />')
    const exam = home.indexOf('<HomeExamStrip />')
    const handoff = home.indexOf('<HandoffCardWithCloud />')
    const streak = home.indexOf('<StreakBar />')
    for (const pos of [brief, exam, handoff, streak]) {
      expect(pos).toBeGreaterThan(moreOpen)
      expect(pos).toBeLessThan(moreClose)
    }
    expect(brief).toBeLessThan(exam)
    expect(exam).toBeLessThan(handoff)
    expect(handoff).toBeLessThan(streak)
  })
})
