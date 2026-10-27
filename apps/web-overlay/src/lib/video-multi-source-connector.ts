/**
 * Multi-Source Video Connector & Webhook Ingestion Engine
 * Proposal [1]: Real-world Multi-Source Cron & Webhook Connector
 * Integrates feeds from Bilibili, YouTube RSS, and GitHub Trending,
 * with secure HMAC signature verification and automated ingestion.
 */

import {
  evaluateVideoWithAIModel,
  generateAISanitizedMetadata,
  type AIEvaluationResult,
  type AISanitizedCourse,
} from '@/lib/video-autonomous-ai-harvester'
import { verifyHmacSha256 } from '@/lib/webhook-signature'
import type { NavigationItem, NavigationSubItem } from '@/types/navigation'

export interface RawExternalCandidate {
  source: 'bilibili' | 'youtube' | 'github_trending' | 'webhook'
  externalId: string
  title: string
  description?: string
  author: string
  durationSec: number
  originUrl: string
  domain: string
  stats?: {
    views?: number
    likes?: number
    coins?: number
    favorites?: number
  }
}

export interface WebhookPayload {
  event: 'video_published' | 'trending_alert' | 'manual_dispatch'
  timestamp: number
  source: 'bilibili' | 'youtube' | 'github' | 'custom'
  data: {
    id: string
    title: string
    description?: string
    author?: string
    durationSec?: number
    url: string
    domain?: string
    tags?: string[]
  }
}

export interface MultiSourceIngestReport {
  timestamp: number
  processedCount: number
  acceptedCount: number
  rejectedCount: number
  items: Array<{
    title: string
    source: string
    approved: boolean
    score: number
    reason?: string
  }>
}

/**
 * Validates HMAC SHA-256 for incoming webhooks.
 *
 * 保留该导出名是为了不打断既有调用方，但内部已改为真 HMAC（见 `lib/webhook-signature.ts`）。
 * 老实现是「32 位滚动哈希 + includes() 子串匹配 + 允许密钥当签名」，等于没有校验；
 * 不要在任何地方再手写一套哈希。
 */
export function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  return verifyHmacSha256(payload, signature, secret)
}

/**
 * Parses raw Bilibili Search / View API responses into standardized candidate objects.
 */
export function parseBilibiliApiResponse(json: Record<string, any>): RawExternalCandidate[] {
  const result: RawExternalCandidate[] = []
  const list = json?.data?.result || json?.data?.list || json?.data?.vlist || []

  for (const item of list) {
    const bvid = item.bvid || (item.aid ? `av${item.aid}` : '')
    if (!bvid) continue

    const durationStr = item.duration || '0'
    let durationSec = 0
    if (typeof durationStr === 'number') {
      durationSec = durationStr
    } else if (typeof durationStr === 'string' && durationStr.includes(':')) {
      const parts = durationStr.split(':').map(p => parseInt(p, 10))
      if (parts.length === 2) durationSec = parts[0] * 60 + parts[1]
      else if (parts.length === 3) durationSec = parts[0] * 3600 + parts[1] * 60 + parts[2]
    } else {
      durationSec = parseInt(durationStr, 10) || 600
    }

    result.push({
      source: 'bilibili',
      externalId: bvid,
      title: (item.title || '').replace(/<[^>]*>/g, '').trim(),
      description: item.description || item.desc || '',
      author: item.author || item.owner?.name || '未知UP主',
      durationSec,
      originUrl: `https://www.bilibili.com/video/${bvid}`,
      domain: 'cat_ai_engineering',
      stats: {
        views: item.play || item.stat?.view || 0,
        likes: item.favorites || item.stat?.like || 0,
        coins: item.coins || item.stat?.coin || 0,
        favorites: item.favorites || item.stat?.favorite || 0,
      },
    })
  }
  return result
}

/**
 * Parses YouTube XML / RSS Atom feeds into standardized candidate objects.
 */
export function parseYouTubeRssFeed(xmlText: string): RawExternalCandidate[] {
  const candidates: RawExternalCandidate[] = []
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g
  let match: RegExpExecArray | null

  while ((match = entryRegex.exec(xmlText)) !== null) {
    const entryBlock = match[1]
    const idMatch = /<yt:videoId>(.*?)<\/yt:videoId>/.exec(entryBlock)
    const titleMatch = /<title>(.*?)<\/title>/.exec(entryBlock)
    const authorMatch = /<name>(.*?)<\/name>/.exec(entryBlock)
    const descMatch = /<media:description>([\s\S]*?)<\/media:description>/.exec(entryBlock)

    if (idMatch && titleMatch) {
      candidates.push({
        source: 'youtube',
        externalId: idMatch[1].trim(),
        title: titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim(),
        description: descMatch ? descMatch[1].trim() : '',
        author: authorMatch ? authorMatch[1].trim() : 'YouTube Creator',
        durationSec: 1200, // RSS feed lacks duration tag, default to 20m
        originUrl: `https://www.youtube.com/watch?v=${idMatch[1].trim()}`,
        domain: 'cat_fullstack_architecture',
        stats: { views: 50000, likes: 3500 },
      })
    }
  }
  return candidates
}

/**
 * Parses GitHub Trending repository feeds and translates them into technical video candidates.
 */
export function parseGitHubTrendingFeed(repos: Array<{ name: string; description: string; language: string; stars: number }>): RawExternalCandidate[] {
  return repos.map(r => ({
    source: 'github_trending',
    externalId: `gh_${r.name.replace(/[^a-zA-Z0-9_]/g, '_')}`,
    title: `${r.name} 架构剖析与开源实战指南（${r.language}）`,
    description: r.description || `基于 ${r.language} 的前沿高星项目。`,
    author: 'GitHub 创作者',
    durationSec: 1800,
    originUrl: `https://github.com/${r.name}`,
    domain: 'cat_tools_indie',
    stats: { views: r.stars * 10, likes: r.stars },
  }))
}

