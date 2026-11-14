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
import { Award, Bell, Cat, CheckCircle2, Circle, Crown, Fish, Flame, Moon, PawPrint, Snowflake, Sparkles, X, Zap } from 'lucide-react'
import {
  CATEGORY_NEW_XP,
  DAILY_FIRST_XP,
  DAILY_VISIT_XP,
  EARNBACK_MIN_STREAK,
  EARNBACK_WINDOW_MS,
  FEATURE_FIRST_EVER_XP,
  FEATURE_META,
  GROWTH_UPDATED_EVENT,
  HOMEPAGE_CLAIM_XP,
  IDENTITY_TIER,
  IDLE_DAILY_CAP_MINUTES,
  IDLE_XP_PER_MINUTE,
  LEVEL_TIER_LABEL,
  MULTIPLIER_CAP,
  PWA_CLAIM_XP,
  REPEAT_LIMIT,
  REPEAT_XP,
  STREAK_BONUS_CAP,
  STREAK_BONUS_STEP,
  STREAK_BONUS_STEP_DAYS,
  USAGE_DAILY_CAP,
  currentMultiplier,
  currentPureStreak,
  currentStreak,
  deriveBadges,
  dismissNoticeAction,
  identityMultiplier,
  levelProgress,
  levelTier,
  loadGrowthProfile,
  markRookiePanelSeenAction,
  recordSeasonZoneVisitAction,
  streakBonus,
  todayIdleMinutes,
  todayXp,
  type GrowthFeature,
  type GrowthProfile,
} from '@/lib/growth'
import { trackGrowthEvent } from '@/lib/growth-analytics'
import { HomepageGuideCard } from '@/components/growth/homepage-guide'
import { GrowthHeatmap } from '@/components/growth/growth-heatmap'
import { GrowthSeasonPanel } from '@/components/growth/growth-season-panel'
import { GrowthTasks } from '@/components/growth/growth-tasks'
import { cn } from '@/lib/utils'

const TIER_ICONS = { paw: PawPrint, bell: Bell, fish: Fish, crown: Crown } as const

