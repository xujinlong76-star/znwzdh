import { describe, it, expect } from 'vitest'
import {
  renderThumbnailDataUrl,
  generateFilmstripSequence,
  findClosestThumbnail,
  isWebCodecsSupported,
} from '@/lib/video-filmstrip-generator'
import {
  calculateFrequencyBands,
  getFrequencyColor,
  SpectrogramWaterfallBuffer,
} from '@/lib/video-spectrum-visualizer'
import {
  buildWorkspaceFromCourse,
  exportToGistPayload,
} from '@/lib/video-workspace-bundler'
import {
  translateTechnicalText,
  buildBilingualTranscripts,
  formatToWebVTT,
  formatToSRT,
} from '@/lib/video-multilingual-translator'
import {
  isDocumentPipSupported,
  createDocumentPipController,
} from '@/lib/video-document-pip'
import {
  SessionActivityRecorder,
} from '@/lib/video-session-recorder'

describe('Proposal [1]: WebCodecs Accelerated Filmstrip & Hover Scrubber Preview', () => {
  it('renders SVG data URLs for timeline preview thumbnails', () => {
    const dataUrl = renderThumbnailDataUrl(75, 160, 90, 'K8s 架构部署')
    expect(dataUrl).toContain('data:image/svg+xml')
    expect(dataUrl).toContain('01%3A15') // 01:15 encoded
  })

  it('generates a full filmstrip sequence and finds closest thumbnail via binary search', () => {
    const chapters = [
      { startTime: 0, title: '导读' },
      { startTime: 60, title: '实操' },
      { startTime: 120, title: '总结' },
    ]
    const sequence = generateFilmstripSequence(180, chapters, { intervalSec: 15 })
    expect(sequence.length).toBeGreaterThan(10)

    const match42 = findClosestThumbnail(sequence, 42)
    expect(match42).toBeDefined()
    expect(match42?.timeSec).toBe(45)

    const match120 = findClosestThumbnail(sequence, 120)
    expect(match120?.timeSec).toBe(120)
    expect(match120?.chapterTitle).toBe('总结')
  })

  it('checks WebCodecs support safely', () => {
    expect(typeof isWebCodecsSupported()).toBe('boolean')
  })
})

describe('Proposal [2]: Audio Spectrogram & Voice Formant Visualizer', () => {
  it('calculates energy across perceptual bands and dominant frequency', () => {
    const sampleRate = 44100
    const binCount = 512
    const data = new Uint8Array(binCount).fill(10)

    // Emphasize 1kHz bin (Voice range)
    const bin1kHz = Math.round(1000 / (sampleRate / 2 / binCount))
    data[bin1kHz] = 220

    const bands = calculateFrequencyBands(data, sampleRate)
    expect(bands.midrange).toBeGreaterThan(bands.subBass)
    expect(bands.dominantFrequencyHz).toBeGreaterThan(900)
    expect(bands.dominantFrequencyHz).toBeLessThan(1100)
  })

  it('maps amplitudes to color values and manages rolling waterfall buffer', () => {
    expect(getFrequencyColor(20)).toBe('#09090b')
    expect(getFrequencyColor(240)).toBe('#f43f5e')

    const buffer = new SpectrogramWaterfallBuffer(5)
    for (let i = 0; i < 10; i++) {
      buffer.pushFrame(new Uint8Array([i * 10]))
    }
    expect(buffer.getFrames()).toHaveLength(5)
    expect(buffer.getFrames()[0][0]).toBe(90)
  })
})

