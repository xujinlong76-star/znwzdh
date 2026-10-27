import { describe, it, expect } from 'vitest'
import {
  verifyWebhookSignature,
  parseBilibiliApiResponse,
  parseYouTubeRssFeed,
  parseGitHubTrendingFeed,
  MultiSourceConnector,
} from '../src/lib/video-multi-source-connector'
import { signHmacSha256 } from '../src/lib/webhook-signature'
import {
  computeFrameMse,
  detectEditorEnvironment,
  extractCodeTextFromImageData,
  CodeExtractorController,
} from '../src/lib/video-wasm-ocr-extractor'
import {
  translateTechnicalText,
  generateBilingualCues,
  getActiveBilingualCue,
  SyntheticTTSController,
} from '../src/lib/video-bilingual-trans-tts'
import {
  buildConceptGraphFromVideos,
  findShortestLearningPath,
} from '../src/lib/video-concept-graph-navigator'
import {
  VirtualFileSystem,
  SandboxRuntime,
} from '../src/lib/video-code-sandbox-runtime'
import {
  StudyRoomCRDTState,
} from '../src/lib/video-study-room-crdt'
import type { NavigationData } from '../src/types/navigation'

describe('Video Autonomous Evolution V10 Full Suite (Proposals 1-6)', () => {
  describe('Proposal [1]: Multi-Source Connector & Webhook Ingestion', () => {
    it('verifies HMAC-SHA256 signatures and rejects tampered payloads', () => {
      const payload = JSON.stringify({ event: 'video_published', id: 'BV1test' })
      const secret = 'test_secret_key'
      const validSig = signHmacSha256(payload, secret)

      expect(verifyWebhookSignature(payload, validSig, secret)).toBe(true)
      expect(verifyWebhookSignature(payload, 'sha256=invalid_hash', secret)).toBe(false)
      expect(verifyWebhookSignature(payload, '', secret)).toBe(false)

      // 回归：老实现用 32 位滚动哈希 + includes() 子串匹配，
      // 下面三种在旧实现下都会「通过」，必须全部拒绝。
      expect(verifyWebhookSignature(payload, secret, secret)).toBe(false)            // 密钥当签名
      expect(verifyWebhookSignature(payload, `sha256=xx${validSig.slice(9)}xx`, secret)).toBe(false) // 子串命中
      expect(verifyWebhookSignature(payload, validSig.slice(0, 12), secret)).toBe(false)             // 截断
      // 篡改 body 后同一签名必须失效
      expect(verifyWebhookSignature(payload + ' ', validSig, secret)).toBe(false)
    })

    it('parses Bilibili API view responses into normalized candidates', () => {
      const mockBili = {
        data: {
          result: [
            {
              bvid: 'BV1abc123',
              title: '<em class="keyword">DeepSeek</em> 企业私有微调实战',
              description: '详细讲解 LLM 与分布式微调。',
              author: '架构导师',
              duration: '32:15',
              stat: { view: 150000, like: 12000, coin: 8000, favorite: 20000 },
            },
          ],
        },
      }

      const candidates = parseBilibiliApiResponse(mockBili)
      expect(candidates).toHaveLength(1)
      expect(candidates[0].externalId).toBe('BV1abc123')
      expect(candidates[0].title).toBe('DeepSeek 企业私有微调实战')
      expect(candidates[0].durationSec).toBe(32 * 60 + 15)
      expect(candidates[0].stats?.coins).toBe(8000)
    })

    it('parses YouTube RSS feeds with XML entry tags', () => {
      const mockXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
  <entry>
    <yt:videoId>yt_video_001</yt:videoId>
    <title>React 19 Server Actions Architecture</title>
    <name>Kent Master</name>
    <media:description>In-depth React 19 deep dive.</media:description>
  </entry>
</feed>`

      const candidates = parseYouTubeRssFeed(mockXml)
      expect(candidates).toHaveLength(1)
      expect(candidates[0].externalId).toBe('yt_video_001')
      expect(candidates[0].title).toBe('React 19 Server Actions Architecture')
      expect(candidates[0].author).toBe('Kent Master')
    })

    it('processes webhook through MultiSourceConnector and evaluates quality', () => {
      const connector = new MultiSourceConnector('my_secret')
      const payload = {
        event: 'video_published' as const,
        timestamp: Date.now(),
        source: 'bilibili' as const,
        data: {
          id: 'BV1DeepSeekArch',
          title: 'DeepSeek-R1 分布式集群部署微调与 Agent 企业级实战',
          description: '系统深入讲解 LLM、Agent 原理、RAG 向量检索以及分布式架构调优。',
          author: '架构先锋',
          durationSec: 2400,
          url: 'https://www.bilibili.com/video/BV1DeepSeekArch',
          domain: 'cat_ai_engineering',
        },
      }

      // 签名现在是必填项（老实现 `if (signature && !verify(...))` 允许不带签名直接过）
      const rawBody = JSON.stringify(payload)
      const res = connector.processWebhook(payload, signHmacSha256(rawBody, 'my_secret'), rawBody)
      expect(res.ok).toBe(true)
      expect(res.subItem).toBeDefined()
      expect(res.subItem?.videoConfig?.qualityScore).toBeGreaterThanOrEqual(70)
      expect(res.subItem?.videoConfig?.chapters?.length).toBe(4)
    })
  })

  describe('Proposal [2]: Wasm/Canvas Video Frame Capture & Visual Code OCR', () => {
    it('computes MSE difference between two frames to detect scene transitions', () => {
      const imgA = {
        width: 10,
        height: 10,
        data: new Uint8ClampedArray(10 * 10 * 4).fill(20),
      } as ImageData

      const imgB = {
        width: 10,
        height: 10,
        data: new Uint8ClampedArray(10 * 10 * 4).fill(220),
      } as ImageData

      const diff = computeFrameMse(imgA, imgB)
      expect(diff.mse).toBeGreaterThan(120)
      expect(diff.isKeyframeTransition).toBe(true)
    })

    it('detects dark vs light IDE editor environments accurately', () => {
      const darkImg = {
        width: 20,
        height: 20,
        data: new Uint8ClampedArray(20 * 20 * 4).fill(25),
      } as ImageData

      const env = detectEditorEnvironment(darkImg)
      expect(env.isCodeEditor).toBe(true)
      expect(env.theme).toBe('dark')
    })

    it('extracts structured monospace code lines, indentation, and detected language', () => {
      const mockImg = {
        width: 100,
        height: 100,
        data: new Uint8ClampedArray(100 * 100 * 4).fill(30),
      } as ImageData

      const codeSample = `import { useState } from 'react'\n\nexport function Counter() {\n  const [count, setCount] = useState(0)\n  return count\n}`
      const result = extractCodeTextFromImageData(mockImg, codeSample)

      expect(result.detectedLanguage).toBe('typescript')
      expect(result.lines).toHaveLength(6)
      expect(result.lines[3].indentationSpaces).toBe(2)
      expect(result.confidenceScore).toBeGreaterThan(80)
    })
  })

  describe('Proposal [3]: AI Bilingual Subtitles & Synthetic Voiceover TTS', () => {
    it('translates hardcore computer science terminology into English, Japanese, and German', () => {
      const zhText = '欢迎来到思维链与分布式推理实战指南'
      const en = translateTechnicalText(zhText, 'en')
      const ja = translateTechnicalText(zhText, 'ja')
      const de = translateTechnicalText(zhText, 'de')

      expect(en).toContain('Chain-of-Thought (CoT)')
      expect(en).toContain('Distributed Inference')
      expect(ja).toContain('思考の連鎖')
      expect(de).toContain('Verteilte Inferenz')
    })

    it('generates synchronized bilingual cues and tracks active cue by playhead time', () => {
      const transcripts = [
        { id: 't1', startSec: 0, endSec: 15, text: '架构设计是分布式系统的核心。' },
        { id: 't2', startSec: 15, endSec: 35, text: '我们需要通过零拷贝减少内存开销。' },
      ]

      const cues = generateBilingualCues(transcripts, 'en')
      expect(cues).toHaveLength(2)
      expect(cues[0].secondaryText).toContain('Architecture')
      expect(cues[1].secondaryText).toContain('Zero-Copy')

      const activeCue = getActiveBilingualCue(cues, 20)
      expect(activeCue?.id).toBe('t2')
    })

    it('controls synthetic TTS configuration and triggers speech cue execution', () => {
      const tts = new SyntheticTTSController()
      tts.updateConfig({ rate: 1.2, pitch: 1.1 })
      expect(tts.getConfig().rate).toBe(1.2)

      const cue = {
        id: 'c1',
        startSec: 0,
        endSec: 10,
        primaryText: '欢迎学习高并发架构',
        secondaryText: 'Welcome to High Concurrency Architecture',
      }
      const res = tts.speakCue(cue, false)
      expect(res.success).toBe(true)
      expect(tts.getSpeakingStatus().isSpeaking).toBe(true)

      tts.stop()
      expect(tts.getSpeakingStatus().isSpeaking).toBe(false)
    })
  })

  describe('Proposal [4]: Interactive Concept Graph & Dijkstra Shortest Learning Path', () => {
    const mockData: NavigationData = {
      navigationItems: [
        {
          id: 'cat_ai',
          title: 'AI 领域',
          icon: 'Bot',
          items: [
            {
              id: 'c1',
              title: 'DeepSeek 核心架构与微调',
              href: 'https://bilibili.com/video/BV1c1',
              videoConfig: {
                type: 'bilibili',
                bvid: 'BV1c1',
                chapters: [{ id: 'ch1', title: 'DeepSeek 原理解析', startTime: 0, duration: 300 }],
              },
            },
            {
              id: 'c2',
              title: 'Docker 容器化与 Kubernetes 编排',
              href: 'https://bilibili.com/video/BV1c2',
              videoConfig: {
                type: 'bilibili',
                bvid: 'BV1c2',
                chapters: [{ id: 'ch2', title: 'Docker 镜像构建', startTime: 0, duration: 400 }],
              },
            },
          ],
          subCategories: [],
        },
      ],
    }

    it('builds topology with nodes, edges and degree centrality from video metadata', () => {
      const topology = buildConceptGraphFromVideos(mockData)
      expect(topology.nodes.length).toBeGreaterThanOrEqual(4)
      expect(topology.edges.length).toBeGreaterThanOrEqual(3)

      const deepseekNode = topology.nodes.find(n => n.id === 'concept_deepseek')
      expect(deepseekNode).toBeDefined()
      expect(deepseekNode?.jumpTarget?.bvid).toBe('BV1c1')
    })

    it('computes Dijkstra shortest path between concept nodes across the topology', () => {
      const topology = buildConceptGraphFromVideos(mockData)
      const pathRes = findShortestLearningPath(topology, 'concept_deepseek', 'concept_docker')

      expect(pathRes.found).toBe(true)
      expect(pathRes.path.length).toBeGreaterThan(1)
      expect(pathRes.path[0]).toBe('concept_deepseek')
      expect(pathRes.path[pathRes.path.length - 1]).toBe('concept_docker')
    })
  })

  describe('Proposal [5]: In-Browser Interactive Code Sandbox & Runtime', () => {
    it('manages multi-file virtual filesystem operations', () => {
      const vfs = new VirtualFileSystem()
      vfs.writeFile('/app.ts', 'export const port = 8080;')
      expect(vfs.hasFile('/app.ts')).toBe(true)
      expect(vfs.readFile('/app.ts')).toContain('8080')
      expect(vfs.listFiles()).toHaveLength(1)

      vfs.deleteFile('/app.ts')
      expect(vfs.hasFile('/app.ts')).toBe(false)
    })

    it('bundles and executes multi-file project with console output interception', async () => {
      const vfs = new VirtualFileSystem({
        '/index.ts': `import { multiply } from './math.ts'\nconst res = multiply(6, 7)\nconsole.log("Answer is:", res)\nreturn res`,
        '/math.ts': `export function multiply(a, b) { return a * b; }`,
      })

      const runtime = new SandboxRuntime(vfs)
      const execution = await runtime.execute('/index.ts')

      expect(execution.success).toBe(true)
      expect(execution.returnValue).toBe(42)
      expect(execution.logs).toHaveLength(1)
      expect(execution.logs[0].text).toContain('Answer is: 42')
    })
  })

  describe('Proposal [6]: WebRTC / CRDT Collaborative Study Room', () => {
    it('maintains synchronized playback state with sequence order', () => {
      const room = new StudyRoomCRDTState('room_math', 'peer_alice', true)
      const updated = room.updatePlayback({ currentTimeSec: 120, isPlaying: true })

      expect(updated.currentTimeSec).toBe(120)
      expect(updated.sequence).toBe(1)
      expect(updated.isPlaying).toBe(true)
      expect(room.getCompensatedPlaybackTime()).toBeGreaterThanOrEqual(120)
    })

    it('records collaborative whiteboard strokes and resolves state snapshots', () => {
      const room = new StudyRoomCRDTState('room_cs', 'peer_bob')
      const stroke = {
        id: 's_001',
        authorId: 'peer_bob',
        color: '#38bdf8',
        width: 3,
        points: [{ x: 10, y: 10 }, { x: 20, y: 20 }],
        createdAt: Date.now(),
      }

      room.addStroke(stroke)
      expect(room.getStrokes()).toHaveLength(1)
      expect(room.getStrokes()[0].id).toBe('s_001')

      // Snapshot serialization
      const json = room.serializeSnapshot()
      expect(json).toContain('peer_bob')
      expect(json).toContain('s_001')

      const room2 = new StudyRoomCRDTState('room_cs', 'peer_charlie')
      room2.mergeRemoteSnapshot(json)
      expect(room2.getStrokes()).toHaveLength(1)
      expect(room2.getStrokes()[0].authorId).toBe('peer_bob')
    })
  })
})
