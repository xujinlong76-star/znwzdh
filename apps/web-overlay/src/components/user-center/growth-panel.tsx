'use client'

/**
 * 用户中心「我的成长」面板：
 * 顶层紧凑成长驾驶舱（等级 / 进度 / KPI 胶囊 / 挂机状态 / 16 周活跃日历）+
 * 4 标签页交互分区（今日与任务 / 赛季进度 / 成就徽章 / 图鉴与指南），
 * 将原先 ~4,650px 的超长瀑布流收纳进高信噪比、按需切换的精致工作区。
 *
 * 数据全部来自 growth.ts 的本机成长档案（localStorage，不回传服务端），
 * 档案变化通过 GROWTH_UPDATED_EVENT 广播，本面板订阅后即时刷新。
 */

import { useCallback, useEffect, useState, type KeyboardEvent } from 'react'
import Link from 'next/link'
import {
  Award,
  Bell,
  Cat,
  CheckCircle2,
  Circle,
  Compass,
  Crown,
  Fish,
  Flame,
  ListChecks,
  Moon,
  PawPrint,
  Snowflake,
  Sparkles,
  Trophy,
  X,
  Zap,
} from 'lucide-react'
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

type GrowthTabId = 'tasks' | 'season' | 'badges' | 'guide'
type BadgeFilter = 'all' | 'earned' | 'locked'

