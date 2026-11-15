import { describe, it, expect, vi } from 'vitest'
import {
  verifyWebhookSignature,
  MultiSourceConnector,
} from '../src/lib/video-multi-source-connector'
import { signHmacSha256 } from '../src/lib/webhook-signature'
import {
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
import type { OpaqueSession } from '../src/lib/video-opaque-sandbox'
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

    it('processes webhook through MultiSourceConnector and evaluates quality', () => {
      const connector = new MultiSourceConnector('my_secret')
      // 零数据载荷现在被入库严标准守卫拒收（2026-11-13）：AI 审核过了也不够，
      // webhook 不是人工/置顶/精选，没有真实互动数据就不许入库、不给默认值。
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
      const noStats = connector.processWebhook(payload, signHmacSha256(rawBody, 'my_secret'), rawBody)
      expect(noStats.ok).toBe(false)
      expect(noStats.message).toContain('守卫拒收')
      expect(noStats.message).toContain('无真实互动数据')
      expect(noStats.subItem).toBeUndefined()

      // 带真实互动数据（6 万播放）才放行，且 stats 随条目入库
      const withStats = {
        ...payload,
        data: { ...payload.data, stats: { views: 60000, likes: 1200, danmaku: 300 } },
      }
      const withStatsRaw = JSON.stringify(withStats)
      const res = connector.processWebhook(withStats, signHmacSha256(withStatsRaw, 'my_secret'), withStatsRaw)
      expect(res.ok).toBe(true)
      expect(res.subItem).toBeDefined()
      expect(res.subItem?.videoConfig?.stats).toEqual({ views: 60000, likes: 1200, danmaku: 300 })
      expect(res.subItem?.videoConfig?.qualityScore).toBeGreaterThanOrEqual(70)
      // 合成章节默认关闭：模板内容不得冒充视频原文
      expect(res.subItem?.videoConfig?.chapters).toBeUndefined()
      expect(res.subItem?.videoConfig?.synthetic).toBeUndefined()
    })
  })

    describe('Proposal [3]: Subtitle Cues & Synthetic Voiceover TTS', () => {
    it('does not fake-translate: cues carry only the original text', () => {
      const transcripts = [
        { id: 't1', startSec: 0, endSec: 15, text: '架构设计是分布式系统的核心。' },
        { id: 't2', startSec: 15, endSec: 35, text: '我们需要通过零拷贝减少内存开销。' },
      ]

      const cues = generateBilingualCues(transcripts)
      expect(cues).toHaveLength(2)
      // 词典假翻译已删：双轨都只放原文，不冒充译文。
      expect(cues[0].secondaryText).toBe('架构设计是分布式系统的核心。')
      expect(cues[1].secondaryText).toBe('我们需要通过零拷贝减少内存开销。')
      expect(cues[0].secondaryText).toBe(cues[0].primaryText)

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
      // 无 speechSynthesis 时不得谎报成功、不得置 isSpeaking（旧断言 success:true
      // 是假成功：speakCue 无条件返回 true，从未真正出声）。
      const res = tts.speakCue(cue, false)
      expect(res.success).toBe(false)
      expect(tts.getSpeakingStatus().isSpeaking).toBe(false)

      // 有 speechSynthesis 时才真正出声：桩一个最小实现走正向路径。
      const speakMock = vi.fn()
      const cancelMock = vi.fn()
      class FakeUtterance {
        text: string
        rate = 1
        pitch = 1
        volume = 1
        onend: (() => void) | null = null
        constructor(text: string) {
          this.text = text
        }
      }
      const prevWindow = (globalThis as any).window
      const prevUtterance = (globalThis as any).SpeechSynthesisUtterance
      ;(globalThis as any).window = { speechSynthesis: { speak: speakMock, cancel: cancelMock } }
      ;(globalThis as any).SpeechSynthesisUtterance = FakeUtterance
      try {
        const res2 = tts.speakCue(cue, false)
        expect(res2.success).toBe(true)
        expect(tts.getSpeakingStatus().isSpeaking).toBe(true)
        expect(cancelMock).toHaveBeenCalled()
        expect(speakMock).toHaveBeenCalledTimes(1)

        tts.stop()
        expect(tts.getSpeakingStatus().isSpeaking).toBe(false)
      } finally {
        if (prevWindow === undefined) delete (globalThis as any).window
        else (globalThis as any).window = prevWindow
        if (prevUtterance === undefined) delete (globalThis as any).SpeechSynthesisUtterance
        else (globalThis as any).SpeechSynthesisUtterance = prevUtterance
      }
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
              enabled: true,
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
              enabled: true,
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
        '/index.ts': `import { multiply } from './math.ts'\nconst res = multiply(6, 7)\nconsole.log("Answer is:", res)\nexports.answer = res`,
        '/math.ts': `export function multiply(a, b) { return a * b; }`,
      })

      // 执行搬进不透明源沙盒（lib/video-opaque-sandbox.ts）；node 里没有 DOM，
      // 真沙盒只会回 unavailable，所以这里注入一个 stub 会话来验跑通之后的接线。
      // 结果走 exports（脚本里顶层 return 是语法错），stub 就照这个契约回一份导出快照。
      let bundled = ''
      const stub: OpaqueSession = {
        logs: [{ level: 'log', text: 'Answer is: 42', timestamp: 1 }],
        load: async (code) => {
          bundled = code
          return { ok: true, logs: [], hasValue: true, value: { answer: 42 }, durationMs: 1 }
        },
        invoke: async () => ({ ok: false, logs: [], hasValue: false, durationMs: 0 }),
        close: () => {},
      }

      const runtime = new SandboxRuntime(vfs, { openSession: async () => stub })
      const execution = await runtime.execute('/index.ts')

      expect(execution.success).toBe(true)
      expect(execution.returnValue).toEqual({ answer: 42 })
      expect(execution.logs).toHaveLength(1)
      expect(execution.logs[0].text).toContain('Answer is: 42')
      expect(bundled, '依赖没被内联进交给沙盒的代码').toContain('function multiply')
    })

    it('沙盒不可用时判「未执行」，不会退回页面内求值', async () => {
      const vfs = new VirtualFileSystem({
        '/index.ts': `console.log("被执行了")\nexports.one = 1`,
      })
      const execution = await new SandboxRuntime(vfs).execute('/index.ts')
      expect(execution.success).toBe(false)
      expect(execution.stopReason).toBe('unavailable')
      expect(execution.logs, '真的跑了就说明留了同源回退口').toEqual([])
    })
  })

})
