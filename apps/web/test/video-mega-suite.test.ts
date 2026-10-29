import { describe, it, expect } from 'vitest'
import {
  computeUnifiedDiff,
  extractCodeMilestones,
  findMilestoneAtTime,
} from '@/lib/video-code-diff'
import {
  attachAudioEnhancer,
} from '@/lib/video-audio-enhancer'
import {
  joinCoWatchRoom,
} from '@/lib/video-crdt-room'
import {
  generateVideoQuizzes,
  gradeQuizAnswers,
  findQuizTriggerAtPlayhead,
  quizCorrectIndex,
} from '@/lib/video-quiz-generator'
import {
  generateVideoMindMap,
  flattenMindMap,
  exportMindMapAsMarkdown,
} from '@/lib/video-mindmap-generator'
import {
  generateVideoObjectSchema,
  generateVideoSitemapXml,
  generateVideoRssFeed,
} from '@/lib/video-seo'
import type { VideoChapter, NavigationSubItem } from '@/types/navigation'

describe('1. Video Code Diff Engine (LCS Unified Diff & Timeline)', () => {
  it('correctly calculates added, removed, and context lines between code snippets', () => {
    const oldCode = 'const a = 1\nconst b = 2\nconsole.log(a)'
    const newCode = 'const a = 1\nconst b = 3\nconst c = 4\nconsole.log(a)'

    const result = computeUnifiedDiff(oldCode, newCode)
    expect(result.summary.totalOldLines).toBe(3)
    expect(result.summary.totalNewLines).toBe(4)
    expect(result.summary.addedLines).toBeGreaterThan(0)
    expect(result.summary.removedLines).toBeGreaterThan(0)

    const added = result.lines.filter(l => l.type === 'add')
    const removed = result.lines.filter(l => l.type === 'del')
    const unchanged = result.lines.filter(l => l.type === 'context')

    expect(added.length).toBe(2) // const b = 3, const c = 4
    expect(removed.length).toBe(1) // const b = 2
    expect(unchanged.length).toBe(2) // const a = 1, console.log(a)
  })

  it('handles empty code diffing gracefully', () => {
    const diffEmpty = computeUnifiedDiff('', '')
    expect(diffEmpty.lines).toHaveLength(0)
    expect(diffEmpty.summary.addedLines).toBe(0)
    expect(diffEmpty.summary.removedLines).toBe(0)

    const diffFromEmpty = computeUnifiedDiff('', 'line 1\nline 2')
    expect(diffFromEmpty.summary.addedLines).toBe(2)
  })

  it('extracts milestones sequentially from video chapters', () => {
    const chapters: VideoChapter[] = [
      { id: 'c1', title: 'Init Project', startTime: 0, codeSnippet: 'npm init -y', codeLanguage: 'bash' },
      { id: 'c2', title: 'Theoretical concept', startTime: 60 },
      { id: 'c3', title: 'Add server code', startTime: 120, codeSnippet: 'import express from "express"', codeLanguage: 'typescript' },
    ]

    const milestones = extractCodeMilestones(chapters)
    expect(milestones).toHaveLength(2)
    expect(milestones[0].title).toBe('Init Project')
    expect(milestones[0].diffFromPrev).toBeUndefined()
    expect(milestones[1].title).toBe('Add server code')
    expect(milestones[1].diffFromPrev).toBeDefined()
    expect(milestones[1].diffFromPrev?.summary.addedLines).toBe(1)

    const found = findMilestoneAtTime(milestones, 150)
    expect(found?.id).toBe('c3')
  })
})

