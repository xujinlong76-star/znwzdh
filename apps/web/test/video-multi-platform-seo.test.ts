import { describe, expect, it, vi } from 'vitest'
import {
  VIDEO_PLATFORM_REGISTRY,
  detectVideoPlatform,
  extractOpenGraphAndJsonLdFromHtml,
  harvestMultiPlatformVideosForKeyword,
  parseIso8601DurationToSeconds,
  resolveMultiPlatformVideoUrl,
} from '../src/lib/video-multi-platform-harvester'
import {
  auditVideoSeoReadiness,
  buildVideoEmbedUrlForSeo,
  enrichVideoItemSeo,
  generateVideoBreadcrumbSchema,
  generateVideoObjectSchema,
  generateVideoSitemapXml,
} from '../src/lib/video-seo'
import type { NavigationSubItem } from '../src/types/navigation'

describe('多平台视频采集与搜索引擎收录 (SEO) 深度套件', () => {
  describe('1. 12+ 国内外视频平台 URL 识别 (detectVideoPlatform)', () => {
    it('支持识别国内主流平台 (Bilibili / 抖音 / 快手 / 西瓜 / 小红书 / 腾讯 / 优酷)', () => {
      expect(detectVideoPlatform('https://www.bilibili.com/video/BV1xx411c7mD')).toMatchObject({
        platform: 'bilibili',
        bvid: 'BV1xx411c7mD',
      })
      expect(detectVideoPlatform('https://www.douyin.com/video/7321098765432109876')).toMatchObject({
        platform: 'douyin',
        externalId: '7321098765432109876',
      })
      expect(detectVideoPlatform('https://www.kuaishou.com/short-video/3x8a9b2c3d4e5f6')).toMatchObject({
        platform: 'kuaishou',
        externalId: '3x8a9b2c3d4e5f6',
      })
      expect(detectVideoPlatform('https://www.ixigua.com/7291234567890123456')).toMatchObject({
        platform: 'xigua',
        externalId: '7291234567890123456',
      })
      expect(
        detectVideoPlatform('https://www.xiaohongshu.com/explore/65a1b2c3000000001e02f3a4')
      ).toMatchObject({
        platform: 'xiaohongshu',
        externalId: '65a1b2c3000000001e02f3a4',
      })
      expect(detectVideoPlatform('https://v.qq.com/x/page/u3245abcdef.html')).toMatchObject({
        platform: 'tencent',
        externalId: 'u3245abcdef',
      })
      expect(
        detectVideoPlatform('https://v.youku.com/v_show/id_XNTk4NzY1NDMyMA==.html')
      ).toMatchObject({
        platform: 'youku',
        externalId: 'XNTk4NzY1NDMyMA==',
      })
    })

    it('支持识别国际与开源联邦平台 (YouTube / Vimeo / TED / Dailymotion / PeerTube / Custom)', () => {
      expect(detectVideoPlatform('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toMatchObject({
        platform: 'youtube',
        externalId: 'dQw4w9WgXcQ',
      })
      expect(detectVideoPlatform('https://vimeo.com/76979871')).toMatchObject({
        platform: 'vimeo',
        externalId: '76979871',
      })
      expect(
        detectVideoPlatform('https://www.ted.com/talks/sir_ken_robinson_do_schools_kill_creativity')
      ).toMatchObject({
        platform: 'ted',
        externalId: 'sir_ken_robinson_do_schools_kill_creativity',
      })
      expect(detectVideoPlatform('https://www.dailymotion.com/video/x8abcde')).toMatchObject({
        platform: 'dailymotion',
        externalId: 'x8abcde',
      })
      expect(detectVideoPlatform('https://framatube.org/w/kkGMgK9ZtnKfYAgnEtQxbv')).toMatchObject({
        platform: 'peertube',
        externalId: 'kkGMgK9ZtnKfYAgnEtQxbv',
        instanceOrigin: 'https://framatube.org',
      })
      expect(detectVideoPlatform('https://developer.apple.com/videos/play/wwdc2024/101/')).toMatchObject({
        platform: 'custom',
      })
    })

    it('注册表包含完整的 13 个平台能力声明', () => {
      expect(Object.keys(VIDEO_PLATFORM_REGISTRY)).toHaveLength(13)
    })
  })

  describe('2. 网页结构化元数据嗅探器 (OpenGraph + JSON-LD VideoObject)', () => {
    it('能够解析 ISO 8601 时长与 JSON-LD VideoObject / OpenGraph 元数据', () => {
      expect(parseIso8601DurationToSeconds('PT1H15M30S')).toBe(4530)
      expect(parseIso8601DurationToSeconds('PT25M40S')).toBe(1540)

      const sampleHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta property="og:title" content="DeepSeek R1 大模型微调与部署全攻略" />
            <meta property="og:description" content="从零掌握 DeepSeek 本地推理、vLLM 量化与高并发网关部署实战。" />
            <meta property="og:image" content="//cdn.example.com/cover.jpg" />
            <meta name="keywords" content="DeepSeek, LLM, vLLM, 模型部署" />
            <script type="application/ld+json">
              {
                "@context": "https://schema.org",
                "@type": "VideoObject",
                "name": "DeepSeek R1 大模型微调与部署全攻略",
                "duration": "PT32M15S",
                "uploadDate": "2026-02-15T08:00:00Z",
                "author": { "@type": "Person", "name": "AI架构师老王" },
                "interactionStatistic": [
                  {
                    "@type": "InteractionCounter",
                    "interactionType": "https://schema.org/WatchAction",
                    "userInteractionCount": 128000
                  }
                ]
              }
            </script>
          </head>
        </html>
      `
      const extracted = extractOpenGraphAndJsonLdFromHtml(sampleHtml)
      expect(extracted.title).toBe('DeepSeek R1 大模型微调与部署全攻略')
      expect(extracted.description).toContain('vLLM 量化')
      expect(extracted.durationSec).toBe(1935)
      expect(extracted.author).toBe('AI架构师老王')
      expect(extracted.views).toBe(128000)
      expect(extracted.keywords).toEqual(['DeepSeek', 'LLM', 'vLLM', '模型部署'])
    })
  })

  describe('3. 多平台单链解析与主题词批量采集', () => {
    it('resolveMultiPlatformVideoUrl 支持解析 Dailymotion 并自动生成 SEO 字段', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'x8abcde',
          title: 'Kubernetes 生产集群高可用架构实战',
          description: '深入讲解 K8s 控制平面高可用、etcd 备份恢复与 Cilium eBPF 网络优化。',
          duration: 1860,
          thumbnail_720_url: 'https://s1.dmcdn.net/v/x8abcde/x720',
          'owner.screenname': 'CloudNativeLab',
          views_total: 42000,
          created_time: 1740000000,
        }),
      })

      const resolved = await resolveMultiPlatformVideoUrl(
        'https://www.dailymotion.com/video/x8abcde',
        mockFetch as unknown as typeof fetch
      )
      expect(resolved.videoConfig.type).toBe('dailymotion')
      expect(resolved.videoConfig.videoId).toBe('x8abcde')
      expect(resolved.videoConfig.seoSlug).toContain('dailymotion-x8abcde')
      expect(resolved.videoConfig.seoTitle).toContain('Kubernetes 生产集群高可用架构实战')
      expect(resolved.videoConfig.seoKeywords?.length).toBeGreaterThan(0)
      expect(resolved.videoConfig.indexable).toBe(true)
    })

    it('harvestMultiPlatformVideosForKeyword 支持从 Dailymotion 与 PeerTube 采集并注入 SEO 元数据', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('api.dailymotion.com')) {
          return {
            ok: true,
            json: async () => ({
              list: [
                {
                  id: 'x9k8j7',
                  title: 'Rust 异步运行时 Tokio 源码深度剖析',
                  description: '详解 Tokio 调度器、协作式任务抢占与零拷贝 IO。',
                  duration: 2100,
                  thumbnail_720_url: 'https://s1.dmcdn.net/v/x9k8j7/x720',
                  'owner.screenname': 'RustaceanCN',
                  views_total: 85000,
                  created_time: 1741000000,
                },
              ],
            }),
          }
        }
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                shortUUID: 'kkGMgK9ZtnKfYAgnEtQxbv',
                name: 'Linux Kernel eBPF Tracing Deep Dive',
                description: 'Complete walkthrough of eBPF verifier, kprobes and ringbuf.',
                duration: 2400,
                views: 19500,
                likes: 1200,
                publishedAt: '2026-01-20T10:00:00Z',
                url: 'https://framatube.org/w/kkGMgK9ZtnKfYAgnEtQxbv',
                account: { displayName: 'KernelRecipes', host: 'framatube.org' },
              },
            ],
          }),
        }
      })

      const items = await harvestMultiPlatformVideosForKeyword(
        'Rust eBPF',
        {
          platforms: ['dailymotion', 'peertube'],
          minDurationSec: 180,
          minQualityScore: 60,
          limitPerKeyword: 2,
        },
        mockFetch as unknown as typeof fetch
      )

      expect(items).toHaveLength(2)
      expect(items[0].videoConfig?.type).toBe('dailymotion')
      expect(items[0].videoConfig?.seoSlug).toContain('dailymotion-x9k8j7')
      expect(items[1].videoConfig?.type).toBe('peertube')
      expect(items[1].videoConfig?.seoSlug).toContain('peertube-kkgmgk9ztnkfyagnetqxbv')
    })
  })

  describe('4. 搜索引擎结构化数据 (Schema.org VideoObject + Key Moments + Sitemap)', () => {
    const sampleItem: NavigationSubItem = enrichVideoItemSeo(
      {
        id: 'vid_seo_01',
        title: 'Next.js 16 SSR 与 ISR 搜索引擎优化实战',
        href: 'https://www.bilibili.com/video/BV1seo411c7m',
        description: '全面解析 Next.js 16 Metadata API、JSON-LD VideoObject、动态 Sitemap 与 Core Web Vitals 优化。',
        icon: 'https://i0.hdslb.com/bfs/archive/sample.jpg',
        enabled: true,
        videoConfig: {
          type: 'bilibili',
          bvid: 'BV1seo411c7m',
          author: '前端架构师',
          durationSec: 1540,
          publishedAt: '2026-03-01T12:00:00.000Z',
          qualityScore: 92,
          healthStatus: 'healthy',
          stats: { views: 68000, likes: 5400, favorites: 3200 },
          chapters: [
            { time: 0, title: '为什么视频内容需要独立索引落地页' },
            { time: 420, title: 'VideoObject 与 Google Key Moments 配置' },
            { time: 980, title: 'Google Video Sitemap 与 IndexNow 自动推送' },
          ],
        },
      },
      '全栈架构'
    )

    it('generateVideoObjectSchema 生成包含 Clip (Key Moments) 与 SeekToAction 的完整 Schema', () => {
      const schema = generateVideoObjectSchema(sampleItem, 'https://nav.example.com') as Record<string, any>
      expect(schema['@type']).toBe('VideoObject')
      expect(schema.duration).toBe('PT25M40S')
      expect(schema.url).toBe('https://nav.example.com/videos/v/vid_seo_01')
      expect(schema.embedUrl).toContain('player.bilibili.com')
      expect(schema.hasPart).toHaveLength(3)
      expect(schema.hasPart[0]['@type']).toBe('Clip')
      expect(schema.hasPart[0].startOffset).toBe(0)
      expect(schema.hasPart[0].endOffset).toBe(420)
      expect(schema.potentialAction['@type']).toBe('SeekToAction')
      expect(schema.interactionStatistic.length).toBeGreaterThanOrEqual(2)

      const breadcrumb = generateVideoBreadcrumbSchema(
        sampleItem,
        '全栈架构',
        'cat_fullstack',
        'https://nav.example.com'
      ) as Record<string, any>
      expect(breadcrumb['@type']).toBe('BreadcrumbList')
      expect(breadcrumb.itemListElement).toHaveLength(4)
    })

    it('generateVideoSitemapXml 过滤失效视频并输出 player_loc、view_count 与 tag', () => {
      const brokenItem: NavigationSubItem = {
        id: 'vid_broken_02',
        title: '已失效视频',
        href: 'https://www.bilibili.com/video/BV1broken',
        enabled: true,
        videoConfig: {
          type: 'bilibili',
          bvid: 'BV1broken',
          healthStatus: 'broken',
        },
      }
      const xml = generateVideoSitemapXml([sampleItem, brokenItem], 'https://nav.example.com')
      expect(xml).toContain('<loc>https://nav.example.com/videos/v/vid_seo_01</loc>')
      expect(xml).toContain('<video:player_loc')
      expect(xml).toContain('<video:view_count>68000</video:view_count>')
      expect(xml).not.toContain('vid_broken_02')
    })

    it('buildVideoEmbedUrlForSeo 与 auditVideoSeoReadiness 准确评估多平台视频', () => {
      expect(
        buildVideoEmbedUrlForSeo({ type: 'douyin', videoId: '7321098765432109876' })
      ).toContain('open.douyin.com/player/video')
      expect(buildVideoEmbedUrlForSeo({ type: 'vimeo', videoId: '76979871' })).toContain(
        'player.vimeo.com/video/76979871'
      )
      expect(buildVideoEmbedUrlForSeo({ type: 'tencent', videoId: 'u3245abcdef' })).toContain(
        'v.qq.com/txp/iframe/player.html?vid=u3245abcdef'
      )

      const audit = auditVideoSeoReadiness([sampleItem])
      expect(audit.totalVideos).toBe(1)
      expect(audit.indexableVideos).toBe(1)
      expect(audit.withKeyMomentsChapters).toBe(1)
      expect(audit.seoScore).toBeGreaterThanOrEqual(90)
    })
  })
})
