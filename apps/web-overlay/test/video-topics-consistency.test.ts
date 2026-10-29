import { describe, it, expect } from 'vitest'
import topicsFile from '@/navsphere/content/video-topics.json'

/**
 * 候选热点池的数据契约守卫。
 *
 * 背景：`video-topics.json` 里曾有 6 条 `durationSec` 与章节时长之和相差 1–2 个
 * 数量级（如 314,062s ≈ 87 小时），而这份数据同时喂给：
 *   · `calculateQualityScore` 的时长区间（>7200s 得 12 分）；
 *   · 前端播放器的总时长与章节跳转；
 *   · `chapters[].startTime` 的合法性。
 * 三者会因此互相矛盾，且不会有任何报错。
 *
 * 这里守住三条不变量，任何一条被破坏都说明数据被手改坏了。
 */

interface Topic {
  domain: string
  keyword: string
  bvidFallback: string
  durationSec: number
  chapters?: Array<{ startTime?: number; duration?: number }>
}

const topics = ((topicsFile as { topics?: unknown }).topics ?? []) as Topic[]

/** 章节时长之和 */
function chapterTotal(topic: Topic): number {
  return (topic.chapters ?? []).reduce((acc, c) => acc + (Number(c.duration) || 0), 0)
}

describe('候选热点池：时长自洽性', () => {
  it('候选池非空', () => {
    expect(topics.length).toBeGreaterThan(0)
  })

  it('每条 durationSec 与章节时长之和一致（误差 ≤ 60s）', () => {
    const drifted = topics
      .map(t => ({ id: t.bvidFallback, durationSec: t.durationSec, sum: chapterTotal(t) }))
      .filter(x => x.sum > 0 && Math.abs(x.durationSec - x.sum) > 60)

    expect(drifted).toEqual([])
  })

  it('durationSec 落在合理区间（>0 且 ≤ 24 小时）', () => {
    // 上限取 24h 而非 8h：候选池里确有 8–10 小时的「全套课程」合辑，属合法数据。
    // 要拦住的是 52h / 87h 这类数量级错误 —— 它们会让章节树与总时长彻底矛盾。
    const outliers = topics
      .filter(t => !Number.isFinite(t.durationSec) || t.durationSec <= 0 || t.durationSec > 24 * 3600)
      .map(t => ({ id: t.bvidFallback, durationSec: t.durationSec }))

    expect(outliers).toEqual([])
  })

  it('章节起点 + 时长不超过总时长（误差 ≤ 60s）', () => {
    const overflowing = topics
      .filter(t => {
        const last = (t.chapters ?? []).reduce(
          (max, c) => Math.max(max, (Number(c.startTime) || 0) + (Number(c.duration) || 0)),
          0,
        )
        return last > 0 && last > t.durationSec + 60
      })
      .map(t => ({ id: t.bvidFallback, durationSec: t.durationSec }))

    expect(overflowing).toEqual([])
  })
})