describe('2. Client-Side WebAudio Signal Processing (DSP Enhancer)', () => {
  it('initializes enhancer safely in SSR / fallback environments and updates options', () => {
    const mockAudio = {} as HTMLMediaElement
    const controller = attachAudioEnhancer(mockAudio, {
      voiceClarity: true,
      loudnessNormalization: true,
      volumeBoost: 1.5,
      lowCut: true,
    })

    expect(controller).toBeDefined()
    expect(controller.getOptions().volumeBoost).toBe(1.5)
    expect(controller.getOptions().voiceClarity).toBe(true)

    // Update options
    controller.setOptions({ volumeBoost: 2.0, voiceClarity: false })
    expect(controller.getOptions().volumeBoost).toBe(2.0)
    expect(controller.getOptions().voiceClarity).toBe(false)

    // Volume clamping check
    controller.setOptions({ volumeBoost: 5.0 })
    expect(controller.getOptions().volumeBoost).toBe(2.5) // Clamped to max 2.5

    // Clean destruction
    expect(() => controller.destroy()).not.toThrow()
  })
})

describe('3. P2P Co-Watching Room & Collaborative Sync Protocol', () => {
  it('initializes session, updates playback, and tracks state updates', () => {
    let capturedState: any = null
    const session = joinCoWatchRoom({
      roomId: 'test-room-42',
      videoId: 'video-101',
      onStateUpdate: (state) => {
        capturedState = state
      },
    })

    expect(session.roomId).toBe('test-room-42')
    expect(session.clientId).toBeDefined()
    expect(session.getPeerCount()).toBeGreaterThanOrEqual(1)

    // Broadcast playback update
    session.broadcastPlayback(128.5, true)
    const st = session.getState()
    expect(st.currentSec).toBe(128.5)
    expect(st.isPlaying).toBe(true)
    expect(st.version).toBeGreaterThan(0)

    // Append shared note
    session.appendSharedNote('This is a collaborative note at 128s', 128.5)
    expect(session.getState().notes).toHaveLength(1)
    expect(session.getState().notes[0].text).toContain('collaborative note')

    expect(() => session.leave()).not.toThrow()
  })
})

describe('4. In-Video Knowledge Checkpoint Gate & Quiz Engine', () => {
  const mockChapters: VideoChapter[] = [
    { id: 'ch1', title: 'Kubernetes Ingress 架构解析', startTime: 0, summary: '讲解控制器选型与路由规则' },
    { id: 'ch2', title: 'Helm Chart 模版编写实战', startTime: 300, summary: '编写 values.yaml 和模板变量替换' },
  ]

  it('generates technical quiz questions based on chapter topics', () => {
    const questions = generateVideoQuizzes('vid-1', mockChapters, 'K8s 生产实践')
    expect(questions.length).toBeGreaterThanOrEqual(2)
    expect(questions[0].options).toHaveLength(4)
    expect(questions[0].correctIndex).toBeGreaterThanOrEqual(0)
    expect(questions[0].explanation).toBeDefined()
  })

  it('correctly scores user submissions and generates detailed diagnostic feedback', () => {
    const questions = generateVideoQuizzes('vid-1', mockChapters, 'K8s 生产实践')
    const userAnswers: Record<string, number> = {}

    // Answer first correctly, second incorrectly
    // 下标访问在 noUncheckedIndexedAccess 下是 `T | undefined`：先取局部常量再判空，
    // 否则 tsc 红（TS2322 / TS2532），而 vitest 不查类型、会一直「看起来是绿的」。
    const firstQuestion = questions[0]
    const secondQuestion = questions[1]
    if (!firstQuestion) throw new Error('mockChapters 至少要生成 1 道题')
    // correctIndex 是可选字段（AI 生成的题只带 correctAnswerIndex），统一走 quizCorrectIndex
    userAnswers[firstQuestion.id] = quizCorrectIndex(firstQuestion)
    if (secondQuestion) {
      userAnswers[secondQuestion.id] = (quizCorrectIndex(secondQuestion) + 1) % 4
    }

    const result = gradeQuizAnswers(questions, userAnswers)
    expect(result.totalQuestions).toBe(questions.length)
    expect(result.correctCount).toBe(1)
    expect(result.scorePercent).toBe(50)
    expect(result.feedback).toBeDefined()
    expect(result.detailedResults).toHaveLength(questions.length)
    expect(result.detailedResults[0]?.isCorrect).toBe(true)
  })

  it('finds trigger checkpoints near the current playhead', () => {
    const questions = generateVideoQuizzes('vid-1', mockChapters, 'K8s 生产实践')
    // Question for chapter 1 has timeSec = ch.startTime + 60 = 60, or near it
    const firstQuestion = questions[0]
    if (!firstQuestion) throw new Error('mockChapters 至少要生成 1 道题')
    const trigger = findQuizTriggerAtPlayhead(questions, firstQuestion.timeSec ?? 0, new Set())
    expect(trigger).toBeDefined()
    expect(trigger?.id).toBe(firstQuestion.id)
  })
})

