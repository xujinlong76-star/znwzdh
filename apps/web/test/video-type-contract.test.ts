import { describe, expect, it } from 'vitest'
import type { VideoConfig } from '@/types/navigation'
import { extractCodeMilestones } from '@/lib/video-code-diff'
import { resolveAvailableMirrors } from '@/lib/video-failover'
import {
  generateFlashcardsFromNotes,
  generateFlashcardsFromQuizzes,
} from '@/lib/video-spaced-repetition'

/**
 * A8 第二批的回归守卫。
 *
 * 这些用例全部对应**恢复类型检查后暴露出来的功能失效**，不是纯类型洁癖：
 * 它们在过去（`ignoreBuildErrors: true` 期间）一直「编译通过、行为是错的」。
 */

describe('章节起始秒：两套字段并存时不能丢值', () => {
  it('只有 timeSec 的章节也能拿到正确的 timeSec', () => {
    // 旧实现写 `timeSec: ch.startTime` —— 而采集器写入的章节只有 timeSec，
    // 于是所有里程碑的时间点都是 undefined，点击章节不会跳转。
    const milestones = extractCodeMilestones([
      { title: '第一章：环境准备', timeSec: 120, codeSnippet: 'pnpm install' },
      { title: '第二章：核心实现', startTime: 600, codeSnippet: 'export const x = 1' },
    ])

    expect(milestones).toHaveLength(2)
    expect(milestones[0].timeSec).toBe(120)
    expect(milestones[1].timeSec).toBe(600)
  })

  it('两套字段都缺时退化为 0，而不是 undefined', () => {
    const milestones = extractCodeMilestones([{ title: '无时间点', codeSnippet: 'echo hi' }])
    expect(milestones[0].timeSec).toBe(0)
  })
})

describe('镜像线路：priority 排序契约', () => {
  const base: VideoConfig = { type: 'bilibili', bvid: 'BV1xx411c7mD' }

  it('主线路排在第一位，附加线路按默认优先级 10 排在后面', () => {
    // 注意：`videos.json` 里目前**没有任何** mirrors 数据（0 条），这条链路是潜在功能。
    // 因此这里锁的是排序契约，而不是「曾经有过 NaN 崩溃」——构造时缺省的 priority
    // 会被填成 10（见 resolveAvailableMirrors），primary 恒为 0。
    const sources = resolveAvailableMirrors({
      ...base,
      mirrors: [
        { id: 'mirror-a', platform: 'youtube', sourceId: 'dQw4w9WgXcQ' },
        { id: 'mirror-b', platform: 'custom', sourceId: 'https://cdn.example.com/a.m3u8' },
      ],
    })

    expect(sources).toHaveLength(3)
    expect(sources[0].label).toContain('主线路')
    expect(sources[0].priority).toBe(0)
    // 附加线路未显式给 priority → 统一 10
    expect(sources.slice(1).map(s => s.priority)).toEqual([10, 10])
  })

  it('缺 sourceId 的线路会被跳过（无法构造播放地址）', () => {
    const sources = resolveAvailableMirrors({
      ...base,
      mirrors: [{ id: 'no-address', platform: 'youtube' }],
    })
    expect(sources.map(s => s.id)).not.toContain('no-address')
  })

  it('显式 priority 仍然生效（0 最高）', () => {
    const sources = resolveAvailableMirrors({
      ...base,
      mirrors: [{ id: 'fast', platform: 'youtube', sourceId: 'abc', priority: -1 }],
    })
    expect(sources[0].id).toBe('fast')
  })
})

describe('自测题闪卡：答案取真实正确项', () => {
  it('correctIndex 指向的选项就是答案', () => {
    // 旧实现读 `q.options.find(o => o.isCorrect)?.label` —— options 是 string[]，
    // 没有 isCorrect 属性，于是**每张自测闪卡的答案都是「查看详解」**。
    const [card] = generateFlashcardsFromQuizzes([
      {
        id: 'q1',
        question: 'React 的 useMemo 作用是什么？',
        options: ['缓存计算结果', '发起请求', '绑定事件', '设置样式'],
        correctIndex: 0,
        explanation: '避免重复计算',
      },
    ])

    expect(card.answer).toBe('正确答案：缓存计算结果')
    expect(card.question).toContain('React 的 useMemo')
  })

  it('兼容 correctAnswerIndex 旧字段', () => {
    const [card] = generateFlashcardsFromQuizzes([
      {
        id: 'q2',
        question: 'Next.js 的 App Router 目录名？',
        options: ['pages', 'app', 'routes', 'views'],
        correctAnswerIndex: 1,
        explanation: 'app 目录',
      },
    ])
    expect(card.answer).toBe('正确答案：app')
  })

  it('题干取自 question 字段（不是不存在的 title）', () => {
    const [card] = generateFlashcardsFromQuizzes([
      { id: 'q3', question: '真正的题干', options: ['a', 'b'], correctIndex: 0, explanation: '' },
    ])
    expect(card.question).toContain('真正的题干')
    expect(card.question).not.toContain('undefined')
  })
})

describe('笔记闪卡：answer 必填与时间戳类型', () => {
  it('没有用户笔记时按 OCR / 代码片段兜底，不留空答案', () => {
    const [card] = generateFlashcardsFromNotes([
      {
        id: 'n1',
        videoId: 'v1',
        videoTitle: '依赖注入',
        timeSec: 65,
        codeSnippet: 'const a = 1',
        createdAt: '2026-01-02T03:04:05.000Z',
      },
    ])

    expect(card.answer).toBe('const a = 1')
    // createdAt 在 FlashcardItem 上是毫秒数：旧实现把 ISO 字符串直接塞进去
    expect(typeof card.createdAt).toBe('number')
    expect(card.createdAt).toBe(Date.parse('2026-01-02T03:04:05.000Z'))
  })

  it('优先使用用户手写笔记', () => {
    const [card] = generateFlashcardsFromNotes([
      {
        id: 'n2',
        videoId: 'v1',
        videoTitle: 't',
        timeSec: 0,
        userNote: '我自己的总结',
        codeSnippet: 'const a = 1',
        createdAt: '2026-01-02T03:04:05.000Z',
      },
    ])
    expect(card.answer).toBe('我自己的总结')
  })
})