/**
 * Controller executing multi-source collection, webhook processing, and AI qualification.
 */
export class MultiSourceConnector {
  private webhookSecret: string

  /**
   * 不设默认密钥。此前默认值是仓库里硬编码的 `navhub_video_webhook_secret_2026`，
   * 等于把「未配置」变成「用一个公开密钥」——攻击者无需探测即可伪造。
   * 未配置时 `processWebhook` 一律拒绝（fail-closed）。
   */
  constructor(secret: string = '') {
    this.webhookSecret = secret
  }

  getSecret(): string {
    return this.webhookSecret
  }

  setSecret(secret: string): void {
    this.webhookSecret = secret
  }

  /**
   * Processes a validated webhook dispatch and returns synthesized course metadata if approved.
   *
   * @param signature 签名头。**必填** —— 老实现写的是 `if (signature && !verify(...))`，
   *                  不带签名即可跳过校验，整个入口等于公开。
   * @param rawBody   原始请求体文本。签名的输入必须是原文：对已 parse 的对象再
   *                  `JSON.stringify` 会因键序/空格变化导致正确签名也被拒。
   */
  processWebhook(
    payload: WebhookPayload,
    signature?: string,
    rawBody?: string
  ): { ok: boolean; message: string; subItem?: NavigationSubItem; evaluation?: AIEvaluationResult } {
    if (!this.webhookSecret) {
      return { ok: false, message: 'Webhook 未配置密钥（NAVHUB_VIDEO_WEBHOOK_SECRET），已拒绝请求' }
    }

    const signingInput = rawBody ?? JSON.stringify(payload)
    if (!verifyWebhookSignature(signingInput, signature ?? '', this.webhookSecret)) {
      return { ok: false, message: 'Webhook HMAC 签名验证失败，拒绝请求' }
    }

    const { id, title, description, author, durationSec, url, domain } = payload.data
    const evalResult = evaluateVideoWithAIModel({
      title,
      description,
      author,
      durationSec: durationSec || 1200,
    })

    if (!evalResult.isApproved) {
      return {
        ok: false,
        message: `AI 审核未通过: ${evalResult.rejectReason}`,
        evaluation: evalResult,
      }
    }

    const meta = generateAISanitizedMetadata(
      title,
      description,
      durationSec || 1200,
      evalResult.conceptTags
    )

    /**
     * 平台由来源决定，不再一律当 B 站。
     *
     * 原实现把 `type` 写死成 `'bilibili'`，并且对非 BV 号塞了一个硬编码的
     * `bvid: 'BV1whDefault'` —— 于是所有 webhook 来源在去重时都被判成同一条视频，
     * 且点开永远指向一个不存在的稿件。没有真实 BV 号就不要伪造。
     */
    const platform: 'bilibili' | 'youtube' | 'custom' = id.startsWith('BV')
      ? 'bilibili'
      : payload.source === 'youtube'
        ? 'youtube'
        : 'custom'

    const subItem: NavigationSubItem = {
      id: `wh_${platform}_${id}_${Date.now()}`,
      title: meta.cleanTitle,
      href: url,
      description: meta.overview,
      // 不写封面：webhook 载荷里没有封面字段，此前统一塞同一张 Unsplash 图，
      // 等于给所有外部内容伪造配图。留空后前端走平台占位。
      enabled: true,
      videoConfig: {
        type: platform,
        ...(platform === 'bilibili' ? { bvid: id } : {}),
        ...(platform !== 'bilibili' ? { videoId: id } : {}),
        p: 1,
        author: author || 'Webhook 创作者',
        durationSec: durationSec || 1200,
        // 发布时间未知就不写：原来一律写 now，让老内容也显示成今天发布
        ...(payload.timestamp ? { publishedAt: new Date(payload.timestamp).toISOString() } : {}),
        harvestedAt: Date.now(),
        qualityScore: evalResult.aiQualityScore,
        freshnessScore: 100,
        sourceType: 'webhook',
        healthStatus: 'healthy',
        chapters: meta.chapters,
        transcript: meta.transcripts,
      },
    }

    return {
      ok: true,
      message: 'Webhook 处理成功，已通过规则初筛（关键词 / 时长 / 互动加权）',
      subItem,
      evaluation: evalResult,
    }
  }

  /**
   * Ingests a list of raw candidates from any source and aggregates the evaluation results.
   */
  ingestCandidates(candidates: RawExternalCandidate[]): MultiSourceIngestReport {
    const report: MultiSourceIngestReport = {
      timestamp: Date.now(),
      processedCount: candidates.length,
      acceptedCount: 0,
      rejectedCount: 0,
      items: [],
    }

    for (const c of candidates) {
      const evalRes = evaluateVideoWithAIModel({
        title: c.title,
        description: c.description,
        author: c.author,
        durationSec: c.durationSec,
        stats: c.stats,
      })

      if (evalRes.isApproved) {
        report.acceptedCount++
        report.items.push({
          title: c.title,
          source: c.source,
          approved: true,
          score: evalRes.aiQualityScore,
        })
      } else {
        report.rejectedCount++
        report.items.push({
          title: c.title,
          source: c.source,
          approved: false,
          score: evalRes.aiQualityScore,
          reason: evalRes.rejectReason,
        })
      }
    }

    return report
  }
}
