/**
 * U-403：/me 成长横幅的宝箱按钮文案必须跟宝箱状态走。
 *
 * 以前按钮写死「去领每日宝箱」：宝箱开过了还是这句，用户点进去才发现
 * 「今天的宝箱已经开过了」。横幅用的 dailyTaskStatus 早就返回了
 * chestOpened / allDone / chestAvailable，只是横幅没用。
 *
 * 三态（与成长页 growth-tasks.tsx 的宝箱文案同口径）：
 * - chestOpened → 「今日宝箱已领」
 * - allDone（可领未开）→ 「去领每日宝箱」
 * - 默认（任务未做完）→ 「完成今日任务领宝箱」
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  awardEvent,
  dailyTaskStatus,
  emptyProfile,
  openDailyChest,
  settleProfile,
  type GrowthProfile,
} from '../src/lib/growth'

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

/** 本地时间构造：正午，避开 04:00 切日平移（与 growth-v2.test.ts 同口径） */
function at(month: number, day: number): Date {
  return new Date(2026, month - 1, day, 12)
}

function allDoneDay(p: GrowthProfile, now: Date): GrowthProfile {
  // 用四种动作把三槽谓词都覆盖（浅层/核心/沉淀的候选池任一命中即可）
  p = awardEvent(p, 'brief_read', {}, now).profile
  p = awardEvent(p, 'site_open', { siteKey: 'https://a.example.com' }, now).profile
  p = awardEvent(p, 'site_open', { siteKey: 'https://b.example.com' }, now).profile
  p = awardEvent(p, 'ai_find', {}, now).profile
  p = awardEvent(p, 'search', { term: '新词' }, now).profile
  p = awardEvent(p, 'favorite_add', { siteId: 's1' }, now).profile
  p = awardEvent(p, 'category_visit', { categoryId: 'brand-new-cat' }, now).profile
  return p
}

describe('U-403 /me 成长横幅宝箱按钮：三态文案', () => {
  const view = read('src/app/me/me-view.tsx')

  it('三态各有一句文案，且按 chestOpened → allDone → 默认的顺序分支', () => {
    expect(view).toContain("? '今日宝箱已领'")
    expect(view).toContain("? '去领每日宝箱'")
    expect(view).toContain(": '完成今日任务领宝箱'")
    expect(view).toContain('status.chestOpened')
    expect(view).toContain('status.allDone')
    // 开过先判：chestOpened 分支必须在 allDone 分支之前
    expect(view.indexOf('status.chestOpened')).toBeLessThan(view.indexOf('status.allDone'))
    // 按钮渲染的是三态变量，不是写死的字符串
    expect(view).toContain('{chestCta}')
  })

  it('「去领每日宝箱」只出现一次（可领态的三元分支里），不再是写死的按钮文本', () => {
    const hits = view.match(/去领每日宝箱/g) ?? []
    expect(hits).toHaveLength(1)
    expect(view).not.toContain('\n          去领每日宝箱\n')
  })
})

describe('U-403 dailyTaskStatus 三态本身是真实可分的（横幅分支的依据）', () => {
  it('默认态：任务未做完 → allDone/chestOpened/chestAvailable 全 false', () => {
    const s = dailyTaskStatus(emptyProfile(at(11, 9)), at(11, 9))
    expect(s.allDone).toBe(false)
    expect(s.chestOpened).toBe(false)
    expect(s.chestAvailable).toBe(false)
  })

  it('可领态：三槽全清且未开箱 → allDone 与 chestAvailable 为 true，chestOpened 为 false', () => {
    let p = emptyProfile(at(11, 9))
    p = allDoneDay(p, at(11, 9))
    p = settleProfile(p, at(11, 9)).profile
    const s = dailyTaskStatus(p, at(11, 9))
    expect(s.allDone).toBe(true)
    expect(s.chestOpened).toBe(false)
    expect(s.chestAvailable).toBe(true)
  })

  it('已领态：开箱后 → chestOpened 为 true，chestAvailable 为 false', () => {
    let p = emptyProfile(at(11, 9))
    p = allDoneDay(p, at(11, 9))
    p = settleProfile(p, at(11, 9)).profile
    const opened = openDailyChest(p, at(11, 9), () => 0.99)
    expect(opened.result.ok).toBe(true)
    const s = dailyTaskStatus(opened.profile, at(11, 9))
    expect(s.allDone).toBe(true)
    expect(s.chestOpened).toBe(true)
    expect(s.chestAvailable).toBe(false)
  })
})