export function GrowthPanel() {
  const [profile, setProfile] = useState<GrowthProfile | null>(null)

  const refresh = useCallback(() => setProfile(loadGrowthProfile()), [])

  useEffect(() => {
    refresh()
    // 赛季任务 S1 的信号：打开成长页 = 到访赛季专区；新手链 D6：看过自己的档案
    recordSeasonZoneVisitAction()
    markRookiePanelSeenAction()
    trackGrowthEvent('growth_card_view')
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
  const pureStreak = currentPureStreak(profile)
  const idleToday = todayIdleMinutes(profile)
  const featureIds = Object.keys(FEATURE_META) as GrowthFeature[]
  const tier = levelTier(lp.level)
  const TierIcon = TIER_ICONS[tier.kind]
  const mult = currentMultiplier(profile)
  const earnbackHoursLeft = profile.earnBack
    ? Math.max(0, Math.round((new Date(profile.earnBack.deadline).getTime() - Date.now()) / 3600000))
    : 0

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
              <p className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-0.5" aria-label={`进阶阶段：${LEVEL_TIER_LABEL[tier.kind]}，已点亮 ${tier.count} 枚`}>
                  {Array.from({ length: 4 }, (_, i) => (
                    <TierIcon key={i} className={cn('h-4 w-4', i < tier.count ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
                  ))}
                </span>
                <span>{LEVEL_TIER_LABEL[tier.kind]}阶段</span>
              </p>
              <p className="text-sm text-muted-foreground">
                总经验 {profile.totalXp}
                <span className="ml-2 inline-flex items-center gap-0.5 font-medium text-primary" title={`身份档 ×${identityMultiplier(profile)} + 连胜加成 +${streakBonus(profile).toFixed(1)}，合计封顶 ×2.0`}>
                  <Zap className="h-3.5 w-3.5" aria-hidden /> 当前倍率 ×{mult.toFixed(1)}
                </span>
              </p>
            </div>
          </div>
          <div className="text-right text-sm">
            <p>
              今日 <span className="font-semibold text-primary">+{todayXp(profile)}</span> 经验
            </p>
            {profile.earnBack ? (
              <p className="mt-0.5 font-medium text-amber-600">
                连胜抢救中：{profile.earnBack.brokenStreak} 天的连胜还剩约 {earnbackHoursLeft} 小时接回
              </p>
            ) : (
              <p className="mt-0.5 flex items-center justify-end gap-1 text-muted-foreground">
                <Flame className="h-3.5 w-3.5 text-orange-500" aria-hidden /> 连续访问 {streak} 天
                {pureStreak !== streak && <span>（真连胜 {pureStreak} 天）</span>}
                <span className="inline-flex items-center gap-0.5">
                  <Snowflake className="h-3.5 w-3.5 text-sky-500" aria-hidden /> {profile.freezeCards}
                </span>
              </p>
            )}
            <p className="mt-0.5 text-xs text-muted-foreground">
              历史最长 {profile.longestStreak} 天
              {profile.pureLongestStreak !== profile.longestStreak && ` · 真连胜最长 ${profile.pureLongestStreak} 天`}
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
              : `已是最高等级——${lp.title}，就是你。`}
          </p>
        </div>

        {profile.pendingNotices.length > 0 && (
          <ul className="mt-4 space-y-2" aria-label="成长提醒">
            {profile.pendingNotices.map((n) => (
              <li key={n.id} className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">{n.text}</span>
                <button
                  type="button"
                  aria-label="知道了"
                  onClick={() => setProfile(dismissNoticeAction(n.id))}
                  className="shrink-0 rounded-md p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex items-start gap-3 rounded-xl bg-muted/50 p-3">
          <Moon className="mt-0.5 h-5 w-5 shrink-0 animate-pulse text-primary" aria-hidden />
          <div className="text-sm">
            <p className="font-medium">挂机陪伴：小猫猫陪你逛站点也在攒经验</p>
            <p className="mt-0.5 text-muted-foreground">
              页面开着且在前台时，每分钟 +1 经验；今日已挂机 {idleToday} / {IDLE_DAILY_CAP_MINUTES} 分钟，累计 {profile.idleTotalMinutes} 分钟。切到后台就暂停，不偷跑。
            </p>
          </div>
        </div>

        <div className="mt-4">
          <GrowthHeatmap profile={profile} />
        </div>
      </section>

      <GrowthTasks profile={profile} />

      <GrowthSeasonPanel profile={profile} />

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
        {/* 规则区默认折叠，不撑长面板首屏；数字一律引 growth.ts 常量，常量一改页面自动跟 */}
        <details className="mt-3 rounded-xl border border-border/60 px-3 py-2" aria-label="成长规则">
          <summary className="cursor-pointer text-sm font-medium">成长规则：经验怎么来，倍率怎么算</summary>
          <div className="mt-2 space-y-2 text-sm text-muted-foreground">
            <div>
              <p className="font-medium text-foreground">经验来源</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                <li>功能首次使用 +{FEATURE_FIRST_EVER_XP}；每日首次 +{DAILY_FIRST_XP}；同一功能重复 +{REPEAT_XP}（每天第 2 次起、最多到第 {REPEAT_LIMIT} 次）</li>
                <li>逛到新分类 +{CATEGORY_NEW_XP}；每日到访 +{DAILY_VISIT_XP}</li>
                <li>挂机陪伴：页面开着且在前台时，每分钟 +{IDLE_XP_PER_MINUTE}，每日最多 {IDLE_DAILY_CAP_MINUTES} 分钟</li>
                <li>设为首页 +{HOMEPAGE_CLAIM_XP}（一次性，不带倍率）；装为应用 +{PWA_CLAIM_XP}（一次性，并开启 ×{IDENTITY_TIER.homeOrPwa.toFixed(1)}）</li>
              </ul>
            </div>
            <p>
              倍率算法：身份档基础 ×{IDENTITY_TIER.base.toFixed(1)} / 登录 ×{IDENTITY_TIER.member.toFixed(1)} / 装为应用 ×{IDENTITY_TIER.homeOrPwa.toFixed(1)}（取高不叠）
              + 连胜加成（每满 {STREAK_BONUS_STEP_DAYS} 天 +{STREAK_BONUS_STEP.toFixed(1)}，封顶 +{STREAK_BONUS_CAP.toFixed(1)}），
              合计封顶 ×{MULTIPLIER_CAP.toFixed(1)}；倍率只放大使用类经验。
            </p>
            <p>
              过渡口径：2026-11-15 前已领取设首页奖励的用户，×{IDENTITY_TIER.homeOrPwa.toFixed(1)} 档位保留不变，不收回；
              之后新领取的设首页奖励不再开启倍率（设首页是自述领取，网页无法核实）。
            </p>
            <p>
              使用类经验每日上限 {USAGE_DAILY_CAP}（任务类不计入）；成长日每天凌晨 4 点结算。
              连胜保护：冻结卡自动垫付、每周可设一个休息日、Earn Back {EARNBACK_WINDOW_MS / 3600000} 小时抢救
              （断签时连胜 ≥{EARNBACK_MIN_STREAK} 天才开）。成长档案只存在这台设备的浏览器里，不回传服务器。
            </p>
          </div>
        </details>
        <p className="mt-3 text-xs text-muted-foreground">
          说明：成长档案只存在这台设备的浏览器里，不回传服务器，换设备或清浏览器数据不会同步、也找不回——重要的话就一直用这台设备逛。连胜每天凌晨 4 点结算前一天；哪天实在来不了，冻结卡会自动顶上，也可以去赛季区设一个每周休息日。
        </p>
      </section>

      <HomepageGuideCard />
    </div>
  )
}
