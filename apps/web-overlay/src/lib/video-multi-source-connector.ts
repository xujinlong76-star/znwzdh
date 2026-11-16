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
} from '@/lib/video-autonomous-ai-harvester'
import {
  checkHarvestEligibility,
  harvestGuardRejectReason,
} from '@/lib/video-harvest-guard'
import {
  verifyHmacSha256,
  verifyHmacSha256WithTimestamp,
  createReplayGuard,
  WEBHOOK_TIMESTAMP_TOLERANCE_SEC,
} from '@/lib/webhook-signature'

/**
 * 重放去重守卫（进程内）。
 * TTL 取 2× 时间容差：签名在窗口内可能被接受，超过窗口的重复请求本就会因 stale 被拒，
 * 所以缓存只需覆盖窗口长度即可，留一倍余量应对边界。
 * 多副本部署时每副本各挡一次（严格跨副本去重需共享存储，见 ADR-0001）。
 */
const webhookReplayGuard = createReplayGuard(WEBHOOK_TIMESTAMP_TOLERANCE_SEC * 2 * 1000)
import { calculateFreshnessScore } from '@/lib/video-scoring'
import { syntheticMetadataEnabled } from '@/lib/video-metadata-policy'
import { enrichVideoItemSeo } from '@/lib/video-seo'
import { detectVideoPlatform } from '@/lib/video-multi-platform-harvester'
import type { NavigationSubItem, VideoPlatformType, VideoStats } from '@/types/navigation'


