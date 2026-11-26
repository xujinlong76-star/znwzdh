'use client'

/**
 * 用户中心「我的成长」面板（2026-11-21 UX 全面重构）：
 *  1. 顶层精炼档案卡：价值驱动副标题（注入 LEVEL_UNLOCK_HINTS 升级回报钩子）、
 *     琥珀金强调色经验进度条、4 枚核心指标胶囊（含无障碍 ? Hover+Focus Tooltip）；
 *  2. 响应式 12 栏双栏（热力图 lg:col-span-7 + 下一级里程碑预告卡 lg:col-span-5），
 *     彻底消除 16 周热力图右侧留白与新号空态冷清感；
 *  3. 独立分段控制器（Segmented Control）：将 4 个二级 Tab 抽离出顶部档案卡，
 *     置于档案卡与下方内容区之间，建立清晰的「控制栏 → 内容区」格式塔从属关系；
 *  4. 支持 `/me/growth?openChest=1` 自动切至任务页签并触发开箱。
 */

import { useCallback, useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
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
  FREEZE_CAP_HIGH,
  FREEZE_CAP_HIGH_LEVEL,
  FREEZE_CAP_LOW,
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
  levelUnlockHint,
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const TIER_ICONS = { paw: PawPrint, bell: Bell, fish: Fish, crown: Crown } as const

type GrowthTabId = 'tasks' | 'season' | 'badges' | 'guide'
type BadgeFilter = 'all' | 'earned' | 'locked'

/** 无障碍指标说明触发器：同时支持鼠标 Hover 与键盘 Focus/Enter，不依赖纯悬停 */
function MetricHelpTip({
  label,
  content,
}: {
  label: string
  content: ReactNode
}) {
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border/80 bg-background/80 text-[10px] font-semibold leading-none text-muted-foreground transition-colors hover:border-amber-500/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          ?
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="center"
        className="max-w-[260px] rounded-xl border border-border/80 bg-popover px-3 py-2 text-[11px] leading-relaxed text-popover-foreground shadow-md"
      >
        {content}
      </TooltipContent>
    </Tooltip>
  )
}

