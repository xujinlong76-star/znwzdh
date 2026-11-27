'use client'

/**
 * 用户中心概览（仪表盘）。
 *
 * 拆分前这里是 1238 行的单页：状态机 + 资料编辑 + 统计 + 全量设置 + 信号清理 +
 * 最近操作 + 重复入口。现在职责收敛为：
 *   - 组装：账号卡、统计、快捷入口、同步与健康、个性化摘要、最近操作、分组入口；
 *   - 取数与四态状态机（loading / anonymous / ready / error）复用 useMeOverview（T1），
 *     服务端注入的首屏概览经 initialOverview 传入，不再自带一份取数实现；
 *   - 设置写路径复用 lib/me-settings-save 的 Save-then-Verify 内核（T1）；
 *   - 完整设置与资料编辑分别移到 `/me/settings`、`/me/account`。
 *
 * 原地即时交互控件（V5）：
 * 偏好设置从只读展示升级为 In-Place 即时修改（搜索引擎、密度、历史周期、智能极速预加载），
 * 修改后通过 Save-then-Verify 内核落盘并广播跨 Tab 与 data-density 样式属性。
 *
 * 固定文案（匿名 / 加载失败 / 登录状态无法确认）与 E2E 断言保持一致。
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { useFavorites } from '@/hooks/useFavorites'
import { useMeOverview } from '@/hooks/use-me-overview'
import { getAnonId } from '@/lib/identity'
import { saveSettingsPatchLocal, saveSettingsPatchToCloud, shouldUploadLocalSettingsFirst } from '@/lib/me-settings-save'
import type { MeOverview } from '@/lib/me-types'
import {
  clearProfileSignals,
  fetchProfileExplain,
  type HubProfileExplain,
} from '@/lib/navhub-api'
import {
  normalizeUserSettings,
  readLocalUserSettings,
  SEARCH_ENGINE_OPTIONS,
  CARD_DENSITY_OPTIONS,
  RETENTION_DAY_OPTIONS,
  type UserSettingsModel,
  type UserSettingsPatch,
  type SearchEngineId,
  type CardDensityMode,
  type HistoryRetentionDays,
} from '@/lib/user-settings'
import { contentDensityOf } from '@/lib/user-preferences'
import { cn } from '@/lib/utils'
import { CenterPageHeader } from '@/components/user-center/center-page-header'
import { SectionState } from '@/components/user-center/section-state'
import { AccountCard } from '@/components/user-center/dashboard/account-card'
import { StatsGrid } from '@/components/user-center/dashboard/stats-grid'
import { QuickActions } from '@/components/user-center/dashboard/quick-actions'
import { SyncHealthCard } from '@/components/user-center/dashboard/sync-health-card'
import { PersonalizationCard } from '@/components/user-center/dashboard/personalization-card'
import { RecentActivity, type ActivityItem } from '@/components/user-center/dashboard/recent-activity'
import {
  currentStreak,
  dailyTaskStatus,
  GROWTH_UPDATED_EVENT,
  levelProgress,
  loadGrowthProfile,
  type GrowthProfile,
} from '@/lib/growth'
import { EntryGroups } from '@/components/user-center/dashboard/entry-groups'
import { ThemeQuickToggle } from '@/components/user-center/dashboard/theme-quick-toggle'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ArrowRight, CheckCircle2, ChevronDown, Gift, RefreshCw, Settings2, User } from 'lucide-react'

/** 设置面板：原地即时交互控件（In-Place Controls），完整表单可前往 /me/settings */
// 单选组方向键：遵循 WAI-ARIA 单选组模式——方向键在组内移动并选中，
// Home/End 跳到两端；roving tabindex 保证整组只有一个 Tab 停靠点。
// 只在未禁用的选项之间移动；方向键与点击 pill 走同一条 onPatch 路径。
function moveRadioSelection(event: KeyboardEvent<HTMLDivElement>) {
  const buttons = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not([disabled])'),
  )
  if (buttons.length === 0) return
  const current = buttons.indexOf(event.target as HTMLButtonElement)
  if (current === -1) return
  let next = -1
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
    next = (current + 1) % buttons.length
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
    next = (current - 1 + buttons.length) % buttons.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = buttons.length - 1
  else return
  event.preventDefault()
  const target = buttons[next]
  target.focus()
  target.click()
}

