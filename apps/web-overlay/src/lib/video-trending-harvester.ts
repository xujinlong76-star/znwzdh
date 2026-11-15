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
