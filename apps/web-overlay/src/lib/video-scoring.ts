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
 * 综合质量分计算模型 (0 - 100)。
 *
 * 只用真实数据，四个分项全部来自视频自身的统计字段：
 *   播放量级（views）0–35 + 点赞率（likes/views）0–25
 *   + 弹幕率（danmaku/views）0–20 + 时长契合度 0–20。
 *
 * 诚实性规则（2026-11-13 去垫高）：
 *   - 没有统计数据就是 0 分，不编造「中性 70 分」；
 *   - 没有基础底分，没有下限钳制（旧 `Math.max(20, …)` 让零数据视频也有 20 分）；
 *   - 播放量不设下限赠分（旧 `log10(max(10, views))` 让 0 播放也有 5 分）；
 *   - 时长未知得 0 分，不按 300/600/900 秒猜一个时长；
 *   - 投币/收藏（coins/favorites）不计入：备份 6007 条里只有 11 条有这两个字段，
 *     计入等于给 99.8% 的视频两个 0 分项，白白压缩量表；等采集能稳定回填这两个
 *     字段后再以独立分项加回，不要在这里用 0 填充。
 *   - 绝不用上一次的 qualityScore 当输入：回填是纯函数重算，不是平滑/继承。
 *   - 保鲜分没有 5 分底线（旧 `Math.max(5, …)` 让 0 分/极旧视频也有 5 分保鲜分）。
 *
 * 校准（备份 6007 条实测）：中位数 47，p90 66，最高 94；
 * 众数值 47 仅占 4.1%，不再出现 4134 条扎堆 65（旧 `Math.max(65, …)` 的遗迹）。
 * 注意：按新公式只有约 20% 的旧库能过 60 分门禁、约 12% 能过 65 分门禁，
 * 重采后的入库量会明显变小 —— 这是去垫高的直接后果，门禁阈值是否下调
 * 由协调人/ Ryan 决定，不要在这里偷偷把分抬回去。
 */
export function calculateQualityScore(
  stats?: VideoStats,
  durationSec?: number,
  pubdateUnix?: number
): number {
  void pubdateUnix
  if (!stats) return 0

  const views = stats.views || 0
  const likes = stats.likes || 0
  const danmaku = stats.danmaku || 0

  // 1. 播放量级对数评分 (0 - 35)
  // 0 播放 0 分；10 播放 5 分，1 千播放 15 分，1 万播放 20 分，
  // 10 万播放 25 分，100 万播放 30 分，1000 万以上 35 分封顶。
  const viewsScore = Math.min(35, Math.log10(Math.max(1, views)) * 5)

  // 2. 点赞率 (0 - 25)：点赞/播放比达到 5% 满分。
  // 备份实测：中位数 1.5%，p90 3.6%，p95 4.9%。
  const likeRate = views > 0 ? likes / views : 0
  const likeScore = Math.min(25, (likeRate / 0.05) * 25)

  // 3. 弹幕率 (0 - 20)：弹幕/播放比达到 0.5% 满分，是「有人在讨论」的直接信号。
  // 备份实测：中位数 0.027%，p75 0.16%，p90 0.56%。
  const danmakuRate = views > 0 ? danmaku / views : 0
  const danmakuScore = Math.min(20, (danmakuRate / 0.005) * 20)

  // 4. 时长契合度 (0 - 20)
  // 5 分钟 - 45 分钟为黄金深度教程区间；短于 2 分钟扣分；
  // 时长未知得 0 分 —— 不猜。
  let durationScore = 0
  if (durationSec) {
    if (durationSec < 120) durationScore = 5
    else if (durationSec >= 300 && durationSec <= 2700) durationScore = 20
    else if (durationSec > 2700 && durationSec <= 7200) durationScore = 16
    else durationScore = 12
  }

  const total = Math.round(viewsScore + likeScore + danmakuScore + durationScore)
  return Math.min(99, total)
}

/**
 * 计算视频当前的保鲜评分 (0 - 100)
 *
 * 注意 `publishedAt` 缺失时的语义：返回 `qualityScore * 0.8`（「未知」的保守值），
 * **不是** 100。历史上有调用方把 `publishedAt` 写成 `new Date()` 再传进来，
 * 等于让所有内容永远新鲜、衰减模型永不触发。
 *
 * `qualityScore` 缺省为 0：调用方漏传时不按 75 分估算（旧缺省 75 是编造的分数，
 * 会让一次漏传凭空给视频 60 分保鲜分）；所有现有调用方都显式传分，改缺省不影响它们。
 */
export function calculateFreshnessScore(
  publishedAt?: string | number,
  qualityScore: number = 0,
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
  // 没有下限钳制：0 分就是 0 分（旧 Math.max(5, …) 给 0 分/极旧视频白送 5 分）。
  return Math.min(100, effective)
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