describe('Proposal [3]: Course Project Workspace Bundler & Git Gist Exporter', () => {
  it('bundles multi-file workspace with README, package.json, Dockerfile and source code', () => {
    const workspace = buildWorkspaceFromCourse({
      courseTitle: 'Fullstack Microservices Lab',
      videoId: 'v-lab-01',
      milestoneCodeSnippets: [
        { title: 'Server Entrypoint', code: 'const express = require("express")', language: 'javascript' },
        { title: 'K8s Ingress', code: 'apiVersion: networking.k8s.io/v1', language: 'yaml' },
      ],
      notesList: [
        { userNote: 'Remember to tune connection pool size.' },
      ],
    })

    expect(workspace.files['README.md']).toBeDefined()
    expect(workspace.files['package.json']).toBeDefined()
    expect(workspace.files['Dockerfile']).toBeDefined()
    expect(workspace.files['src/milestone_1.js']).toBeDefined()
    expect(workspace.files['src/milestone_2.yaml']).toBeDefined()
    expect(workspace.totalBytes).toBeGreaterThan(100)
  })

  it('converts bundled workspace to valid GitHub Gist API payload format', () => {
    const workspace = buildWorkspaceFromCourse({
      courseTitle: 'DevOps Lab',
      videoId: 'v-01',
    })
    const payload = exportToGistPayload(workspace)
    expect(payload.public).toBe(false)
    expect(Object.keys(payload.files).length).toBeGreaterThan(0)
    for (const key of Object.keys(payload.files)) {
      expect(key).not.toContain('/')
    }
  })
})

describe('Proposal [4]: Multilingual Subtitle Translator & WebVTT/SRT Serializer', () => {
  it('translates technical domain terminology deterministically', () => {
    const translated = translateTechnicalText('这里配置 Kubernetes 和 Idempotency 机制', 'en')
    expect(translated).toContain('Kubernetes')
    expect(translated).toContain('Idempotency')
  })

  it('constructs synchronized bilingual subtitle lines', () => {
    const items = [
      { id: 't1', startSec: 0, endSec: 10, text: '微服务架构导读' },
      { id: 't2', startSec: 10, endSec: 25, text: '高并发设计实践' },
    ]
    const bilingual = buildBilingualTranscripts(items, 'en')
    expect(bilingual).toHaveLength(2)
    expect(bilingual[0].originalText).toBe('微服务架构导读')
    expect(bilingual[0].translatedText).toBeDefined()
  })

  it('formats transcript items into standard WebVTT and SRT formats', () => {
    const items = [
      { id: 't1', startSec: 5, endSec: 12.5, text: '容器编排基础' },
    ]
    const vtt = formatToWebVTT(items)
    expect(vtt).toContain('WEBVTT')
    expect(vtt).toContain('00:00:05.000 --> 00:00:12.500')
    expect(vtt).toContain('容器编排基础')

    const srt = formatToSRT(items)
    expect(srt).toContain('00:00:05,000 --> 00:00:12,500')
  })
})

describe('Proposal [5]: Chrome Document Picture-in-Picture Controller', () => {
  it('detects Document PiP API support safely', () => {
    expect(typeof isDocumentPipSupported()).toBe('boolean')
  })

  it('creates Document PiP controller with open, close, and state tracking', () => {
    const controller = createDocumentPipController({ width: 400, height: 200 })
    expect(controller.isOpen()).toBe(false)
    expect(controller.getWindow()).toBeNull()
    controller.close()
  })
})

describe('Proposal [6]: Learning Session Time-Travel DVR & Cognitive Telemetry', () => {
  it('records chronological user micro-actions and evaluates cognitive friction', () => {
    const recorder = new SessionActivityRecorder('test-video-dvr')
    recorder.recordEvent('play', 0)
    recorder.recordEvent('seek', 60)
    recorder.recordEvent('seek', 20) // Rewound 40s (High cognitive challenge)
    recorder.recordEvent('take_note', 20)
    recorder.recordEvent('sandbox_run', 20)
    recorder.recordEvent('pause', 30)

    expect(recorder.getEvents()).toHaveLength(6)

    const report = recorder.generateEngagementReport()
    expect(report.totalEvents).toBe(6)
    expect(report.frictionScore).toBeGreaterThan(10)
    expect(report.handsOnScore).toBeGreaterThan(20)
    expect(report.rewindHotspotsSec).toContain(20)
  })
})
