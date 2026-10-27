/**
 * Automated Trending Video Harvester & Content Enrichment Engine
 * Discovers, filters, scores, and injects hot tech tutorials into video catalogs.
 */

import type { NavigationData, NavigationItem, NavigationSubItem, VideoChapter, VideoTranscriptItem } from '@/types/navigation'
import { calculateFreshnessScore } from '@/lib/video-scoring'
import { videoExternalKey } from '@/lib/video-identity'
import topicsFile from '@/navsphere/content/video-topics.json'

export interface TrendingTechTopic {
  domain: string
  keyword: string
  hotIndex: number
  recommendedTitle: string
  bvidFallback: string
  author: string
  durationSec: number
  chapters: VideoChapter[]
  transcripts: VideoTranscriptItem[]
  /**
   * 真实发布时间（ISO 字符串）。
   *
   * 没有这一项就**不要**入库时写 `new Date()`：历史实现把 2021 年的课程标成「今天发布」
   * 并写死 `freshnessScore: 98`，直接绕过整个保鲜衰减模型（`worstScore < 45` 永不成立，
   * 「过时内容轮换」因此不可能触发）。留空表示「未知」，按不确定处理。
   */
  publishedAt?: string
}

export interface TrendingHarvestResult {
  timestamp: number
  harvestedCount: number
  categoriesEnriched: string[]
  topDiscoveredVideos: Array<{
    title: string
    category: string
    author: string
    hotIndex: number
    durationSec: number
  }>
}

/**
 * 候选热点池。
 *
 * 从 `src/navsphere/content/video-topics.json` 读入（构建期内联），不再写死在代码里 ——
 * 运维改选题不必改 TS，也不会因为一处手写笔误让整包采集失效。
 *
 * 数据契约（改 JSON 时必须守住的四条）：
 *   1. `domain` 必须是视频库里真实存在的分类 id，否则整条被跳过；
 *   2. `bvidFallback` 必须是真的 BV 号（`BV` + 10 位），否则入库即死链；
 *   3. `publishedAt` 未知就**不要填** —— 填 `new Date()` 会让保鲜衰减模型永不触发；
 *   4. `chapters` 至少 2 条，否则 UI 的章节树是空的。
 *
 * 上面四条都有回归守卫（`video-evolution-v8.test.ts` 的「候选质量」用例）。
 */
const topicsData = topicsFile as { version?: number; topics?: unknown }

export const CURATED_TRENDING_TOPICS: TrendingTechTopic[] = Array.isArray(topicsData.topics)
  ? (topicsData.topics as TrendingTechTopic[])
  : []

/**
 * Executes trending harvest and automatically injects discovered trending tech courses.
 */
export function harvestTrendingVideos(
  currentData: NavigationData,
  options: { maxItemsPerCategory?: number; minHotIndex?: number } = {}
): { updatedData: NavigationData; result: TrendingHarvestResult } {
  const maxItems = options.maxItemsPerCategory || 8
  const minHot = options.minHotIndex || 80

  const categories = [...currentData.navigationItems]
  const existingKeys = new Set<string>()

  // Collect existing video IDs（复合键 platform:externalId）
  categories.forEach(cat => {
    ;(cat.items || []).forEach(it => {
      const key = videoExternalKey(it.videoConfig)
      if (key) existingKeys.add(key)
    })
  })

  // Ensure 'cat_systems_perf' exists if missing
  let sysCat = categories.find(c => c.id === 'cat_systems_perf')
  if (!sysCat) {
    sysCat = {
      id: 'cat_systems_perf',
      title: '系统底层与高性能计算',
      icon: 'Cpu',
      description: 'Rust 系统编程、Go 高并发微服务、WebGPU 硬件加速与网络内核调优',
      enabled: true,
      items: [],
      subCategories: [],
    }
    categories.push(sysCat)
  }

  const enrichedCategories = new Set<string>()
  const discovered: TrendingHarvestResult['topDiscoveredVideos'] = []
  let harvestedCount = 0

  for (const topic of CURATED_TRENDING_TOPICS) {
    if (topic.hotIndex < minHot) continue

    const targetCategory = categories.find(c => c.id === topic.domain)
    if (!targetCategory) continue
    if (!targetCategory.items) targetCategory.items = []

    // Skip if already in category or max capacity reached（候选池固定为 B 站）
    const topicKey = `bilibili:${topic.bvidFallback}`
    if (existingKeys.has(topicKey)) continue
    if (targetCategory.items.length >= maxItems) continue

    // 质量分来自候选池的人工评估分；保鲜分由**真实**发布时间推导。
    // 没有发布时间就按「未知」算（calculateFreshnessScore 的 undefined 分支），
    // 不再写死 98 假装刚发布。
    const qualityScore = Math.min(99, topic.hotIndex + 2)
    const freshnessScore = calculateFreshnessScore(topic.publishedAt, qualityScore, 90, topic.recommendedTitle)

    const newItem: NavigationSubItem = {
      id: `harvest_${topic.bvidFallback}_${Date.now()}`,
      title: topic.recommendedTitle,
      href: `https://www.bilibili.com/video/${topic.bvidFallback}`,
      // 不再用「热点精选」：候选池是人工维护的静态选题（video-topics.json），
      // 不是实时抓取的热榜。把它说成「热点」会让读者以为这是当天的流行内容。
      description: `【精选】深度涵盖 ${topic.keyword}。系统梳理工程架构，提供完整章节大纲与源码演练。`,
      // 不写封面：候选池没有真实封面来源，留空后前端走平台占位
      enabled: true,
      videoConfig: {
        type: 'bilibili',
        bvid: topic.bvidFallback,
        p: 1,
        author: topic.author,
        durationSec: topic.durationSec,
        ...(topic.publishedAt ? { publishedAt: topic.publishedAt } : {}),
        harvestedAt: Date.now(),
        qualityScore,
        freshnessScore,
        sourceType: 'auto_trend',
        trendKeyword: topic.keyword,
        pinned: false,
        healthStatus: 'healthy',
        chapters: topic.chapters,
        transcript: topic.transcripts,
        // stats 不再编造：历史实现用 `125000 + Math.random() * 80000` 生成播放量，
        // 这些假数字会进入 calculateQualityScore 的 log10(views) 与收藏率，
        // 让「质量分」变成随机数的函数。没有真实来源就留空，UI 走「无统计」分支。
      },
    }

    targetCategory.items.push(newItem)
    existingKeys.add(topicKey)
    enrichedCategories.add(targetCategory.title)
    harvestedCount++

    discovered.push({
      title: topic.recommendedTitle,
      category: targetCategory.title,
      author: topic.author,
      hotIndex: topic.hotIndex,
      durationSec: topic.durationSec,
    })
  }

  const result: TrendingHarvestResult = {
    timestamp: Date.now(),
    harvestedCount,
    categoriesEnriched: Array.from(enrichedCategories),
    topDiscoveredVideos: discovered,
  }

  return {
    updatedData: {
      ...currentData,
      navigationItems: categories,
    },
    result,
  }
}