function SettingsSummary({
  settings,
  local,
  onPatch,
  busy,
}: {
  settings: UserSettingsModel
  local: boolean
  onPatch?: (patch: UserSettingsPatch) => void
  busy?: boolean
}) {
  // U-476：可见引擎名须进入 accessible name（WCAG 2.5.3），否则 axe 报
  // label-content-name-mismatch；同一 label 既渲染可见文案、也拼进 aria-label。
  const currentSearchEngineLabel =
    SEARCH_ENGINE_OPTIONS.find((opt) => opt.value === settings.defaultSearchEngine)?.label ??
    '站内聚合搜索 (山羊胡)'
  return (
    <section className="flex h-full flex-col rounded-2xl border border-border/70 bg-card/75 p-4 shadow-xs sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-700 dark:text-sky-300">
              <Settings2 className="h-4 w-4" aria-hidden />
            </span>
            偏好设置
          </h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {local ? '保存在本浏览器，登录后自动同步' : '已同步云端，跨设备生效'}
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="text-xs">
          <Link href="/me/settings">
            管理设置
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden />
          </Link>
        </Button>
      </div>

      <div className="mt-3.5 grid flex-1 gap-2.5 sm:grid-cols-2">
        {/* 默认搜索引擎 */}
        <div className="flex flex-col justify-between gap-2 rounded-xl border border-border/60 bg-background/50 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground font-medium">默认搜索引擎</span>
            <span className="text-[10px] text-muted-foreground font-mono">即时生效</span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`默认搜索引擎：${currentSearchEngineLabel}`}
              disabled={busy || !onPatch}
              className="flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/90 px-2.5 text-xs font-medium text-foreground transition-colors focus:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
            >
              <span className="truncate">{currentSearchEngineLabel}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuRadioGroup
                value={settings.defaultSearchEngine}
                onValueChange={(value) => onPatch?.({ defaultSearchEngine: value as SearchEngineId })}
              >
                {SEARCH_ENGINE_OPTIONS.map((opt) => (
                  <DropdownMenuRadioItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* 卡片展示密度 */}
        <div className="flex flex-col justify-between gap-2 rounded-xl border border-border/60 bg-background/50 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground font-medium">卡片展示密度</span>
            <span className="text-[10px] text-muted-foreground font-mono">全站布局</span>
          </div>
          <div
            role="radiogroup"
            aria-label="卡片展示密度"
            className="grid grid-cols-3 rounded-lg border border-border/70 bg-muted/40 p-0.5"
            onKeyDown={moveRadioSelection}
          >
            {CARD_DENSITY_OPTIONS.map((opt) => {
              const active = settings.cardDensity === opt.value
              const label = opt.label.split(' (')[0]
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={busy || !onPatch}
                  onClick={() => onPatch?.({ cardDensity: opt.value as CardDensityMode })}
                  tabIndex={active ? 0 : -1}
                  className={cn(
                    'rounded-md py-1 text-center text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    active
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground disabled:opacity-50',
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {/* 历史保留周期 */}
        <div className="flex flex-col justify-between gap-2 rounded-xl border border-border/60 bg-background/50 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground font-medium">历史保留周期</span>
            <span className="text-[10px] text-muted-foreground font-mono">本地/云端</span>
          </div>
          <div
            role="radiogroup"
            aria-label="历史保留周期"
            className="grid grid-cols-4 gap-1"
            onKeyDown={moveRadioSelection}
          >
            {RETENTION_DAY_OPTIONS.map((opt) => {
              const active = settings.historyRetentionDays === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={busy || !onPatch}
                  onClick={() => onPatch?.({ historyRetentionDays: opt.value as HistoryRetentionDays })}
                  tabIndex={active ? 0 : -1}
                  className={cn(
                    'rounded-lg border py-1 text-center text-[11px] font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    active
                      ? 'border-primary bg-primary text-primary-foreground shadow-xs'
                      : 'border-border/60 bg-background/60 text-muted-foreground hover:border-primary/40 hover:text-foreground disabled:opacity-50',
                  )}
                >
                  {opt.label.replace(' (默认)', '').replace(' (1年)', '')}
                </button>
              )
            })}
          </div>
        </div>

        {/* 智能极速预加载 */}
        <div className="flex flex-col justify-between gap-2 rounded-xl border border-border/60 bg-background/50 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
              智能极速预加载
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="什么是智能极速预加载"
                    className="flex h-4 w-4 items-center justify-center rounded-full border border-border/70 bg-muted/50 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                  >
                    ?
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[240px] text-xs leading-relaxed">
                  基于 0-RTT 推测预热技术：悬停链接时提前预热，打开站点更快。
                </TooltipContent>
              </Tooltip>
            </span>
            <span className="text-[10px] text-muted-foreground font-mono">
              {settings.speculativeZeroRttEnabled ? '已开启' : '已关闭'}
            </span>
          </div>
          <div className="flex items-end justify-between gap-3">
            <span className="text-[11px] leading-snug text-muted-foreground">
              悬停链接时提前预热，打开站点更快
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={settings.speculativeZeroRttEnabled}
              aria-label="智能极速预加载"
              disabled={busy || !onPatch}
              onClick={() => onPatch?.({ speculativeZeroRttEnabled: !settings.speculativeZeroRttEnabled })}
              className={cn(
                'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-border-strong transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
                settings.speculativeZeroRttEnabled ? 'bg-primary' : 'bg-muted',
              )}
            >
              <span
                className={cn(
                  'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out',
                  settings.speculativeZeroRttEnabled ? 'translate-x-5' : 'translate-x-0',
                )}
              />
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * 概览页「今日成长速览」横幅卡（2026-11-21 结构重构）。
 *
 * 成长系统本体已迁至 /me/growth 独立 Tab，这里只留一张紧凑横向横幅。
 * 数据与成长系统同源（lib/growth：loadGrowthProfile + levelProgress +
 * dailyTaskStatus + currentStreak），绝不硬编码；档案变化经
 * GROWTH_UPDATED_EVENT 广播即时刷新。
 *
 * 数字口径（与 William 当前真实值一致）：
 *   文案 `Lv.4 · 422/600 XP` = 总经验 / 下一级门槛（Lv.5 在 600 XP），
 *   进度条可视化同一分数（422/600 ≈ 70%）；成长面板内的 in-level 进度条
 *  （levelProgress.progress，本级 62/240 ≈ 26%）是另一口径，留在成长 Tab 内。
 *
 * 诚实口径（U-372）：成长档案只存本机 localStorage、不回传服务端，
 * 横幅 Lv/XP 旁挂「本机」角标，别让用户以为等级已同步到云端；
 * 完整披露仍在成长页深处（growth-panel.tsx），两处文案同一口径。
 */
function GrowthBanner() {
  const [profile, setProfile] = useState<GrowthProfile | null>(null)

  useEffect(() => {
    const refresh = () => {
      try {
        setProfile(loadGrowthProfile())
      } catch {
        setProfile(null)
      }
    }
    refresh()
    window.addEventListener(GROWTH_UPDATED_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(GROWTH_UPDATED_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  if (!profile) {
    return (
      <section
        aria-label="今日成长速览"
        aria-busy="true"
        className="rounded-2xl border border-border/70 bg-card/75 p-4 shadow-xs sm:p-5"
      >
        <div className="h-5 w-32 animate-pulse rounded-lg bg-muted" />
        <div className="mt-3 h-2 w-full animate-pulse rounded-full bg-muted/60" />
      </section>
    )
  }

  const lp = levelProgress(profile.totalXp)
  const status = dailyTaskStatus(profile, new Date())
  const doneCount = status.slots.filter((s) => s.done).length
  const streak = currentStreak(profile, new Date())
  // 横幅分数 = 总经验 / 下一级门槛，与文案「422/600 XP」同一口径。
  const totalProgress = lp.nextXp ? Math.min(1, Math.max(0, profile.totalXp / lp.nextXp)) : 1
  const progressPct = Math.round(totalProgress * 100)

  return (
    <section
      aria-label="今日成长速览"
      className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/75 p-4 shadow-xs sm:flex-row sm:items-center sm:gap-4 sm:p-5"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-sm font-semibold tracking-tight">
            Lv.{lp.level} {lp.title} · {profile.totalXp}/{lp.nextXp ?? profile.totalXp} XP
          </span>
          <span
            className="rounded-full border border-border/70 bg-muted/60 px-1.5 py-px text-[10px] font-medium text-muted-foreground"
            title="成长档案只保存在这台设备的浏览器里，不会同步到云端"
          >
            本机
          </span>
          <span className="text-xs text-muted-foreground">连续 {streak} 天</span>
          <span className="text-xs text-muted-foreground">今日任务 {doneCount}/3</span>
        </div>
        <div
          className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={progressPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`距离下一级 Lv.${lp.nextLevel ?? lp.level} 的总进度`}
        >
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
        </div>
        {lp.nextXp && lp.nextLevel && (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            再赚 {lp.toNext} XP 升至 Lv.{lp.nextLevel} · {lp.nextTitle}
          </p>
        )}
      </div>
      <Button asChild size="sm" className="shrink-0 text-xs">
        <Link href="/me/growth">
          <Gift className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          去领每日宝箱
          <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
        </Link>
      </Button>
    </section>
  )
}

export function MeView({ initialOverview }: { initialOverview: MeOverview | null }) {
  const favorites = useFavorites()
  const { toast } = useToast()
  const {
    state,
    overview,
    error,
    anonId,
    settingsNotice,
    settingsError,
    dismissSettingsNotice,
    reload,
    updateSettings,
  } = useMeOverview({ initialOverview })
  const [explain, setExplain] = useState<HubProfileExplain | null>(null)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [localPrefs, setLocalPrefs] = useState<UserSettingsModel>(() => {
    const local = readLocalUserSettings()
    const cloud = initialOverview?.settings ? normalizeUserSettings(initialOverview.settings) : null
    // 与 lib/me-settings-save 同一条判定：云端还没有这一行时，本机这一份才是用户真实的偏好，
    // 不能拿服务端默认值当「你的设置」显示（也不能写回本机）。
    return cloud && !shouldUploadLocalSettingsFirst(cloud, local) ? cloud : local
  })
  const [verifyNotice, setVerifyNotice] = useState<string | null>(null)

  // 跨路由与跨 Tab 偏好总线监听
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    let bc: BroadcastChannel | null = null
    try {
      bc = new BroadcastChannel('navhub_settings_channel')
      bc.onmessage = (event) => {
        if (event.data && typeof event.data === 'object') {
          const normalized = normalizeUserSettings(event.data)
          setLocalPrefs(normalized)
          updateSettings(normalized)
        }
      }
    } catch {
      // 降级兜底
    }
    return () => {
      bc?.close()
    }
  }, [updateSettings])

  // 身份事件（合并 / 切换）触发的重取做 inflight 去重：
  // 合并完成的瞬间 merged + changed 两个事件几乎同时到达，不去重会连发两次 /api/me。
  const reloadInflight = useRef(false)
  const reloadOnce = useCallback(async () => {
    if (reloadInflight.current) return
    reloadInflight.current = true
    try {
      await reload()
    } finally {
      reloadInflight.current = false
    }
  }, [reload])

  useEffect(() => {
    const onMerged = () => void reloadOnce()
    window.addEventListener('navhub_identity_merged', onMerged)
    window.addEventListener('navhub_identity_changed', onMerged)
    return () => {
      window.removeEventListener('navhub_identity_merged', onMerged)
      window.removeEventListener('navhub_identity_changed', onMerged)
    }
  }, [reloadOnce])

  useEffect(() => {
    if (overview) void fetchProfileExplain(overview.identity).then(setExplain)
  }, [overview])

  // 最近操作（M10 接线）：辅助信息，失败保持静默，绝不打断主面板
  const refreshActivity = useCallback(async () => {
    try {
      const res = await fetch('/api/me/activity?limit=10', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { items?: ActivityItem[] }
      if (Array.isArray(data.items)) setActivity(data.items)
    } catch {
      // 辅助信息取不到就不展示：用户中心的错误条只留给关键区块
    }
  }, [])

  useEffect(() => {
    if (state !== 'ready') return
    // 取数放微任务：effect 同步段不触碰 setState（set-state-in-effect）
    void Promise.resolve().then(refreshActivity)
  }, [state, refreshActivity])

  /**
   * 概览原地即时修改偏好：
   * 登录态 PATCH 云端并回读校验，匿名态写本机。
   * Save-then-Verify 内核复用 lib/me-settings-save，并打通 BroadcastChannel 与 DOM 布局属性。
   */
  const applySettingsPatch = useCallback(
    async (patch: UserSettingsPatch) => {
      if (settingsBusy) return
      setSettingsBusy(true)
      setVerifyNotice(null)
      try {
        const result =
          state === 'ready'
            ? await saveSettingsPatchToCloud(patch)
            : saveSettingsPatchLocal(patch)
        setLocalPrefs(result.finalSettings)
        updateSettings(result.finalSettings)
        setVerifyNotice(result.notice)

        // 跨标签页广播
        try {
          if (typeof BroadcastChannel !== 'undefined') {
            const bc = new BroadcastChannel('navhub_settings_channel')
            bc.postMessage(result.finalSettings)
            bc.close()
          }
        } catch {
          // ignore
        }

        // 卡片密度同步到 html[data-density]
        if (patch.cardDensity) {
          document.documentElement.setAttribute('data-density', contentDensityOf(patch.cardDensity))
        }

        toast({ title: '偏好已即时生效', description: result.notice })
      } catch {
        toast({ title: '设置保存失败', description: '中枢暂不可用，请稍后重试', variant: 'destructive' })
      } finally {
        setSettingsBusy(false)
      }
    },
    [settingsBusy, state, updateSettings, toast],
  )

  const togglePersonalization = useCallback(async () => {
    if (!overview || settingsBusy) return
    const next = !overview.settings.personalizationEnabled
    await applySettingsPatch({ personalizationEnabled: next })
  }, [overview, settingsBusy, applySettingsPatch])

  const clearSignal = useCallback(async (kind: 'click' | 'search' | 'favorite') => {
    if (!overview) return
    const labels = { click: '点击', search: '搜索', favorite: '收藏' } as const
    setSettingsBusy(true)
    const ok = await clearProfileSignals(overview.identity, kind)
    setSettingsBusy(false)
    if (!ok) {
      toast({ title: `清理${labels[kind]}信号失败`, description: '中枢暂不可用，请稍后重试', variant: 'destructive' })
      return
    }
    toast({ title: `已清理${labels[kind]}信号`, description: '画像已按剩余行为重建。' })
    void fetchProfileExplain(overview.identity).then(setExplain)
  }, [overview, toast])

  const effectiveSettings = state === 'ready' && overview ? normalizeUserSettings(overview.settings) : localPrefs
  const displayAnonId = anonId || (state === 'anonymous' ? getAnonId() : '')

  return (
    <Container as="main" id="main-content" className="space-y-4 pb-20 pt-3 sm:space-y-5 sm:pb-14 sm:pt-4">
      <CenterPageHeader
        compact
        title="用户中心"
        eyebrow="账户与数据"
        icon={User}
        description="账号身份、收藏、历史、插件、个性化偏好与数据管理，从这里统一进入。"
        actions={
          <>
            <ThemeQuickToggle />
          </>
        }
      />

      {verifyNotice && (
        <div
          role="status"
          className="flex items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs text-emerald-700 dark:text-emerald-300"
        >
          <span className="flex items-center gap-1.5 font-medium">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {verifyNotice}
          </span>
          <button
            type="button"
            onClick={() => setVerifyNotice(null)}
            className="text-[11px] underline underline-offset-2 opacity-80 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            知道了
          </button>
        </div>
      )}

      {settingsNotice && (
        <div
          role="status"
          className="flex items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs text-emerald-700 dark:text-emerald-300"
        >
          <span className="flex items-center gap-1.5 font-medium">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {settingsNotice}
          </span>
          <button
            type="button"
            onClick={() => dismissSettingsNotice()}
            className="text-[11px] underline underline-offset-2 opacity-80 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            知道了
          </button>
        </div>
      )}

      {settingsError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-800 dark:text-amber-200"
        >
          <span className="min-w-0 font-medium">{settingsError}</span>
          <Button variant="outline" size="sm" className="text-xs" onClick={() => void reloadOnce()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            重试同步
          </Button>
        </div>
      )}

      {state === 'loading' && (
        <SectionState variant="loading" rows={6} rowClassName="h-24" loadingLabel="正在加载用户中心" />
      )}

      {state === 'anonymous' && (
        <div className="space-y-4 sm:space-y-5">
          {/* 首屏双栏 Bento 驾驶舱：左身份与资产，右高频偏好设置 */}
          <div className="grid gap-4 lg:grid-cols-12">
            <div className="min-w-0 lg:col-span-5">
              <AccountCard
                anonymous
                user={null}
                anonId={displayAnonId}
                favoritesCount={favorites.items.length}
              />
            </div>
            <div className="min-w-0 lg:col-span-7">
              <SettingsSummary
                settings={localPrefs}
                local
                onPatch={applySettingsPatch}
                busy={settingsBusy}
              />
            </div>
          </div>

          {/* 全部功能入口上移至首屏下沿，找收藏/历史/插件/金库不必滚过长成长面板 */}
          <EntryGroups
            favoritesCount={favorites.items.length}
            settings={localPrefs}
            vaultExists={false}
            profileReady={false}
            anonymous={true}
          />

          {/* 2026-11-21 结构重构：成长系统已迁至 /me/growth 独立 Tab，
              概览仅留一张「今日成长速览」横幅卡（数据与成长系统同源）。 */}
          <GrowthBanner />
        </div>
      )}

      {state === 'error' && (
        <SectionState
          variant="error"
          title="用户中心加载失败"
          description={error ?? '网络或中枢暂时不可用，请稍后重试。这不代表你的数据被清空。'}
          onRetry={() => void reloadOnce()}
        />
      )}

      {state === 'ready' && overview && (
        <div className="space-y-4 sm:space-y-5">
          <AccountCard
            anonymous={false}
            user={overview.user}
            anonId={displayAnonId}
            favoritesCount={overview.counts.favorites}
          />
          <StatsGrid counts={overview.counts} />
          <QuickActions />

          {/* 全部功能入口优先展示在个人驾驶舱核心位 */}
          <EntryGroups
            favoritesCount={overview.counts.favorites}
            installedPluginsCount={overview.counts.activePluginInstalls}
            searchesCount={overview.counts.searches}
            vaultExists={Boolean(overview.vault)}
            profileReady={Boolean(overview.profile)}
            anonymous={false}
            settings={effectiveSettings}
          />

          <div className="grid gap-4 lg:grid-cols-12">
            <div className="min-w-0 lg:col-span-7">
              <SettingsSummary
                settings={effectiveSettings}
                local={false}
                onPatch={applySettingsPatch}
                busy={settingsBusy}
              />
            </div>
            <div className="min-w-0 lg:col-span-5">
              <SyncHealthCard
                profile={overview.profile}
                vault={overview.vault}
                llmConfig={overview.llmConfig}
                settingsUpdatedAt={overview.settings.updatedAt}
                aliases={overview.aliases}
              />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            <div className="min-w-0 lg:col-span-7">
              <PersonalizationCard
                enabled={overview.settings.personalizationEnabled}
                busy={settingsBusy}
                explain={explain}
                onToggle={() => void togglePersonalization()}
                onClearSignal={(kind) => void clearSignal(kind)}
              />
            </div>
            <div className="min-w-0 lg:col-span-5">
              <RecentActivity items={activity} />
            </div>
          </div>

          {/* 2026-11-21 结构重构：成长系统已迁至 /me/growth 独立 Tab，
              概览仅留一张「今日成长速览」横幅卡（数据与成长系统同源）。 */}
          <GrowthBanner />
        </div>
      )}

      <Footer />
    </Container>
  )
}
