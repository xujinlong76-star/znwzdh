import { describe, it, expect } from 'vitest'
import {
  computeUnifiedDiff,
  extractCodeMilestones,
  findMilestoneAtTime,
} from '@/lib/video-code-diff'
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
    expect((schema.author as { name?: string } | undefined)?.name).toBe('云原生架构师')
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
