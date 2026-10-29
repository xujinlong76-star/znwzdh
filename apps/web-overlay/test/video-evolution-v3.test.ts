import { describe, it, expect } from 'vitest'
import {
  getSpriteCoordinate,
  generateEngagementHeatmap,
  buildHeatmapSvgPath,
  type SpriteConfig,
} from '@/lib/video-scrubber-filmstrip'
import {
  lookupTechnicalTerm,
  tokenizeSubtitles,
  buildAlignedBilingualCues,
  findActiveBilingualCue,
  findActiveKaraokeToken,
} from '@/lib/video-bilingual-transcriber'
import {
  parseAnsiString,
  parseAsciinemaCast,
  generateSyntheticTerminalCast,
  getTerminalStateAtTime,
} from '@/lib/video-terminal-recorder'
import {
  isStorageAvailable,
  calculatePrefetchQueue,
} from '@/lib/video-cache-manager'
import {
  createQoETracker,
} from '@/lib/video-qoe-telemetry'
import { GET as getOgVideo } from '@/app/api/og/video/route'
import { NextRequest } from 'next/server'
import type { VideoChapter, NavigationSubItem } from '@/types/navigation'

describe('1. Scrubber Filmstrip & Engagement Heatmap Engine', () => {
  it('calculates correct sprite background coordinates and clamps out-of-range timestamps', () => {
    const config: SpriteConfig = {
      spriteUrl: 'https://example.com/sprite.jpg',
      cellWidth: 160,
      cellHeight: 90,
      cols: 5,
      rows: 5,
      intervalSec: 10,
      totalFrames: 25,
    }

    // Time 0 -> frame 0, col 0, row 0
    const coord0 = getSpriteCoordinate(0, config)
    expect(coord0.offsetX).toBe(0)
    expect(coord0.offsetY).toBe(0)
    expect(coord0.frameIndex).toBe(0)

    // Time 65 -> frame 6, col 1, row 1
    const coord65 = getSpriteCoordinate(65, config)
    expect(coord65.frameIndex).toBe(6)
    expect(coord65.offsetX).toBe(1 * 160)
    expect(coord65.offsetY).toBe(1 * 90)

    // Huge time -> clamps to max frame (24)
    const coordHuge = getSpriteCoordinate(9999, config)
    expect(coordHuge.frameIndex).toBe(24)
    expect(coordHuge.offsetX).toBe(4 * 160)
    expect(coordHuge.offsetY).toBe(4 * 90)
  })

  it('generates density waveform with peak detection on code chapters and danmaku', () => {
    const chapters: VideoChapter[] = [
      { id: 'ch1', title: '环境就绪', startTime: 0 },
      { id: 'ch2', title: '核心算法实操', startTime: 200, codeSnippet: 'const x = 100;' },
    ]

    const points = generateEngagementHeatmap({
      durationSec: 500,
      chapters,
      samplesCount: 50,
    })

    expect(points).toHaveLength(50)
    expect(points[0].density).toBeGreaterThan(0)
    expect(points[0].density).toBeLessThanOrEqual(1.0)

    const peak = points.find(p => p.isPeak)
    expect(peak).toBeDefined()
    expect(peak?.label).toContain('核心算法实操')

    const { areaPath, linePath } = buildHeatmapSvgPath(points, 500, 40)
    expect(areaPath).toContain('M ')
    expect(areaPath).toContain(' Z')
    expect(linePath).toContain(' Q ')
  })
})

describe('2. Realtime Bilingual Subtitles & Technical Glossary Alignment', () => {
  it('correctly looks up technical vocabulary and tokenizes subtitles', () => {
    const k8sDef = lookupTechnicalTerm('Kubernetes')
    expect(k8sDef).toBeDefined()
    expect(k8sDef?.chineseName).toContain('K8s')

    const ingressDef = lookupTechnicalTerm('ingress!')
    expect(ingressDef).toBeDefined()
    expect(ingressDef?.category).toBe('network')

    const unknownDef = lookupTechnicalTerm('nonexistentterm123')
    expect(unknownDef).toBeNull()

    const tokens = tokenizeSubtitles('Deploying Ingress on Kubernetes cluster', 10, 20)
    expect(tokens).toHaveLength(5)
    expect(tokens[1].word).toBe('Ingress')
    expect(tokens[1].isTerm).toBe(true)
    expect(tokens[0].isTerm).toBe(false)
  })

  it('builds aligned cues and matches active karaoke word at playhead', () => {
    const cues = buildAlignedBilingualCues([
      { id: 'c1', startSec: 0, endSec: 10, text: 'Hello Cloud Native World', translation: '你好云原生世界' },
      { id: 'c2', startSec: 10, endSec: 20, text: 'Kubernetes Ingress Controllers', translation: 'Kubernetes 入口控制器' },
    ])

    expect(cues).toHaveLength(2)
    expect(cues[0].targetText).toBe('你好云原生世界')

    const activeCue = findActiveBilingualCue(cues, 14.5)
    expect(activeCue?.id).toBe('c2')

    const activeToken = findActiveKaraokeToken(activeCue!, 14.5)
    expect(activeToken).toBeDefined()
    expect(activeToken?.token.word).toBeDefined()
  })
})