describe('5. AI Video MindMap & Knowledge Graph Tree Builder', () => {
  const mockChapters: VideoChapter[] = [
    { id: 'ch1', title: '架构概览与集群拓扑', startTime: 0 },
    { id: 'ch2', title: 'YAML 实战演练', startTime: 120, codeSnippet: 'apiVersion: v1' },
    { id: 'ch3', title: '生产高可用运维与避坑', startTime: 400 },
  ]

  it('constructs a multi-branch tree taxonomy from chapters', () => {
    const tree = generateVideoMindMap({
      videoId: 'v-99',
      title: 'Docker 到 K8s 演进',
      chapters: mockChapters,
      tags: ['devops', 'kubernetes'],
    })

    expect(tree.title).toBe('Docker 到 K8s 演进')
    expect(tree.children.length).toBeGreaterThanOrEqual(3) // arch, code, prod branches

    const flattened = flattenMindMap(tree)
    expect(flattened.length).toBeGreaterThan(tree.children.length)
  })

  it('exports valid Markmap-compatible Markdown with indentation and timestamps', () => {
    const tree = generateVideoMindMap({
      videoId: 'v-99',
      title: 'Docker 到 K8s 演进',
      chapters: mockChapters,
    })

    const md = exportMindMapAsMarkdown(tree)
    expect(md).toContain('# Docker 到 K8s 演进')
    expect(md).toContain('- 架构与核心原理')
    expect(md).toContain('- 实战演练与代码清单')
  })
})

describe('6. Google Video SEO, Sitemap & RSS Enclosure Feeds', () => {
  const mockVideo: NavigationSubItem = {
    id: 'vid-seo-1',
    title: 'Prometheus 生产监控报警实战',
    description: 'Prometheus 与 Grafana 全链路实战指南',
    href: '/videos?id=vid-seo-1',
    enabled: true,
    videoConfig: {
      type: 'bilibili',
      bvid: 'BV1SeoTest123',
      author: '云原生架构师',
      durationSec: 1540,
      publishedAt: '2026-03-15T08:00:00.000Z',
    },
  }

  it('generates Schema.org VideoObject JSON-LD with ISO 8601 duration and timestamps', () => {
    const schema = generateVideoObjectSchema(mockVideo, 'https://example.com')
    expect(schema).toBeDefined()
    expect(schema['@context']).toBe('https://schema.org')
    expect(schema['@type']).toBe('VideoObject')
    expect(schema.name).toBe('Prometheus 生产监控报警实战')
    expect(schema.duration).toBe('PT25M40S')
    expect(schema.author?.name).toBe('云原生架构师')
    expect(schema.embedUrl).toContain('bilibili.com')
  })

  it('generates valid Google Video XML Sitemap', () => {
    const sitemap = generateVideoSitemapXml([mockVideo], 'https://example.com')
    expect(sitemap).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(sitemap).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')
    expect(sitemap).toContain('xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"')
    expect(sitemap).toContain('<video:title>Prometheus 生产监控报警实战</video:title>')
    expect(sitemap).toContain('<video:duration>1540</video:duration>')
  })

  it('generates valid RSS 2.0 / MRSS feed with enclosures', () => {
    const feed = generateVideoRssFeed([mockVideo], 'https://example.com')
    expect(feed).toContain('<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"')
    expect(feed).toContain('<channel>')
    expect(feed).toContain('<title>Prometheus 生产监控报警实战</title>')
    expect(feed).toContain('</channel>')
    expect(feed).toContain('</rss>')
  })
})
