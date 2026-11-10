'use client'

/**
 * 用户中心「我的成长」面板：等级 / 经验进度 / 今日所得 / 挂机陪伴 /
 * 成就徽章墙 / 功能图鉴 / 设为首页卡，一页看全。
 *
 * 数据全部来自 growth.ts 的本机成长档案（localStorage，不回传服务端），
 * 页面底部如实标注。档案变化通过 GROWTH_UPDATED_EVENT 广播，本面板
 * 订阅后即时刷新——在本站任何页面用功能赚的经验，回到这里都看得见。
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Award, Cat, CheckCircle2, Circle, Flame, Moon, Sparkles, Zap } from 'lucide-react'
import {
  FEATURE_META,
  GROWTH_UPDATED_EVENT,
  IDLE_DAILY_CAP_MINUTES,
  currentStreak,
  deriveBadges,
  levelProgress,
  loadGrowthProfile,
  todayIdleMinutes,
  todayXp,
  type GrowthFeature,
  type GrowthProfile,
} from '@/lib/growth'
import { HomepageGuideCard } from '@/components/growth/homepage-guide'
import { cn } from '@/lib/utils'

export function GrowthPanel() {
  const [profile, setProfile] = useState<GrowthProfile | null>(null)

  const refresh = useCallback(() => setProfile(loadGrowthProfile()), [])

  useEffect(() => {
    refresh()
    window.addEventListener(GROWTH_UPDATED_EVENT, refresh)
    return () => window.removeEventListener(GROWTH_UPDATED_EVENT, refresh)
  }, [refresh])

  if (!profile) {
    return (
      <section className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5" aria-label="我的成长">
        <p className="text-sm text-muted-foreground">正在加载本机成长档案…</p>
      </section>
    )
  }

  const lp = levelProgress(profile.totalXp)
  const badges = deriveBadges(profile)
  const earnedBadges = badges.filter((b) => b.earned).length
  const streak = currentStreak(profile)
  const idleToday = todayIdleMinutes(profile)
  const featureIds = Object.keys(FEATURE_META) as GrowthFeature[]

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5" aria-label="我的成长">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
              <Cat className="h-7 w-7 text-primary" aria-hidden />
            </span>
            <div>
              <h2 className="text-base font-semibold">
                Lv.{lp.level} · {lp.title}
              </h2>
              <p className="text-sm text-muted-foreground">
                总经验 {profile.totalXp}
                {profile.boost && (
                  <span className="ml-2 inline-flex items-center gap-0.5 font-medium text-primary">
                    <Zap className="h-3.5 w-3.5" aria-hidden /> 加速 ×1.5 中
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="text-right text-sm">
            <p>
              今日 <span className="font-semibold text-primary">+{todayXp(profile)}</span> 经验
            </p>
            <p className="mt-0.5 flex items-center justify-end gap-1 text-muted-foreground">
              <Flame className="h-3.5 w-3.5 text-orange-500" aria-hidden /> 连续访问 {streak} 天
            </p>
          </div>
        </div>

        <div className="mt-4">
          <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(lp.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="升级进度">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round(lp.progress * 100)}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {lp.nextLevel
              ? `再赚 ${lp.toNext} 经验升到 Lv.${lp.nextLevel}「${lp.nextTitle}」`
              : '已是最高等级，传说大猫猫就是你！'}
          </p>
        </div>

        <div className="mt-4 flex items-start gap-3 rounded-xl bg-muted/50 p-3">
          <Moon className="mt-0.5 h-5 w-5 shrink-0 animate-pulse text-primary" aria-hidden />
          <div className="text-sm">
            <p className="font-medium">挂机陪伴：小猫猫陪你逛站点也在攒经验</p>
            <p className="mt-0.5 text-muted-foreground">
              页面开着且在前台时，每分钟 +1 经验；今日已挂机 {idleToday} / {IDLE_DAILY_CAP_MINUTES} 分钟，累计 {profile.idleTotalMinutes} 分钟。切到后台就暂停，不偷跑。
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5" aria-label="成就徽章">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Award className="h-4 w-4 text-primary" aria-hidden /> 成就徽章（已点亮 {earnedBadges} / {badges.length}）
        </h3>
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {badges.map((b) => (
            <li
              key={b.id}
              className={cn(
                'rounded-xl border p-3',
                b.earned ? 'border-primary/40 bg-primary/5' : 'border-border/60 opacity-70',
              )}
            >
              <p className="text-xl" aria-hidden>{b.icon}</p>
              <p className="mt-1 text-sm font-medium">{b.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{b.desc}</p>
              <p className="mt-1 text-xs font-medium text-primary">{b.earned ? '已点亮' : b.progressText}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5" aria-label="功能图鉴">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden /> 功能图鉴：把本站用全，经验涨得最快
        </h3>
        <ul className="mt-3 divide-y divide-border/60">
          {featureIds.map((id) => {
            const used = (profile.features[id]?.count ?? 0) > 0
            const meta = FEATURE_META[id]
            return (
              <li key={id} className="flex items-center gap-3 py-2.5">
                {used ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" aria-hidden />
                ) : (
                  <Circle className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{meta.title}</p>
                  <p className="text-xs text-muted-foreground">{meta.desc}</p>
                </div>
                {used ? (
                  <span className="shrink-0 text-xs text-muted-foreground">已用 {profile.features[id]?.count} 次</span>
                ) : (
                  <Link href={meta.href} className="shrink-0 rounded-lg border border-primary/40 px-2.5 py-1 text-xs font-medium text-primary">
                    去体验
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          说明：成长档案只存在这台设备的浏览器里（和「场景包常用标记」同一套本机存储），不回传服务器，换设备或清缓存不会同步——想要跨设备等级，等本站帐号体系接入后再升级。
        </p>
      </section>

      <HomepageGuideCard />
    </div>
  )
}
