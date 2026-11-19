/**
 * 首页「今日中心」轻量徽标摘要（服务端 / 纯函数复用）：
 * 只提取计数与最近倒计时文案，不把完整今日模块直接塞在首页正文上方。
 */
import {
  nearestExamCountdown,
  todayNodes,
  type ExamUrgencyTier,
} from '@/lib/exam-calendar'
import { isPeakEligible } from '@/lib/exam-verification'

export interface HomeTodayBadgeSummary {
  todayCount: number
  urgentCount: number
  countdownLabel: string | null
  countdownTier: ExamUrgencyTier | null
}

/** 计算首页顶栏「今日」按钮角标与悬停摘要（确定性按传入时间戳算）。
 * 计数口径与 HomeTodayZone 一致：只计准入节点（§7.2，未核实节点不计入）。 */
export function computeHomeTodayBadge(nowMs: number = Date.now()): HomeTodayBadgeSummary {
  const nodes = todayNodes(nowMs).filter((item) => isPeakEligible(item.node, nowMs))
  const urgentCount = nodes.filter(
    (item) => item.kind === 'today' || item.kind === 'endsToday',
  ).length
  const countdown = nearestExamCountdown(nowMs)
  return {
    todayCount: nodes.length,
    urgentCount,
    countdownLabel: countdown ? countdown.label : null,
    countdownTier: countdown ? countdown.tier : null,
  }
}