describe('3. Asciinema CLI Session Replay & ANSI Tokenizer', () => {
  it('parses ANSI escape sequences into styled tokens', () => {
    const rawAnsi = '\x1b[32mSUCCESS:\x1b[0m \x1b[1;34mCluster Ready\x1b[0m'
    const tokens = parseAnsiString(rawAnsi)

    expect(tokens.length).toBeGreaterThanOrEqual(2)
    expect(tokens[0].text).toBe('SUCCESS:')
    expect(tokens[0].color).toBe('#4ade80') // green-400
    expect(tokens[2].isBold).toBe(true)
    expect(tokens[2].color).toBe('#60a5fa') // blue-400
  })

  it('parses asciinema v2 format and resolves terminal state at time', () => {
    const castRaw = '{"version": 2, "width": 80, "height": 24, "title": "K8s Demo"}\n' +
      '[0.5, "o", "kubectl get pods\\r\\n"]\n' +
      '[1.5, "o", "pod-1 1/1 Running\\r\\n"]\n' +
      '[3.0, "o", "pod-2 1/1 Running\\r\\n"]'

    const cast = parseAsciinemaCast(castRaw)
    expect(cast.header.title).toBe('K8s Demo')
    expect(cast.events).toHaveLength(3)

    // At 1.0s, only first event has occurred
    const stateAt1s = getTerminalStateAtTime(cast, 1.0)
    expect(stateAt1s.rawOutput).toContain('kubectl get pods')
    expect(stateAt1s.rawOutput).not.toContain('pod-1')

    // At 2.0s, pod-1 is included
    const stateAt2s = getTerminalStateAtTime(cast, 2.0)
    expect(stateAt2s.rawOutput).toContain('pod-1 1/1 Running')
    expect(stateAt2s.rawOutput).not.toContain('pod-2')
  })

  it('generates synthetic terminal casts for shell commands', () => {
    const synthetic = generateSyntheticTerminalCast({
      title: 'Helm Deploy',
      commands: ['helm install my-app ./chart'],
      durationSec: 30,
    })

    expect(synthetic.header.title).toBe('Helm Deploy')
    expect(synthetic.events.length).toBeGreaterThan(5)
    expect(synthetic.events.some(e => e.data.includes('devops@cluster'))).toBe(true)
  })
})

describe('4. Offline-First Video Cache & Speculative Prefetch Scheduler', () => {
  it('checks storage availability safely', () => {
    const available = isStorageAvailable()
    expect(typeof available).toBe('boolean')
  })

  it('computes prefetch queue with high priority when playback is near completion', () => {
    const mockVideos: NavigationSubItem[] = [
      { id: 'v1', title: 'Part 1', href: '/v1', enabled: true },
      { id: 'v2', title: 'Part 2', href: '/v2', enabled: true },
      { id: 'v3', title: 'Part 3', href: '/v3', enabled: true },
    ]

    // At 30% progress, next video is normal priority
    const queueAt30 = calculatePrefetchQueue({
      currentVideoId: 'v1',
      allVideos: mockVideos,
      watchProgressPercent: 30,
    })
    expect(queueAt30).toHaveLength(2)
    expect(queueAt30[0].videoId).toBe('v2')
    expect(queueAt30[0].priority).toBe('normal')

    // At 85% progress, next video escalates to high priority
    const queueAt85 = calculatePrefetchQueue({
      currentVideoId: 'v1',
      allVideos: mockVideos,
      watchProgressPercent: 85,
    })
    expect(queueAt85[0].priority).toBe('high')
  })
})

describe('5. Video QoE Telemetry & Network Sentinel', () => {
  it('tracks quality metrics and calculates health score', () => {
    const tracker = createQoETracker('v-test', 'mirror-primary')
    tracker.recordTTFB(120)
    tracker.recordPlaybackTick(5000)

    const initialMetrics = tracker.getMetrics()
    expect(initialMetrics.healthScore).toBeGreaterThanOrEqual(80)
    expect(initialMetrics.status).toBe('excellent')
    expect(tracker.shouldTriggerAutoFailover()).toBe(false)

    // Simulate severe network stalls
    tracker.recordStallStart()
    tracker.recordStallEnd()
    tracker.recordStallStart()
    tracker.recordStallEnd()
    tracker.recordStallStart()
    tracker.recordStallEnd()
    tracker.recordStallStart()
    tracker.recordStallEnd()

    const degradedMetrics = tracker.getMetrics()
    expect(degradedMetrics.rebufferCount).toBe(4)
    expect(degradedMetrics.status).toBe('critical')
    expect(tracker.shouldTriggerAutoFailover()).toBe(true)
  })
})

describe('6. Dynamic OpenGraph Video Card Route', () => {
  it('renders SVG social preview card with custom parameters and caching headers', async () => {
    const req = new NextRequest('https://example.com/api/og/video?title=Kubernetes+Architecture&author=DevOpsGuru&time=12:34&tag=K8s')
    const response = await getOgVideo(req)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/svg+xml')
    expect(response.headers.get('cache-control')).toContain('public')

    const svgText = await response.text()
    expect(svgText).toContain('<svg')
    expect(svgText).toContain('Kubernetes Architecture')
    expect(svgText).toContain('DevOpsGuru')
    expect(svgText).toContain('12:34')
  })
})