export interface WebhookPayload {
  event: 'video_published' | 'trending_alert' | 'manual_dispatch'
  timestamp: number
  source: VideoPlatformType | 'github'
  data: {
    id: string
    title: string
    description?: string
    author?: string
    durationSec?: number
    url: string
    domain?: string
    tags?: string[]
    /**
     * 发送方提供的真实互动数据（播放/点赞/弹幕/投币/收藏）。
     * 可选，但缺了就等于零数据：入库严标准守卫会直接拒收，不给默认值。
     * 发送方想走这条路入库，必须在载荷里带真实数字；编造数字与伪造无异。
     */
    stats?: VideoStats
  }
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
    rawBody?: string,
    /** v2 时间戳头（秒级 Unix 时间戳）；提供时走「时间窗口 + 重放去重」校验 */
    timestampHeader?: string,
  ): { ok: boolean; message: string; subItem?: NavigationSubItem; evaluation?: AIEvaluationResult } {
    if (!this.webhookSecret) {
      return { ok: false, message: 'Webhook 未配置密钥（NAVHUB_VIDEO_WEBHOOK_SECRET），已拒绝请求' }
    }

    const signingInput = rawBody ?? JSON.stringify(payload)

    // 2026-11-06 深扫 P2-11：有 ts 头就走 v2（时间窗口 + 去重），否则退回 v1。
    // 为什么保留 v1：现网发送方未必都升级；但**v1 没有重放保护**，所以只要发送方
    // 带了 ts 头就按 v2 严格校验——剥掉 ts 头退回 v1 会因载荷不同而验签失败。
    if (timestampHeader) {
      const replay = verifyHmacSha256WithTimestamp(
        signingInput,
        signature ?? '',
        this.webhookSecret,
        timestampHeader,
      )
      if (!replay.ok) {
        return { ok: false, message: `Webhook 签名验证失败（${replay.reason}），拒绝请求` }
      }
      // 去重键 = 时间戳 + 签名：同一请求重放时两者完全相同
      const replayKey = `${timestampHeader}.${signature ?? ''}`
      if (!webhookReplayGuard.check(replayKey)) {
        return { ok: false, message: 'Webhook 重放被拒（同一签名在容差窗口内重复出现）' }
      }
    } else if (!verifyWebhookSignature(signingInput, signature ?? '', this.webhookSecret)) {
      return { ok: false, message: 'Webhook HMAC 签名验证失败，拒绝请求' }
    }

    const { id, title, description, author, durationSec, url } = payload.data
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

    // 入库严标准守卫（2026-11-13）：webhook 载荷不带 stats 就是零数据，直接拒收。
    // 此前这里只过 AI 审核就放行，等于任何外部推送都能无数据入库；人工豁免不适用
    // （sourceType 是 'webhook'，不是 'manual'），想入库就带真实互动数据。
    const guardVerdict = checkHarvestEligibility({ stats: payload.data.stats })
    if (!guardVerdict.eligible) {
      return {
        ok: false,
        message: harvestGuardRejectReason(guardVerdict),
        evaluation: evalResult,
      }
    }

    const meta = generateAISanitizedMetadata(
      title,
      description,
      durationSec || 1200,
      evalResult.conceptTags
    )
    // 合成元数据默认关闭：模板章节/字幕不得冒充视频原文（见 video-metadata-policy.ts）
    const synthetic = syntheticMetadataEnabled()

    /**
     * 平台由来源决定，不再一律当 B 站。
     *
     * 原实现把 `type` 写死成 `'bilibili'`，并且对非 BV 号塞了一个硬编码的
     * `bvid: 'BV1whDefault'` —— 于是所有 webhook 来源在去重时都被判成同一条视频，
     * 且点开永远指向一个不存在的稿件。没有真实 BV 号就不要伪造。
     */
    const detected = detectVideoPlatform(url)
    const platform: VideoPlatformType = id.startsWith('BV')
      ? 'bilibili'
      : payload.source && payload.source !== 'github' && payload.source !== 'custom'
        ? payload.source
        : detected?.platform || 'custom'

    const subItem: NavigationSubItem = enrichVideoItemSeo({
      id: `wh_${platform}_${id}_${Date.now()}`,
      title: meta.cleanTitle,
      href: url,
      description: synthetic ? meta.overview : (description ?? ''),
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
        // 按真实发布时间计算保鲜分。
        // 写死 100 会让任何老内容都「满分新鲜」，淘汰门槛（worstScore < 45）永不成立，
        // 整条保鲜衰减链路因此失效 —— 与本文件「发布时间未知就不写 publishedAt」的
        // 处理自相矛盾。时间未知时 calculateFreshnessScore 走保守分支（质量分 × 0.8）。
        freshnessScore: calculateFreshnessScore(
          payload.timestamp ? new Date(payload.timestamp).toISOString() : undefined,
          evalResult.aiQualityScore,
          90,
          title
        ),
        // 守卫已验过的真实互动数据随条目入库（有 stats 才写，零数据到不了这里）。
        ...(payload.data.stats ? { stats: payload.data.stats } : {}),
        sourceType: 'webhook',
        healthStatus: 'healthy',
        // 合成元数据默认不写：模板章节/字幕会被误认为视频原文
        ...(synthetic ? { chapters: meta.chapters, transcript: meta.transcripts, synthetic: true } : {}),
      },
    })

    return {
      ok: true,
      message: 'Webhook 处理成功，已通过 AI 审核与入库严标准守卫',
      subItem,
      evaluation: evalResult,
    }
  }

  /**
   * 管理员控制台调试通道：对已通过会话鉴权的管理员，支持在未配置或已配置外部密钥的情况下执行完整 AI 审核与结构化提取。
   */
  processAdminTestPayload(
    payload: WebhookPayload
  ): { ok: boolean; message: string; subItem?: NavigationSubItem; evaluation?: AIEvaluationResult } {
    const { id, title, description, author, durationSec, url } = payload.data
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

    // 与 processWebhook 同一条入库严标准守卫：管理员测试通道同样写库，零数据一样拒收。
    const guardVerdict = checkHarvestEligibility({ stats: payload.data.stats })
    if (!guardVerdict.eligible) {
      return {
        ok: false,
        message: harvestGuardRejectReason(guardVerdict),
        evaluation: evalResult,
      }
    }

    const meta = generateAISanitizedMetadata(
      title,
      description,
      durationSec || 1200,
      evalResult.conceptTags
    )
    // 合成元数据默认关闭：模板章节/字幕不得冒充视频原文（见 video-metadata-policy.ts）
    const synthetic = syntheticMetadataEnabled()

    const detected = detectVideoPlatform(url)
    const platform: VideoPlatformType = id.startsWith('BV')
      ? 'bilibili'
      : payload.source && payload.source !== 'github' && payload.source !== 'custom'
        ? payload.source
        : detected?.platform || 'custom'

    const subItem: NavigationSubItem = enrichVideoItemSeo({
      id: `wh_${platform}_${id}_${Date.now()}`,
      title: meta.cleanTitle,
      href: url,
      description: synthetic ? meta.overview : (description ?? ''),
      enabled: true,
      videoConfig: {
        type: platform,
        ...(platform === 'bilibili' ? { bvid: id } : {}),
        ...(platform !== 'bilibili' ? { videoId: id } : {}),
        p: 1,
        author: author || 'Webhook 创作者',
        durationSec: durationSec || 1200,
        ...(payload.timestamp ? { publishedAt: new Date(payload.timestamp).toISOString() } : {}),
        harvestedAt: Date.now(),
        qualityScore: evalResult.aiQualityScore,
        // 按真实发布时间计算保鲜分。
        // 写死 100 会让任何老内容都「满分新鲜」，淘汰门槛（worstScore < 45）永不成立，
        // 整条保鲜衰减链路因此失效 —— 与本文件「发布时间未知就不写 publishedAt」的
        // 处理自相矛盾。时间未知时 calculateFreshnessScore 走保守分支（质量分 × 0.8）。
        freshnessScore: calculateFreshnessScore(
          payload.timestamp ? new Date(payload.timestamp).toISOString() : undefined,
          evalResult.aiQualityScore,
          90,
          title
        ),
        // 守卫已验过的真实互动数据随条目入库（有 stats 才写，零数据到不了这里）。
        ...(payload.data.stats ? { stats: payload.data.stats } : {}),
        sourceType: 'webhook',
        healthStatus: 'healthy',
        // 合成元数据默认不写：模板章节/字幕会被误认为视频原文
        ...(synthetic ? { chapters: meta.chapters, transcript: meta.transcripts, synthetic: true } : {}),
      },
    })

    return {
      ok: true,
      message: '管理员测试 Webhook 处理成功：AI 审核、元数据清洗与入库严标准守卫均已通过',
      subItem,
      evaluation: evalResult,
    }
  }
}
