'use client'

/**
 * 首页连胜条（v2 定稿第 6 节）：只在三种状态出现——
 *  ① 连胜 ≥3 天的日常态；② 冻结卡刚垫付（有未读提醒）；③ Earn Back 抢救窗。
 * 其余时候（连胜 0–2 天、无事发生）不出现：首页每行都要挣自己的位置。
 * 关闭规则：①类关掉后本赛季不再出现；②③是事件通知，关掉只关这一次。
 * 大字模式（特大字档）不展示：长辈优先扫站，不给连胜压力。
 * 数据来自本机成长档案，档案变化（GROWTH_UPDATED_EVENT）即时刷新。
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Flame, Snowflake, X } from 'lucide-react'
import {
  GROWTH_UPDATED_EVENT,
  currentStreak,
  growthDayKey,
  loadGrowthProfile,
  seasonCalendar,
  type GrowthProfile,
} from '@/lib/growth'
import { FONT_SIZE_STORAGE_KEY, parseFontSizeLevel } from '@/lib/font-size'

const DISMISS_KEY = 'navhub.growth.streakBarDismissedSeason.v1'

type BarKind = 'earnback' | 'freeze' | 'daily' | null

function barKindOf(profile: GrowthProfile): BarKind {
  if (profile.earnBack) return 'earnback'
  const today = growthDayKey(new Date())
  if (profile.pendingNotices.some((n) => n.kind === 'freeze' && n.key === today)) return 'freeze'
  return null
}

export function StreakBar() {
  const [profile, setProfile] = useState<GrowthProfile | null>(null)
  const [hidden, setHidden] = useState(false)

  const refresh = useCallback(() => setProfile(loadGrowthProfile()), [])

  useEffect(() => {
    // 特大字档（长辈近似信号）不展示连胜条
    let fontOk = true
    try {
      fontOk = parseFontSizeLevel(window.localStorage.getItem(FONT_SIZE_STORAGE_KEY)) !== 'xlarge'
    } catch {
      fontOk = true
    }
    if (!fontOk) {
      setHidden(true)
      return
    }
    refresh()
    window.addEventListener(GROWTH_UPDATED_EVENT, refresh)
    return () => window.removeEventListener(GROWTH_UPDATED_EVENT, refresh)
  }, [refresh])

  if (!profile || hidden) return null

  const kind = barKindOf(profile)
  const eventId = kind === 'earnback' ? `earnback-${profile.earnBack!.openedAt}` : kind === 'freeze' ? `freeze-${growthDayKey(new Date())}` : null
  // ②③类：本次事件关掉后不再出现（按事件 id 记）；①类：本赛季不再出现
  let dismissed = false
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY)
    if (raw) {
      const rec = JSON.parse(raw) as { season?: number; events?: string[] }
      if (kind === 'daily') dismissed = rec.season === seasonCalendar().index
      else if (eventId) dismissed = (rec.events ?? []).includes(eventId)
    }
  } catch {
    dismissed = false
  }

  const streak = currentStreak(profile)

  const showDaily = kind === null && streak >= 3
  if (!kind && !showDaily) return null
  if (dismissed) return null

  const dismiss = () => {
    try {
      const raw = window.localStorage.getItem(DISMISS_KEY)
      const rec = raw ? (JSON.parse(raw) as { season?: number; events?: string[] }) : {}
      if (kind === 'daily' || (!kind && showDaily)) rec.season = seasonCalendar().index
      if (eventId) rec.events = [...(rec.events ?? []), eventId]
      window.localStorage.setItem(DISMISS_KEY, JSON.stringify(rec))
    } catch {
      /* 存不下就只关这一次渲染 */
    }
    setHidden(true)
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-3 sm:px-6" role="status">
      <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-card/70 px-3 py-2 text-sm">
        {kind === 'earnback' ? (
          <>
            <Flame className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
            <p className="min-w-0 flex-1">
              昨天没来，{profile.earnBack!.brokenStreak} 天的连胜先帮你留着——读 1 期简报、打开 2 个站就能接上。
              <Link href="/me" className="ml-1 font-medium text-primary">去看看</Link>
            </p>
          </>
        ) : kind === 'freeze' ? (
          <>
            <Snowflake className="h-4 w-4 shrink-0 text-sky-500" aria-hidden />
            <p className="min-w-0 flex-1">
              你不在的日子，冻结卡帮你留住了连胜——现在是 {streak} 天。
              <Link href="/me" className="ml-1 font-medium text-primary">看看我的成长</Link>
            </p>
          </>
        ) : (
          <>
            <Flame className="h-4 w-4 shrink-0 text-orange-500" aria-hidden />
            <p className="min-w-0 flex-1">
              连续访问 {streak} 天 · 历史最长 {profile.longestStreak} 天。
              <Link href="/me" className="ml-1 font-medium text-primary">看看我的成长</Link>
            </p>
          </>
        )}
        <button type="button" onClick={dismiss} aria-label="关闭连胜提醒" className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  )
}