export function GrowthPanel() {
  const searchParams = useSearchParams()
  const [profile, setProfile] = useState<GrowthProfile | null>(null)
  const [activeTab, setActiveTab] = useState<GrowthTabId>('tasks')
  const [badgeFilter, setBadgeFilter] = useState<BadgeFilter>('all')
  const [autoOpenChestToken, setAutoOpenChestToken] = useState<number>(0)

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

  // 跨页全清宝箱回流闭环：识别 /me/growth?openChest=1 后切至任务 Tab 并自动触发开箱，同时清理 URL 参数
  useEffect(() => {
    if (searchParams?.get('openChest') !== '1') return
    setActiveTab('tasks')
    setAutoOpenChestToken((t) => t + 1)
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('openChest')
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
    } catch {
      // 忽略 history 限制
    }
  }, [searchParams])

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
  const nextUnlock = levelUnlockHint(lp.nextLevel)
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
  const freezeCap = lp.level >= FREEZE_CAP_HIGH_LEVEL ? FREEZE_CAP_HIGH : FREEZE_CAP_LOW
  const earnbackHoursLeft = profile.earnBack
    ? Math.max(0, Math.round((new Date(profile.earnBack.deadline).getTime() - Date.now()) / 3600000))
    : 0
  const progressPct = Math.round(lp.progress * 100)

  const tabs: Array<{ id: GrowthTabId; label: string; badge?: string; icon: typeof ListChecks }> = [
    { id: 'tasks', label: '今日与任务', icon: ListChecks },
    { id: 'season', label: '赛季进度', badge: `S${profile.season.index + 1}`, icon: Trophy },
    { id: 'badges', label: '成就徽章', badge: `${earnedBadges}/${badges.length}`, icon: Award },
    { id: 'guide', label: '图鉴与指南', badge: `${usedFeaturesCount}/${featureIds.length}`, icon: Compass },
  ]

  return (
    <div className="space-y-4">
      {/* 顶部精炼档案大卡（不含二级 Tab，确保格式塔分组边界清晰） */}
      <section
        data-growth-profile-card="true"
        className="rounded-2xl border border-border/70 bg-card/85 p-4 shadow-xs sm:p-5"
        aria-label="我的成长"
      >
        {/* 身份头 + 价值驱动副标题 + 升级进度条 + 4 指标胶囊 */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3.5">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-amber-500/25 bg-amber-500/10 text-amber-700 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-300">
                <Cat className="h-6 w-6" aria-hidden />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold tracking-tight text-foreground">
                    Lv.{lp.level} · {lp.title}
                  </h2>
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-muted/75 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                    aria-label={`进阶阶段：${LEVEL_TIER_LABEL[tier.kind]}，已点亮 ${tier.count} 枚`}
                  >
                    <span className="inline-flex items-center gap-0.5">
                      {Array.from({ length: 4 }, (_, i) => (
                        <TierIcon
                          key={i}
                          className={cn(
                            'h-3 w-3',
                            i < tier.count
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-muted-foreground opacity-40',
                          )}
                          aria-hidden
                        />
                      ))}
                    </span>
                    <span>{LEVEL_TIER_LABEL[tier.kind]}阶段</span>
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  总经验 <strong className="font-semibold text-foreground tabular-nums">{profile.totalXp}</strong>
                  {' · '}
                  {lp.nextLevel ? (
                    <>
                      再赚 <strong className="font-semibold text-amber-700 dark:text-amber-400 tabular-nums">{lp.toNext} XP</strong> 升至 Lv.{lp.nextLevel}「{lp.nextTitle}」
                      {nextUnlock ? ` · ${nextUnlock.summary}` : ''}
                    </>
                  ) : (
                    `已是最高等级——${lp.title}`
                  )}
                </p>
              </div>
            </div>

            {/* 右侧专注浏览微注脚 + 无障碍 ? Tooltip */}
            <div className="flex items-center gap-1.5 rounded-xl border border-border/60 bg-background/70 px-2.5 py-1.5 text-[11px] text-muted-foreground">
              <span>
                专注浏览{' '}
                <strong className="font-semibold text-foreground tabular-nums">
                  {idleToday}/{IDLE_DAILY_CAP_MINUTES}
                </strong>{' '}
                分钟
              </span>
              <MetricHelpTip
                label="专注浏览经验换算规则"
                content={
                  <div className="space-y-1">
                    <p className="font-semibold text-foreground">专注浏览换算规则</p>
                    <p>
                      页面处于前台可见状态时自动计时，每满 1 分钟入账 +{IDLE_XP_PER_MINUTE} XP，每日上限 {IDLE_DAILY_CAP_MINUTES} 分钟（最高 +{IDLE_DAILY_CAP_MINUTES * IDLE_XP_PER_MINUTE} XP/天）。切后台自动暂停，不吃流量不打扰。
                    </p>
                  </div>
                }
              />
            </div>
          </div>

          {/* 升级进度条（克制琥珀金强调色）。
              U-376：可见口径标注——这根条是「本级进度」（levelProgress.progress，
              本级内已赚 / 本级跨度），与概览横幅的「总进度」（总经验 / 下一级门槛）
              是另一口径；以前只有 aria-label，没有可见文案。 */}
          <div className="mt-3.5 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>本级进度</span>
            <span className="font-mono font-semibold text-amber-700 dark:text-amber-400 tabular-nums">{progressPct}%</span>
          </div>
          <div
            className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={progressPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="本级进度"
          >
            <div
              className="h-full rounded-full bg-amber-500 transition-all duration-300 dark:bg-amber-400"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {/* 4 枚高对比核心成长指标胶囊 */}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl border border-border/60 bg-background/65 px-3 py-2">
              <span className="block text-[10px] text-muted-foreground">今日获得</span>
              <span className="mt-0.5 block text-sm font-semibold text-amber-700 dark:text-amber-400 tabular-nums">
                +{todayXp(profile)} XP
              </span>
            </div>

            <div className="rounded-xl border border-border/60 bg-background/65 px-3 py-2">
              <div className="flex items-center justify-between gap-1">
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Zap className="h-3 w-3 text-amber-700 dark:text-amber-400" aria-hidden />
                  当前倍率
                </span>
                <MetricHelpTip
                  label="当前倍率计算与连登提倍阶梯说明"
                  content={
                    <div className="space-y-1">
                      <p className="font-semibold text-foreground">
                        当前 ×{mult.toFixed(1)}（身份 ×{identityMultiplier(profile).toFixed(1)} + 连胜 +{streakBonus(profile).toFixed(1)}）
                      </p>
                      <p>
                        身份档：基础 ×{IDENTITY_TIER.base.toFixed(1)} / 登录 ×{IDENTITY_TIER.member.toFixed(1)} / 装为应用 ×{IDENTITY_TIER.homeOrPwa.toFixed(1)}（取高不叠）。
                      </p>
                      <p>
                        连登提倍阶梯：每连续活跃满 {STREAK_BONUS_STEP_DAYS} 天 +{STREAK_BONUS_STEP.toFixed(1)}（7 天 +0.1、14 天 +0.2、21 天封顶 +{STREAK_BONUS_CAP.toFixed(1)}），总倍率封顶 ×{MULTIPLIER_CAP.toFixed(1)}。
                      </p>
                    </div>
                  }
                />
              </div>
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
              <div className="flex items-center justify-between gap-1">
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Snowflake className="h-3 w-3 text-sky-500" aria-hidden />
                  冻结卡
                </span>
                <MetricHelpTip
                  label="冻结卡作用与获取途径说明"
                  content={
                    <div className="space-y-1">
                      <p className="font-semibold text-foreground">
                        断签自动保连胜（当前 {profile.freezeCards}/{freezeCap} 张）
                      </p>
                      <p>
                        作用：某天忘记来访时自动消耗 1 张垫付当天记录，保护连续访问不归零。
                      </p>
                      <p>
                        获取途径：开启「每日全清宝箱」有概率掉落（连空 3 次第 4 次必出），或完成本周任务「五日同行」与每满 7 天连胜自动补给。
                      </p>
                    </div>
                  }
                />
              </div>
              <span className="mt-0.5 block text-sm font-semibold text-foreground tabular-nums">{profile.freezeCards} 张</span>
            </div>
          </div>

          {profile.earnBack && (
            <p className="mt-3 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-400">
              连胜抢救中：{profile.earnBack.brokenStreak} 天的连胜还剩约 {earnbackHoursLeft} 小时接回
            </p>
          )}
        </div>

        {/* 响应式双栏：左活跃热力图（col-span-7） + 右下一级里程碑预告卡（col-span-5） */}
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-7">
            <GrowthHeatmap profile={profile} />
          </div>

          {/* 下一级里程碑预告卡 */}
          <aside
            data-next-milestone-card="true"
            aria-label="下一级里程碑预告"
            className="flex flex-col justify-between rounded-xl border border-amber-500/25 bg-amber-500/[0.04] px-3.5 py-3 dark:border-amber-400/20 dark:bg-amber-400/[0.05] lg:col-span-5"
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <Sparkles className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400" aria-hidden />
                  下一级里程碑预告
                </span>
                {nextUnlock && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-400/15 dark:text-amber-300">
                    {nextUnlock.stageTag}
                  </span>
                )}
              </div>

              {lp.nextLevel && nextUnlock ? (
                <>
                  <div className="mt-2.5 flex items-center gap-2.5">
                    <span
                      aria-hidden
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-background text-lg shadow-2xs"
                    >
                      {nextUnlock.previewIcon}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-foreground">
                        Lv.{lp.nextLevel} · {lp.nextTitle}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                        还差 <strong className="font-semibold text-amber-700 dark:text-amber-400">{lp.toNext} XP</strong> 解锁
                      </p>
                    </div>
                  </div>
                  <ul className="mt-2.5 space-y-1.5 text-[11px] text-muted-foreground">
                    {nextUnlock.perks.map((perk) => (
                      <li key={perk} className="flex items-start gap-1.5 leading-snug">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400" aria-hidden />
                        <span>{perk}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <div className="mt-3 flex items-center gap-2.5">
                  <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-background text-lg">
                    🌟
                  </span>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    你已登顶终极头衔「{lp.title}」，所有等阶印记全部点亮。
                  </p>
                </div>
              )}
            </div>

            <div className="mt-3 pt-2 border-t border-amber-500/15">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
                <span>当前阶段进度</span>
                <span className="font-mono font-semibold text-amber-700 dark:text-amber-400">{progressPct}%</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted/80">
                <div
                  className="h-full rounded-full bg-amber-500 transition-all duration-300 dark:bg-amber-400"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          </aside>
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
                  className="shrink-0 rounded-md p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 独立分段控制器（Segmented Control）：置于档案大卡与下方任务内容区之间，建立清晰视觉归属。
          桌面档右侧留出挂件安全区：小猫猫固定 right:16px / 48px 宽，会压住撑满内容区的
          最右「图鉴与指南」Tab（1366×768 实测重叠 13×12px）；移动端挂件抬高到底部导航
          之上、与 Tab 行不同区，故只在 md+ 生效。 */}
      <div
        role="tablist"
        aria-label="成长档案分区"
        data-growth-segmented-control="true"
        onKeyDown={handleTabKeyDown}
        className="flex items-center gap-1 overflow-x-auto rounded-2xl border border-border/70 bg-card/85 p-1.5 shadow-xs md:pr-14 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
                'inline-flex flex-1 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-medium transition-all',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:bg-muted/65 hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{label}</span>
              {badge && (
                <span
                  className={cn(
                    'rounded-md px-1.5 py-0.5 font-mono text-[10px] tabular-nums',
                    selected
                      ? 'bg-primary-foreground/15 text-primary-foreground'
                      : 'bg-muted/80 text-muted-foreground',
                  )}
                >
                  {badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* 标签内容区 */}
      {activeTab === 'tasks' && (
        <GrowthTasks
          profile={profile}
          onGoToGuide={() => setActiveTab('guide')}
          autoOpenChestToken={autoOpenChestToken}
        />
      )}

      {activeTab === 'season' && <GrowthSeasonPanel profile={profile} />}

      {activeTab === 'badges' && (
        <section className="rounded-2xl border border-border/70 bg-card/85 p-4 shadow-xs sm:p-5" aria-label="成就徽章">
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
                    ? 'border-amber-500/40 bg-amber-500/[0.06] dark:bg-amber-400/[0.10]'
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
                          ? 'bg-amber-500 text-amber-950 dark:bg-amber-400 dark:text-zinc-950'
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
          <section className="rounded-2xl border border-border/70 bg-card/85 p-4 shadow-xs sm:p-5" aria-label="功能图鉴">
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
                        className="shrink-0 rounded-lg border border-border-strong bg-background px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-amber-500/60 hover:text-amber-700 dark:hover:text-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

/**
 * 成长 Tab 内容组件（供「成长与任务」Tab 挂载，与 GrowthPanel 同体；
 * me-view 的 Tab wiring 由结构重构线负责，此处只提供别名导出）。
 */
export const GrowthHubTab = GrowthPanel