export function GrowthPanel() {
  const [profile, setProfile] = useState<GrowthProfile | null>(null)
  const [activeTab, setActiveTab] = useState<GrowthTabId>('tasks')
  const [badgeFilter, setBadgeFilter] = useState<BadgeFilter>('all')

  const refresh = useCallback(() => setProfile(loadGrowthProfile()), [])

  useEffect(() => {
    void Promise.resolve().then(() => {
      refresh()
      // 赛季任务 S1 的信号：打开成长页 = 到访赛季专区；新手链 D6：看过自己的档案
      recordSeasonZoneVisitAction()
      markRookiePanelSeenAction()
      trackGrowthEvent('growth_card_view')
    })
    window.addEventListener(GROWTH_UPDATED_EVENT, refresh)
    return () => window.removeEventListener(GROWTH_UPDATED_EVENT, refresh)
  }, [refresh])

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const order: GrowthTabId[] = ['tasks', 'season', 'badges', 'guide']
    const idx = order.indexOf(activeTab)
    let next = -1
    if (event.key === 'ArrowRight') next = (idx + 1) % order.length
    else if (event.key === 'ArrowLeft') next = (idx - 1 + order.length) % order.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = order.length - 1
    else return
    event.preventDefault()
    const nextTab = order[next]
    setActiveTab(nextTab)
    const btn = event.currentTarget.querySelector<HTMLButtonElement>(`[data-growth-tab="${nextTab}"]`)
    btn?.focus()
  }

  if (!profile) {
    return (
      <section className="rounded-2xl border border-border/70 bg-card/75 p-4 shadow-xs sm:p-5" aria-label="我的成长">
        <p className="text-sm text-muted-foreground">正在加载本机成长档案…</p>
      </section>
    )
  }

  const lp = levelProgress(profile.totalXp)
  const badges = deriveBadges(profile)
  const earnedBadges = badges.filter((b) => b.earned).length
  const lockedBadges = badges.length - earnedBadges
  const sortedBadges = [...badges].sort((a, b) => Number(b.earned) - Number(a.earned))
  const visibleBadges =
    badgeFilter === 'earned'
      ? sortedBadges.filter((b) => b.earned)
      : badgeFilter === 'locked'
        ? sortedBadges.filter((b) => !b.earned)
        : sortedBadges

  const streak = currentStreak(profile)
  const pureStreak = currentPureStreak(profile)
  const idleToday = todayIdleMinutes(profile)
  const featureIds = Object.keys(FEATURE_META) as GrowthFeature[]
  const usedFeaturesCount = featureIds.filter((id) => (profile.features[id]?.count ?? 0) > 0).length
  const tier = levelTier(lp.level)
  const TierIcon = TIER_ICONS[tier.kind]
  const mult = currentMultiplier(profile)
  const earnbackHoursLeft = profile.earnBack
    ? Math.max(0, Math.round((new Date(profile.earnBack.deadline).getTime() - Date.now()) / 3600000))
    : 0

  const tabs: Array<{ id: GrowthTabId; label: string; badge?: string; icon: typeof ListChecks }> = [
    { id: 'tasks', label: '今日与任务', icon: ListChecks },
    { id: 'season', label: '赛季进度', badge: `S${profile.season.index + 1}`, icon: Trophy },
    { id: 'badges', label: '成就徽章', badge: `${earnedBadges}/${badges.length}`, icon: Award },
    { id: 'guide', label: '图鉴与指南', badge: `${usedFeaturesCount}/${featureIds.length}`, icon: Compass },
  ]

  return (
    <div className="space-y-4">
      {/* 顶部精炼成长总览卡 */}
      <section className="rounded-2xl border border-border/70 bg-card/75 p-4 shadow-xs sm:p-5" aria-label="我的成长">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-amber-400/15 text-primary ring-1 ring-primary/20">
              <Cat className="h-6 w-6" aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold tracking-tight">
                  Lv.{lp.level} · {lp.title}
                </h2>
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-muted/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                  aria-label={`进阶阶段：${LEVEL_TIER_LABEL[tier.kind]}，已点亮 ${tier.count} 枚`}
                >
                  <span className="inline-flex items-center gap-0.5">
                    {Array.from({ length: 4 }, (_, i) => (
                      <TierIcon
                        key={i}
                        className={cn('h-3 w-3', i < tier.count ? 'text-primary' : 'text-muted-foreground opacity-45')}
                        aria-hidden
                      />
                    ))}
                  </span>
                  <span>{LEVEL_TIER_LABEL[tier.kind]}阶段</span>
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                总经验 <strong className="font-semibold text-foreground tabular-nums">{profile.totalXp}</strong>
                {' · '}
                {lp.nextLevel
                  ? `再赚 ${lp.toNext} 经验升至 Lv.${lp.nextLevel}「${lp.nextTitle}」`
                  : `已是最高等级——${lp.title}`}
              </p>
            </div>
          </div>

          {/* 4 枚高对比核心成长指标胶囊 */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl border border-border/60 bg-background/65 px-3 py-2">
              <span className="block text-[10px] text-muted-foreground">今日获得</span>
              <span className="mt-0.5 block text-sm font-semibold text-primary tabular-nums">+{todayXp(profile)} XP</span>
            </div>
            <div
              className="rounded-xl border border-border/60 bg-background/65 px-3 py-2"
              title={`身份档 ×${identityMultiplier(profile)} + 连胜加成 +${streakBonus(profile).toFixed(1)}，合计封顶 ×2.0`}
            >
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Zap className="h-3 w-3 text-amber-700 dark:text-amber-400" aria-hidden />
                当前倍率
              </span>
              <span className="mt-0.5 block text-sm font-semibold text-foreground tabular-nums">×{mult.toFixed(1)}</span>
            </div>
            <div
              className="rounded-xl border border-border/60 bg-background/65 px-3 py-2"
              title={`历史最长 ${profile.longestStreak} 天${profile.pureLongestStreak !== profile.longestStreak ? ` · 真连胜最长 ${profile.pureLongestStreak} 天` : ''}`}
            >
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Flame className="h-3 w-3 text-orange-500" aria-hidden />
                连续访问
              </span>
              <span className="mt-0.5 block text-sm font-semibold text-foreground tabular-nums">
                {streak} 天
                {pureStreak !== streak && <span className="ml-1 text-[10px] font-normal text-muted-foreground">真{pureStreak}</span>}
              </span>
            </div>
            <div className="rounded-xl border border-border/60 bg-background/65 px-3 py-2">
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Snowflake className="h-3 w-3 text-sky-500" aria-hidden />
                冻结卡
              </span>
              <span className="mt-0.5 block text-sm font-semibold text-foreground tabular-nums">{profile.freezeCards} 张</span>
            </div>
          </div>
        </div>

        {profile.earnBack && (
          <p className="mt-3 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-400">
            连胜抢救中：{profile.earnBack.brokenStreak} 天的连胜还剩约 {earnbackHoursLeft} 小时接回
          </p>
        )}

        {/* 升级进度条 + 精炼单行挂机陪伴状态 */}
        <div className="mt-3.5 space-y-2.5">
          <div
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={Math.round(lp.progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="升级进度"
          >
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round(lp.progress * 100)}%` }} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/50 bg-muted/35 px-3 py-2 text-xs">
            <span className="flex min-w-0 items-center gap-2 text-foreground">
              <Moon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              <span className="truncate font-medium">挂机陪伴：前台浏览每分钟 +1 经验，切后台自动暂停</span>
            </span>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
              今日 {idleToday}/{IDLE_DAILY_CAP_MINUTES} 分钟 · 累计 {profile.idleTotalMinutes} 分钟
            </span>
          </div>
        </div>

        {profile.pendingNotices.length > 0 && (
          <ul className="mt-3 space-y-2" aria-label="成长提醒">
            {profile.pendingNotices.map((n) => (
              <li key={n.id} className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
                <span className="min-w-0 flex-1 text-foreground">{n.text}</span>
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

        <div className="mt-3.5">
          <GrowthHeatmap profile={profile} />
        </div>

        {/* 成长中心 4 标签切换条 */}
        <div
          role="tablist"
          aria-label="成长档案分区"
          onKeyDown={handleTabKeyDown}
          className="mt-4 flex items-center gap-1 overflow-x-auto rounded-xl border border-border/60 bg-muted/45 p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {tabs.map(({ id, label, badge, icon: Icon }) => {
            const selected = activeTab === id
            return (
              <button
                key={id}
                type="button"
                role="tab"
                data-growth-tab={id}
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActiveTab(id)}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected
                    ? 'bg-background text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{label}</span>
                {badge && (
                  <span
                    className={cn(
                      'rounded-md px-1.5 py-0.5 font-mono text-[10px] tabular-nums',
                      selected ? 'bg-primary/10 text-primary' : 'bg-background/70 text-muted-foreground',
                    )}
                  >
                    {badge}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </section>

      {/* 标签内容区 */}
      {activeTab === 'tasks' && <GrowthTasks profile={profile} />}

      {activeTab === 'season' && <GrowthSeasonPanel profile={profile} />}

      {activeTab === 'badges' && (
        <section className="rounded-2xl border border-border/70 bg-card/75 p-4 shadow-xs sm:p-5" aria-label="成就徽章">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400">
                <Award className="h-3.5 w-3.5" aria-hidden />
              </span>
              成就徽章（已点亮 {earnedBadges} / {badges.length}）
            </h3>
            <div role="group" aria-label="筛选徽章状态" className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-muted/40 p-0.5">
              {(
                [
                  ['all', `全部 ${badges.length}`],
                  ['earned', `已点亮 ${earnedBadges}`],
                  ['locked', `待解锁 ${lockedBadges}`],
                ] as const
              ).map(([key, text]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={badgeFilter === key}
                  onClick={() => setBadgeFilter(key)}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    badgeFilter === key
                      ? 'bg-background text-foreground shadow-2xs'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>

          {/* 3 列网格：33 枚徽章正好 3 × 11 排满，彻底消灭第 33 枚孤儿卡 */}
          <ul className="mt-3.5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {visibleBadges.map((b) => (
              <li
                key={b.id}
                className={cn(
                  'relative flex flex-col justify-between rounded-xl border p-3 transition-colors',
                  b.earned
                    ? 'border-primary/45 bg-primary/[0.06] dark:bg-primary/[0.12]'
                    : 'border-border/60 bg-background/45 opacity-80',
                )}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xl leading-none" aria-hidden>{b.icon}</span>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-medium',
                        b.earned
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {b.earned ? '已点亮' : b.progressText}
                    </span>
                  </div>
                  <p className="mt-2 text-xs font-semibold text-foreground">{b.title}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{b.desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {activeTab === 'guide' && (
        <div className="space-y-4">
          <section className="rounded-2xl border border-border/70 bg-card/75 p-4 shadow-xs sm:p-5" aria-label="功能图鉴">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-500/10 text-violet-700 dark:text-violet-300">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />
                </span>
                功能图鉴：把本站用全，经验涨得最快
              </h3>
              <span className="text-[11px] text-muted-foreground">
                已探索 {usedFeaturesCount} / {featureIds.length} 项
              </span>
            </div>

            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {featureIds.map((id) => {
                const used = (profile.features[id]?.count ?? 0) > 0
                const meta = FEATURE_META[id]
                return (
                  <li
                    key={id}
                    className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-background/60 px-3 py-2.5"
                  >
                    {used ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
                    ) : (
                      <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-foreground">{meta.title}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{meta.desc}</p>
                    </div>
                    {used ? (
                      <span className="shrink-0 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                        已用 {profile.features[id]?.count} 次
                      </span>
                    ) : (
                      <Link
                        href={meta.href}
                        className="shrink-0 rounded-lg border border-primary/40 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
                      >
                        去体验
                      </Link>
                    )}
                  </li>
                )
              })}
            </ul>

            {/* 规则区默认折叠，不撑长面板首屏；数字一律引 growth.ts 常量，常量一改页面自动跟 */}
            <details className="mt-3.5 rounded-xl border border-border/60 bg-background/50 px-3 py-2.5" aria-label="成长规则">
              <summary className="cursor-pointer text-xs font-semibold text-foreground">成长规则：经验怎么来，倍率怎么算</summary>
              <div className="mt-2 space-y-2 text-xs leading-relaxed text-muted-foreground">
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
          </section>

          <HomepageGuideCard />
        </div>
      )}
    </div>
  )
}
