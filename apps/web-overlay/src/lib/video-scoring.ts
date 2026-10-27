/**
 * 视频评分纯函数。
 *
 * 为什么从 `video-harvester.ts` 抽出来：
 *   那两个函数是纯计算，但原文件顶部 `import { getFileContent } from '@/lib/github'`，
 *   而 `github.ts` → `lib/auth` → `next-auth` → `next/server`。
 *   任何想复用评分模型的模块（热点采集、自主采集、单测）都会被这条链拉进
 *   next-auth，在 vitest 里直接 `Cannot find module .../next/server`。
 *
 * 约定：本文件**不得**引入任何 IO / 环境依赖，只做数学计算。
 */

import type { VideoStats } from '@/types/navigation'

/**
 * 综合质量分计算模型 (0 - 100)
 */
export function calculateQualityScore(
  stats?: VideoStats,
  durationSec?: number,
  pubdateUnix?: number
): number {
  if (!stats) return 70

  const views = stats.views || 0
  const likes = stats.likes || 0
  const coins = stats.coins || 0
  const favorites = stats.favorites || 0

  // 1. 播放量级对数评分 (0 - 30)
  // 1万播放约18分，10万播放约24分，100万播放约30分
  const viewsScore = Math.min(30, Math.log10(Math.max(10, views)) * 5)

  // 2. 互动转化率与干货比 (0 - 40)
  // 技术教程最重要的指标是「收藏/播放比」与「投币/点赞比」
  const favRate = views > 0 ? favorites / views : 0
  const likeRate = views > 0 ? likes / views : 0
  const coinToLikeRate = likes > 0 ? coins / likes : 0

  // 收藏率达到 5% 为高质教程满分(20)，投币点赞比达到 30% 满分(20)
  const favScore = Math.min(20, (favRate / 0.05) * 20)
  const coinScore = Math.min(20, (coinToLikeRate / 0.3) * 20)

  // 3. 时长契合度 (0 - 20)
  // 5分钟 - 45分钟为黄金深度教程区间；短于2分钟扣分
  let durationScore = 15
  if (durationSec) {
    if (durationSec < 120) durationScore = 5
    else if (durationSec >= 300 && durationSec <= 2700) durationScore = 20
    else if (durationSec > 2700 && durationSec <= 7200) durationScore = 16
    else durationScore = 12
  }

  // 4. 基础底分 (10)
  const baseScore = 10

  const total = Math.round(viewsScore + favScore + coinScore + durationScore + baseScore)
  return Math.max(20, Math.min(99, total))
}

/**
 * 计算视频当前的保鲜评分 (0 - 100)
 *
 * 注意 `publishedAt` 缺失时的语义：返回 `qualityScore * 0.8`（「未知」的保守值），
 * **不是** 100。历史上有调用方把 `publishedAt` 写成 `new Date()` 再传进来，
 * 等于让所有内容永远新鲜、衰减模型永不触发。
 */
export function calculateFreshnessScore(
  publishedAt?: string | number,
  qualityScore: number = 75,
  halfLifeDays: number = 90,
  title?: string
): number {
  if (!publishedAt) return Math.round(qualityScore * 0.8)

  const pubTime = typeof publishedAt === 'number'
    ? (publishedAt < 1e11 ? publishedAt * 1000 : publishedAt)
    : new Date(publishedAt).getTime()

  if (isNaN(pubTime)) return qualityScore

  const now = Date.now()
  const ageDays = Math.max(0, (now - pubTime) / (1000 * 3600 * 24))

  // 半衰期指数衰减
  const decayFactor = Math.pow(0.5, ageDays / Math.max(15, halfLifeDays))

  // 语义年份老化检查：如果标题带有旧年份（如 2021, 2022, 2023），给予额外折旧惩罚
  let yearPenalty = 1.0
  if (title) {
    const currentYear = new Date().getFullYear()
    for (let y = 2018; y < currentYear - 1; y++) {
      if (title.includes(String(y))) {
        yearPenalty = 0.8
        break
      }
    }
  }

  const effective = Math.round(qualityScore * decayFactor * yearPenalty)
  return Math.max(5, Math.min(100, effective))
}

/** 把 "MM:SS" / "HH:MM:SS" / 秒数 归一成秒 */
export function parseDurationToSeconds(durationStr?: string | number): number {
  if (durationStr === undefined || durationStr === null) return 0
  if (typeof durationStr === 'number') return durationStr
  const parts = durationStr.split(':').map(Number)
  if (parts.length === 2 && !isNaN(parts[0]!) && !isNaN(parts[1]!)) {
    return parts[0]! * 60 + parts[1]!
  }
  if (parts.length === 3 && !isNaN(parts[0]!) && !isNaN(parts[1]!) && !isNaN(parts[2]!)) {
    return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
  }
  return 0
}
