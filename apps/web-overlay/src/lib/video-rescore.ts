/**
 * 视频库全量重算回填（纯函数，无 IO）。
 *
 * 用途：
 *   1. 对备份/导出的视频库按当前 `calculateQualityScore` 重算每一项的
 *      qualityScore，并按新分重算 freshnessScore；
 *   2. 重采后对新库跑同一遍入口（见 `scripts/video-rescore-backfill.mjs`）。
 *
 * 规则：
 *   - 只用条目自身的真实字段（stats.views/likes/danmaku、durationSec、
 *     publishedAt、title）重算，绝不读旧 qualityScore 当输入；
 *   - 不写回任何在线库：本模块只返回新数据，落盘由调用方决定；
 *   - 不改动除两个分数以外的任何字段；输入不被原地修改。
 */

import { calculateFreshnessScore, calculateQualityScore } from './video-scoring'
import type { NavigationItem, NavigationSubItem } from '@/types/navigation'

export interface RescoreItemDiff {
  id: string
  title: string
  oldQualityScore: number | null
  newQualityScore: number
  oldFreshnessScore: number | null
  newFreshnessScore: number
  changed: boolean
  missingStats: boolean
}

export interface ScoreDistribution {
  count: number
  min: number | null
  max: number | null
  mean: number | null
  median: number | null
  p10: number | null
  p25: number | null
  p75: number | null
  p90: number | null
  /** 出现次数最多的分数及其次数：用来发现「扎堆」型垫高回归 */
  mode: { value: number; count: number } | null
  passAt50: number
  passAt60: number
  passAt65: number
}

export interface RescoreReport {
  total: number
  rescored: number
  changed: number
  unchanged: number
  missingStats: number
  qualityBefore: ScoreDistribution
  qualityAfter: ScoreDistribution
  diffs: RescoreItemDiff[]
}

export interface RescoreOptions {
  /** 保鲜分半衰期（天），默认 90，与各采集分支写死的值一致 */
  halfLifeDays?: number
}

/** 对单条视频重算两个分数，返回新条目（输入不被修改）与差异记录。 */
export function rescoreVideoItem(
  item: NavigationSubItem,
  halfLifeDays = 90
): { item: NavigationSubItem; diff: RescoreItemDiff } {
  const vc = item.videoConfig
  const base: RescoreItemDiff = {
    id: item.id,
    title: item.title,
    oldQualityScore: vc?.qualityScore ?? null,
    newQualityScore: 0,
    oldFreshnessScore: vc?.freshnessScore ?? null,
    newFreshnessScore: 0,
    changed: false,
    missingStats: !vc?.stats,
  }
  if (!vc) return { item, diff: base }

  const newQualityScore = calculateQualityScore(vc.stats, vc.durationSec)
  const newFreshnessScore = calculateFreshnessScore(
    vc.publishedAt,
    newQualityScore,
    halfLifeDays,
    item.title
  )
  const changed =
    vc.qualityScore !== newQualityScore || vc.freshnessScore !== newFreshnessScore
  return {
    item: {
      ...item,
      videoConfig: {
        ...vc,
        qualityScore: newQualityScore,
        freshnessScore: newFreshnessScore,
      },
    },
    diff: { ...base, newQualityScore, newFreshnessScore, changed },
  }
}

function percentile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? null
}

export function summarizeScores(scores: Array<number | null | undefined>): ScoreDistribution {
  const values = scores.filter((s): s is number => typeof s === 'number').sort((a, b) => a - b)
  if (values.length === 0) {
    return {
      count: 0,
      min: null,
      max: null,
      mean: null,
      median: null,
      p10: null,
      p25: null,
      p75: null,
      p90: null,
      mode: null,
      passAt50: 0,
      passAt60: 0,
      passAt65: 0,
    }
  }
  const counts = new Map<number, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let modeValue = values[0]!
  let modeCount = 0
  for (const [v, c] of counts) {
    if (c > modeCount) {
      modeValue = v
      modeCount = c
    }
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  return {
    count: values.length,
    min: values[0] ?? null,
    max: values[values.length - 1] ?? null,
    mean: Math.round(mean * 10) / 10,
    median: percentile(values, 0.5),
    p10: percentile(values, 0.1),
    p25: percentile(values, 0.25),
    p75: percentile(values, 0.75),
    p90: percentile(values, 0.9),
    mode: { value: modeValue, count: modeCount },
    passAt50: values.filter((v) => v >= 50).length,
    passAt60: values.filter((v) => v >= 60).length,
    passAt65: values.filter((v) => v >= 65).length,
  }
}

/**
 * 对整库（顶级分类 + 子分类）重算分数。
 * 返回新数组（输入不被修改）与全量报告；不触碰在线库、不写文件。
 */
export function rescoreNavigationItems(
  items: NavigationItem[],
  options: RescoreOptions = {}
): { items: NavigationItem[]; report: RescoreReport } {
  const halfLifeDays = options.halfLifeDays ?? 90
  const before: Array<number | null> = []
  const after: Array<number | null> = []
  const diffs: RescoreItemDiff[] = []
  let rescored = 0
  let changed = 0
  let missingStats = 0

  const rescoreList = (list: NavigationSubItem[] | undefined): NavigationSubItem[] | undefined => {
    if (!list) return list
    return list.map((item) => {
      if (!item.videoConfig) {
        diffs.push({
          id: item.id,
          title: item.title,
          oldQualityScore: null,
          newQualityScore: 0,
          oldFreshnessScore: null,
          newFreshnessScore: 0,
          changed: false,
          missingStats: true,
        })
        missingStats++
        return item
      }
      before.push(item.videoConfig.qualityScore ?? null)
      const { item: next, diff } = rescoreVideoItem(item, halfLifeDays)
      after.push(diff.newQualityScore)
      diffs.push(diff)
      rescored++
      if (diff.changed) changed++
      if (diff.missingStats) missingStats++
      return next
    })
  }

  const nextItems = items.map((cat) => ({
    ...cat,
    items: rescoreList(cat.items),
    subCategories: cat.subCategories?.map((sub) => ({
      ...sub,
      items: rescoreList(sub.items),
    })),
  }))

  return {
    items: nextItems,
    report: {
      total: diffs.length,
      rescored,
      changed,
      unchanged: rescored - changed,
      missingStats,
      qualityBefore: summarizeScores(before),
      qualityAfter: summarizeScores(after),
      diffs,
    },
  }
}
